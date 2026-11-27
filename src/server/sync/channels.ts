import { and, desc, eq } from "drizzle-orm";
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
import { expandDateRange, extractDiscountDatesFromLabel, normalizeEventDates } from "@/lib/kst";
import { calcDiscountRate } from "@/lib/pricing";
import { parseSafeExternalUrl } from "@/lib/url";
import { recomputeShowPriceCache } from "@/server/modules/reports";
import { classifyDiscountLabel, hasMeaningfulBenefit, isStatutoryDiscount } from "./benefit-filter";
import { isKidsMusical } from "./kids-filter";
import { normalizeTitle, parseChannelLinks, type ChannelLinks } from "./kopis";

export const AUTO_PUBLISH_CONFIDENCE = 0.85;

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
}

export interface ChannelSyncShowHint {
  id: number;
  title: string;
  venueName: string;
  channelLinks: ChannelLinks;
  hasEnrichedCast: boolean;
}

export interface ChannelSyncContext {
  shows: ChannelSyncShowHint[];
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
  return normalizeVenueName(raw).replace(/(?:\d+관|대극장|중극장|소극장|스콘\d*관|페이코홀|연강홀|우리은행홀|신한카드홀|드림\d*관|아트홀|씨어터홀).*$/, "");
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

  for (const c of candidates) {
    const cCore = normalizeCoreTitle(c.normalizedTitle);
    const exactTitle =
      (Boolean(norm) && c.normalizedTitle === norm) || (Boolean(core) && Boolean(cCore) && cCore === core);
    const partialTitle =
      !exactTitle &&
      ((Boolean(norm) && (c.normalizedTitle.includes(norm) || norm.includes(c.normalizedTitle))) ||
        (Boolean(core) && core.length >= 2 && Boolean(cCore) && (cCore.includes(core) || core.includes(cCore))));

    if (!exactTitle && !partialTitle) continue;

    // Factor 2: region or venue similarity (robust to KOPIS "(구. ...)" and "(1관)" formatting)
    let placeMatched = false;
    const hasPlaceHint = Boolean(item.subRegionHint || item.regionHint || venueNorm);
    if (hasPlaceHint) {
      const subOk = item.subRegionHint ? c.subRegion === item.subRegionHint : false;
      const regOk = item.regionHint ? c.region.includes(item.regionHint) : false;
      const candVenueNorm = normalizeVenueName(c.venueName);
      const candVenueBase = venueBaseName(c.venueName);
      const venueOk =
        (Boolean(venueNorm) &&
          Boolean(candVenueNorm) &&
          (candVenueNorm.includes(venueNorm) || venueNorm.includes(candVenueNorm))) ||
        (venueBase.length >= 3 &&
          candVenueBase.length >= 3 &&
          (candVenueBase.includes(venueBase) || venueBase.includes(candVenueBase)));
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
    const safePhoto = credit.profileImageUrl
      ? parseSafeExternalUrl(credit.profileImageUrl.replace(/^http:\/\//, "https://"))
      : null;

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
    const [candidates, enrichedCastRows] = await Promise.all([
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
    ]);

    const enrichedCastShows = new Set(
      enrichedCastRows
        .filter((r) => r.sourceType === "NOL" || r.sourceType === "YES24")
        .map((r) => r.showId),
    );

    const ctx: ChannelSyncContext = {
      shows: candidates
        .filter((c) => c.status !== "ENDED")
        .map((c) => ({
          id: c.id,
          title: c.title,
          venueName: c.venueName,
          channelLinks: parseChannelLinks(c.channelLinksJson),
          hasEnrichedCast: enrichedCastShows.has(c.id),
        })),
    };

    const rawItems = await adapter.fetchDrafts(ctx);

    const posterByShowId = new Map<number, string | null>(candidates.map((c) => [c.id, c.posterUrl]));
    const synopsisImgByShowId = new Map<number, string | null>(candidates.map((c) => [c.id, c.synopsisImageUrl]));
    const linksByShowId = new Map<number, ChannelLinks>(
      candidates.map((c) => [c.id, parseChannelLinks(c.channelLinksJson)]),
    );

    const matchCandidates: ShowMatchCandidate[] = candidates.map((c) => ({
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
    const nowIso = now.toISOString();

    for (const item of rawItems) {
      if (isKidsMusical(item.showTitle, item.venueName)) continue;
      const safeUrl = parseSafeExternalUrl(item.externalUrl);
      if (!safeUrl) continue;

      let matchedShowId: number | null = item.directShowId ?? null;
      let shouldAutoPublish = Boolean(matchedShowId);
      if (!matchedShowId) {
        const match = matchShowWithConfidence(matchCandidates, item);
        matchedShowId = match?.showId ?? null;
        shouldAutoPublish = Boolean(match && match.confidence >= AUTO_PUBLISH_CONFIDENCE);
      }

      // Backfill missing show poster, synopsis intro image, or channel product link
      if (matchedShowId) {
        const showPatch: Partial<typeof shows.$inferInsert> = {};
        if (item.posterUrl && !posterByShowId.get(matchedShowId)) {
          const safePoster = parseSafeExternalUrl(item.posterUrl);
          if (safePoster) {
            showPatch.posterUrl = safePoster;
            posterByShowId.set(matchedShowId, safePoster);
          }
        }
        if (item.synopsisImageUrl && !synopsisImgByShowId.get(matchedShowId)) {
          const safeSyn = parseSafeExternalUrl(item.synopsisImageUrl);
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

      if (meaningful) {
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

        // BP-SYNC-002-3: never overwrite admin_locked=1 deals
        if (existing?.adminLocked !== 1) {
          const tagsJson = item.conditionTags?.length ? JSON.stringify(item.conditionTags) : null;
          const itemEventDatesJson = item.eventDates?.length ? JSON.stringify(item.eventDates) : null;
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
                expiresAt: item.expiresAt ?? existing.expiresAt,
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

function kstDateTimeToIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed.replace(" ", "T")}+09:00`).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T23:59:59+09:00`).toISOString();
  }
  return null;
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
      if (!goodsCode) continue;
      const price = it.prices?.[0];
      const basePrice = parseKrwDigits(price?.originPrice);
      const salePrice = parseKrwDigits(price?.discountPrice);
      const badges = (it.benefitBadges ?? []).map((b) => b.text?.trim() ?? "").filter(Boolean);
      const webUrl = it.action?.web?.startsWith("https://")
        ? it.action.web
        : `https://nol.yanolja.com/ticket/products/${goodsCode}`;
      const hasDiscount = salePrice !== null || widgetTitle.includes("할인");

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
        thumbnail: it.thumbnail?.startsWith("https://") ? it.thumbnail : (prev?.thumbnail ?? null),
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
      /https?:\/\/ticketimage\.interpark\.com\/(?:Play\/ITM\/Data\/Modify\/|\d{8,}20\d{2}\/)[^"'\\<\s]+?\.(?:jpg|jpeg|png|webp)/gi,
    ) ?? [];
  return Array.from(new Set(matches.map((u) => u.replace(/^http:\/\//, "https://")))).slice(0, 3);
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

  const gdIdx = combined.indexOf('{"goodsDetail":');
  if (gdIdx !== -1) {
    const raw = extractBalancedJson(combined, gdIdx);
    if (raw) {
      try {
        const obj = JSON.parse(raw) as {
          goodsDetail?: {
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
        };
        const gd = obj.goodsDetail;
        if (gd) {
          title = gd.goodsName?.trim() || null;
          venueName = gd.placeName?.trim() || null;
          startDate = gd.playStartDate?.trim() || null;
          endDate = gd.playEndDate?.trim() || null;
          bookingEndTime = kstDateTimeToIso(gd.bookingEndTime ?? gd.detail?.bookingEndTime);
          posterUrl = gd.posterImageUrl?.replace(/^http:\/\//, "https://") || null;
          lotteryApplyStart = kstDateTimeToIso(gd.detail?.lotteryApplyStartDateTime);
          lotteryApplyEnd = kstDateTimeToIso(gd.detail?.lotteryApplyEndDateTime);
          lotteryAnnounce = kstDateTimeToIso(gd.detail?.lotteryAnnounceDateTime);
          const contentImg = /src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp))["']/i.exec(
            gd.detail?.contentInfo ?? "",
          )?.[1];
          if (contentImg) synopsisImageUrl = contentImg.replace(/^http:\/\//, "https://");
        }
      } catch {
        // Ignore malformed goodsDetail chunk
      }
    }
  }

  // Parse prices.all (full "가격 전체보기" table!)
  const discounts: NolParsedPriceRow[] = [];
  const pIdx = combined.indexOf('{"prices":{"all":');
  if (pIdx !== -1) {
    const raw = extractBalancedJson(combined, pIdx);
    if (raw) {
      try {
        const obj = JSON.parse(raw) as {
          prices?: {
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
        };
        const allRows = obj.prices?.all ?? [];
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
          const basePrice = basicPriceByGrade.get(gradeName) ?? null;
          discounts.push({
            seatGrade: normalizeSeatGrade(gradeName),
            seatGradeName: gradeName,
            priceGrade: row.priceGrade ?? `${discounts.length + 1}`,
            priceGradeName: label,
            basePrice,
            salePrice,
            discountStartDate: kstDateTimeToIso(row.priceStartDate || row.discountStartDate),
            discountEndDate: kstDateTimeToIso(row.priceEndDate || row.discountEndDate),
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
          const photo = (c.manSmallImageUrl || c.manLargeImageUrl || "").replace(/^http:\/\//, "https://") || null;
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
    castCredits,
    noticeImageUrls: parseNolNoticeImages(combined),
    synopsisImageUrl,
  };
}

/** Tier-1 NOL Ticket adapter: full prices.all + lottery/SugarDay/timesale banners + structured castCredits + notice OCR. */
export const nolAdapter: ChannelSyncAdapter = {
  sourceName: "NOL",
  async fetchDrafts(ctx) {
    const genreRes = await fetch("https://nol.yanolja.com/ticket/genre/musical", { headers: BROWSER_HEADERS });
    if (!genreRes.ok) throw new Error(`NOL genre HTTP ${genreRes.status}`);
    const genreHtml = await genreRes.text();

    const genreItems = parseNolMusicalHtml(genreHtml).filter((it) => !isKidsMusical(it.title, it.venueName));
    const promoBanners = parseNolPromoBanners(genreHtml);

    // Build prioritized queue of NOL goodsCodes (promo banners -> KOPIS-linked shows -> genre items)
    type QueueEntry = {
      goodsCode: string;
      directShowId?: number;
      fallbackTitle: string;
      fallbackVenue?: string;
      fallbackRegion?: string;
      promoKind?: "LOTTERY" | "SPECIAL_DAY" | "TIMESALE";
      promoAlt?: string;
      priority: number;
    };
    const queue = new Map<string, QueueEntry>();

    for (const b of promoBanners) {
      queue.set(b.goodsCode, {
        goodsCode: b.goodsCode,
        fallbackTitle: b.alt,
        promoKind: b.kind,
        promoAlt: b.alt,
        priority: 3,
      });
    }

    for (const s of ctx?.shows ?? []) {
      const gc = s.channelLinks.nol;
      if (!gc) continue;
      const existing = queue.get(gc);
      if (existing) {
        existing.directShowId = s.id;
      } else {
        queue.set(gc, {
          goodsCode: gc,
          directShowId: s.id,
          fallbackTitle: s.title,
          fallbackVenue: s.venueName,
          priority: s.hasEnrichedCast ? 1 : 2,
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
        });
      }
    }

    const sortedQueue = Array.from(queue.values()).sort((a, b) => b.priority - a.priority);
    const drafts: RawChannelDraft[] = [];

    // Fetch up to 12 product detail pages per run to fit comfortably in Cloudflare Workers subrequest budget
    for (const target of sortedQueue.slice(0, 12)) {
      const productUrl = `https://nol.yanolja.com/ticket/products/${target.goodsCode}`;
      try {
        const dRes = await fetch(productUrl, { headers: BROWSER_HEADERS });
        if (!dRes.ok) continue;
        const parsed = parseNolProductDetailHtml(await dRes.text(), target.goodsCode);
        const showTitle = parsed.title || target.fallbackTitle;
        if (isKidsMusical(showTitle, parsed.venueName ?? target.fallbackVenue)) continue;

        let emittedForProduct = false;

        // 1. Lottery product (e.g. ［로터리 티켓］)
        if (parsed.lotteryApplyEnd || target.promoKind === "LOTTERY") {
          const lowestLottery = parsed.discounts[0];
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
            conditionSummary: parsed.lotteryAnnounce
              ? `NOL 로터리 티켓 추첨 (발표 ${parsed.lotteryAnnounce.slice(5, 10)})`
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
        }

        // 2. Every non-statutory discount row from prices.all
        const extraHints = target.promoKind === "SPECIAL_DAY" ? [target.promoAlt ?? "슈가DAY"] : [];
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
          // For special-day standalone goods (e.g. 슈가DAY), if basic row wasn't present, compute from label percent if possible
          let basePrice = row.basePrice;
          if (!basePrice) {
            const pct = /(\d{1,2})\s*%/.exec(row.priceGradeName)?.[1];
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
          drafts.push({
            externalKey: `nol-${target.goodsCode}-${row.seatGrade}-${row.priceGrade}`,
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

/** Parse YES24 GenreList_Data.aspx HTML into musical items. */
export function parseYes24GenreListHtml(html: string): Yes24GenreItem[] {
  const out: Yes24GenreItem[] = [];
  const seen = new Set<string>();
  const re =
    /jsf_base_GoToPerfDetail\((\d+)\);'\s*title='([^']+)'[\s\S]*?(?:data-src|src)='([^']+)'[\s\S]*?<p class='list-b-tit2[^']*'>([^<]+)<\/p><p class='list-b-tit2[^']*'>([^<]+)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const perfId = m[1];
    if (seen.has(perfId)) continue;
    seen.add(perfId);
    const periodMatch = /(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})/.exec(m[4]);
    const rawPoster = m[3]?.trim();
    const posterUrl = rawPoster ? (rawPoster.startsWith("//") ? `https:${rawPoster}` : rawPoster) : null;
    out.push({
      perfId,
      title: m[2].trim(),
      startDate: periodMatch ? `${periodMatch[1]}-${periodMatch[2]}-${periodMatch[3]}` : undefined,
      endDate: periodMatch ? `${periodMatch[4]}-${periodMatch[5]}-${periodMatch[6]}` : undefined,
      venueName: m[5].trim(),
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

/** Parse YES24 popPerfPromotion.aspx ("가격 - 자세히") HTML table into all seat-grade × discount rows. */
export function parseYes24PromotionHtml(html: string): Yes24PromoPriceRow[] {
  const out: Yes24PromoPriceRow[] = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(html)) !== null) {
    const tableBody = tm[1];
    const gradeRaw = /<th[^>]*>([\s\S]*?)<\/th>/i.exec(tableBody)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "전석";
    const seatGrade = normalizeSeatGrade(gradeRaw);

    const rows: Array<{ label: string; price: number }> = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = trRe.exec(tableBody)) !== null) {
      const tds = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) =>
        x[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
      );
      if (tds.length < 2) continue;
      const label = tds[tds.length - 2];
      const price = parseKrwDigits(tds[tds.length - 1]);
      if (label && price) rows.push({ label, price });
    }

    const baseRow = rows.find((r) => r.label.includes("기본가") || r.label === "일반");
    const basePrice = baseRow?.price ?? null;

    for (const row of rows) {
      if (row.label.includes("기본가") || row.label === "일반") continue;
      out.push({
        seatGrade,
        seatGradeName: gradeRaw,
        basePrice,
        label: row.label.replace(/^\s*-\s*/, "").trim(),
        salePrice: row.price,
      });
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

/** Tier-1 YES24 adapter: full popPerfPromotion prices + YES24데이/넵프라이즈/엔젤티켓 promos + cast + event notices. */
export const yes24Adapter: ChannelSyncAdapter = {
  sourceName: "YES24",
  async fetchDrafts(ctx) {
    const out: RawChannelDraft[] = [];

    // 1. Musical genre list (active musicals)
    const genreRes = await fetch(
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
      const evRes = await fetch("https://ticket.yes24.com/New/Events/Main.aspx", { headers: BROWSER_HEADERS });
      if (evRes.ok) {
        const promoIds = parseYes24PromotionIds(await evRes.text()).slice(0, 5);
        for (const promoId of promoIds) {
          const pr = await fetch(`https://ticket.yes24.com/Pages/Events/HotEvent/PromotionInfo.aspx?id=${promoId}`, {
            headers: BROWSER_HEADERS,
          });
          if (!pr.ok) continue;
          const pHtml = await pr.text();
          const ogTitle = /property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(pHtml)?.[1] ?? "";
          if (!/YES24데이|예스24데이|넵프라이즈|엔젤티켓|예스특가|타임세일/i.test(ogTitle)) continue;
          for (const pm of pHtml.matchAll(/(?:\/Perf\/|IdPerf=|PerfDetail\()(\d{5})/gi)) {
            if (!specialPromoByPerfId.has(pm[1])) specialPromoByPerfId.set(pm[1], ogTitle);
          }
        }
      }
    } catch {
      // Keep full price sync running even if events hub fails
    }

    // 3. Build prioritized queue of YES24 perfIds (special promo -> KOPIS-linked shows -> genre list)
    type YQueue = {
      perfId: string;
      directShowId?: number;
      title: string;
      venueName?: string;
      startDate?: string;
      endDate?: string;
      posterUrl?: string | null;
      specialPromoTitle?: string;
      needsCast?: boolean;
      priority: number;
    };
    const queue = new Map<string, YQueue>();

    for (const s of ctx?.shows ?? []) {
      const pid = s.channelLinks.yes24;
      if (!pid) continue;
      const specialTitle = specialPromoByPerfId.get(pid);
      queue.set(pid, {
        perfId: pid,
        directShowId: s.id,
        title: s.title,
        venueName: s.venueName,
        specialPromoTitle: specialTitle,
        needsCast: !s.hasEnrichedCast,
        priority: specialTitle ? 3 : 2,
      });
    }

    for (const g of genreItems) {
      const existing = queue.get(g.perfId);
      if (existing) {
        existing.startDate = g.startDate;
        existing.endDate = g.endDate;
        existing.posterUrl = g.posterUrl;
      } else {
        const specialTitle = specialPromoByPerfId.get(g.perfId);
        queue.set(g.perfId, {
          perfId: g.perfId,
          title: g.title,
          venueName: g.venueName,
          startDate: g.startDate,
          endDate: g.endDate,
          posterUrl: g.posterUrl,
          specialPromoTitle: specialTitle,
          priority: specialTitle ? 3 : 1,
        });
      }
    }

    const sortedQueue = Array.from(queue.values()).sort((a, b) => b.priority - a.priority);
    let castFetches = 0;

    for (const target of sortedQueue.slice(0, 12)) {
      const detailUrl = `https://ticket.yes24.com/Perf/${target.perfId}`;
      try {
        const promoRes = await fetch("https://ticket.yes24.com/New/Perf/Detail/Popup/popPerfPromotion.aspx", {
          method: "POST",
          headers: {
            ...BROWSER_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Referer: detailUrl,
            "X-Requested-With": "XMLHttpRequest",
          },
          body: `IdPerf=${encodeURIComponent(target.perfId)}`,
        });
        if (!promoRes.ok) continue;

        const rows = parseYes24PromotionHtml(await promoRes.text());

        // Optional cast enrichment from Perf/{id} HTML when show has no NOL/YES24 cast yet
        let castCredits: CastCreditInput[] | undefined;
        if (target.needsCast && castFetches < 3) {
          castFetches += 1;
          try {
            const pRes = await fetch(detailUrl, { headers: BROWSER_HEADERS });
            if (pRes.ok) {
              const parsedCast = parseYes24CastHtml(await pRes.text());
              if (parsedCast.length > 0) castCredits = parsedCast;
            }
          } catch {
            // Optional cast enrichment failure is non-fatal
          }
        }

        let first = true;
        for (let idx = 0; idx < rows.length; idx++) {
          const row = rows[idx];
          const classified = classifyDiscountLabel(row.label);
          if (classified.isStatutory) continue;
          const labelDates = extractDiscountDatesFromLabel(row.label, {
            showStartDate: target.startDate,
            showEndDate: target.endDate,
          });

          out.push({
            externalKey: `yes24-${target.perfId}-${row.seatGrade}-${idx}`,
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
      const nRes = await fetch("https://ticket.yes24.com/New/Notice/Ajax/axList.aspx?page=1&genre=15457", {
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
          const dealType: DealType | null = title.includes("싱어롱")
            ? "SINGALONG"
            : title.includes("커튼콜")
              ? "CURTAIN_CALL"
              : title.includes("특전") || title.includes("포토카드") || title.includes("굿즈")
                ? "PERK_GOODS"
                : /YES24데이|예스24데이/i.test(title)
                  ? "SPECIAL_DAY"
                  : null;
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
            expiresAt: latestNotice ? new Date(`${latestNotice}T23:59:59+09:00`).toISOString() : null,
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

/** Parse ALL seat grade rows from L.TICKET detail HTML (`#seatPriceTable`). */
export function parseLTicketAllSeatPrices(html: string): {
  title: string | null;
  venueName: string | null;
  posterUrl: string | null;
  seats: LTicketSeatPriceRow[];
  discountImageUrls: string[];
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

  const seats: LTicketSeatPriceRow[] = [];
  const rowRe =
    /<th[^>]*scope="row"[^>]*>([^<]+)<\/th>\s*<td>\s*<div class="seat_price_value">\s*<strong>([0-9,]+)원<\/strong>(?:\s*<span class="max_discount">[^0-9]*([0-9,]+)원<\/span>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const seatGradeName = m[1].trim();
    const basePrice = parseKrwDigits(m[2]);
    const salePrice = parseKrwDigits(m[3]);
    if (!basePrice) continue;
    seats.push({
      seatGrade: normalizeSeatGrade(seatGradeName),
      seatGradeName,
      basePrice,
      salePrice,
    });
  }

  // Extract discount info images from <h3>할인정보...</h3> accordion for Vision OCR
  const discountImageUrls: string[] = [];
  const discAcc = /<h3>\s*할인정보[\s\S]*?<div class="info_accordion_body">([\s\S]*?)<\/div>/i.exec(html)?.[1];
  if (discAcc) {
    for (const im of discAcc.matchAll(/src=["'](https:\/\/cdn\.l-ticket\.co\.kr\/images\/[^"']+\.(?:jpg|jpeg|png|webp))["']/gi)) {
      if (!discountImageUrls.includes(im[1])) discountImageUrls.push(im[1]);
    }
  }

  return {
    title: rawTitle,
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

/** Tier-1 L.TICKET adapter: scans 뮤지컬·연극 (UWVJLM) + 지역 (FWALLB) + KOPIS-linked products, emits all discounted grades + queues 할인정보 OCR. */
export const lTicketAdapter: ChannelSyncAdapter = {
  sourceName: "LTICKET",
  async fetchDrafts(ctx) {
    const ids = new Map<string, { hintName: string; directShowId?: number }>();

    for (const s of ctx?.shows ?? []) {
      if (s.channelLinks.lticket) {
        ids.set(s.channelLinks.lticket, { hintName: s.title, directShowId: s.id });
      }
    }

    for (const url of [
      "https://www.l-ticket.co.kr/product/list?condition=UWVJLM",
      "https://www.l-ticket.co.kr/product/list?condition=FWALLB",
    ]) {
      try {
        const res = await fetch(url, { headers: BROWSER_HEADERS });
        if (!res.ok) continue;
        const html = await res.text();
        const itemRe = /href="\/product\/detail\/(\d+)"[^>]*>[\s\S]{0,300}?<span class="on_sale_ticker_name">([\s\S]*?)<\/span>/gi;
        let m: RegExpExecArray | null;
        while ((m = itemRe.exec(html)) !== null) {
          const name = m[2].replace(/<[^>]+>/g, "").trim();
          if (!ids.has(m[1])) ids.set(m[1], { hintName: name });
        }
        const genericRe = /href="\/product\/detail\/(\d+)"/gi;
        while ((m = genericRe.exec(html)) !== null) {
          if (!ids.has(m[1])) ids.set(m[1], { hintName: "" });
        }
      } catch {
        // Keep other list tabs running
      }
    }

    const drafts: RawChannelDraft[] = [];
    let detailFetches = 0;

    for (const [productId, meta] of ids) {
      if (detailFetches >= 10) break;
      if (
        meta.hintName &&
        (meta.hintName.startsWith("연극") || meta.hintName.includes("Series.L") || isKidsMusical(meta.hintName))
      ) {
        continue;
      }
      detailFetches += 1;

      const detailUrl = `https://www.l-ticket.co.kr/product/detail/${productId}`;
      try {
        const dRes = await fetch(detailUrl, { headers: BROWSER_HEADERS });
        if (!dRes.ok) continue;
        const parsed = parseLTicketAllSeatPrices(await dRes.text());
        const showTitle = parsed.title || meta.hintName;
        if (
          !showTitle ||
          showTitle.startsWith("연극") ||
          showTitle.includes("Series.L") ||
          isKidsMusical(showTitle, parsed.venueName)
        ) {
          continue;
        }

        const discountedSeats = parsed.seats.filter((s) => s.salePrice !== null && s.salePrice < s.basePrice);
        let first = true;
        for (const seat of discountedSeats) {
          drafts.push({
            externalKey: `lticket-prod-${productId}-${seat.seatGrade}-${seat.seatGradeName}`,
            channelName: "엘티켓",
            directShowId: meta.directShowId,
            showTitle,
            venueName: parsed.venueName ?? undefined,
            dealType: "TIMESALE",
            seatGrade: seat.seatGrade,
            basePrice: seat.basePrice,
            salePrice: seat.salePrice,
            isUnconditional: true,
            conditionSummary: `엘티켓 ${seat.seatGradeName} 최대할인가`,
            externalUrl: detailUrl,
            posterUrl: parsed.posterUrl,
            noticeImageUrls: first ? parsed.discountImageUrls : [],
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
