import { and, eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  actors,
  showActors,
  shows,
  syncRuns,
  userActorFollows,
  userNotifications,
  type SubRegion,
} from "@/db/schema";
import { formatKstDate } from "@/lib/kst";
import { isKidsMusical } from "./kids-filter";

const DAEHAKRO_KEYWORDS = ["대학로", "동숭동", "혜화동", "명륜", "이화동", "연건동"];
const DAEHAKRO_VENUES = [
  "유니플렉스",
  "예스24스테이지",
  "링크아트센터",
  "드림아트센터",
  "TOM",
  "티오엠",
  "서경대학교 공연예술센터",
  "대학로",
  "자유극장",
  "아트원씨어터",
  "플러스씨어터",
];

export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/뮤지컬/g, "")
    .replace(/[<>\[\](){}「」『』·•.,:;\-_'"]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/** BP-SEARCH-004: classify KOPIS area/address/venue into 8 sub_regions with Seoul-Daehakro split. */
export function classifySubRegion(
  region: string,
  venueAddress?: string | null,
  venueName?: string | null,
): SubRegion {
  const r = region.trim();
  const addr = venueAddress ?? "";
  const venue = venueName ?? "";

  if (r.includes("서울")) {
    if (
      DAEHAKRO_KEYWORDS.some((k) => addr.includes(k) || venue.includes(k)) ||
      DAEHAKRO_VENUES.some((v) => venue.includes(v))
    ) {
      return "DAEHAKRO";
    }
    return "SEOUL_OTHER";
  }
  if (r.includes("경기") || r.includes("인천")) return "GYEONGGI_INCHEON";
  if (r.includes("부산")) return "BUSAN";
  if (r.includes("대구")) return "DAEGU";
  if (r.includes("대전") || r.includes("충청") || r.includes("충북") || r.includes("충남") || r.includes("세종")) {
    return "DAEJEON_CHUNGCHEONG";
  }
  if (r.includes("광주") || r.includes("전라") || r.includes("전북") || r.includes("전남")) {
    return "GWANGJU_JEOLLA";
  }
  if (r.includes("강원") || r.includes("제주")) return "GANGWON_JEJU";
  // Fallback for 경상/울산 -> BUSAN/DAEGU bucket
  if (r.includes("울산") || r.includes("경남")) return "BUSAN";
  if (r.includes("경북")) return "DAEGU";
  return "SEOUL_OTHER";
}

/** DD-006: parse KOPIS pcseguidance string into {"VIP":170000,"R":140000,...}. */
export function parseBasePricesText(raw: string | null | undefined): Record<string, number> | null {
  if (!raw) return null;
  const out: Record<string, number> = {};
  const regex = /(VIP|R|S|A|OP|전석|일반)\s*석?\s*[:\-]?\s*([0-9,]+)\s*원/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const keyRaw = match[1].toUpperCase();
    const key = keyRaw === "전석" || keyRaw === "일반" ? "ALL" : keyRaw;
    const price = Number(match[2].replace(/,/g, ""));
    if (Number.isFinite(price) && price > 0) out[key] = price;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** DD-006: parse KOPIS prfcast ("홍광호, 김준수, 박은태 등") into clean actor names. */
export function parseCastText(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const cleaned = raw.replace(/\s*등\s*\.?$/, "").trim();
  if (!cleaned) return [];
  const names = cleaned
    .split(/[,/·]/)
    .map((s) => s.replace(/\(.*?\)/g, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 20 && !/^외\s*\d*/.test(s));
  return Array.from(new Set(names));
}

function xmlTag(block: string, tag: string): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
}

export interface KopisShowSummary {
  kopisId: string;
  title: string;
  startDate: string;
  endDate: string;
  venueName: string;
  posterUrl: string | null;
  region: string;
  state: string;
}

export interface KopisShowDetail {
  kopisId: string;
  pcseguidance: string;
  prfcast: string;
  venueId: string;
}

export function parseKopisXmlList(xml: string): KopisShowSummary[] {
  const items: KopisShowSummary[] = [];
  const matches = xml.match(/<db>[\s\S]*?<\/db>/gi) ?? [];
  for (const block of matches) {
    const kopisId = xmlTag(block, "mt20id");
    const title = xmlTag(block, "prfnm");
    if (!kopisId || !title) continue;
    items.push({
      kopisId,
      title,
      startDate: xmlTag(block, "prfpdfrom").replaceAll(".", "-"),
      endDate: xmlTag(block, "prfpdto").replaceAll(".", "-"),
      venueName: xmlTag(block, "fcltynm") || "미정",
      posterUrl: xmlTag(block, "poster") || null,
      region: xmlTag(block, "area") || "서울특별시",
      state: xmlTag(block, "prfstate"),
    });
  }
  return items;
}

export function parseKopisXmlDetail(xml: string): KopisShowDetail | null {
  const kopisId = xmlTag(xml, "mt20id");
  if (!kopisId) return null;
  return {
    kopisId,
    pcseguidance: xmlTag(xml, "pcseguidance"),
    prfcast: xmlTag(xml, "prfcast"),
    venueId: xmlTag(xml, "mt10id"),
  };
}

function mapKopisState(state: string, startDate: string, todayKst: string): "UPCOMING" | "ONGOING" | "ENDED" {
  if (state.includes("완료") || state.includes("종료")) return "ENDED";
  if (state.includes("예정") || startDate > todayKst) return "UPCOMING";
  return "ONGOING";
}

export interface KopisSyncOptions {
  maxPages?: number;
  maxDetailFetches?: number;
  fetchFn?: typeof fetch;
}

/**
 * FR-001: daily KOPIS sync (auto-upserts shows, actors, show_actors, notifies actor followers).
 * Bounded for Cloudflare Workers Free subrequest limit via venueId caching & incremental detail fetch.
 */
export async function syncKopisShows(
  db: AppDb,
  apiKey: string | undefined,
  now = new Date(),
  opts: KopisSyncOptions = {},
): Promise<{
  runId: number;
  fetchedCount: number;
  detailFetchCount: number;
  status: "SUCCESS" | "FAILED";
  error?: string;
}> {
  const [run] = await db
    .insert(syncRuns)
    .values({ sourceName: "KOPIS", status: "RUNNING" })
    .returning({ id: syncRuns.id });

  if (!apiKey) {
    const msg = "KOPIS_API_KEY가 설정되지 않아 동기화를 건너뛰었습니다.";
    await db
      .update(syncRuns)
      .set({ status: "FAILED", errorMessage: msg, finishedAt: new Date().toISOString() })
      .where(eq(syncRuns.id, run.id));
    return { runId: run.id, fetchedCount: 0, detailFetchCount: 0, status: "FAILED", error: msg };
  }

  const fetchImpl = opts.fetchFn ?? fetch;
  const maxPages = Math.max(1, opts.maxPages ?? 3);
  const maxDetailFetches = Math.max(0, opts.maxDetailFetches ?? 18);

  try {
    const todayKst = formatKstDate(now);
    const stdate = todayKst.replaceAll("-", "");
    const edDate = new Date(now.getTime() + 90 * 86_400_000);
    const eddate = formatKstDate(edDate).replaceAll("-", "");

    // 1. Collect KOPIS official children's show IDs (kidstate=Y) so we can exclude kids musicals accurately.
    const kidsKopisIds = new Set<string>();
    try {
      for (let page = 1; page <= 2; page++) {
        const kidUrl = `https://www.kopis.or.kr/openApi/restful/pblprfr?service=${encodeURIComponent(
          apiKey,
        )}&stdate=${stdate}&eddate=${eddate}&cpage=${page}&rows=100&shcate=GGGA&kidstate=Y`;
        const kRes = await fetchImpl(kidUrl);
        if (!kRes.ok) break;
        const kidItems = parseKopisXmlList(await kRes.text());
        for (const k of kidItems) kidsKopisIds.add(k.kopisId);
        if (kidItems.length < 100) break;
      }
    } catch {
      // Fall back to keyword kids filter if kidstate=Y query fails
    }

    // 2. Fetch musicals prioritizing currently ongoing (prfstate=02) then upcoming (prfstate=01)
    const list: KopisShowSummary[] = [];
    const seenKopisIds = new Set<string>();
    const statePlans: Array<{ prfstate: string; pages: number }> =
      maxPages >= 2
        ? [
            { prfstate: "02", pages: Math.max(1, maxPages - 1) },
            { prfstate: "01", pages: 1 },
          ]
        : [{ prfstate: "", pages: maxPages }];

    for (const plan of statePlans) {
      for (let page = 1; page <= plan.pages; page++) {
        const stateParam = plan.prfstate ? `&prfstate=${plan.prfstate}` : "";
        const listUrl = `https://www.kopis.or.kr/openApi/restful/pblprfr?service=${encodeURIComponent(
          apiKey,
        )}&stdate=${stdate}&eddate=${eddate}&cpage=${page}&rows=50&shcate=GGGA${stateParam}`;
        const res = await fetchImpl(listUrl);
        if (!res.ok) throw new Error(`KOPIS list HTTP ${res.status}`);
        const pageItems = parseKopisXmlList(await res.text());
        for (const item of pageItems) {
          if (seenKopisIds.has(item.kopisId)) continue;
          if (kidsKopisIds.has(item.kopisId) || isKidsMusical(item.title, item.venueName)) continue;
          seenKopisIds.add(item.kopisId);
          list.push(item);
        }
        if (pageItems.length < 50) break;
      }
    }

    // 3. Prioritize most recently opened/scheduled shows first for detail enrichment
    list.sort((a, b) => b.startDate.localeCompare(a.startDate));

    const venueAddressCache = new Map<string, string | null>();
    let synced = 0;
    let detailFetchCount = 0;

    for (const item of list) {
      const [existing] = await db
        .select({
          id: shows.id,
          basePricesJson: shows.basePricesJson,
          venueAddress: shows.venueAddress,
        })
        .from(shows)
        .where(eq(shows.kopisId, item.kopisId))
        .limit(1);

      const needsDetail = !existing || (!existing.basePricesJson && !existing.venueAddress);
      let detail: KopisShowDetail | null = null;
      let venueAddress: string | null = existing?.venueAddress ?? null;

      if (needsDetail && detailFetchCount < maxDetailFetches) {
        detailFetchCount += 1;
        try {
          const dRes = await fetchImpl(
            `https://www.kopis.or.kr/openApi/restful/pblprfr/${encodeURIComponent(item.kopisId)}?service=${encodeURIComponent(apiKey)}`,
          );
          if (dRes.ok) detail = parseKopisXmlDetail(await dRes.text());
          if (detail?.venueId) {
            if (venueAddressCache.has(detail.venueId)) {
              venueAddress = venueAddressCache.get(detail.venueId) ?? null;
            } else {
              const vRes = await fetchImpl(
                `https://www.kopis.or.kr/openApi/restful/prfplc/${encodeURIComponent(detail.venueId)}?service=${encodeURIComponent(apiKey)}`,
              );
              const addr = vRes.ok ? xmlTag(await vRes.text(), "adres") || null : null;
              venueAddressCache.set(detail.venueId, addr);
              venueAddress = addr;
            }
          }
        } catch {
          // Preserve list item upsert even if detail lookup fails
        }
      }

      const subRegion = classifySubRegion(item.region, venueAddress, item.venueName);
      const basePrices = parseBasePricesText(detail?.pcseguidance);
      const status = mapKopisState(item.state, item.startDate, todayKst);
      const nowIso = now.toISOString();

      let showId: number;
      if (existing) {
        showId = existing.id;
        await db
          .update(shows)
          .set({
            title: item.title,
            normalizedTitle: normalizeTitle(item.title),
            posterUrl: item.posterUrl,
            venueName: item.venueName,
            ...(venueAddress ? { venueAddress } : {}),
            region: item.region,
            subRegion,
            startDate: item.startDate,
            endDate: item.endDate,
            ...(basePrices ? { basePricesJson: JSON.stringify(basePrices) } : {}),
            status,
            updatedAt: nowIso,
          })
          .where(eq(shows.id, showId));
      } else {
        const [inserted] = await db
          .insert(shows)
          .values({
            kopisId: item.kopisId,
            title: item.title,
            normalizedTitle: normalizeTitle(item.title),
            posterUrl: item.posterUrl,
            venueName: item.venueName,
            venueAddress,
            region: item.region,
            subRegion,
            startDate: item.startDate,
            endDate: item.endDate,
            basePricesJson: basePrices ? JSON.stringify(basePrices) : null,
            status,
          })
          .returning({ id: shows.id });
        showId = inserted.id;
      }

      // Parse prfcast -> actors + show_actors + notify followers if brand new show
      const castNames = parseCastText(detail?.prfcast);
      const linkedActorIds: number[] = [];
      for (const name of castNames) {
        const norm = name.replace(/\s+/g, "").toLowerCase();
        const [foundActor] = await db
          .select({ id: actors.id })
          .from(actors)
          .where(eq(actors.normalizedName, norm))
          .limit(1);

        let actorId: number;
        if (foundActor) {
          actorId = foundActor.id;
        } else {
          const [createdActor] = await db
            .insert(actors)
            .values({ name, normalizedName: norm })
            .returning({ id: actors.id });
          actorId = createdActor.id;
        }
        linkedActorIds.push(actorId);
        await db
          .insert(showActors)
          .values({ showId, actorId, sourceType: "KOPIS" })
          .onConflictDoNothing();
      }

      if (!existing && linkedActorIds.length > 0) {
        const followers = await db
          .select({ userId: userActorFollows.userId, actorId: userActorFollows.actorId })
          .from(userActorFollows)
          .where(inArray(userActorFollows.actorId, linkedActorIds));

        if (followers.length > 0) {
          await db
            .insert(userNotifications)
            .values(
              followers.map((f) => ({
                userId: f.userId,
                notiType: "FOLLOWED_ACTOR_NEW_SHOW" as const,
                showId,
                actorId: f.actorId,
                title: `신규 출연작 등록 · ${item.title}`,
                body: `${item.venueName} (${item.startDate} ~ ${item.endDate})`,
                dedupKey: `new-show:${showId}:u:${f.userId}`,
              })),
            )
            .onConflictDoNothing();
        }
      }

      synced += 1;
    }

    await db
      .update(syncRuns)
      .set({ status: "SUCCESS", fetchedCount: synced, finishedAt: new Date().toISOString() })
      .where(eq(syncRuns.id, run.id));

    return { runId: run.id, fetchedCount: synced, detailFetchCount, status: "SUCCESS" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(syncRuns)
      .set({ status: "FAILED", errorMessage: msg, finishedAt: new Date().toISOString() })
      .where(eq(syncRuns.id, run.id));
    return { runId: run.id, fetchedCount: 0, detailFetchCount: 0, status: "FAILED", error: msg };
  }
}
