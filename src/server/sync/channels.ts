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
import { hasMeaningfulBenefit } from "./benefit-filter";
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
  posterUrl?: string | null;
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
      const venueNorm = (item.venueName ?? "").replace(/^NOL\s+/i, "").replace(/\s+/g, "");
      const candVenueNorm = c.venueName.replace(/^NOL\s+/i, "").replace(/\s+/g, "");
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
        posterUrl: shows.posterUrl,
        venueName: shows.venueName,
        region: shows.region,
        subRegion: shows.subRegion,
        startDate: shows.startDate,
        endDate: shows.endDate,
      })
      .from(shows);

    const posterByShowId = new Map<number, string | null>(candidates.map((c) => [c.id, c.posterUrl]));

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

      // Backfill missing show poster (e.g. Excel-imported shows) from channel thumbnail
      if (matchedShowId && item.posterUrl && !posterByShowId.get(matchedShowId)) {
        const safePoster = parseSafeExternalUrl(item.posterUrl);
        if (safePoster) {
          await db
            .update(shows)
            .set({ posterUrl: safePoster, updatedAt: nowIso })
            .where(eq(shows.id, matchedShowId));
          posterByShowId.set(matchedShowId, safePoster);
        }
      }

      const discountRate = calcDiscountRate(item.basePrice ?? null, item.salePrice ?? null);
      const meaningful = hasMeaningfulBenefit({
        dealType: item.dealType,
        basePrice: item.basePrice ?? null,
        salePrice: item.salePrice ?? null,
        discountRate,
        conditionSummary: item.conditionSummary ?? null,
      });

      if (meaningful) {
        const [existing] = await db
          .select({ id: deals.id, status: deals.status, showId: deals.showId, adminLocked: deals.adminLocked })
          .from(deals)
          .where(eq(deals.externalKey, item.externalKey))
          .limit(1);

        // BP-SYNC-002-3: never overwrite admin_locked=1 deals
        if (existing?.adminLocked !== 1) {
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
        }
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

/** Tier-1 Ticketlink mapi adapter: ranking posters (for show backfill) + real event/discount notices only. */
export const ticketlinkAdapter: ChannelSyncAdapter = {
  sourceName: "TICKETLINK",
  async fetchDrafts() {
    const out: RawChannelDraft[] = [];

    // 1. Notice API: only ingest real discount/perk/singalong/special-curtain-call notices (never plain ticket opens)
    try {
      const nRes = await fetch(
        "https://mapi.ticketlink.co.kr/mapi/notice/list?page=1&size=30&categoryId=10",
        { headers: { "User-Agent": "MuDealBot/1.0 (+https://mudeal.kr)" } },
      );
      if (nRes.ok) {
        const nJson = (await nRes.json()) as {
          data?: { notices?: Array<{ noticeId?: number; title?: string }> };
        };
        for (const n of nJson.data?.notices ?? []) {
          if (!n.noticeId || !n.title) continue;
          const title = n.title.trim();
          const dealType: DealType | null = title.includes("싱어롱")
            ? "SINGALONG"
            : title.includes("커튼콜")
              ? "CURTAIN_CALL"
              : title.includes("특전") || title.includes("포토카드") || title.includes("굿즈")
                ? "PERK_GOODS"
                : null;
          if (!dealType) continue;
          out.push({
            externalKey: `ticketlink-notice-${n.noticeId}`,
            channelName: "티켓링크",
            showTitle: title,
            dealType,
            conditionSummary: title,
            externalUrl: `https://www.ticketlink.co.kr/help/notice/${n.noticeId}`,
          });
        }
      }
    } catch {
      // Keep ranking poster backfill even if notice API fails
    }

    // 2. Ranking API: pass posterUrl for show backfill; hasMeaningfulBenefit prevents price-less rows from becoming deals
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
          imgUrl?: string;
          startDate?: number;
          endDate?: number;
        }>;
      };
    };
    const toDate = (ms?: number) =>
      typeof ms === "number" && Number.isFinite(ms) ? new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10) : undefined;
    for (const row of (json.data?.rankingList ?? []).slice(0, 20)) {
      if (!row.productId || !row.productName) continue;
      const posterUrl = row.imgUrl
        ? row.imgUrl.startsWith("//")
          ? `https:${row.imgUrl}`
          : row.imgUrl
        : null;
      out.push({
        externalKey: `ticketlink-rank-${row.productId}`,
        channelName: "티켓링크",
        showTitle: row.productName,
        venueName: row.hallName,
        regionHint: row.locationName,
        startDate: toDate(row.startDate),
        endDate: toDate(row.endDate),
        dealType: "DISCOUNT_SITE" as const,
        externalUrl: `https://www.ticketlink.co.kr/product/${row.productId}`,
        posterUrl,
      });
    }
    return out;
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

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

function parseKrwDigits(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function inferTagsAndType(badges: string[]): {
  dealType: DealType;
  conditionTags: ConditionTag[];
  isUnconditional: boolean;
} {
  const joined = badges.join(" ");
  const tags: ConditionTag[] = [];
  if (joined.includes("마티네")) tags.push("MATINEE");
  if (joined.includes("재관람")) tags.push("REWATCH");
  if (joined.includes("학생") || joined.includes("청년") || joined.includes("수험생") || joined.includes("청소년")) {
    tags.push("YOUTH_STUDENT");
  }
  if (joined.includes("직장인")) tags.push("OFFICE_WORKER");
  if (joined.includes("카드") || joined.includes("제휴")) tags.push("CARD_PARTNER");

  const dealType: DealType = joined.includes("로터리")
    ? "LOTTERY"
    : joined.includes("타임세일") || joined.includes("타임특가")
      ? "TIMESALE"
      : joined.includes("카드") || joined.includes("제휴")
        ? "CARD_EVENT"
        : "DISCOUNT_SITE";

  return {
    dealType,
    conditionTags: tags,
    isUnconditional: tags.length === 0,
  };
}

/** Extract __next_f payload items from NOL musical genre SSR HTML (pure parser for unit tests). */
export function parseNolMusicalHtml(html: string): Array<{
  goodsCode: string;
  title: string;
  venueName?: string;
  regionHint?: string;
  basePrice: number | null;
  salePrice: number | null;
  badges: string[];
  url: string;
  thumbnail: string | null;
  hasDiscount: boolean;
}> {
  const chunks: string[] = [];
  const pushRe = /self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = pushRe.exec(html)) !== null) {
    try {
      chunks.push(JSON.parse(`"${m[1]}"`) as string);
    } catch {
      // Ignore non-JSON chunk
    }
  }
  const combined = chunks.join("");
  const byGoodsCode = new Map<
    string,
    {
      goodsCode: string;
      title: string;
      venueName?: string;
      regionHint?: string;
      basePrice: number | null;
      salePrice: number | null;
      badges: string[];
      url: string;
      thumbnail: string | null;
      hasDiscount: boolean;
    }
  >();

  const widgetRe = /"header":\{"title":"([^"]+)"[^}]*\},"items":\[/g;
  while ((m = widgetRe.exec(combined)) !== null) {
    const widgetTitle = m[1];
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let end = start;
    let inStr = false;
    let esc = false;
    for (let i = start; i < combined.length; i++) {
      const ch = combined[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end <= start) continue;

    let items: Array<{
      id?: string;
      title?: string;
      prices?: Array<{ originPrice?: string; discountPrice?: string; discountRate?: string }>;
      benefitBadges?: Array<{ text?: string }>;
      locationDetails?: string[];
      action?: { web?: string };
      thumbnail?: string;
    }>;
    try {
      items = JSON.parse(combined.slice(start, end));
    } catch {
      continue;
    }

    const regionHint = widgetTitle.includes("서울")
      ? "서울"
      : widgetTitle.includes("부산")
        ? "부산"
        : widgetTitle.includes("대구")
          ? "대구"
          : widgetTitle.includes("대전")
            ? "대전"
            : widgetTitle.includes("광주")
              ? "광주"
              : widgetTitle.includes("강원")
                ? "강원"
                : undefined;

    for (const it of items) {
      if (!it.id || !it.title) continue;
      const goodsCode = it.id.split(":")[0]?.trim();
      if (!goodsCode) continue;
      const price = it.prices?.[0];
      const basePrice = parseKrwDigits(price?.originPrice);
      const salePrice = parseKrwDigits(price?.discountPrice);
      const badges = (it.benefitBadges ?? []).map((b) => b.text?.trim() ?? "").filter(Boolean);
      const webUrl = it.action?.web?.startsWith("https://")
        ? it.action.web
        : `https://tickets.interpark.com/goods/${goodsCode}`;
      const hasDiscount = salePrice !== null || widgetTitle.includes("할인");

      const prev = byGoodsCode.get(goodsCode);
      // Prefer discounted entry over plain regional listing for the same goodsCode
      if (prev && prev.hasDiscount && !hasDiscount) continue;
      byGoodsCode.set(goodsCode, {
        goodsCode,
        title: it.title.trim(),
        venueName: it.locationDetails?.[0]?.trim(),
        regionHint,
        basePrice: basePrice ?? prev?.basePrice ?? null,
        salePrice: salePrice ?? prev?.salePrice ?? null,
        badges: badges.length ? badges : (prev?.badges ?? []),
        url: webUrl.includes("/ticket/places/") ? webUrl : (prev?.url ?? webUrl),
        thumbnail: it.thumbnail?.startsWith("https://") ? it.thumbnail : (prev?.thumbnail ?? null),
        hasDiscount: hasDiscount || Boolean(prev?.hasDiscount),
      });
    }
  }

  return Array.from(byGoodsCode.values());
}

/** Extract NOL notice image URLs (Play/ITM/Data/Modify/...) from product detail HTML for Vision OCR. */
export function parseNolNoticeImages(detailHtml: string): string[] {
  const matches =
    detailHtml.match(/https:\/\/ticketimage\.interpark\.com\/Play\/ITM\/Data\/Modify\/[^"'\\<\s]+?\.(?:jpg|jpeg|png|webp)/gi) ??
    [];
  return Array.from(new Set(matches)).slice(0, 3);
}

/** Tier-1 NOL Ticket adapter (__next_f SSR JSON + detail notice images queued for Gemini Vision OCR). */
export const nolAdapter: ChannelSyncAdapter = {
  sourceName: "NOL",
  async fetchDrafts() {
    const res = await fetch("https://nol.yanolja.com/ticket/genre/musical", { headers: BROWSER_HEADERS });
    if (!res.ok) throw new Error(`NOL genre HTTP ${res.status}`);
    const items = parseNolMusicalHtml(await res.text()).filter((it) => !isKidsMusical(it.title, it.venueName));

    // Prioritize discounted items first, then regional musicals; fetch detail notice images for top 8 for OCR
    items.sort((a, b) => Number(b.hasDiscount) - Number(a.hasDiscount));
    const drafts: RawChannelDraft[] = [];
    let detailFetches = 0;

    for (const it of items.slice(0, 25)) {
      let noticeImageUrls: string[] = [];
      if (detailFetches < 8 && it.url.includes("nol.yanolja.com/ticket/places/")) {
        detailFetches += 1;
        try {
          const dRes = await fetch(it.url, { headers: BROWSER_HEADERS });
          if (dRes.ok) noticeImageUrls = parseNolNoticeImages(await dRes.text());
        } catch {
          // Keep deal even if detail page notice lookup fails
        }
      }

      const { dealType, conditionTags, isUnconditional } = inferTagsAndType(it.badges);
      const conditionSummary = it.badges.length > 0 ? it.badges.join(" · ") : it.hasDiscount ? "NOL티켓 할인 진행 중" : null;

      drafts.push({
        externalKey: `nol-goods-${it.goodsCode}`,
        channelName: "NOL티켓",
        showTitle: it.title,
        venueName: it.venueName,
        regionHint: it.regionHint,
        dealType,
        seatGrade: "ALL",
        basePrice: it.basePrice,
        salePrice: it.salePrice,
        isUnconditional,
        conditionTags,
        conditionSummary,
        externalUrl: it.url,
        posterUrl: it.thumbnail,
        noticeImageUrls,
      });
    }
    return drafts;
  },
};

/** Parse L.TICKET detail HTML for title, venue, and lowest discounted seat price (pure parser for unit tests). */
export function parseLTicketDetailHtml(html: string): {
  title: string | null;
  venueName: string | null;
  seatGrade: SeatGrade;
  basePrice: number | null;
  salePrice: number | null;
  posterUrl: string | null;
} {
  const gaNameMatch = /item_name:\s*['"]([^'"]+)['"]/i.exec(html);
  const ogMatch = /<meta\s+property="og:title"\s+content="([^"]+)"/i.exec(html);
  const titleTagMatch = /<title>([^<]+)<\/title>/i.exec(html);
  const cleanTitle = (s?: string | null) => {
    const t = s?.replace(/\s*[-|]\s*(L\.?TICKET|엘티켓).*$/i, "").trim() ?? "";
    return !t || /^L\.?TICKET$/i.test(t) || t === "엘티켓" ? null : t;
  };
  const rawTitle = cleanTitle(gaNameMatch?.[1]) ?? cleanTitle(ogMatch?.[1]) ?? cleanTitle(titleTagMatch?.[1]);

  const venueMatch = /class="detail_place_link"[\s\S]*?<span>([^<]+)/i.exec(html);
  const venueName = venueMatch?.[1]?.trim() ?? null;

  const posterMatch =
    /(https:\/\/cdn\.l-ticket\.co\.kr\/images\/product\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp|gif))/i.exec(html);
  const posterUrl = posterMatch?.[1] ?? null;

  const rowRe =
    /<th[^>]*scope="row"[^>]*>([^<]+)<\/th>\s*<td>\s*<div class="seat_price_value">\s*<strong>([0-9,]+)원<\/strong>(?:\s*<span class="max_discount">[^0-9]*([0-9,]+)원<\/span>)?/gi;
  let best: { seatGrade: SeatGrade; basePrice: number; salePrice: number | null } | null = null;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const gradeRaw = m[1].trim().toUpperCase();
    const seatGrade: SeatGrade = gradeRaw.includes("VIP")
      ? "VIP"
      : gradeRaw.startsWith("R")
        ? "R"
        : gradeRaw.startsWith("S")
          ? "S"
          : gradeRaw.startsWith("A")
            ? "A"
            : "ALL";
    const basePrice = parseKrwDigits(m[2]);
    const salePrice = parseKrwDigits(m[3]);
    if (!basePrice) continue;
    const effective = salePrice ?? basePrice;
    if (!best || effective < (best.salePrice ?? best.basePrice)) {
      best = { seatGrade, basePrice, salePrice };
    }
  }

  // Fallback to GA4 item price if lower than basePrice
  if (best && !best.salePrice) {
    const gaPrice = parseKrwDigits(/item_category:[^}]*price:\s*(\d+)/i.exec(html)?.[1]);
    if (gaPrice && gaPrice < best.basePrice) {
      best.salePrice = gaPrice;
    }
  }

  return {
    title: rawTitle,
    venueName,
    seatGrade: best?.seatGrade ?? "ALL",
    basePrice: best?.basePrice ?? null,
    salePrice: best?.salePrice ?? null,
    posterUrl,
  };
}

/** Tier-1 L.TICKET adapter (BFYSAL sale list + product detail seat prices). */
export const lTicketAdapter: ChannelSyncAdapter = {
  sourceName: "LTICKET",
  async fetchDrafts() {
    const ids = new Map<string, string>();
    for (const url of [
      "https://www.l-ticket.co.kr/product/list?condition=BFYSAL",
      "https://www.l-ticket.co.kr/",
    ]) {
      const res = await fetch(url, { headers: BROWSER_HEADERS });
      if (!res.ok) continue;
      const html = await res.text();
      const itemRe = /href="\/product\/detail\/(\d+)"[^>]*>[\s\S]{0,300}?<span class="on_sale_ticker_name">([\s\S]*?)<\/span>/gi;
      let m: RegExpExecArray | null;
      while ((m = itemRe.exec(html)) !== null) {
        const name = m[2].replace(/<[^>]+>/g, "").trim();
        if (!ids.has(m[1])) ids.set(m[1], name);
      }
      const genericRe = /href="\/product\/detail\/(\d+)"/gi;
      while ((m = genericRe.exec(html)) !== null) {
        if (!ids.has(m[1])) ids.set(m[1], "");
      }
    }

    const drafts: RawChannelDraft[] = [];
    let detailFetches = 0;

    for (const [productId, hintName] of ids) {
      if (detailFetches >= 10) break;
      if (hintName && (hintName.startsWith("연극") || hintName.includes("Series.L") || isKidsMusical(hintName))) continue;
      detailFetches += 1;

      const detailUrl = `https://www.l-ticket.co.kr/product/detail/${productId}`;
      try {
        const dRes = await fetch(detailUrl, { headers: BROWSER_HEADERS });
        if (!dRes.ok) continue;
        const parsed = parseLTicketDetailHtml(await dRes.text());
        const showTitle = parsed.title || hintName;
        if (
          !showTitle ||
          showTitle.startsWith("연극") ||
          showTitle.includes("Series.L") ||
          isKidsMusical(showTitle, parsed.venueName)
        ) {
          continue;
        }

        drafts.push({
          externalKey: `lticket-prod-${productId}`,
          channelName: "엘티켓",
          showTitle,
          venueName: parsed.venueName ?? undefined,
          dealType: "TIMESALE",
          seatGrade: parsed.seatGrade,
          basePrice: parsed.basePrice,
          salePrice: parsed.salePrice,
          isUnconditional: true,
          conditionSummary: parsed.salePrice ? "엘티켓 단독 최대할인가" : "엘티켓 특가 진행 중",
          externalUrl: detailUrl,
          posterUrl: parsed.posterUrl,
        });
      } catch {
        // Skip failing detail page without aborting adapter
      }
    }
    return drafts;
  },
};

// NOL & L.TICKET run first (primary channels); all 4 stay well under Workers Free 50-subrequest budget.
export const DEFAULT_CHANNEL_ADAPTERS: ChannelSyncAdapter[] = [
  nolAdapter,
  lTicketAdapter,
  ticketlinkAdapter,
  yes24Adapter,
];
