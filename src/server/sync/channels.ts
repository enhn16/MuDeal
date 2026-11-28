import { and, desc, eq, like } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  actors,
  deals,
  ocrImageJobs,
  showActors,
  shows,
  syncRuns,
  type ConditionTag,
  type DealType,
  type SeatGrade,
  type SubRegion,
} from "@/db/schema";
import {
  expandDateRange,
  extractDiscountDatesFromLabel,
  formatKstDate,
  isExpired,
  isValidIsoDate,
  normalizeEventDates,
  normalizeExpiresAtToUtcIso,
} from "@/lib/kst";
import { calcDiscountRate } from "@/lib/pricing";
import { normalizeExternalHttpsUrl, parseSafeServerFetchUrl } from "@/lib/url";
import { recomputeShowPriceCache } from "@/server/modules/reports";
import { classifyDiscountLabel, hasMeaningfulBenefit, isStatutoryDiscount } from "./benefit-filter";
import { isKidsMusical } from "./kids-filter";
import { isSafeChannelId, normalizeTitle, parseChannelLinks, redactSecrets, type ChannelLinks } from "./kopis";

export const AUTO_PUBLISH_CONFIDENCE = 0.85;
const CHANNEL_FETCH_TIMEOUT_MS = 12_000;
const CHANNEL_MAX_REDIRECTS = 2;

function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = CHANNEL_FETCH_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let currentUrl = parseSafeServerFetchUrl(url);
  if (!currentUrl) {
    throw new Error("Blocked unsafe channel fetch URL");
  }

  let currentInit: RequestInit = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Fetch timeout (${timeoutMs}ms)`)), timeoutMs);
  try {
    for (let hops = 0; hops <= CHANNEL_MAX_REDIRECTS; hops++) {
      const attempt = await fetchImpl(currentUrl, {
        ...currentInit,
        redirect: "manual",
        signal: controller.signal,
      });
      if (attempt.status >= 300 && attempt.status < 400) {
        const location = attempt.headers.get("location");
        await attempt.body?.cancel().catch(() => undefined);
        if (!location || hops === CHANNEL_MAX_REDIRECTS) {
          throw new Error(`Channel redirect blocked (${attempt.status})`);
        }
        let nextRaw: string;
        try {
          nextRaw = new URL(location, currentUrl).toString();
        } catch {
          throw new Error("Invalid channel redirect location");
        }
        const nextSafe = parseSafeServerFetchUrl(nextRaw);
        if (!nextSafe) {
          throw new Error("Blocked unsafe channel redirect target");
        }
        if (
          attempt.status === 303 ||
          ((attempt.status === 301 || attempt.status === 302) &&
            (currentInit.method ?? "GET").toUpperCase() === "POST")
        ) {
          currentInit = { ...currentInit, method: "GET", body: undefined };
        }
        currentUrl = nextSafe;
        continue;
      }
      return attempt;
    }
    throw new Error("Channel redirect blocked");
  } finally {
    clearTimeout(timer);
  }
}

/** Strip region/promo brackets, English subtitles, and anniversary/production suffixes for robust cross-channel matching. */
export function normalizeCoreTitle(raw: string): string {
  const stripped = raw
    // Strip region or channel-promo prefixes inside [...] or ［...］ while keeping real show titles like [아가사]
    .replace(
      /[\[［]\s*(?:서울|대학로|부산|대구|대전|광주|인천|경기|울산|창원|의성|청주|수원|성남|고양|전주|여수|제주|김해|평택|안산|단독|선예매|조기예매|특가|할인|비지정석|내한|오리지널|로터리[^\]］]*|슈가\s*데이[^\]］]*|슈가\s*day[^\]］]*|yes24\s*데이[^\]］]*|예스24\s*데이[^\]］]*)\s*[\]］]/gi,
      " ",
    )
    .replace(/\([^)]*\)/g, " ")
    .replace(/[-–—]\s*\d+\s*주년.*$/g, " ")
    .replace(/\d+\s*주년(\s*기념)?(\s*공연|\s*스페셜\s*시즌)?/g, " ")
    .replace(/:\s*\d+\s*차\s*프로덕션.*$/g, " ")
    .replace(/한국\s*초연|내한\s*공연|프랑스\s*뮤지컬|오리지널\s*내한/g, " ")
    .replace(
      /[-–—]\s*(서울|대학로|부산|대구|대전|광주|인천|경기|울산|창원|의성|청주|수원|성남|고양|전주|여수|제주)\s*$/g,
      " ",
    );
  return normalizeTitle(stripped);
}

export interface CastCreditInput {
  name: string;
  roleName?: string | null;
  externalPlaydbId?: string | null;
  profileImageUrl?: string | null;
  sourceType: "NOL" | "YES24";
}

export interface RawChannelDraft {
  externalKey: string;
  channelName: string;
  directShowId?: number | null;
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
  eventDates?: string[] | null;
  externalUrl: string;
  expiresAt?: string | null;
  posterUrl?: string | null;
  synopsisImageUrl?: string | null;
  noticeImageUrls?: string[];
  castCredits?: CastCreditInput[];
  forceDraft?: boolean;
}

export interface ChannelSyncShowHint {
  id: number;
  title: string;
  venueName: string;
  channelLinks: ChannelLinks;
  hasEnrichedCast: boolean;
  lastSyncedAt?: string | null;
}

export interface ChannelSyncContext {
  shows: ChannelSyncShowHint[];
  fetchedProductKeyPrefixes?: Set<string>;
}

export interface ChannelSyncAdapter {
  readonly sourceName: string;
  fetchDrafts(ctx?: ChannelSyncContext): Promise<RawChannelDraft[]>;
}

export interface ShowMatchCandidate {
  id: number;
  kopisId?: string | null;
  normalizedTitle: string;
  venueName: string;
  region: string;
  subRegion: SubRegion;
  startDate: string;
  endDate: string;
}

const GENERIC_VENUE_BASES = new Set([
  "대학로",
  "서울",
  "부산",
  "대구",
  "인천",
  "경기",
  "대전",
  "광주",
  "극장",
  "아트홀",
  "소극장",
  "대극장",
  "중극장",
  "공연장",
  "씨어터",
]);

/** Normalize venue names across KOPIS ("예스24 스테이지(구. DCF...) (1관)") and ticketing sites ("예스24스테이지 1관"). */
export function normalizeVenueName(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw
    .replace(/\(\s*구\.?[^)]*\)/gi, "")
    .replace(/^NOL\s+/i, "")
    .replace(/[()\[\]·•\-_,.\s]/g, "")
    .toLowerCase();
}

function venueBaseName(raw: string | undefined | null): string {
  const base = normalizeVenueName(raw).replace(
    /(?:\d+관|대극장|중극장|소극장|스콘\d*관|페이코홀|연강홀|우리은행홀|신한카드홀|드림\d*관|아트홀|씨어터홀).*$/,
    "",
  );
  if (base.length < 3 || GENERIC_VENUE_BASES.has(base)) return "";
  return base;
}

function isSafePartialTitleMatch(a: string, b: string): boolean {
  if (a.length < 2 || b.length < 2) return false;
  if (!a.includes(b) && !b.includes(a)) return false;
  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return ratio >= 0.45;
}

export interface ShowMatchResult {
  showId: number;
  confidence: number;
}

/**
 * BP-SYNC-002-2: 3-factor matching (normalized/core title + region/venue + period overlap) with confidence score.
 * Returns null if 0 or genuinely ambiguous (>1 distinct productions) so admin manually confirms the DRAFT.
 */
export function matchShowWithConfidence(
  candidates: ShowMatchCandidate[],
  item: Pick<RawChannelDraft, "showTitle" | "venueName" | "regionHint" | "subRegionHint" | "startDate" | "endDate">,
): ShowMatchResult | null {
  const norm = normalizeTitle(item.showTitle);
  const core = normalizeCoreTitle(item.showTitle);
  if (!norm && !core) return null;

  const scored: Array<{ cand: ShowMatchCandidate; confidence: number }> = [];
  const venueNorm = normalizeVenueName(item.venueName);
  const venueBase = venueBaseName(item.venueName);
  const hasVenueHint = Boolean(venueNorm);
  const hasPlaceHint = Boolean(item.subRegionHint || item.regionHint || hasVenueHint);

  for (const c of candidates) {
    const cCore = normalizeCoreTitle(c.normalizedTitle);
    const exactTitle =
      (Boolean(norm) && c.normalizedTitle === norm) || (Boolean(core) && Boolean(cCore) && cCore === core);
    const partialTitle =
      !exactTitle &&
      (isSafePartialTitleMatch(c.normalizedTitle, norm) || isSafePartialTitleMatch(cCore, core));

    if (!exactTitle && !partialTitle) continue;

    // Factor 2: region or venue similarity (if venueName is given, do NOT override venue mismatch with broad regionHint)
    let placeMatched = false;
    let venueOk = false;
    if (hasPlaceHint) {
      const subOk = item.subRegionHint ? c.subRegion === item.subRegionHint : false;
      const regOk = item.regionHint ? c.region.includes(item.regionHint) : false;
      const candVenueNorm = normalizeVenueName(c.venueName);
      const candVenueBase = venueBaseName(c.venueName);
      venueOk =
        (Boolean(venueNorm) &&
          Boolean(candVenueNorm) &&
          (candVenueNorm.includes(venueNorm) || venueNorm.includes(candVenueNorm))) ||
        (Boolean(venueBase) &&
          Boolean(candVenueBase) &&
          (candVenueBase.includes(venueBase) || venueBase.includes(candVenueBase)));
      placeMatched = hasVenueHint ? venueOk : subOk || regOk;
      if (!placeMatched) continue;
    }

    // Factor 3: date period overlap (if valid ISO dates provided)
    if (item.startDate && isValidIsoDate(item.startDate) && c.endDate < item.startDate) continue;
    if (item.endDate && isValidIsoDate(item.endDate) && c.startDate > item.endDate) continue;

    // Confidence gates:
    // - No place hint -> cap at 0.80 (never auto-publish)
    // - Partial title -> allow 0.88 ONLY with venueOk; broad regionHint alone stays at 0.72
    const confidence = exactTitle
      ? hasPlaceHint
        ? venueOk
          ? 0.98
          : 0.92
        : 0.8
      : venueOk
        ? 0.88
        : 0.72;
    scored.push({ cand: c, confidence });
  }

  if (scored.length === 0) return null;
  if (scored.length === 1) return { showId: scored[0].cand.id, confidence: scored[0].confidence };

  const maxConf = Math.max(...scored.map((s) => s.confidence));
  const top = scored.filter((s) => s.confidence >= maxConf - 0.02);
  if (top.length === 1 && top[0].confidence >= 0.9) {
    return { showId: top[0].cand.id, confidence: top[0].confidence };
  }

  // If multiple top candidates are duplicate rows of the exact same production (same period & subRegion), pick canonical PF* row
  const first = top[0].cand;
  const sameProduction = top.every(
    (s) =>
      s.cand.subRegion === first.subRegion &&
      s.cand.startDate === first.startDate &&
      s.cand.endDate === first.endDate,
  );
  if (sameProduction) {
    const canonical =
      top.find((s) => s.cand.kopisId?.startsWith("PF")) ??
      top.sort((a, b) => a.cand.id - b.cand.id)[0];
    return { showId: canonical.cand.id, confidence: canonical.confidence };
  }

  return null;
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

async function upsertEnrichedActors(db: AppDb, showId: number, credits: CastCreditInput[]) {
  const nowIso = new Date().toISOString();
  for (const credit of credits) {
    const cleanName = credit.name.trim();
    if (cleanName.length < 2 || cleanName.length > 25) continue;
    const norm = cleanName.replace(/\s+/g, "").toLowerCase();
    const safePhoto = normalizeExternalHttpsUrl(credit.profileImageUrl);

    let actorId: number | null = null;
    if (credit.externalPlaydbId) {
      const [byPlaydb] = await db
        .select({ id: actors.id, profileImageUrl: actors.profileImageUrl })
        .from(actors)
        .where(eq(actors.externalPlaydbId, credit.externalPlaydbId))
        .limit(1);
      if (byPlaydb) {
        actorId = byPlaydb.id;
        if (safePhoto && !byPlaydb.profileImageUrl) {
          await db
            .update(actors)
            .set({ profileImageUrl: safePhoto, updatedAt: nowIso })
            .where(eq(actors.id, actorId));
        }
      }
    }

    if (actorId === null) {
      const [byName] = await db
        .select({
          id: actors.id,
          externalPlaydbId: actors.externalPlaydbId,
          profileImageUrl: actors.profileImageUrl,
        })
        .from(actors)
        .where(eq(actors.normalizedName, norm))
        .limit(1);

      if (byName) {
        // If existing actor has a different externalPlaydbId, create a distinct disambiguated actor row
        if (byName.externalPlaydbId && credit.externalPlaydbId && byName.externalPlaydbId !== credit.externalPlaydbId) {
          const [created] = await db
            .insert(actors)
            .values({
              name: cleanName,
              normalizedName: norm,
              externalPlaydbId: credit.externalPlaydbId,
              profileImageUrl: safePhoto,
            })
            .returning({ id: actors.id });
          actorId = created.id;
        } else {
          actorId = byName.id;
          const patch: Partial<typeof actors.$inferInsert> = {};
          if (credit.externalPlaydbId && !byName.externalPlaydbId) {
            patch.externalPlaydbId = credit.externalPlaydbId;
          }
          if (safePhoto && !byName.profileImageUrl) {
            patch.profileImageUrl = safePhoto;
          }
          if (Object.keys(patch).length > 0) {
            await db
              .update(actors)
              .set({ ...patch, updatedAt: nowIso })
              .where(eq(actors.id, actorId));
          }
        }
      } else {
        const [created] = await db
          .insert(actors)
          .values({
            name: cleanName,
            normalizedName: norm,
            externalPlaydbId: credit.externalPlaydbId ?? null,
            profileImageUrl: safePhoto,
          })
          .returning({ id: actors.id });
        actorId = created.id;
      }
    }

    const [existingLink] = await db
      .select({ id: showActors.id, roleName: showActors.roleName })
      .from(showActors)
      .where(and(eq(showActors.showId, showId), eq(showActors.actorId, actorId)))
      .limit(1);

    if (!existingLink) {
      await db
        .insert(showActors)
        .values({
          showId,
          actorId,
          roleName: credit.roleName ?? null,
          sourceType: credit.sourceType,
        })
        .onConflictDoNothing();
    } else if (credit.roleName && !existingLink.roleName) {
      await db
        .update(showActors)
        .set({ roleName: credit.roleName, sourceType: credit.sourceType })
        .where(eq(showActors.id, existingLink.id));
    }
  }
}

const CHANNEL_NAME_BY_SOURCE: Record<string, string> = {
  NOL: "NOL티켓",
  YES24: "YES24티켓",
  LTICKET: "엘티켓",
};

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
    const channelLabel = CHANNEL_NAME_BY_SOURCE[adapter.sourceName];
    const [candidates, enrichedCastRows, syncedDealRows] = await Promise.all([
      db
        .select({
          id: shows.id,
          kopisId: shows.kopisId,
          title: shows.title,
          normalizedTitle: shows.normalizedTitle,
          posterUrl: shows.posterUrl,
          synopsisImageUrl: shows.synopsisImageUrl,
          channelLinksJson: shows.channelLinksJson,
          venueName: shows.venueName,
          region: shows.region,
          subRegion: shows.subRegion,
          startDate: shows.startDate,
          endDate: shows.endDate,
          status: shows.status,
        })
        .from(shows),
      db
        .select({ showId: showActors.showId, sourceType: showActors.sourceType })
        .from(showActors),
      channelLabel
        ? db
            .select({ showId: deals.showId, lastVerifiedAt: deals.lastVerifiedAt })
            .from(deals)
            .where(and(eq(deals.sourceType, "SYNC_APPROVED"), eq(deals.channelName, channelLabel)))
        : Promise.resolve([] as Array<{ showId: number | null; lastVerifiedAt: string }>),
    ]);

    const enrichedCastShows = new Set(
      enrichedCastRows
        .filter((r) => r.sourceType === "NOL" || r.sourceType === "YES24")
        .map((r) => r.showId),
    );

    const lastSyncedByShowId = new Map<number, string>();
    for (const r of syncedDealRows) {
      if (r.showId === null) continue;
      const prev = lastSyncedByShowId.get(r.showId);
      if (!prev || r.lastVerifiedAt > prev) {
        lastSyncedByShowId.set(r.showId, r.lastVerifiedAt);
      }
    }

    const activeCandidates = candidates.filter((c) => c.status !== "ENDED");
    const fetchedProductKeyPrefixes = new Set<string>();

    const ctx: ChannelSyncContext = {
      shows: activeCandidates.map((c) => ({
        id: c.id,
        title: c.title,
        venueName: c.venueName,
        channelLinks: parseChannelLinks(c.channelLinksJson),
        hasEnrichedCast: enrichedCastShows.has(c.id),
        lastSyncedAt: lastSyncedByShowId.get(c.id) ?? null,
      })),
      fetchedProductKeyPrefixes,
    };

    const rawItems = await adapter.fetchDrafts(ctx);

    const posterByShowId = new Map<number, string | null>(candidates.map((c) => [c.id, c.posterUrl]));
    const synopsisImgByShowId = new Map<number, string | null>(candidates.map((c) => [c.id, c.synopsisImageUrl]));
    const linksByShowId = new Map<number, ChannelLinks>(
      candidates.map((c) => [c.id, parseChannelLinks(c.channelLinksJson)]),
    );

    // Exclude ENDED shows from matching to prevent stale/ended-season collisions
    const matchCandidates: ShowMatchCandidate[] = activeCandidates.map((c) => ({
      id: c.id,
      kopisId: c.kopisId,
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
    const castEnrichedThisRun = new Set<string>();
    const seenExternalKeys = new Set<string>();
    const nowIso = now.toISOString();
    const todayKst = formatKstDate(now);

    for (const item of rawItems) {
      if (isKidsMusical(item.showTitle, item.venueName)) continue;
      const safeUrl = normalizeExternalHttpsUrl(item.externalUrl);
      if (!safeUrl) continue;

      let matchedShowId: number | null = item.directShowId ?? null;
      let isHighConfidenceMatch = Boolean(matchedShowId);
      if (!matchedShowId) {
        const match = matchShowWithConfidence(matchCandidates, item);
        matchedShowId = match?.showId ?? null;
        isHighConfidenceMatch = Boolean(match && match.confidence >= AUTO_PUBLISH_CONFIDENCE);
      }
      const shouldAutoPublish = Boolean(matchedShowId) && isHighConfidenceMatch && !item.forceDraft;

      // Backfill show metadata, channel links, and cast ONLY on confirmed high-confidence auto-publish matches
      if (matchedShowId && shouldAutoPublish) {
        const showPatch: Partial<typeof shows.$inferInsert> = {};
        if (item.posterUrl && !posterByShowId.get(matchedShowId)) {
          const safePoster = normalizeExternalHttpsUrl(item.posterUrl);
          if (safePoster) {
            showPatch.posterUrl = safePoster;
            posterByShowId.set(matchedShowId, safePoster);
          }
        }
        if (item.synopsisImageUrl && !synopsisImgByShowId.get(matchedShowId)) {
          const safeSyn = normalizeExternalHttpsUrl(item.synopsisImageUrl);
          if (safeSyn) {
            showPatch.synopsisImageUrl = safeSyn;
            synopsisImgByShowId.set(matchedShowId, safeSyn);
          }
        }
        const curLinks = linksByShowId.get(matchedShowId) ?? {};
        const nolCode = /nol\.yanolja\.com\/ticket\/products\/(\d{7,9})/.exec(safeUrl)?.[1];
        const y24Code = /ticket\.yes24\.com\/Perf\/(\d{4,7})/i.exec(safeUrl)?.[1];
        const ltCode = /l-ticket\.co\.kr\/product\/detail\/(\d+)/i.exec(safeUrl)?.[1];
        let linksChanged = false;
        if (nolCode && !curLinks.nol && item.dealType !== "LOTTERY") {
          curLinks.nol = nolCode;
          linksChanged = true;
        }
        if (y24Code && !curLinks.yes24) {
          curLinks.yes24 = y24Code;
          linksChanged = true;
        }
        if (ltCode && !curLinks.lticket) {
          curLinks.lticket = ltCode;
          linksChanged = true;
        }
        if (linksChanged) {
          linksByShowId.set(matchedShowId, curLinks);
          showPatch.channelLinksJson = JSON.stringify(curLinks);
        }
        if (Object.keys(showPatch).length > 0) {
          await db
            .update(shows)
            .set({ ...showPatch, updatedAt: nowIso })
            .where(eq(shows.id, matchedShowId));
        }

        // Enrich actors once per (showId, channel) per run
        if (item.castCredits?.length) {
          const castKey = `${matchedShowId}:${item.channelName}`;
          if (!castEnrichedThisRun.has(castKey)) {
            castEnrichedThisRun.add(castKey);
            await upsertEnrichedActors(db, matchedShowId, item.castCredits);
          }
        }
      }

      // Strictly block statutory/welfare discounts before persistence
      if (isStatutoryDiscount(item.conditionSummary)) {
        continue;
      }

      const discountRate = calcDiscountRate(item.basePrice ?? null, item.salePrice ?? null);
      const meaningful = hasMeaningfulBenefit({
        dealType: item.dealType,
        basePrice: item.basePrice ?? null,
        salePrice: item.salePrice ?? null,
        discountRate,
        conditionSummary: item.conditionSummary ?? null,
      });

      const validEventDates = (item.eventDates ?? []).filter(isValidIsoDate).sort();
      const latestEventDate = validEventDates.at(-1) ?? null;
      const normalizedItemExpiresAt = normalizeExpiresAtToUtcIso(item.expiresAt);
      const effectiveExpiresAt =
        normalizedItemExpiresAt ?? (latestEventDate ? normalizeExpiresAtToUtcIso(latestEventDate) : null);

      const alreadyEnded =
        isExpired(effectiveExpiresAt, now) || (Boolean(latestEventDate) && Boolean(todayKst) && latestEventDate! < todayKst);

      if (meaningful && !alreadyEnded) {
        seenExternalKeys.add(item.externalKey);

        const [existing] = await db
          .select({
            id: deals.id,
            status: deals.status,
            showId: deals.showId,
            adminLocked: deals.adminLocked,
            expiresAt: deals.expiresAt,
            eventDatesJson: deals.eventDatesJson,
            opensAt: deals.opensAt,
          })
          .from(deals)
          .where(eq(deals.externalKey, item.externalKey))
          .limit(1);

        // BP-SYNC-002-3: never overwrite admin_locked=1 or admin-rejected DISCARDED/HIDDEN deals
        if (existing?.adminLocked !== 1 && existing?.status !== "DISCARDED" && existing?.status !== "HIDDEN") {
          const tagsJson = item.conditionTags?.length ? JSON.stringify(item.conditionTags) : null;
          const itemEventDatesJson = validEventDates.length ? JSON.stringify(validEventDates) : null;
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
              conditionTagsJson: tagsJson,
              conditionSummary: item.conditionSummary ?? null,
              opensAt: item.opensAt ?? null,
              eventDatesJson: itemEventDatesJson,
              externalUrl: safeUrl,
              externalKey: item.externalKey,
              expiresAt: effectiveExpiresAt,
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
          } else {
            const nextStatus =
              existing.status === "DRAFT" && shouldAutoPublish && matchedShowId ? "ACTIVE" : existing.status;
            await db
              .update(deals)
              .set({
                showId: matchedShowId ?? existing.showId,
                dealType: item.dealType,
                seatGrade: item.seatGrade ?? "ALL",
                basePrice: item.basePrice ?? null,
                salePrice: item.salePrice ?? null,
                discountRate,
                isUnconditional: item.isUnconditional === false ? 0 : 1,
                conditionTagsJson: tagsJson,
                conditionSummary: item.conditionSummary ?? null,
                opensAt: item.opensAt ?? existing.opensAt,
                eventDatesJson: itemEventDatesJson ?? existing.eventDatesJson,
                expiresAt: effectiveExpiresAt ?? existing.expiresAt,
                status: nextStatus,
                lastVerifiedAt: nowIso,
                updatedAt: nowIso,
              })
              .where(eq(deals.id, existing.id));
            if (nextStatus === "ACTIVE" && (matchedShowId ?? existing.showId)) {
              publishedCount += 1;
              touchedShowIds.add((matchedShowId ?? existing.showId)!);
            }
          }
        }
      }

      // Queue new notice image URLs for Vision/OCR (unique imageUrl prevents duplicate calls)
      for (const rawImg of item.noticeImageUrls ?? []) {
        const safeImg = normalizeExternalHttpsUrl(rawImg);
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

    // Expire previously SYNC_APPROVED ACTIVE (adminLocked=0) deals that vanished from successfully fetched products
    for (const prefix of fetchedProductKeyPrefixes) {
      const existingPrefixDeals = await db
        .select({
          id: deals.id,
          showId: deals.showId,
          externalKey: deals.externalKey,
        })
        .from(deals)
        .where(
          and(
            eq(deals.sourceType, "SYNC_APPROVED"),
            eq(deals.status, "ACTIVE"),
            eq(deals.adminLocked, 0),
            like(deals.externalKey, `${prefix}%`),
          ),
        );
      for (const row of existingPrefixDeals) {
        if (row.externalKey && !seenExternalKeys.has(row.externalKey)) {
          await db
            .update(deals)
            .set({ status: "EXPIRED", updatedAt: nowIso })
            .where(eq(deals.id, row.id));
          if (row.showId !== null) touchedShowIds.add(row.showId);
        }
      }
    }

    for (const sid of touchedShowIds) {
      await recomputeShowPriceCache(db, sid, now);
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
    const msg = redactSecrets(err instanceof Error ? err.message : String(err));
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

export function normalizeSeatGrade(raw: string | undefined | null): SeatGrade {
  const u = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (u.includes("VIP") || u.startsWith("OP")) return "VIP";
  if (u.startsWith("R")) return "R";
  if (u.startsWith("S")) return "S";
  if (u.startsWith("A")) return "A";
  return "ALL";
}

function normalizeIsoDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
  const candidate = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}`
    : trimmed.replace(/[./]/g, "-");
  return isValidIsoDate(candidate) ? candidate : null;
}

export function kstDateTimeToIso(raw: string | null | undefined, bound: "start" | "end" = "end"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const dateOnly = normalizeIsoDateOnly(trimmed);
  if (dateOnly) {
    const suffix = bound === "start" ? "T00:00:00+09:00" : "T23:59:59+09:00";
    const dt = new Date(`${dateOnly}${suffix}`);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  // Normalize YYYY.MM.DD HH:MM(:SS) or YYYY/MM/DD HH:MM(:SS) or YYYYMMDDHHMMSS
  const dotted = /^(\d{4})[./-](\d{2})[./-](\d{2})([T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)$/i.exec(
    trimmed,
  );
  if (dotted) {
    return normalizeExpiresAtToUtcIso(`${dotted[1]}-${dotted[2]}-${dotted[3]}${dotted[4]}`);
  }

  const compactDt = /^(\d{4})(\d{2})(\d{2})[T ]?(\d{2})(\d{2})(\d{2})?$/.exec(trimmed);
  if (compactDt) {
    return normalizeExpiresAtToUtcIso(
      `${compactDt[1]}-${compactDt[2]}-${compactDt[3]}T${compactDt[4]}:${compactDt[5]}:${compactDt[6] ?? "00"}`,
    );
  }

  return normalizeExpiresAtToUtcIso(trimmed);
}

function extractNextFStream(html: string): string {
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
  return chunks.join("");
}

function extractBalancedJson(str: string, startIdx: number): string | null {
  if (startIdx < 0 || startIdx >= str.length) return null;
  const open = str[startIdx];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
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
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return str.slice(startIdx, i + 1);
    }
  }
  return null;
}

// =============================================================================
// 1. NOL (구 인터파크) — 전체 가격표(prices.all) + 로터리/슈가DAY/타임세일 + 출연진(castCredits)
// =============================================================================

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
  const combined = extractNextFStream(html);
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
  let m: RegExpExecArray | null;
  while ((m = widgetRe.exec(combined)) !== null) {
    const widgetTitle = m[1];
    const start = m.index + m[0].length - 1;
    const rawArr = extractBalancedJson(combined, start);
    if (!rawArr) continue;

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
      items = JSON.parse(rawArr);
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
      if (!goodsCode || !isSafeChannelId(goodsCode)) continue;
      const price = it.prices?.[0];
      const basePrice = parseKrwDigits(price?.originPrice);
      const salePrice = parseKrwDigits(price?.discountPrice);
      const badges = (it.benefitBadges ?? []).map((b) => b.text?.trim() ?? "").filter(Boolean);
      const webUrl =
        normalizeExternalHttpsUrl(it.action?.web, "https://nol.yanolja.com") ??
        `https://nol.yanolja.com/ticket/products/${goodsCode}`;
      const hasDiscount = (salePrice !== null && (basePrice === null || salePrice < basePrice)) || widgetTitle.includes("할인");

      const prev = byGoodsCode.get(goodsCode);
      if (prev && prev.hasDiscount && !hasDiscount) continue;
      byGoodsCode.set(goodsCode, {
        goodsCode,
        title: it.title.trim(),
        venueName: it.locationDetails?.[0]?.trim(),
        regionHint,
        basePrice: basePrice ?? prev?.basePrice ?? null,
        salePrice: salePrice ?? prev?.salePrice ?? null,
        badges: badges.length ? badges : (prev?.badges ?? []),
        url: webUrl.includes("/ticket/") ? webUrl : (prev?.url ?? webUrl),
        thumbnail: normalizeExternalHttpsUrl(it.thumbnail, "https://nol.yanolja.com") ?? prev?.thumbnail ?? null,
        hasDiscount: hasDiscount || Boolean(prev?.hasDiscount),
      });
    }
  }

  return Array.from(byGoodsCode.values());
}

/** Extract NOL special promo banners (로터리티켓, 슈가데이, 타임세일) from genre SSR HTML. */
export function parseNolPromoBanners(html: string): Array<{
  goodsCode: string;
  alt: string;
  kind: "LOTTERY" | "SPECIAL_DAY" | "TIMESALE";
}> {
  const combined = extractNextFStream(html);
  const out = new Map<string, { goodsCode: string; alt: string; kind: "LOTTERY" | "SPECIAL_DAY" | "TIMESALE" }>();
  const re = /"alt":"([^"]+)","imageUrl":"[^"]*","action":\{[^}]*"web":"([^"]+)"[^}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(combined)) !== null) {
    const alt = m[1].trim();
    const web = m[2];
    const goodsCode = /\/products\/(\d{7,9})/.exec(web)?.[1];
    if (!goodsCode) continue;
    const kind: "LOTTERY" | "SPECIAL_DAY" | "TIMESALE" | null = /로터리/i.test(alt)
      ? "LOTTERY"
      : /슈가\s*데이|슈가\s*day/i.test(alt)
        ? "SPECIAL_DAY"
        : /타임세일|타임특가/i.test(alt)
          ? "TIMESALE"
          : null;
    if (!kind) continue;
    if (!out.has(goodsCode)) out.set(goodsCode, { goodsCode, alt, kind });
  }
  return Array.from(out.values());
}

/** Extract NOL notice/discount image URLs from product detail HTML for Vision OCR. */
export function parseNolNoticeImages(detailHtml: string): string[] {
  const matches =
    detailHtml.match(
      /(?:https?:)?\/\/ticketimage\.interpark\.com\/(?:Play\/ITM\/Data\/Modify\/|\d{8,}20\d{2}\/)[^"'\\<\s]+?\.(?:jpg|jpeg|png|webp)/gi,
    ) ?? [];
  const normalized = matches
    .map((u) => normalizeExternalHttpsUrl(u))
    .filter((u): u is string => Boolean(u));
  return Array.from(new Set(normalized)).slice(0, 3);
}

export interface NolParsedPriceRow {
  seatGrade: SeatGrade;
  seatGradeName: string;
  priceGrade: string;
  priceGradeName: string;
  basePrice: number | null;
  salePrice: number;
  discountStartDate: string | null;
  discountEndDate: string | null;
}

export interface NolProductDetailParsed {
  goodsCode: string;
  title: string | null;
  venueName: string | null;
  startDate: string | null;
  endDate: string | null;
  bookingEndTime: string | null;
  posterUrl: string | null;
  lotteryApplyStart: string | null;
  lotteryApplyEnd: string | null;
  lotteryAnnounce: string | null;
  discounts: NolParsedPriceRow[];
  hasPricesTable?: boolean;
  castCredits: CastCreditInput[];
  noticeImageUrls: string[];
  synopsisImageUrl: string | null;
}

/**
 * Parse NOL product detail SSR HTML (`https://nol.yanolja.com/ticket/products/{goodsCode}`)
 * for ALL seat-grade discounts (`prices.all`), lottery timestamps, structured `castCredits`, and intro images.
 */
export function parseNolProductDetailHtml(html: string, goodsCode: string): NolProductDetailParsed {
  const combined = extractNextFStream(html);
  let title: string | null = null;
  let venueName: string | null = null;
  let startDate: string | null = null;
  let endDate: string | null = null;
  let bookingEndTime: string | null = null;
  let posterUrl: string | null = null;
  let lotteryApplyStart: string | null = null;
  let lotteryApplyEnd: string | null = null;
  let lotteryAnnounce: string | null = null;
  let synopsisImageUrl: string | null = null;
  let hasPricesTable = false;

  const gdKey = '"goodsDetail":{';
  const gdKeyIdx = combined.indexOf(gdKey);
  if (gdKeyIdx !== -1) {
    const raw = extractBalancedJson(combined, gdKeyIdx + gdKey.length - 1);
    if (raw) {
      try {
        const gd = JSON.parse(raw) as {
          goodsName?: string;
          placeName?: string;
          playStartDate?: string;
          playEndDate?: string;
          bookingEndTime?: string;
          posterImageUrl?: string;
          detail?: {
            contentInfo?: string;
            bookingEndTime?: string | null;
            lotteryApplyStartDateTime?: string | null;
            lotteryApplyEndDateTime?: string | null;
            lotteryAnnounceDateTime?: string | null;
          };
        };
        if (gd) {
          title = gd.goodsName?.trim() || null;
          venueName = gd.placeName?.trim() || null;
          startDate = normalizeIsoDateOnly(gd.playStartDate);
          endDate = normalizeIsoDateOnly(gd.playEndDate);
          bookingEndTime = kstDateTimeToIso(gd.bookingEndTime ?? gd.detail?.bookingEndTime, "end");
          posterUrl = normalizeExternalHttpsUrl(gd.posterImageUrl, "https://nol.yanolja.com");
          lotteryApplyStart = kstDateTimeToIso(gd.detail?.lotteryApplyStartDateTime, "start");
          lotteryApplyEnd = kstDateTimeToIso(gd.detail?.lotteryApplyEndDateTime, "end");
          lotteryAnnounce = kstDateTimeToIso(gd.detail?.lotteryAnnounceDateTime, "end");
          const contentImg = /src=["']((?:https?:)?\/\/[^"']+\.(?:jpg|jpeg|png|webp))["']/i.exec(
            gd.detail?.contentInfo ?? "",
          )?.[1];
          if (contentImg) synopsisImageUrl = normalizeExternalHttpsUrl(contentImg);
        }
      } catch {
        // Ignore malformed goodsDetail chunk
      }
    }
  }

  // Parse prices.all (full "가격 전체보기" table!) resilient to key order inside prices object
  const discounts: NolParsedPriceRow[] = [];
  const pKey = '"prices":{';
  const pKeyIdx = combined.indexOf(pKey);
  if (pKeyIdx !== -1) {
    const raw = extractBalancedJson(combined, pKeyIdx + pKey.length - 1);
    if (raw) {
      try {
        const pricesObj = JSON.parse(raw) as {
          all?: Array<{
            seatGrade?: string;
            priceGrade?: string;
            seatGradeName?: string;
            priceGradeName?: string;
            salesPrice?: number;
            regularPrice?: number;
            priceType?: string;
            priceStartDate?: string;
            priceEndDate?: string;
            discountStartDate?: string;
            discountEndDate?: string;
          }>;
        };
        const allRows = pricesObj.all ?? [];
        if (Array.isArray(pricesObj.all)) hasPricesTable = true;
        const basicPriceByGrade = new Map<string, number>();
        for (const row of allRows) {
          if (row.priceType === "basic" && row.seatGradeName && typeof row.salesPrice === "number" && row.salesPrice > 0) {
            basicPriceByGrade.set(row.seatGradeName.trim(), row.salesPrice);
          }
        }
        for (const row of allRows) {
          if (row.priceType === "basic") continue;
          const label = (row.priceGradeName ?? "").replace(/\s+/g, " ").trim();
          const salePrice = typeof row.salesPrice === "number" && row.salesPrice > 0 ? row.salesPrice : null;
          if (!label || salePrice === null) continue;
          const gradeName = (row.seatGradeName ?? "전석").trim();
          const regularFallback =
            typeof row.regularPrice === "number" && row.regularPrice > salePrice ? row.regularPrice : null;
          const basePrice = basicPriceByGrade.get(gradeName) ?? regularFallback;
          discounts.push({
            seatGrade: normalizeSeatGrade(gradeName),
            seatGradeName: gradeName,
            priceGrade: row.priceGrade?.trim() || fnv1aHex(`${gradeName}|${label}`),
            priceGradeName: label,
            basePrice,
            salePrice,
            discountStartDate: kstDateTimeToIso(row.priceStartDate || row.discountStartDate, "start"),
            discountEndDate: kstDateTimeToIso(row.priceEndDate || row.discountEndDate, "end"),
          });
        }
      } catch {
        // Ignore malformed prices chunk
      }
    }
  }

  // Parse castCredits (structured actors with characterName, PlayDB manNo, profile photo!)
  const castCredits: CastCreditInput[] = [];
  const cKey = '"castCredits":[';
  const cIdx = combined.indexOf(cKey);
  if (cIdx !== -1) {
    const rawArr = extractBalancedJson(combined, cIdx + cKey.length - 1);
    if (rawArr) {
      try {
        const arr = JSON.parse(rawArr) as Array<{
          characterName?: string;
          manNo?: string;
          manName?: string;
          manSmallImageUrl?: string;
          manLargeImageUrl?: string;
        }>;
        const seen = new Set<string>();
        for (const c of arr) {
          const name = c.manName?.trim();
          if (!name) continue;
          const dedup = `${c.manNo ?? name}`;
          if (seen.has(dedup)) continue;
          seen.add(dedup);
          const photo = normalizeExternalHttpsUrl(c.manSmallImageUrl || c.manLargeImageUrl);
          castCredits.push({
            name,
            roleName: c.characterName?.trim() || null,
            externalPlaydbId: c.manNo?.trim() || null,
            profileImageUrl: photo,
            sourceType: "NOL",
          });
        }
      } catch {
        // Ignore malformed castCredits
      }
    }
  }

  return {
    goodsCode,
    title,
    venueName,
    startDate,
    endDate,
    bookingEndTime,
    posterUrl,
    lotteryApplyStart,
    lotteryApplyEnd,
    lotteryAnnounce,
    discounts,
    hasPricesTable,
    castCredits,
    noticeImageUrls: parseNolNoticeImages(combined),
    synopsisImageUrl,
  };
}

function compareQueueStaleness(a?: string | null, b?: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

/** Tier-1 NOL Ticket adapter: full prices.all + lottery/SugarDay/timesale banners + structured castCredits + notice OCR. */
export const nolAdapter: ChannelSyncAdapter = {
  sourceName: "NOL",
  async fetchDrafts(ctx) {
    const genreRes = await fetchWithTimeout("https://nol.yanolja.com/ticket/genre/musical", { headers: BROWSER_HEADERS });
    if (!genreRes.ok) throw new Error(`NOL genre HTTP ${genreRes.status}`);
    const genreHtml = await genreRes.text();

    const genreItems = parseNolMusicalHtml(genreHtml).filter((it) => !isKidsMusical(it.title, it.venueName));
    const promoBanners = parseNolPromoBanners(genreHtml);

    // Build prioritized queue of NOL goodsCodes (promo banners -> KOPIS-linked shows -> genre items), round-robin by staleness
    type QueueEntry = {
      goodsCode: string;
      directShowId?: number;
      fallbackTitle: string;
      fallbackVenue?: string;
      fallbackRegion?: string;
      promoKind?: "LOTTERY" | "SPECIAL_DAY" | "TIMESALE";
      promoAlt?: string;
      priority: number;
      lastSyncedAt?: string | null;
    };
    const queue = new Map<string, QueueEntry>();

    for (const b of promoBanners) {
      queue.set(b.goodsCode, {
        goodsCode: b.goodsCode,
        fallbackTitle: b.alt,
        promoKind: b.kind,
        promoAlt: b.alt,
        priority: 3,
        lastSyncedAt: null,
      });
    }

    for (const s of ctx?.shows ?? []) {
      const gc = s.channelLinks.nol;
      if (!gc) continue;
      const existing = queue.get(gc);
      if (existing) {
        existing.directShowId = s.id;
        existing.lastSyncedAt = s.lastSyncedAt ?? null;
      } else {
        queue.set(gc, {
          goodsCode: gc,
          directShowId: s.id,
          fallbackTitle: s.title,
          fallbackVenue: s.venueName,
          priority: s.hasEnrichedCast ? 1 : 2,
          lastSyncedAt: s.lastSyncedAt ?? null,
        });
      }
    }

    for (const it of genreItems) {
      if (!queue.has(it.goodsCode)) {
        queue.set(it.goodsCode, {
          goodsCode: it.goodsCode,
          fallbackTitle: it.title,
          fallbackVenue: it.venueName,
          fallbackRegion: it.regionHint,
          priority: it.hasDiscount ? 2 : 0,
          lastSyncedAt: null,
        });
      }
    }

    const sortedQueue = Array.from(queue.values()).sort(
      (a, b) => b.priority - a.priority || compareQueueStaleness(a.lastSyncedAt, b.lastSyncedAt),
    );
    const drafts: RawChannelDraft[] = [];

    // Fetch up to 12 product detail pages per run to fit comfortably in Cloudflare Workers free 50-subrequest budget
    for (const target of sortedQueue.slice(0, 12)) {
      const productUrl = `https://nol.yanolja.com/ticket/products/${target.goodsCode}`;
      try {
        const dRes = await fetchWithTimeout(productUrl, { headers: BROWSER_HEADERS });
        if (!dRes.ok) continue;
        const parsed = parseNolProductDetailHtml(await dRes.text(), target.goodsCode);
        const showTitle = parsed.title || target.fallbackTitle;
        if (isKidsMusical(showTitle, parsed.venueName ?? target.fallbackVenue)) continue;

        let emittedForProduct = false;
        const isLotteryProduct = Boolean(parsed.lotteryApplyEnd) || target.promoKind === "LOTTERY";

        // 1. Lottery product (e.g. ［로터리 티켓］) — emit single deduplicated LOTTERY deal (do not duplicate via prices.all)
        if (isLotteryProduct) {
          const eligibleLotteryRows = parsed.discounts.filter(
            (r) => !isStatutoryDiscount(r.priceGradeName),
          );
          const lowestLottery = eligibleLotteryRows.sort((a, b) => a.salePrice - b.salePrice)[0];
          const announceKstMmDd = parsed.lotteryAnnounce
            ? formatKstDate(new Date(parsed.lotteryAnnounce)).slice(5, 10)
            : "";
          drafts.push({
            externalKey: `nol-lottery-${target.goodsCode}`,
            channelName: "NOL티켓",
            directShowId: target.directShowId,
            showTitle,
            venueName: parsed.venueName ?? target.fallbackVenue,
            regionHint: target.fallbackRegion,
            startDate: parsed.startDate ?? undefined,
            endDate: parsed.endDate ?? undefined,
            dealType: "LOTTERY",
            seatGrade: lowestLottery?.seatGrade ?? "ALL",
            basePrice: lowestLottery?.basePrice ?? null,
            salePrice: lowestLottery?.salePrice ?? null,
            isUnconditional: false,
            conditionTags: [],
            conditionSummary: announceKstMmDd
              ? `NOL 로터리 티켓 추첨 (발표 ${announceKstMmDd})`
              : "NOL 로터리 티켓 추첨 응모",
            opensAt: parsed.lotteryApplyStart,
            expiresAt: parsed.lotteryApplyEnd,
            externalUrl: productUrl,
            posterUrl: parsed.posterUrl,
            synopsisImageUrl: parsed.synopsisImageUrl,
            noticeImageUrls: parsed.noticeImageUrls,
            castCredits: parsed.castCredits,
          });
          emittedForProduct = true;
          continue;
        }

        if (parsed.hasPricesTable) {
          ctx?.fetchedProductKeyPrefixes?.add(`nol-${target.goodsCode}-`);
        }

        // 2. Every non-statutory discount row from prices.all (pass promo keyword only, NOT show title)
        const extraHints =
          target.promoKind === "SPECIAL_DAY"
            ? ["슈가DAY"]
            : target.promoKind === "TIMESALE"
              ? ["타임세일"]
              : [];
        const isStandalonePromoDates =
          (target.promoKind === "SPECIAL_DAY" || (parsed.startDate && parsed.startDate === parsed.endDate)) &&
          parsed.startDate
            ? expandDateRange(parsed.startDate, parsed.endDate ?? parsed.startDate)
            : [];
        for (const row of parsed.discounts) {
          const classified = classifyDiscountLabel(row.priceGradeName, extraHints);
          if (classified.isStatutory) continue;
          const labelDates = extractDiscountDatesFromLabel(row.priceGradeName, {
            showStartDate: parsed.startDate,
            showEndDate: parsed.endDate,
          });
          // Prefer basic/regularPrice; fallback to label % only when basic & regularPrice are unavailable
          let basePrice = row.basePrice;
          if (!basePrice) {
            const pctMatches = [...row.priceGradeName.matchAll(/(?<!\d)(\d{1,2})\s*%(?!\s*p)/gi)];
            const pct = pctMatches.at(-1)?.[1];
            if (pct && Number(pct) > 0 && Number(pct) < 90) {
              basePrice = Math.round((row.salePrice / (1 - Number(pct) / 100)) / 100) * 100;
            }
          }
          const applicableDates =
            labelDates.applicableDates.length > 0 ? labelDates.applicableDates : isStandalonePromoDates;
          const expiresAt =
            row.discountEndDate ??
            labelDates.bookingExpiresAt ??
            (target.promoKind === "SPECIAL_DAY" ? parsed.bookingEndTime : null);
          const gradeSlug = fnv1aHex(row.seatGradeName);
          drafts.push({
            externalKey: `nol-${target.goodsCode}-${row.seatGrade}-${gradeSlug}-${row.priceGrade}`,
            channelName: "NOL티켓",
            directShowId: target.directShowId,
            showTitle,
            venueName: parsed.venueName ?? target.fallbackVenue,
            regionHint: target.fallbackRegion,
            startDate: parsed.startDate ?? undefined,
            endDate: parsed.endDate ?? undefined,
            dealType: classified.dealType,
            seatGrade: row.seatGrade,
            basePrice,
            salePrice: row.salePrice,
            isUnconditional: classified.isUnconditional,
            conditionTags: classified.conditionTags,
            conditionSummary: classified.conditionSummary,
            opensAt: row.discountStartDate,
            eventDates: applicableDates.length > 0 ? applicableDates : null,
            expiresAt,
            externalUrl: productUrl,
            posterUrl: parsed.posterUrl,
            synopsisImageUrl: parsed.synopsisImageUrl,
            noticeImageUrls: !emittedForProduct ? parsed.noticeImageUrls : [],
            castCredits: !emittedForProduct ? parsed.castCredits : undefined,
          });
          emittedForProduct = true;
        }

        // 3. Even if no discount rows, emit metadata-only draft so castCredits / noticeImages / synopsisImageUrl still enrich the show
        if (!emittedForProduct && (parsed.castCredits.length > 0 || parsed.noticeImageUrls.length > 0 || parsed.synopsisImageUrl)) {
          drafts.push({
            externalKey: `nol-meta-${target.goodsCode}`,
            channelName: "NOL티켓",
            directShowId: target.directShowId,
            showTitle,
            venueName: parsed.venueName ?? target.fallbackVenue,
            startDate: parsed.startDate ?? undefined,
            endDate: parsed.endDate ?? undefined,
            dealType: "DISCOUNT_SITE",
            externalUrl: productUrl,
            posterUrl: parsed.posterUrl,
            synopsisImageUrl: parsed.synopsisImageUrl,
            noticeImageUrls: parsed.noticeImageUrls,
            castCredits: parsed.castCredits,
          });
        }
      } catch {
        // Skip failing detail page without aborting adapter
      }
    }

    return drafts;
  },
};

// =============================================================================
// 2. YES24 티켓 — 가격 자세히(popPerfPromotion.aspx) + YES24데이/넵프라이즈/엔젤티켓 + 출연진
// =============================================================================

export interface Yes24GenreItem {
  perfId: string;
  title: string;
  startDate?: string;
  endDate?: string;
  venueName?: string;
  posterUrl?: string | null;
}

/** Parse YES24 GenreList_Data.aspx HTML into musical items (isolated per <a> card block). */
export function parseYes24GenreListHtml(html: string): Yes24GenreItem[] {
  const out: Yes24GenreItem[] = [];
  const seen = new Set<string>();
  const cardRe = /<a\b[^>]*jsf_base_GoToPerfDetail\((\d+)\)[^>]*>[\s\S]*?<\/a>/gi;
  let cm: RegExpExecArray | null;
  while ((cm = cardRe.exec(html)) !== null) {
    const card = cm[0];
    const perfId = cm[1];
    if (seen.has(perfId)) continue;
    const titleMatch = /\btitle=(?:'([^']+)'|"([^"]+)")/i.exec(card);
    const title = (titleMatch?.[1] ?? titleMatch?.[2] ?? "").trim();
    if (!title) continue;
    seen.add(perfId);

    const imgMatch = /\b(?:data-src|src)=(?:'([^']+)'|"([^"]+)")/i.exec(card);
    const rawPoster = (imgMatch?.[1] ?? imgMatch?.[2] ?? "").trim();
    const posterUrl = normalizeExternalHttpsUrl(rawPoster, "https://ticket.yes24.com");

    const pTexts = [...card.matchAll(/<p\b[^>]*class=(?:'[^']*list-b-tit2[^']*'|"[^"]*list-b-tit2[^"]*")[^>]*>([^<]+)<\/p>/gi)].map(
      (x) => x[1].trim(),
    );
    const periodText = pTexts[0] ?? "";
    const venueText = pTexts[1]?.trim();
    const periodMatch = /(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})/.exec(periodText);

    out.push({
      perfId,
      title,
      startDate: periodMatch ? `${periodMatch[1]}-${periodMatch[2]}-${periodMatch[3]}` : undefined,
      endDate: periodMatch ? `${periodMatch[4]}-${periodMatch[5]}-${periodMatch[6]}` : undefined,
      venueName: venueText || undefined,
      posterUrl,
    });
  }
  return out;
}

export interface Yes24PromoPriceRow {
  seatGrade: SeatGrade;
  seatGradeName: string;
  basePrice: number | null;
  label: string;
  salePrice: number;
}

const YES24_BASE_LABEL_RE = /^(?:기본가|일반|정가|일반가|정상가)(?:\s*\([^)]*\))?$/;

/** Parse YES24 popPerfPromotion.aspx ("가격 - 자세히") HTML table into all seat-grade × discount rows. */
export function parseYes24PromotionHtml(html: string): Yes24PromoPriceRow[] {
  const out: Yes24PromoPriceRow[] = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(html)) !== null) {
    // Strip <thead>...</thead> so column header <th> never pollutes seat grade context
    const tableBody = tm[1].replace(/<thead[^>]*>[\s\S]*?<\/thead>/gi, "");

    const gradeGroups: Array<{
      gradeRaw: string;
      seatGrade: SeatGrade;
      rows: Array<{ label: string; price: number }>;
    }> = [];
    let currentGroup: {
      gradeRaw: string;
      seatGrade: SeatGrade;
      rows: Array<{ label: string; price: number }>;
    } | null = null;

    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = trRe.exec(tableBody)) !== null) {
      const trHtml = rm[1];
      const ths = [...trHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((x) =>
        x[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
      );
      const tds = [...trHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) =>
        x[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
      );

      // Skip pure header rows (no <td> cells, e.g. <tr><th>좌석등급</th><th>할인명</th><th>가격</th></tr>)
      if (tds.length === 0) continue;

      if (ths.length > 0 && ths[0] && !/^(?:좌석\s*등급|등급|할인\s*종류|구분)$/.test(ths[0])) {
        const gradeRaw = ths[0];
        currentGroup = {
          gradeRaw,
          seatGrade: normalizeSeatGrade(gradeRaw),
          rows: [],
        };
        gradeGroups.push(currentGroup);
      }

      if (tds.length < 2) continue;
      const label = tds[tds.length - 2];
      const price = parseKrwDigits(tds[tds.length - 1]);
      if (!label || !price) continue;

      if (!currentGroup) {
        currentGroup = { gradeRaw: "전석", seatGrade: "ALL", rows: [] };
        gradeGroups.push(currentGroup);
      }
      currentGroup.rows.push({ label, price });
    }

    for (const group of gradeGroups) {
      const isBaseLabel = (label: string) => {
        const clean = label.replace(/^\s*-\s*/, "").trim();
        return YES24_BASE_LABEL_RE.test(clean) || clean === "기본가";
      };
      const baseRow = group.rows.find((r) => isBaseLabel(r.label));
      const basePrice = baseRow?.price ?? null;

      for (const row of group.rows) {
        if (isBaseLabel(row.label)) continue;
        out.push({
          seatGrade: group.seatGrade,
          seatGradeName: group.gradeRaw,
          basePrice,
          label: row.label.replace(/^\s*-\s*/, "").trim(),
          salePrice: row.price,
        });
      }
    }
  }
  return out;
}

/** Parse YES24 Perf/{id} HTML for full cast actor names (`rn-product-peole`). */
export function parseYes24CastHtml(html: string): CastCreditInput[] {
  const seen = new Set<string>();
  const out: CastCreditInput[] = [];
  const re = /class=['"]rn-product-peole['"][^>]*>([^<]+)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].replace(/\(.*?\)/g, "").trim();
    if (name.length < 2 || name.length > 20 || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, sourceType: "YES24" });
  }
  return out;
}

/** Extract PromotionInfo IDs from YES24 Events/Main.aspx or Main.aspx. */
export function parseYes24PromotionIds(html: string): string[] {
  const ids = new Set<string>();
  const re = /PromotionInfo\.aspx\?id=(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    ids.add(m[1]);
  }
  return Array.from(ids);
}

const YES24_NOTICE_NEGATIVE_RE = /불가|금지|취소|변경|판매\s*안내|MD\s*판매|유료\s*판매/i;
const YES24_TICKET_OPEN_RE = /티켓\s*오픈|티켓오픈/i;
const YES24_EXPLICIT_EVENT_PERK_RE = /싱어롱|커튼콜\s*데이|스페셜\s*커튼콜|포토카드\s*증정|특전\s*증정|YES24데이|예스24데이/i;

export function classifyYes24NoticeTitle(title: string): DealType | null {
  if (!title || YES24_NOTICE_NEGATIVE_RE.test(title)) return null;
  if (YES24_TICKET_OPEN_RE.test(title) && !YES24_EXPLICIT_EVENT_PERK_RE.test(title)) return null;
  if (title.includes("싱어롱")) return "SINGALONG";
  if (title.includes("커튼콜")) return "CURTAIN_CALL";
  if (title.includes("특전") || title.includes("포토카드") || title.includes("굿즈")) return "PERK_GOODS";
  if (/YES24데이|예스24데이/i.test(title)) return "SPECIAL_DAY";
  return null;
}

/** Tier-1 YES24 adapter: full popPerfPromotion prices + YES24데이/넵프라이즈/엔젤티켓 promos + cast + event notices. */
export const yes24Adapter: ChannelSyncAdapter = {
  sourceName: "YES24",
  async fetchDrafts(ctx) {
    const out: RawChannelDraft[] = [];

    // 1. Musical genre list (active musicals)
    const genreRes = await fetchWithTimeout(
      "https://ticket.yes24.com/New/Genre/Ajax/GenreList_Data.aspx?genre=15457&sort=3&area=&genretype=1&pCurPage=1&pPageSize=40",
      {
        headers: {
          ...BROWSER_HEADERS,
          Referer: "https://ticket.yes24.com/New/Genre/GenreList.aspx?genretype=1&genre=15457",
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );
    const genreItems = genreRes.ok
      ? parseYes24GenreListHtml(await genreRes.text()).filter((it) => !isKidsMusical(it.title, it.venueName))
      : [];

    // 2. Discover platform-specific promos (YES24데이, 넵프라이즈티켓, 엔젤티켓) from Events hub
    const specialPromoByPerfId = new Map<string, string>();
    try {
      const evRes = await fetchWithTimeout("https://ticket.yes24.com/New/Events/Main.aspx", {
        headers: BROWSER_HEADERS,
      });
      if (evRes.ok) {
        const promoIds = parseYes24PromotionIds(await evRes.text()).slice(0, 5);
        for (const promoId of promoIds) {
          const pr = await fetchWithTimeout(
            `https://ticket.yes24.com/Pages/Events/HotEvent/PromotionInfo.aspx?id=${promoId}`,
            { headers: BROWSER_HEADERS },
          );
          if (!pr.ok) continue;
          const pHtml = await pr.text();
          const ogTitle = /property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(pHtml)?.[1] ?? "";
          const promoKwMatch = /(YES24데이|예스24데이|넵프라이즈|엔젤티켓|예스특가|타임세일)/i.exec(ogTitle);
          if (!promoKwMatch) continue;
          const promoKeyword = promoKwMatch[1];
          for (const pm of pHtml.matchAll(/(?:\/Perf\/|IdPerf=|PerfDetail\()(\d{4,7})(?!\d)/gi)) {
            if (!specialPromoByPerfId.has(pm[1])) specialPromoByPerfId.set(pm[1], promoKeyword);
          }
        }
      }
    } catch {
      // Keep full price sync running even if events hub fails
    }

    // 3. Build prioritized queue of YES24 perfIds (special promo -> KOPIS-linked shows -> genre list), round-robin by staleness
    type YQueue = {
      perfId: string;
      directShowId?: number;
      title: string;
      venueName?: string;
      startDate?: string;
      endDate?: string;
      posterUrl?: string | null;
      specialPromoKeyword?: string;
      needsCast?: boolean;
      priority: number;
      lastSyncedAt?: string | null;
    };
    const queue = new Map<string, YQueue>();

    for (const s of ctx?.shows ?? []) {
      const pid = s.channelLinks.yes24;
      if (!pid) continue;
      const specialKw = specialPromoByPerfId.get(pid);
      queue.set(pid, {
        perfId: pid,
        directShowId: s.id,
        title: s.title,
        venueName: s.venueName,
        specialPromoKeyword: specialKw,
        needsCast: !s.hasEnrichedCast,
        priority: specialKw ? 3 : 2,
        lastSyncedAt: s.lastSyncedAt ?? null,
      });
    }

    for (const g of genreItems) {
      const existing = queue.get(g.perfId);
      if (existing) {
        existing.startDate = g.startDate;
        existing.endDate = g.endDate;
        existing.posterUrl = g.posterUrl;
      } else {
        const specialKw = specialPromoByPerfId.get(g.perfId);
        queue.set(g.perfId, {
          perfId: g.perfId,
          title: g.title,
          venueName: g.venueName,
          startDate: g.startDate,
          endDate: g.endDate,
          posterUrl: g.posterUrl,
          specialPromoKeyword: specialKw,
          priority: specialKw ? 3 : 1,
          lastSyncedAt: null,
        });
      }
    }

    const sortedQueue = Array.from(queue.values()).sort(
      (a, b) => b.priority - a.priority || compareQueueStaleness(a.lastSyncedAt, b.lastSyncedAt),
    );
    let castFetches = 0;

    for (const target of sortedQueue.slice(0, 12)) {
      const detailUrl = `https://ticket.yes24.com/Perf/${target.perfId}`;
      try {
        const promoRes = await fetchWithTimeout(
          "https://ticket.yes24.com/New/Perf/Detail/Popup/popPerfPromotion.aspx",
          {
            method: "POST",
            headers: {
              ...BROWSER_HEADERS,
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              Referer: detailUrl,
              "X-Requested-With": "XMLHttpRequest",
            },
            body: `IdPerf=${encodeURIComponent(target.perfId)}`,
          },
        );
        if (!promoRes.ok) continue;

        const promoHtml = await promoRes.text();
        const rows = parseYes24PromotionHtml(promoHtml);
        if (/<table\b/i.test(promoHtml)) {
          ctx?.fetchedProductKeyPrefixes?.add(`yes24-${target.perfId}-`);
        }

        // Optional cast enrichment from Perf/{id} HTML when show has no NOL/YES24 cast yet
        let castCredits: CastCreditInput[] | undefined;
        if (target.needsCast && castFetches < 3) {
          castFetches += 1;
          try {
            const pRes = await fetchWithTimeout(detailUrl, { headers: BROWSER_HEADERS });
            if (pRes.ok) {
              const parsedCast = parseYes24CastHtml(await pRes.text());
              if (parsedCast.length > 0) castCredits = parsedCast;
            }
          } catch {
            // Optional cast enrichment failure is non-fatal
          }
        }

        let first = true;
        for (const row of rows) {
          const classified = classifyDiscountLabel(row.label);
          if (classified.isStatutory) continue;
          const labelDates = extractDiscountDatesFromLabel(row.label, {
            showStartDate: target.startDate,
            showEndDate: target.endDate,
          });
          const stableHash = fnv1aHex(
            `${row.seatGradeName.replace(/\s+/g, "")}|${row.label.replace(/\s+/g, "")}`,
          );

          out.push({
            externalKey: `yes24-${target.perfId}-${row.seatGrade}-${stableHash}`,
            channelName: "YES24티켓",
            directShowId: target.directShowId,
            showTitle: target.title,
            venueName: target.venueName,
            startDate: target.startDate,
            endDate: target.endDate,
            dealType: classified.dealType,
            seatGrade: row.seatGrade,
            basePrice: row.basePrice,
            salePrice: row.salePrice,
            isUnconditional: classified.isUnconditional,
            conditionTags: classified.conditionTags,
            conditionSummary: classified.conditionSummary,
            eventDates: labelDates.applicableDates.length > 0 ? labelDates.applicableDates : null,
            expiresAt: labelDates.bookingExpiresAt,
            externalUrl: detailUrl,
            posterUrl: target.posterUrl,
            castCredits: first ? castCredits : undefined,
          });
          first = false;
        }
      } catch {
        // Skip failing promo fetch without aborting adapter
      }
    }

    // 4. Event/perk/YES24-day notices (singalong, curtain-call, goods perks)
    try {
      const seen = new Set<string>();
      const regex = /href="(?:[^"]*NoticeMain\.aspx\?id=|#id=)(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
      const nRes = await fetchWithTimeout("https://ticket.yes24.com/New/Notice/Ajax/axList.aspx?page=1&genre=15457", {
        headers: BROWSER_HEADERS,
      });
      if (nRes.ok) {
        const html = await nRes.text();
        let m: RegExpExecArray | null;
        while ((m = regex.exec(html)) !== null) {
          const id = m[1];
          if (seen.has(id)) continue;
          seen.add(id);
          const title = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          const dealType = classifyYes24NoticeTitle(title);
          if (!dealType) continue;
          const noticeDates = normalizeEventDates([], { fallbackText: title });
          const latestNotice = noticeDates.at(-1) ?? null;
          out.push({
            externalKey: `yes24-notice-${id}`,
            channelName: "YES24티켓",
            showTitle: title,
            dealType,
            isUnconditional: true,
            conditionSummary: title,
            eventDates: noticeDates.length > 0 ? noticeDates : null,
            expiresAt: latestNotice ? normalizeExpiresAtToUtcIso(latestNotice) : null,
            externalUrl: `https://ticket.yes24.com/New/Notice/NoticeMain.aspx?id=${id}`,
          });
        }
      }
    } catch {
      // Keep price drafts even if notice fetch fails
    }

    return out;
  },
};

// =============================================================================
// 3. L.TICKET (엘티켓) — 전체 뮤지컬·연극(UWVJLM) + 등급별 최대할인가 + 할인정보 이미지 OCR
// =============================================================================

export interface LTicketSeatPriceRow {
  seatGrade: SeatGrade;
  seatGradeName: string;
  basePrice: number;
  salePrice: number | null;
}

function extractBalancedDivInner(html: string, openTagStart: number): string | null {
  const openEnd = html.indexOf(">", openTagStart);
  if (openEnd === -1) return null;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = openEnd + 1;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    if (m[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(openEnd + 1, m.index);
    } else if (!m[0].endsWith("/>")) {
      depth += 1;
    }
  }
  return html.slice(openEnd + 1);
}

const LTICKET_NON_MUSICAL_TITLE_RE = /(?:연극|콘서트|전시|클래식|무용|발레|오페라|국악|페스티벌|Series\.L)/i;
const LTICKET_NON_MUSICAL_CATEGORY_RE = /(?:콘서트|전시|클래식|스포츠|레저|무용|국악)/i;

export function isLTicketNonMusical(title: string, category?: string | null): boolean {
  const t = title.trim();
  const c = (category ?? "").trim();
  if (!t) return true;
  if (t.includes("Series.L")) return true;
  if (LTICKET_NON_MUSICAL_TITLE_RE.test(t) && !t.includes("뮤지컬")) return true;
  if (c && LTICKET_NON_MUSICAL_CATEGORY_RE.test(c) && !c.includes("뮤지컬")) return true;
  return false;
}

/** Parse ALL seat grade rows from L.TICKET detail HTML (`#seatPriceTable`). */
export function parseLTicketAllSeatPrices(html: string): {
  title: string | null;
  category: string | null;
  venueName: string | null;
  posterUrl: string | null;
  seats: LTicketSeatPriceRow[];
  discountImageUrls: string[];
} {
  const gaNameMatch =
    /item_name:\s*'((?:\\'|[^'])+)'/i.exec(html) ?? /item_name:\s*"((?:\\"|[^"])+)"/i.exec(html);
  const gaCatMatch =
    /item_category:\s*'((?:\\'|[^'])+)'/i.exec(html) ?? /item_category:\s*"((?:\\"|[^"])+)"/i.exec(html);
  const ogMatch =
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html) ??
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html);
  const titleTagMatch = /<title>([^<]+)<\/title>/i.exec(html);
  const cleanTitle = (s?: string | null) => {
    const t = s?.replace(/\\(['"])/g, "$1").replace(/\s*[-|]\s*(L\.?TICKET|엘티켓).*$/i, "").trim() ?? "";
    return !t || /^L\.?TICKET$/i.test(t) || t === "엘티켓" ? null : t;
  };
  const rawTitle = cleanTitle(gaNameMatch?.[1]) ?? cleanTitle(ogMatch?.[1]) ?? cleanTitle(titleTagMatch?.[1]);
  const category = gaCatMatch?.[1]?.replace(/\\(['"])/g, "$1").trim() ?? null;

  const venueMatch = /class=["'][^"']*detail_place_link[^"']*["'][^>]*>[\s\S]{0,200}?<span>([^<]+)/i.exec(html);
  const venueName = venueMatch?.[1]?.trim() ?? null;

  const posterMatch =
    /((?:https?:)?\/\/cdn\.l-ticket\.co\.kr\/images\/product\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp|gif))/i.exec(html);
  const posterUrl = normalizeExternalHttpsUrl(posterMatch?.[1], "https://www.l-ticket.co.kr");

  const seats: LTicketSeatPriceRow[] = [];
  const rowRe =
    /<th[^>]*scope=["']row["'][^>]*>([^<]+)<\/th>\s*<td[^>]*>\s*<div[^>]*class=["'][^"']*seat_price_value[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const seatGradeName = m[1].trim();
    const cellHtml = m[2];
    const basePrice = parseKrwDigits(/<strong[^>]*>([0-9,]+)\s*원<\/strong>/i.exec(cellHtml)?.[1]);
    if (!basePrice) continue;
    const maxDiscSpan = /<span[^>]*class=["'][^"']*max_discount[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(
      cellHtml,
    )?.[1];
    let salePrice: number | null = null;
    if (maxDiscSpan) {
      const wonMatches = [...maxDiscSpan.matchAll(/([0-9,]+)\s*원/g)];
      salePrice = parseKrwDigits(wonMatches.at(-1)?.[1]);
    }
    seats.push({
      seatGrade: normalizeSeatGrade(seatGradeName),
      seatGradeName,
      basePrice,
      salePrice,
    });
  }

  // Extract discount info images from <h3>할인정보...</h3> accordion (supports nested <div>s) for Vision OCR
  const discountImageUrls: string[] = [];
  const discHeader = /<h3[^>]*>\s*할인정보[\s\S]{0,300}?<div[^>]*class=["'][^"']*info_accordion_body[^"']*["'][^>]*>/i.exec(
    html,
  );
  if (discHeader && discHeader.index !== undefined) {
    const bodyDivStart = html.indexOf("<div", discHeader.index);
    const discAcc = bodyDivStart !== -1 ? extractBalancedDivInner(html, bodyDivStart) : null;
    if (discAcc) {
      for (const im of discAcc.matchAll(
        /src=["']((?:https?:)?\/\/[^"']+\.(?:jpg|jpeg|png|webp)|\/images\/[^"']+\.(?:jpg|jpeg|png|webp))["']/gi,
      )) {
        const safeImg = normalizeExternalHttpsUrl(im[1], "https://www.l-ticket.co.kr");
        if (safeImg && !discountImageUrls.includes(safeImg)) discountImageUrls.push(safeImg);
      }
    }
  }

  return {
    title: rawTitle,
    category,
    venueName,
    posterUrl,
    seats,
    discountImageUrls: discountImageUrls.slice(0, 2),
  };
}

/** Parse L.TICKET detail HTML for title, venue, and lowest discounted seat price (kept for unit test compat). */
export function parseLTicketDetailHtml(html: string): {
  title: string | null;
  venueName: string | null;
  seatGrade: SeatGrade;
  basePrice: number | null;
  salePrice: number | null;
  posterUrl: string | null;
} {
  const full = parseLTicketAllSeatPrices(html);
  let best: LTicketSeatPriceRow | null = null;
  for (const s of full.seats) {
    const effective = s.salePrice ?? s.basePrice;
    if (!best || effective < (best.salePrice ?? best.basePrice)) {
      best = s;
    }
  }

  if (best && !best.salePrice) {
    const gaPrice = parseKrwDigits(/item_category:[^}]*price:\s*(\d+)/i.exec(html)?.[1]);
    if (gaPrice && gaPrice < best.basePrice) {
      best = { ...best, salePrice: gaPrice };
    }
  }

  return {
    title: full.title,
    venueName: full.venueName,
    seatGrade: best?.seatGrade ?? "ALL",
    basePrice: best?.basePrice ?? null,
    salePrice: best?.salePrice ?? null,
    posterUrl: full.posterUrl,
  };
}

/** Tier-1 L.TICKET adapter: scans 뮤지컬·연극 (UWVJLM) + 지역 (FWALLB) + KOPIS-linked products, queues DRAFT max_discount + 할인정보 OCR. */
export const lTicketAdapter: ChannelSyncAdapter = {
  sourceName: "LTICKET",
  async fetchDrafts(ctx) {
    type LQueue = {
      productId: string;
      hintName: string;
      directShowId?: number;
      priority: number;
      lastSyncedAt?: string | null;
    };
    const ids = new Map<string, LQueue>();

    for (const s of ctx?.shows ?? []) {
      if (s.channelLinks.lticket) {
        ids.set(s.channelLinks.lticket, {
          productId: s.channelLinks.lticket,
          hintName: s.title,
          directShowId: s.id,
          priority: 2,
          lastSyncedAt: s.lastSyncedAt ?? null,
        });
      }
    }

    for (const url of [
      "https://www.l-ticket.co.kr/product/list?condition=UWVJLM",
      "https://www.l-ticket.co.kr/product/list?condition=FWALLB",
    ]) {
      try {
        const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS });
        if (!res.ok) continue;
        const html = await res.text();
        const itemRe = /href="\/product\/detail\/(\d+)"[^>]*>[\s\S]{0,300}?<span class="on_sale_ticker_name">([\s\S]*?)<\/span>/gi;
        let m: RegExpExecArray | null;
        while ((m = itemRe.exec(html)) !== null) {
          const name = m[2].replace(/<[^>]+>/g, "").trim();
          if (!ids.has(m[1])) ids.set(m[1], { productId: m[1], hintName: name, priority: 1, lastSyncedAt: null });
        }
        const genericRe = /href="\/product\/detail\/(\d+)"/gi;
        while ((m = genericRe.exec(html)) !== null) {
          if (!ids.has(m[1])) ids.set(m[1], { productId: m[1], hintName: "", priority: 0, lastSyncedAt: null });
        }
      } catch {
        // Keep other list tabs running
      }
    }

    const sortedQueue = Array.from(ids.values()).sort(
      (a, b) => b.priority - a.priority || compareQueueStaleness(a.lastSyncedAt, b.lastSyncedAt),
    );

    const drafts: RawChannelDraft[] = [];
    let detailFetches = 0;

    for (const meta of sortedQueue) {
      const productId = meta.productId;
      if (detailFetches >= 10) break;
      if (meta.hintName && (isLTicketNonMusical(meta.hintName) || isKidsMusical(meta.hintName))) {
        continue;
      }
      detailFetches += 1;

      const detailUrl = `https://www.l-ticket.co.kr/product/detail/${productId}`;
      try {
        const dRes = await fetchWithTimeout(detailUrl, { headers: BROWSER_HEADERS });
        if (!dRes.ok) continue;
        const parsed = parseLTicketAllSeatPrices(await dRes.text());
        const showTitle = parsed.title || meta.hintName;
        if (
          !showTitle ||
          isLTicketNonMusical(showTitle, parsed.category) ||
          isKidsMusical(showTitle, parsed.venueName)
        ) {
          continue;
        }

        if (parsed.seats.length > 0) {
          ctx?.fetchedProductKeyPrefixes?.add(`lticket-prod-${productId}-`);
        }

        const discountedSeats = parsed.seats.filter((s) => s.salePrice !== null && s.salePrice < s.basePrice);
        let first = true;
        for (const seat of discountedSeats) {
          const gradeSlug = fnv1aHex(seat.seatGradeName.replace(/\s+/g, ""));
          drafts.push({
            externalKey: `lticket-prod-${productId}-${seat.seatGrade}-${gradeSlug}`,
            channelName: "엘티켓",
            directShowId: meta.directShowId,
            showTitle,
            venueName: parsed.venueName ?? undefined,
            dealType: "DISCOUNT_SITE",
            seatGrade: seat.seatGrade,
            basePrice: seat.basePrice,
            salePrice: seat.salePrice,
            isUnconditional: false,
            conditionSummary: "엘티켓 최대할인가 (조건 확인 필요)",
            externalUrl: detailUrl,
            posterUrl: parsed.posterUrl,
            noticeImageUrls: first ? parsed.discountImageUrls : [],
            forceDraft: true,
          });
          first = false;
        }
      } catch {
        // Skip failing detail page without aborting adapter
      }
    }
    return drafts;
  },
};

// Ticketlink intentionally excluded (WAF-protected detail API); primary channels: NOL, YES24, L.TICKET.
export const DEFAULT_CHANNEL_ADAPTERS: ChannelSyncAdapter[] = [
  nolAdapter,
  yes24Adapter,
  lTicketAdapter,
];
