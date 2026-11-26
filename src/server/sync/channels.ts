import { desc, eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  deals,
  ocrImageJobs,
  shows,
  syncRuns,
  type ConditionTag,
  type DealType,
  type SeatGrade,
  type SubRegion,
} from "@/db/schema";
import { calcDiscountRate } from "@/lib/pricing";
import { parseSafeExternalUrl } from "@/lib/url";
import { normalizeTitle } from "./kopis";

export interface RawChannelDraft {
  externalKey: string;
  channelName: string;
  showTitle: string;
  venueName?: string;
  regionHint?: string;
  subRegionHint?: SubRegion;
  startDate?: string;
  endDate?: string;
  dealType: DealType;
  seatGrade?: SeatGrade;
  basePrice?: number | null;
  salePrice?: number | null;
  isUnconditional?: boolean;
  conditionTags?: ConditionTag[];
  conditionSummary?: string | null;
  opensAt?: string | null;
  externalUrl: string;
  expiresAt?: string | null;
  noticeImageUrls?: string[];
}

export interface ChannelSyncAdapter {
  readonly sourceName: string;
  fetchDrafts(): Promise<RawChannelDraft[]>;
}

export interface ShowMatchCandidate {
  id: number;
  normalizedTitle: string;
  venueName: string;
  region: string;
  subRegion: SubRegion;
  startDate: string;
  endDate: string;
}

/**
 * BP-SYNC-002-2: 3-factor matching (normalizedTitle + region/venue + period overlap).
 * Returns null if 0 or ambiguous (>1) matches so admin manually confirms the DRAFT.
 */
export function matchShowThreeFactor(
  candidates: ShowMatchCandidate[],
  item: Pick<RawChannelDraft, "showTitle" | "venueName" | "regionHint" | "subRegionHint" | "startDate" | "endDate">,
): number | null {
  const norm = normalizeTitle(item.showTitle);
  if (!norm) return null;

  const matches = candidates.filter((c) => {
    const titleOk = c.normalizedTitle === norm || c.normalizedTitle.includes(norm) || norm.includes(c.normalizedTitle);
    if (!titleOk) return false;

    // Factor 2: region or venue similarity
    let placeOk = true;
    if (item.subRegionHint || item.regionHint || item.venueName) {
      const subOk = item.subRegionHint ? c.subRegion === item.subRegionHint : false;
      const regOk = item.regionHint ? c.region.includes(item.regionHint) : false;
      const venueOk = item.venueName
        ? c.venueName.replace(/\s+/g, "").includes(item.venueName.replace(/\s+/g, "")) ||
          item.venueName.replace(/\s+/g, "").includes(c.venueName.replace(/\s+/g, ""))
        : false;
      placeOk = subOk || regOk || venueOk;
    }
    if (!placeOk) return false;

    // Factor 3: date period overlap (if dates provided)
    if (item.startDate && c.endDate < item.startDate) return false;
    if (item.endDate && c.startDate > item.endDate) return false;
    return true;
  });

  return matches.length === 1 ? matches[0].id : null;
}

/** Check if a channel failed 3 consecutive runs (FR-001 / NFR-005 admin warning). */
export async function hasConsecutiveFailureAlert(db: AppDb, sourceName: string): Promise<boolean> {
  const recent = await db
    .select({ status: syncRuns.status })
    .from(syncRuns)
    .where(eq(syncRuns.sourceName, sourceName))
    .orderBy(desc(syncRuns.startedAt))
    .limit(3);
  return recent.length === 3 && recent.every((r) => r.status === "FAILED");
}

/** ADR-004 & ADR-005: isolated adapter execution; writes DRAFT only, respects admin_locked=1, preserves existing deals on error. */
export async function runChannelAdapter(
  db: AppDb,
  adapter: ChannelSyncAdapter,
  now = new Date(),
): Promise<{ sourceName: string; status: "SUCCESS" | "FAILED"; fetchedCount: number; draftCount: number; alert: boolean }> {
  const [run] = await db
    .insert(syncRuns)
    .values({ sourceName: adapter.sourceName, status: "RUNNING" })
    .returning({ id: syncRuns.id });

  try {
    const rawItems = await adapter.fetchDrafts();
    const candidates = await db
      .select({
        id: shows.id,
        normalizedTitle: shows.normalizedTitle,
        venueName: shows.venueName,
        region: shows.region,
        subRegion: shows.subRegion,
        startDate: shows.startDate,
        endDate: shows.endDate,
      })
      .from(shows);

    let draftCount = 0;
    const nowIso = now.toISOString();

    for (const item of rawItems) {
      const safeUrl = parseSafeExternalUrl(item.externalUrl);
      if (!safeUrl) continue;

      const matchedShowId = matchShowThreeFactor(candidates, item);
      const [existing] = await db
        .select({ id: deals.id, adminLocked: deals.adminLocked })
        .from(deals)
        .where(eq(deals.externalKey, item.externalKey))
        .limit(1);

      // BP-SYNC-002-3: never overwrite admin_locked=1 deals
      if (existing?.adminLocked === 1) continue;

      const discountRate = calcDiscountRate(item.basePrice ?? null, item.salePrice ?? null);
      if (!existing) {
        await db.insert(deals).values({
          showId: matchedShowId,
          channelName: item.channelName,
          dealType: item.dealType,
          seatGrade: item.seatGrade ?? "ALL",
          basePrice: item.basePrice ?? null,
          salePrice: item.salePrice ?? null,
          discountRate,
          isUnconditional: item.isUnconditional === false ? 0 : 1,
          conditionTagsJson: item.conditionTags?.length ? JSON.stringify(item.conditionTags) : null,
          conditionSummary: item.conditionSummary ?? null,
          opensAt: item.opensAt ?? null,
          externalUrl: safeUrl,
          externalKey: item.externalKey,
          expiresAt: item.expiresAt ?? null,
          status: "DRAFT",
          sourceType: "SYNC_APPROVED",
          lastVerifiedAt: nowIso,
        });
        draftCount += 1;
      }

      // Queue new notice image URLs for Vision/OCR (unique imageUrl prevents duplicate calls)
      for (const rawImg of item.noticeImageUrls ?? []) {
        const safeImg = parseSafeExternalUrl(rawImg);
        if (!safeImg) continue;
        await db
          .insert(ocrImageJobs)
          .values({
            showId: matchedShowId,
            sourceChannel: item.channelName,
            sourcePageUrl: safeUrl,
            imageUrl: safeImg,
            ocrStatus: "QUEUED",
          })
          .onConflictDoNothing();
      }
    }

    await db
      .update(syncRuns)
      .set({
        status: "SUCCESS",
        fetchedCount: rawItems.length,
        draftCount,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(syncRuns.id, run.id));

    return { sourceName: adapter.sourceName, status: "SUCCESS", fetchedCount: rawItems.length, draftCount, alert: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(syncRuns)
      .set({ status: "FAILED", errorMessage: msg, finishedAt: new Date().toISOString() })
      .where(eq(syncRuns.id, run.id));
    const alert = await hasConsecutiveFailureAlert(db, adapter.sourceName);
    return { sourceName: adapter.sourceName, status: "FAILED", fetchedCount: 0, draftCount: 0, alert };
  }
}

/** Tier-1 Ticketlink mapi JSON adapter (verified endpoint from SAD §4). */
export const ticketlinkAdapter: ChannelSyncAdapter = {
  sourceName: "TICKETLINK",
  async fetchDrafts() {
    const res = await fetch(
      "https://mapi.ticketlink.co.kr/mapi/ranking/genre/daily?categoryId=10&categoryId2=16",
      { headers: { "User-Agent": "MuDealBot/1.0 (+https://mudeal.kr)" } },
    );
    if (!res.ok) throw new Error(`Ticketlink mapi HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: { rankingList?: Array<{ productId?: number; productName?: string; hallName?: string }> };
    };
    const list = json.data?.rankingList ?? [];
    return list.slice(0, 20).flatMap((row) => {
      if (!row.productId || !row.productName) return [];
      return [
        {
          externalKey: `ticketlink-rank-${row.productId}`,
          channelName: "티켓링크",
          showTitle: row.productName,
          venueName: row.hallName,
          dealType: "DISCOUNT_SITE" as const,
          externalUrl: `https://www.ticketlink.co.kr/product/${row.productId}`,
        },
      ];
    });
  },
};

/** Tier-1 YES24 discount/event/perk notice adapter (skips plain non-discount ticket opens). */
export const yes24Adapter: ChannelSyncAdapter = {
  sourceName: "YES24",
  async fetchDrafts() {
    const res = await fetch(
      "https://ticket.yes24.com/New/Notice/Ajax/axList.aspx?page=1&genre=15457",
      { headers: { "User-Agent": "MuDealBot/1.0 (+https://mudeal.kr)" } },
    );
    if (!res.ok) throw new Error(`YES24 notice HTTP ${res.status}`);
    const html = await res.text();
    const out: RawChannelDraft[] = [];
    const regex = /href="[^"]*\/New\/Notice\/NoticeMain\.aspx\?id=(\d+)[^"]*"[^>]*>([^<]+)</gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null && out.length < 15) {
      const id = m[1];
      const title = m[2].replace(/\s+/g, " ").trim();
      const dealType: DealType | null = title.includes("싱어롱")
        ? "SINGALONG"
        : title.includes("커튼콜")
          ? "CURTAIN_CALL"
          : title.includes("특전") || title.includes("포토카드") || title.includes("굿즈")
            ? "PERK_GOODS"
            : title.includes("할인") || title.includes("조기예매") || title.includes("타임세일")
              ? "DISCOUNT_SITE"
              : null;
      if (!dealType) continue;
      out.push({
        externalKey: `yes24-notice-${id}`,
        channelName: "YES24티켓",
        showTitle: title,
        dealType,
        conditionSummary: title,
        externalUrl: `https://ticket.yes24.com/New/Notice/NoticeMain.aspx?id=${id}`,
      });
    }
    return out;
  },
};

// shortcut: NOL & L.TICKET HTML/SSR parsers stay low-frequency opt-in; add __next_f extractors after live header verification
export const DEFAULT_CHANNEL_ADAPTERS: ChannelSyncAdapter[] = [ticketlinkAdapter, yes24Adapter];
