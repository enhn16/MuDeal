import { and, eq, inArray, like, or } from "drizzle-orm";
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
  "예스24아트원",
  "링크아트센터",
  "드림아트센터",
  "TOM",
  "티오엠",
  "서경대학교 공연예술센터",
  "서경스퀘어",
  "대학로",
  "자유극장",
  "아트원씨어터",
  "플러스씨어터",
];

export interface ChannelLinks {
  nol?: string;
  yes24?: string;
  lticket?: string;
}

export function parseChannelLinks(raw: string | null | undefined): ChannelLinks {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: ChannelLinks = {};
    if (typeof parsed.nol === "string" && parsed.nol) out.nol = parsed.nol;
    if (typeof parsed.yes24 === "string" && parsed.yes24) out.yes24 = parsed.yes24;
    if (typeof parsed.lticket === "string" && parsed.lticket) out.lticket = parsed.lticket;
    return out;
  } catch {
    return {};
  }
}

export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/뮤지컬/g, "")
    .replace(/[<>\[\](){}「」『』〈〉《》·•.,:;\-_'"]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/** BP-SEARCH-004: classify KOPIS area/address/venue into 8 sub_regions with Seoul-Daehakro split. */
export function classifySubRegion(
  region: string,
  venueAddress?: string | null,
  venueName?: string | null,
  isDaehakroFlag?: boolean,
): SubRegion {
  const r = region.trim();
  const addr = venueAddress ?? "";
  const venue = venueName ?? "";

  if (isDaehakroFlag) return "DAEHAKRO";

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

function toHttpsKopisUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://www.kopis.or.kr/")) {
    return trimmed.replace(/^http:\/\//, "https://");
  }
  return trimmed.startsWith("https://") || trimmed.startsWith("http://") ? trimmed : null;
}

/** Extract NOL, YES24, and L.TICKET product IDs from KOPIS <relates> block (Ticketlink intentionally excluded). */
export function parseKopisRelates(xml: string): ChannelLinks {
  const links: ChannelLinks = {};
  const relRe = /<relate>[\s\S]*?<relatenm>([\s\S]*?)<\/relatenm>[\s\S]*?<relateurl>([\s\S]*?)<\/relateurl>[\s\S]*?<\/relate>/gi;
  let m: RegExpExecArray | null;
  while ((m = relRe.exec(xml)) !== null) {
    const name = m[1].trim().toLowerCase();
    const url = m[2].trim();
    if (!url) continue;

    if (!links.nol && (name.includes("놀유니버스") || name.includes("인터파크") || url.includes("interpark.com") || url.includes("nol.yanolja.com"))) {
      const id = /(?:GoodsCode=|\/goods\/|\/products\/)(\d{7,9})/i.exec(url)?.[1];
      if (id) links.nol = id;
    } else if (!links.yes24 && (name.includes("예스24") || name.includes("yes24") || url.includes("yes24.com"))) {
      const id = /(?:\/Perf\/|IdPerf=)(\d{4,7})/i.exec(url)?.[1];
      if (id) links.yes24 = id;
    } else if (!links.lticket && (name.includes("l티켓") || name.includes("엘티켓") || url.includes("l-ticket.co.kr"))) {
      const id = /\/product\/detail\/(\d+)/i.exec(url)?.[1];
      if (id) links.lticket = id;
    }
  }
  return links;
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
  isDaehakro: boolean;
  synopsisImageUrl: string | null;
  channelLinks: ChannelLinks;
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
      posterUrl: toHttpsKopisUrl(xmlTag(block, "poster")),
      region: xmlTag(block, "area") || "서울특별시",
      state: xmlTag(block, "prfstate"),
    });
  }
  return items;
}

export function parseKopisXmlDetail(xml: string): KopisShowDetail | null {
  const kopisId = xmlTag(xml, "mt20id");
  if (!kopisId) return null;
  const styUrls = [...xml.matchAll(/<styurl>([\s\S]*?)<\/styurl>/gi)]
    .map((m) => toHttpsKopisUrl(m[1]))
    .filter((u): u is string => Boolean(u))
    .slice(0, 3);
  const synopsisImageUrl =
    styUrls.length === 0 ? null : styUrls.length === 1 ? styUrls[0] : JSON.stringify(styUrls);
  return {
    kopisId,
    pcseguidance: xmlTag(xml, "pcseguidance"),
    prfcast: xmlTag(xml, "prfcast"),
    venueId: xmlTag(xml, "mt10id"),
    isDaehakro: xmlTag(xml, "daehakro").toUpperCase() === "Y",
    synopsisImageUrl,
    channelLinks: parseKopisRelates(xml),
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
  requestDelayMs?: number;
  fetchFn?: typeof fetch;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * FR-001: daily KOPIS sync (auto-upserts shows, channelLinks from <relates>, synopsisImageUrl, actors, show_actors).
 * Uses official kidstate=N filter with rows=100 so all non-kids musicals fit cleanly in 2-3 list requests.
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
  const maxDetailFetches = Math.max(0, opts.maxDetailFetches ?? 16);
  const requestDelayMs = opts.requestDelayMs ?? (opts.fetchFn ? 0 : 250);

  try {
    const todayKst = formatKstDate(now);
    const stdate = todayKst.replaceAll("-", "");
    const edDate = new Date(now.getTime() + 180 * 86_400_000);
    const eddate = formatKstDate(edDate).replaceAll("-", "");

    // 1. Fetch non-kids musicals directly via kidstate=N (rows=100) prioritizing ongoing (02) then upcoming (01)
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
        )}&stdate=${stdate}&eddate=${eddate}&cpage=${page}&rows=100&shcate=GGGA&kidstate=N${stateParam}`;
        const res = await fetchImpl(listUrl);
        if (!res.ok) throw new Error(`KOPIS list HTTP ${res.status}`);
        const pageItems = parseKopisXmlList(await res.text());
        for (const item of pageItems) {
          if (seenKopisIds.has(item.kopisId)) continue;
          if (isKidsMusical(item.title, item.venueName)) continue;
          seenKopisIds.add(item.kopisId);
          list.push(item);
        }
        if (pageItems.length < 100) break;
      }
    }

    // 2. Prioritize currently ongoing shows first (then most recently started) so active musicals get relates/styurls immediately
    list.sort((a, b) => {
      const aOngoing = a.state.includes("공연중") || a.startDate <= todayKst ? 1 : 0;
      const bOngoing = b.state.includes("공연중") || b.startDate <= todayKst ? 1 : 0;
      if (aOngoing !== bOngoing) return bOngoing - aOngoing;
      return b.startDate.localeCompare(a.startDate);
    });

    const venueAddressCache = new Map<string, string | null>();
    let synced = 0;
    let detailFetchCount = 0;

    for (const item of list) {
      const normTitle = normalizeTitle(item.title);
      const [existing] = await db
        .select({
          id: shows.id,
          kopisId: shows.kopisId,
          basePricesJson: shows.basePricesJson,
          venueAddress: shows.venueAddress,
          channelLinksJson: shows.channelLinksJson,
          synopsisImageUrl: shows.synopsisImageUrl,
        })
        .from(shows)
        .where(
          or(
            eq(shows.kopisId, item.kopisId),
            and(
              like(shows.kopisId, "XLSX_%"),
              eq(shows.normalizedTitle, normTitle),
              eq(shows.startDate, item.startDate),
            ),
          ),
        )
        .limit(1);

      const needsDetail =
        !existing ||
        (!existing.basePricesJson && !existing.venueAddress) ||
        !existing.channelLinksJson ||
        !existing.synopsisImageUrl;
      let detail: KopisShowDetail | null = null;
      let venueAddress: string | null = existing?.venueAddress ?? null;

      if (needsDetail && detailFetchCount < maxDetailFetches) {
        if (detailFetchCount > 0 && requestDelayMs > 0) await delay(requestDelayMs);
        detailFetchCount += 1;
        try {
          const dRes = await fetchImpl(
            `https://www.kopis.or.kr/openApi/restful/pblprfr/${encodeURIComponent(item.kopisId)}?service=${encodeURIComponent(apiKey)}`,
          );
          if (dRes.ok) detail = parseKopisXmlDetail(await dRes.text());
          if (detail?.venueId && !venueAddress) {
            if (venueAddressCache.has(detail.venueId)) {
              venueAddress = venueAddressCache.get(detail.venueId) ?? null;
            } else {
              if (requestDelayMs > 0) await delay(requestDelayMs);
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

      const subRegion = classifySubRegion(item.region, venueAddress, item.venueName, detail?.isDaehakro);
      const basePrices = parseBasePricesText(detail?.pcseguidance);
      const mergedLinks: ChannelLinks = {
        ...parseChannelLinks(existing?.channelLinksJson),
        ...(detail?.channelLinks ?? {}),
      };
      const hasLinks = Object.keys(mergedLinks).length > 0;
      const synopsisImageUrl = existing?.synopsisImageUrl ?? detail?.synopsisImageUrl ?? null;
      const status = mapKopisState(item.state, item.startDate, todayKst);
      const nowIso = now.toISOString();

      let showId: number;
      if (existing) {
        showId = existing.id;
        await db
          .update(shows)
          .set({
            kopisId: item.kopisId,
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
            ...(hasLinks ? { channelLinksJson: JSON.stringify(mergedLinks) } : {}),
            ...(synopsisImageUrl ? { synopsisImageUrl } : {}),
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
            channelLinksJson: hasLinks ? JSON.stringify(mergedLinks) : null,
            synopsisImageUrl,
            status,
          })
          .returning({ id: shows.id });
        showId = inserted.id;
      }

      // Fallback cast from KOPIS prfcast (later enriched with full role/photo cast by NOL & YES24 adapters)
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
