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
import { recomputeShowPriceCache } from "@/server/modules/reports";
import { isKidsMusical } from "./kids-filter";
import { normalizeTitle } from "./kopis";

export const AUTO_PUBLISH_CONFIDENCE = 0.85;

/** Strip region brackets, English subtitles, and anniversary/production suffixes for robust cross-channel matching. */
export function normalizeCoreTitle(raw: string): string {
  const stripped = raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[-–—]\s*\d+\s*주년.*$/g, " ")
    .replace(/\d+\s*주년(\s*기념)?(\s*공연)?/g, " ")
    .replace(/:\s*\d+\s*차\s*프로덕션.*$/g, " ")
    .replace(/[-–—]\s*(서울|대학로|부산|대구|대전|광주|인천|경기|울산|창원|의성|청주|수원|성남|고양|전주|여수|제주)\s*$/g, " ");
  return normalizeTitle(stripped);
}

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

export interface ShowMatchResult {
  showId: number;
  confidence: number;
}

/**
 * BP-SYNC-002-2: 3-factor matching (normalized/core title + region/venue + period overlap) with confidence score.
 * Returns null if 0 or ambiguous (>1) matches so admin manually confirms the DRAFT.
 */
export function matchShowWithConfidence(
  candidates: ShowMatchCandidate[],
  item: Pick<RawChannelDraft, "showTitle" | "venueName" | "regionHint" | "subRegionHint" | "startDate" | "endDate">,
): ShowMatchResult | null {
  const norm = normalizeTitle(item.showTitle);
  const core = normalizeCoreTitle(item.showTitle);
  if (!norm && !core) return null;

  const scored: Array<{ id: number; confidence: number }> = [];

  for (const c of candidates) {
    const cCore = normalizeCoreTitle(c.normalizedTitle);
    const exactTitle =
      (Boolean(norm) && c.normalizedTitle === norm) || (Boolean(core) && Boolean(cCore) && cCore === core);
    const partialTitle =
      !exactTitle &&
      ((Boolean(norm) && (c.normalizedTitle.includes(norm) || norm.includes(c.normalizedTitle))) ||
        (Boolean(core) && core.length >= 2 && Boolean(cCore) && (cCore.includes(core) || core.includes(cCore))));

    if (!exactTitle && !partialTitle) continue;

    // Factor 2: region or venue similarity
    let placeMatched = false;
    const hasPlaceHint = Boolean(item.subRegionHint || item.regionHint || item.venueName);
    if (hasPlaceHint) {
      const subOk = item.subRegionHint ? c.subRegion === item.subRegionHint : false;
      const regOk = item.regionHint ? c.region.includes(item.regionHint) : false;
      const venueNorm = (item.venueName ?? "").replace(/\s+/g, "");
      const candVenueNorm = c.venueName.replace(/\s+/g, "");
      const venueOk =
        Boolean(venueNorm) && (candVenueNorm.includes(venueNorm) || venueNorm.includes(candVenueNorm));
      placeMatched = subOk || regOk || venueOk;
      if (!placeMatched) continue;
    }

    // Factor 3: date period overlap (if dates provided)
    if (item.startDate && c.endDate < item.startDate) continue;
    if (item.endDate && c.startDate > item.endDate) continue;

    const confidence = exactTitle
      ? placeMatched
        ? 0.98
        : 0.9
      : placeMatched
        ? 0.88
        : 0.72;
    scored.push({ id: c.id, confidence });
  }

  if (scored.length === 1) return { showId: scored[0].id, confidence: scored[0].confidence };
  // If multiple candidates matched, prefer a single exact-title match if strictly higher than others
  const top = scored.filter((s) => s.confidence >= 0.95);
  return top.length === 1 ? { showId: top[0].id, confidence: top[0].confidence } : null;
}

export function matchShowThreeFactor(
  candidates: ShowMatchCandidate[],
  item: Pick<RawChannelDraft, "showTitle" | "venueName" | "regionHint" | "subRegionHint" | "startDate" | "endDate">,
): number | null {
  return matchShowWithConfidence(candidates, item)?.showId ?? null;
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

/** Isolated adapter execution: auto-publishes high-confidence matches as ACTIVE, queues ambiguous ones as DRAFT, respects admin_locked=1. */
export async function runChannelAdapter(
  db: AppDb,
  adapter: ChannelSyncAdapter,
  now = new Date(),
): Promise<{
  sourceName: string;
  status: "SUCCESS" | "FAILED";
  fetchedCount: number;
  publishedCount: number;
  draftCount: number;
  alert: boolean;
}> {
  const [run] = await db
    .insert(syncRuns)
    .values({ sourceName: adapter.sourceName, status: "RUNNING" })
    .returning({ id: syncRuns.id });

  try {
    const rawItems = await adapter.fetchDrafts();
    const candidates = await db
      .select({
        id: shows.id,
        title: shows.title,
        normalizedTitle: shows.normalizedTitle,
        venueName: shows.venueName,
        region: shows.region,
        subRegion: shows.subRegion,
        startDate: shows.startDate,
        endDate: shows.endDate,
      })
      .from(shows);

    const matchCandidates: ShowMatchCandidate[] = candidates.map((c) => ({
      id: c.id,
      normalizedTitle: normalizeCoreTitle(c.title) || c.normalizedTitle,
      venueName: c.venueName,
      region: c.region,
      subRegion: c.subRegion,
      startDate: c.startDate,
      endDate: c.endDate,
    }));

    let publishedCount = 0;
    let draftCount = 0;
    const touchedShowIds = new Set<number>();
    const nowIso = now.toISOString();

    for (const item of rawItems) {
      if (isKidsMusical(item.showTitle, item.venueName)) continue;
      const safeUrl = parseSafeExternalUrl(item.externalUrl);
      if (!safeUrl) continue;

      const match = matchShowWithConfidence(matchCandidates, item);
      const matchedShowId = match?.showId ?? null;
      const shouldAutoPublish = Boolean(match && match.confidence >= AUTO_PUBLISH_CONFIDENCE);

      const [existing] = await db
        .select({ id: deals.id, status: deals.status, showId: deals.showId, adminLocked: deals.adminLocked })
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
          status: shouldAutoPublish ? "ACTIVE" : "DRAFT",
          sourceType: "SYNC_APPROVED",
          lastVerifiedAt: nowIso,
        });
        if (shouldAutoPublish && matchedShowId) {
          publishedCount += 1;
          touchedShowIds.add(matchedShowId);
        } else {
          draftCount += 1;
        }
      } else if (existing.status === "DRAFT" && shouldAutoPublish && matchedShowId) {
        // Promote previously unmatched DRAFT once the corresponding show exists with high confidence
        await db
          .update(deals)
          .set({
            showId: matchedShowId,
            status: "ACTIVE",
            lastVerifiedAt: nowIso,
            updatedAt: nowIso,
          })
          .where(eq(deals.id, existing.id));
        publishedCount += 1;
        touchedShowIds.add(matchedShowId);
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

    for (const sid of touchedShowIds) {
      await recomputeShowPriceCache(db, sid);
    }

    await db
      .update(syncRuns)
      .set({
        status: "SUCCESS",
        fetchedCount: rawItems.length,
        draftCount: draftCount + publishedCount,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(syncRuns.id, run.id));

    return {
      sourceName: adapter.sourceName,
      status: "SUCCESS",
      fetchedCount: rawItems.length,
      publishedCount,
      draftCount,
      alert: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(syncRuns)
      .set({ status: "FAILED", errorMessage: msg, finishedAt: new Date().toISOString() })
      .where(eq(syncRuns.id, run.id));
    const alert = await hasConsecutiveFailureAlert(db, adapter.sourceName);
    return {
      sourceName: adapter.sourceName,
      status: "FAILED",
      fetchedCount: 0,
      publishedCount: 0,
      draftCount: 0,
      alert,
    };
  }
}

/** Tier-1 Ticketlink mapi JSON adapter (verified endpoint from SAD §4). */
export const ticketlinkAdapter: ChannelSyncAdapter = {
  sourceName: "TICKETLINK",
  async fetchDrafts() {
    const res = await fetch(
      "https://mapi.ticketlink.co.kr/mapi/ranking/genre/daily?categoryId=10&categoryId2=16&menu=RANKING",
      { headers: { "User-Agent": "MuDealBot/1.0 (+https://mudeal.kr)" } },
    );
    if (!res.ok) throw new Error(`Ticketlink mapi HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: {
        rankingList?: Array<{
          productId?: number;
          productName?: string;
          hallName?: string;
          locationName?: string;
          startDate?: number;
          endDate?: number;
        }>;
      };
    };
    const toDate = (ms?: number) =>
      typeof ms === "number" && Number.isFinite(ms) ? new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10) : undefined;
    const list = json.data?.rankingList ?? [];
    return list.slice(0, 20).flatMap((row) => {
      if (!row.productId || !row.productName) return [];
      return [
        {
          externalKey: `ticketlink-rank-${row.productId}`,
          channelName: "티켓링크",
          showTitle: row.productName,
          venueName: row.hallName,
          regionHint: row.locationName,
          startDate: toDate(row.startDate),
          endDate: toDate(row.endDate),
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
    const out: RawChannelDraft[] = [];
    const seen = new Set<string>();
    const regex = /href="(?:[^"]*NoticeMain\.aspx\?id=|#id=)(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

    for (let page = 1; page <= 2 && out.length < 15; page++) {
      const res = await fetch(
        `https://ticket.yes24.com/New/Notice/Ajax/axList.aspx?page=${page}&genre=15457`,
        { headers: { "User-Agent": "MuDealBot/1.0 (+https://mudeal.kr)" } },
      );
      if (!res.ok) throw new Error(`YES24 notice HTTP ${res.status}`);
      const html = await res.text();
      let m: RegExpExecArray | null;
      while ((m = regex.exec(html)) !== null && out.length < 15) {
        const id = m[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const title = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
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
    }
    return out;
  },
};

// shortcut: NOL & L.TICKET HTML/SSR parsers stay low-frequency opt-in; add __next_f extractors after live header verification
export const DEFAULT_CHANNEL_ADAPTERS: ChannelSyncAdapter[] = [ticketlinkAdapter, yes24Adapter];
