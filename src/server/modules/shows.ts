import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  actors,
  CONDITION_TAGS,
  DEAL_TYPES,
  deals,
  homeCurations,
  SEAT_GRADES,
  showActors,
  shows,
  SUB_REGIONS,
  type ConditionTag,
  type DealType,
  type SeatGrade,
  type SubRegion,
} from "@/db/schema";
import {
  calcKstDDay,
  compareDatedBenefitPriority,
  extractDiscountDatesFromLabel,
  formatKstDate,
  isDealActiveNow,
  isExpired,
  normalizeEventDates,
  resolveDatePreset,
} from "@/lib/kst";
import { compareDealsForDisplay, summarizeLowestDeals } from "@/lib/pricing";

export type ShowSort = "LOWEST_PRICE" | "HIGHEST_DISCOUNT" | "CLOSING_SOON" | "POPULAR";
export type HomeCategory = "DISCOUNT" | "PERK" | "EVENT";

export const HOME_CATEGORIES: readonly HomeCategory[] = ["DISCOUNT", "PERK", "EVENT"] as const;

export function dealMatchesCategory(
  deal: Pick<typeof deals.$inferSelect, "dealType" | "salePrice" | "discountRate" | "perkSummary">,
  category: HomeCategory,
): boolean {
  if (category === "DISCOUNT") {
    return deal.salePrice !== null || deal.discountRate !== null || deal.dealType === "LOTTERY";
  }
  if (category === "PERK") {
    return deal.dealType === "PERK_GOODS" || Boolean(deal.perkSummary?.trim());
  }
  return (
    deal.dealType === "SINGALONG" ||
    deal.dealType === "CURTAIN_CALL" ||
    (deal.dealType === "SPECIAL_DAY" && deal.salePrice === null && deal.discountRate === null)
  );
}

export interface ShowSearchQuery {
  q?: string;
  datePreset?: "TODAY" | "THIS_WEEKEND" | "THIS_MONTH";
  dateFrom?: string;
  dateTo?: string;
  priceMin?: number;
  priceMax?: number;
  regions?: SubRegion[];
  category?: HomeCategory;
  dealType?: DealType;
  seatGrade?: SeatGrade;
  unconditionalOnly?: boolean;
  conditionTags?: ConditionTag[];
  source?: "USER_REPORT";
  sort?: ShowSort;
  page?: number;
  pageSize?: number;
}

export interface ShowCardItem {
  id: number;
  title: string;
  posterUrl: string | null;
  venueName: string;
  subRegion: SubRegion;
  startDate: string;
  endDate: string;
  channelCount: number;
  lowestPrice: number | null;
  basePrice: number | null;
  maxDiscountRate: number | null;
  primaryDealType: DealType;
  categories: HomeCategory[];
  discountDates: string[];
  discountExpiresAt: string | null;
  perkHighlight: string | null;
  perkDates: string[];
  eventHighlight: {
    dealType: "SINGALONG" | "CURTAIN_CALL";
    summary: string;
    date: string | null;
    dates: string[];
  } | null;
  isUnconditional: boolean;
  earliestExpiresAt: string | null;
  dDay: number | null;
  communityCredit: {
    dealId: number;
    reporterNickname: string;
    clickCount: number;
    helpfulCount: number;
  } | null;
}

function parseJsonArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function parseBasePrices(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function activeDealCondition(nowIso: string) {
  return and(eq(deals.status, "ACTIVE"), or(isNull(deals.expiresAt), gt(deals.expiresAt, nowIso)));
}

function toShowCard(
  show: typeof shows.$inferSelect,
  showDeals: (typeof deals.$inferSelect)[],
  now: Date,
  preferUnconditional = true,
): ShowCardItem {
  const todayKst = formatKstDate(now);
  const resolveEventDates = (d: typeof deals.$inferSelect) =>
    normalizeEventDates(parseJsonArray<string>(d.eventDatesJson), {
      showStartDate: show.startDate,
      showEndDate: show.endDate,
      fallbackText: [d.conditionSummary, d.perkSummary].filter(Boolean).join(" "),
      now,
    });
  const resolveDiscountMeta = (d: typeof deals.$inferSelect) => {
    const rawDates = parseJsonArray<string>(d.eventDatesJson);
    const labelDates =
      rawDates.length === 0 || !d.expiresAt
        ? extractDiscountDatesFromLabel(d.conditionSummary, {
            showStartDate: show.startDate,
            showEndDate: show.endDate,
            now,
          })
        : { bookingExpiresAt: null, applicableDates: [] };
    const eventDates =
      rawDates.length > 0
        ? normalizeEventDates(rawDates, { showStartDate: show.startDate, showEndDate: show.endDate, now })
        : labelDates.applicableDates;
    const expiresAt = d.expiresAt ?? labelDates.bookingExpiresAt;
    return { eventDates, expiresAt };
  };

  // Pick currently applicable unconditional largest discount first (rate DESC -> salePrice ASC)
  const pricedWithMeta = showDeals
    .filter((d) => d.salePrice !== null || d.discountRate !== null)
    .map((deal) => ({ deal, ...resolveDiscountMeta(deal) }));
  const currentlyActivePriced = pricedWithMeta.filter((x) =>
    isDealActiveNow({ opensAt: x.deal.opensAt, expiresAt: x.expiresAt, eventDates: x.eventDates }, now),
  );
  const activePool = currentlyActivePriced.length > 0 ? currentlyActivePriced : pricedWithMeta;
  const sortBiggestDiscountFirst = (
    a: (typeof pricedWithMeta)[number],
    b: (typeof pricedWithMeta)[number],
  ) => {
    const rateA = a.deal.discountRate ?? -1;
    const rateB = b.deal.discountRate ?? -1;
    if (rateA !== rateB) return rateB - rateA;
    return compareDealsForDisplay(a.deal, b.deal);
  };
  const unconditionalPriced = activePool
    .filter((x) => Boolean(x.deal.isUnconditional))
    .sort(sortBiggestDiscountFirst);
  const sortedAllPriced = [...activePool].sort(sortBiggestDiscountFirst);
  const headlinePool =
    preferUnconditional && unconditionalPriced.length > 0 ? unconditionalPriced : sortedAllPriced;
  const topEntry = headlinePool[0] ?? null;
  const topDeal = topEntry?.deal ?? showDeals[0];

  const channels = new Set(showDeals.map((d) => d.channelName));
  const withExpiry = showDeals
    .map((d) => d.expiresAt)
    .filter((v): v is string => Boolean(v))
    .sort();
  const earliestExpiresAt = topEntry?.expiresAt ?? withExpiry[0] ?? null;
  const userReport = showDeals.find((d) => d.sourceType === "USER_REPORT");
  const categories = HOME_CATEGORIES.filter((cat) =>
    showDeals.some((d) => dealMatchesCategory(d, cat)),
  );

  // Pick currently active or earliest upcoming perk first
  const perkEntries = showDeals
    .filter((d) => d.dealType === "PERK_GOODS" || Boolean(d.perkSummary?.trim()))
    .map((deal) => ({ deal, dates: resolveEventDates(deal) }))
    .filter((x) => x.dates.length === 0 || x.dates[x.dates.length - 1] >= todayKst)
    .sort(
      (a, b) =>
        compareDatedBenefitPriority(a.dates, b.dates, todayKst) ||
        (a.deal.dealType === "PERK_GOODS" ? 0 : 1) - (b.deal.dealType === "PERK_GOODS" ? 0 : 1),
    );
  const perkEntry = perkEntries[0] ?? null;
  const perkDeal = perkEntry?.deal ?? null;
  const perkDates = perkEntry?.dates ?? [];

  // Pick currently active or earliest upcoming singalong/curtain-call/special-day first
  const eventEntries = showDeals
    .filter(
      (d) =>
        d.dealType === "SINGALONG" ||
        d.dealType === "CURTAIN_CALL" ||
        (d.dealType === "SPECIAL_DAY" && d.salePrice === null && d.discountRate === null),
    )
    .map((deal) => ({ deal, dates: resolveEventDates(deal) }))
    .filter((x) => x.dates.length === 0 || x.dates[x.dates.length - 1] >= todayKst)
    .sort(
      (a, b) =>
        compareDatedBenefitPriority(a.dates, b.dates, todayKst) ||
        (a.deal.dealType === "SINGALONG" || a.deal.dealType === "CURTAIN_CALL" ? 0 : 1) -
          (b.deal.dealType === "SINGALONG" || b.deal.dealType === "CURTAIN_CALL" ? 0 : 1),
    );
  const eventEntry = eventEntries[0] ?? null;
  const eventDeal = eventEntry?.deal ?? null;
  const eventDates = eventEntry?.dates ?? [];

  return {
    id: show.id,
    title: show.title,
    posterUrl: show.posterUrl,
    venueName: show.venueName,
    subRegion: show.subRegion,
    startDate: show.startDate,
    endDate: show.endDate,
    channelCount: channels.size,
    lowestPrice: topDeal?.salePrice ?? null,
    basePrice: topDeal?.basePrice ?? null,
    maxDiscountRate: topDeal?.discountRate ?? null,
    primaryDealType: topDeal?.dealType ?? "TIMESALE",
    categories,
    discountDates: topEntry?.eventDates ?? [],
    discountExpiresAt: topEntry?.expiresAt ?? null,
    perkHighlight: perkDeal ? perkDeal.perkSummary?.trim() || perkDeal.conditionSummary || "현장 특전 증정" : null,
    perkDates,
    eventHighlight: eventDeal
      ? {
          dealType: (eventDeal.dealType === "SINGALONG" ? "SINGALONG" : "CURTAIN_CALL") as "SINGALONG" | "CURTAIN_CALL",
          summary:
            eventDeal.conditionSummary ||
            (eventDeal.dealType === "SINGALONG" ? "싱어롱 이벤트" : "스페셜 커튼콜 이벤트"),
          date: eventDates[0] ?? null,
          dates: eventDates,
        }
      : null,
    isUnconditional: Boolean(topDeal?.isUnconditional),
    earliestExpiresAt,
    dDay: earliestExpiresAt ? calcKstDDay(earliestExpiresAt, now) : null,
    communityCredit: userReport
      ? {
          dealId: userReport.id,
          reporterNickname: userReport.reporterNickname || "익명의 관객",
          clickCount: userReport.clickCount,
          helpfulCount: userReport.helpfulCount,
        }
      : null,
  };
}

/** Pure filter predicate for 4-axis search so unit tests verify BP-SEARCH-001~005 without DB mocks. */
export function filterShowsWithDeals(
  rows: Array<{
    show: typeof shows.$inferSelect;
    deals: (typeof deals.$inferSelect)[];
    actorNames: string[];
  }>,
  query: ShowSearchQuery,
  now = new Date(),
): ShowCardItem[] {
  const preset = query.datePreset ? resolveDatePreset(query.datePreset, now) : null;
  const dateFrom = query.dateFrom || preset?.dateFrom;
  const dateTo = query.dateTo || preset?.dateTo;
  const needle = query.q?.trim().toLowerCase() ?? "";
  const needleCompact = needle.replace(/\s+/g, "");

  const matched: Array<{ card: ShowCardItem; viewCount: number }> = [];

  for (const row of rows) {
    // BP-SEARCH-001: show period overlaps [dateFrom, dateTo]
    if (dateFrom && row.show.endDate < dateFrom) continue;
    if (dateTo && row.show.startDate > dateTo) continue;

    // BP-SEARCH-004: region multi-filter
    if (query.regions?.length && !query.regions.includes(row.show.subRegion)) continue;

    // Keep only non-expired ACTIVE deals (and deals not expired before requested dateFrom)
    const activeDeals = row.deals.filter((d) => {
      if (d.status !== "ACTIVE" || isExpired(d.expiresAt, now)) return false;
      if (dateFrom && d.expiresAt) {
        const expDate = new Date(d.expiresAt);
        if (!Number.isNaN(expDate.getTime()) && formatKstDate(expDate) < dateFrom) return false;
      }
      return true;
    });
    if (activeDeals.length === 0) continue; // BP-SEARCH-003: search only returns shows with active deals/events

    // Filter deals by price / category / type / seat / unconditional / conditionTags / source
    const matchingDeals = activeDeals.filter((d) => {
      if (query.source === "USER_REPORT" && d.sourceType !== "USER_REPORT") return false;
      if (query.category && !dealMatchesCategory(d, query.category)) return false;
      if (query.dealType && d.dealType !== query.dealType) return false;
      if (query.seatGrade && query.seatGrade !== "ALL" && d.seatGrade !== query.seatGrade && d.seatGrade !== "ALL") {
        return false;
      }
      if (query.unconditionalOnly && !d.isUnconditional) return false;
      if (query.priceMin !== undefined && (d.salePrice === null || d.salePrice < query.priceMin)) return false;
      if (query.priceMax !== undefined && (d.salePrice === null || d.salePrice > query.priceMax)) return false;
      if (query.conditionTags?.length) {
        const tags = parseJsonArray<ConditionTag>(d.conditionTagsJson);
        if (!query.conditionTags.some((t) => tags.includes(t))) return false;
      }
      return true;
    });
    if (matchingDeals.length === 0) continue;

    // BP-SEARCH-002: q matches title, venue, actor names, or deal channel/event keywords
    if (needle) {
      const inShow =
        row.show.title.toLowerCase().includes(needle) ||
        row.show.normalizedTitle.toLowerCase().includes(needleCompact) ||
        row.show.venueName.toLowerCase().includes(needle);
      const inActors = row.actorNames.some((n) => n.toLowerCase().includes(needle));
      const inDeals = matchingDeals.some((d) =>
        [d.channelName, d.conditionSummary, d.perkSummary, d.dealType]
          .filter(Boolean)
          .some((text) => text!.toLowerCase().includes(needle)),
      );
      if (!inShow && !inActors && !inDeals) continue;
    }

    const preferUnconditional = !query.conditionTags?.length && query.dealType !== "LOTTERY";
    matched.push({ card: toShowCard(row.show, matchingDeals, now, preferUnconditional), viewCount: row.show.viewCount });
  }

  const sort = query.sort ?? "LOWEST_PRICE";
  matched.sort((a, b) => {
    if (sort === "HIGHEST_DISCOUNT") {
      return (b.card.maxDiscountRate ?? -1) - (a.card.maxDiscountRate ?? -1);
    }
    if (sort === "CLOSING_SOON") {
      const ea = a.card.earliestExpiresAt ? Date.parse(a.card.earliestExpiresAt) : Number.MAX_SAFE_INTEGER;
      const eb = b.card.earliestExpiresAt ? Date.parse(b.card.earliestExpiresAt) : Number.MAX_SAFE_INTEGER;
      return ea - eb;
    }
    if (sort === "POPULAR") {
      return b.viewCount - a.viewCount;
    }
    const pa = a.card.lowestPrice ?? Number.MAX_SAFE_INTEGER;
    const pb = b.card.lowestPrice ?? Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });

  return matched.map((m) => m.card);
}

async function loadShowsWithActiveDeals(db: AppDb, nowIso: string) {
  // shortcut: loads active shows/deals in memory for multi-axis + actor filtering; switch to indexed SQL CTE when >1,000 active shows
  const [showRows, dealRows, castRows] = await Promise.all([
    db.select().from(shows).where(or(eq(shows.status, "ONGOING"), eq(shows.status, "UPCOMING"))),
    db.select().from(deals).where(activeDealCondition(nowIso)),
    db
      .select({ showId: showActors.showId, actorName: actors.name })
      .from(showActors)
      .innerJoin(actors, eq(showActors.actorId, actors.id)),
  ]);

  const dealsByShow = new Map<number, (typeof deals.$inferSelect)[]>();
  for (const d of dealRows) {
    if (!d.showId) continue;
    const list = dealsByShow.get(d.showId) ?? [];
    list.push(d);
    dealsByShow.set(d.showId, list);
  }

  const actorsByShow = new Map<number, string[]>();
  for (const c of castRows) {
    const list = actorsByShow.get(c.showId) ?? [];
    list.push(c.actorName);
    actorsByShow.set(c.showId, list);
  }

  return showRows.map((show) => ({
    show,
    deals: dealsByShow.get(show.id) ?? [],
    actorNames: actorsByShow.get(show.id) ?? [],
  }));
}

export async function getHomeData(db: AppDb, now = new Date()) {
  const nowIso = now.toISOString();
  const [curations, dataset, communityRows] = await Promise.all([
    db
      .select()
      .from(homeCurations)
      .where(eq(homeCurations.isActive, 1))
      .orderBy(asc(homeCurations.sortOrder)),
    loadShowsWithActiveDeals(db, nowIso),
    db
      .select({ deal: deals, show: shows })
      .from(deals)
      .innerJoin(shows, eq(deals.showId, shows.id))
      .where(and(activeDealCondition(nowIso), eq(deals.sourceType, "USER_REPORT")))
      .orderBy(desc(deals.createdAt))
      .limit(6),
  ]);

  const allCards = filterShowsWithDeals(dataset, { sort: "LOWEST_PRICE" }, now);
  const closingSoon = filterShowsWithDeals(dataset, { sort: "CLOSING_SOON" }, now).slice(0, 6);

  const posterByShowId = new Map<number, string>();
  for (const row of dataset) {
    if (row.show.posterUrl) posterByShowId.set(row.show.id, row.show.posterUrl);
  }
  const allPosteredCards = allCards.filter((c): c is ShowCardItem & { posterUrl: string } => Boolean(c.posterUrl));
  const allPosteredShows = dataset
    .map((r) => r.show)
    .filter((s): s is typeof shows.$inferSelect & { posterUrl: string } => Boolean(s.posterUrl));

  const usedHeroPosters = new Set<string>();
  const resolveHeroPoster = (hero: typeof homeCurations.$inferSelect): string | null => {
    const pick = (url: string | null | undefined): string | null => {
      if (!url || usedHeroPosters.has(url)) return null;
      usedHeroPosters.add(url);
      return url;
    };

    const explicit = pick(hero.imageUrl);
    if (explicit) return explicit;

    const hint = `${hero.linkUrl} ${hero.eyebrow ?? ""} ${hero.title} ${hero.subtitle ?? ""}`.toLowerCase();
    const matchByTheme = (): string | null => {
      if (hint.includes("perk") || hint.includes("특전") || hint.includes("굿즈")) {
        const hit = allPosteredCards.find((c) => c.categories.includes("PERK") && !usedHeroPosters.has(c.posterUrl));
        if (hit) return pick(hit.posterUrl);
      }
      if (hint.includes("event") || hint.includes("싱어롱") || hint.includes("커튼콜")) {
        const hit = allPosteredCards.find((c) => c.categories.includes("EVENT") && !usedHeroPosters.has(c.posterUrl));
        if (hit) return pick(hit.posterUrl);
      }
      if (hint.includes("daehakro") || hint.includes("대학로")) {
        const hit = allPosteredCards.find((c) => c.subRegion === "DAEHAKRO" && !usedHeroPosters.has(c.posterUrl));
        if (hit) return pick(hit.posterUrl);
      }
      if (hint.includes("lottery") || hint.includes("로터리")) {
        const hit = allPosteredCards.find((c) => c.primaryDealType === "LOTTERY" && !usedHeroPosters.has(c.posterUrl));
        if (hit) return pick(hit.posterUrl);
      }
      if (hint.includes("discount") || hint.includes("할인") || hint.includes("특가") || hint.includes("최저가")) {
        const sorted = [...allPosteredCards]
          .filter((c) => c.categories.includes("DISCOUNT") && !usedHeroPosters.has(c.posterUrl))
          .sort((a, b) => (b.maxDiscountRate ?? 0) - (a.maxDiscountRate ?? 0));
        if (sorted[0]) return pick(sorted[0].posterUrl);
      }
      return null;
    };

    const isSingleShowBanner = hero.linkUrl.startsWith("/shows/");
    if (isSingleShowBanner && hero.showId) {
      const linked = pick(posterByShowId.get(hero.showId));
      if (linked) return linked;
    }

    const themed = matchByTheme();
    if (themed) return themed;

    if (!isSingleShowBanner && hero.showId) {
      const linked = pick(posterByShowId.get(hero.showId));
      if (linked) return linked;
    }

    const fallbackCard = allPosteredCards.find((c) => !usedHeroPosters.has(c.posterUrl));
    if (fallbackCard) return pick(fallbackCard.posterUrl);

    const fallbackShow = allPosteredShows.find((s) => !usedHeroPosters.has(s.posterUrl));
    return pick(fallbackShow?.posterUrl);
  };

  const heroes = curations
    .filter((c) => c.slotType === "HERO")
    .slice(0, 3)
    .map((hero) => ({
      ...hero,
      imageUrl: resolveHeroPoster(hero),
    }));

  return {
    heroes,
    spotlight: curations.find((c) => c.slotType === "SPOTLIGHT") ?? null,
    closingSoon,
    communityDeals: communityRows.map(({ deal, show }) => ({
      dealId: deal.id,
      showId: show.id,
      showTitle: show.title,
      venueName: show.venueName,
      subRegion: show.subRegion,
      channelName: deal.channelName,
      dealType: deal.dealType,
      seatGrade: deal.seatGrade,
      basePrice: deal.basePrice,
      salePrice: deal.salePrice,
      discountRate: deal.discountRate,
      isUnconditional: Boolean(deal.isUnconditional),
      conditionSummary: deal.conditionSummary,
      reporterNickname: deal.reporterNickname || "익명의 관객",
      clickCount: deal.clickCount,
      helpfulCount: deal.helpfulCount,
      externalUrl: deal.externalUrl,
      expiresAt: deal.expiresAt,
      dDay: deal.expiresAt ? calcKstDDay(deal.expiresAt, now) : null,
    })),
    shows: allCards,
  };
}

export async function listCommunityDeals(
  db: AppDb,
  sort: "latest" | "clicks" | "helpful" = "latest",
  now = new Date(),
) {
  const nowIso = now.toISOString();
  const orderBy =
    sort === "clicks"
      ? desc(deals.clickCount)
      : sort === "helpful"
        ? desc(deals.helpfulCount)
        : desc(deals.createdAt);

  const rows = await db
    .select({ deal: deals, show: shows })
    .from(deals)
    .innerJoin(shows, eq(deals.showId, shows.id))
    .where(and(activeDealCondition(nowIso), eq(deals.sourceType, "USER_REPORT")))
    .orderBy(orderBy)
    .limit(40);

  return rows.map(({ deal, show }) => ({
    dealId: deal.id,
    showId: show.id,
    showTitle: show.title,
    venueName: show.venueName,
    subRegion: show.subRegion,
    channelName: deal.channelName,
    dealType: deal.dealType,
    seatGrade: deal.seatGrade,
    basePrice: deal.basePrice,
    salePrice: deal.salePrice,
    discountRate: deal.discountRate,
    isUnconditional: Boolean(deal.isUnconditional),
    conditionSummary: deal.conditionSummary,
    reporterNickname: deal.reporterNickname || "익명의 관객",
    clickCount: deal.clickCount,
    helpfulCount: deal.helpfulCount,
    externalUrl: deal.externalUrl,
    expiresAt: deal.expiresAt,
    dDay: deal.expiresAt ? calcKstDDay(deal.expiresAt, now) : null,
  }));
}

export async function searchShows(db: AppDb, query: ShowSearchQuery, now = new Date()) {
  const dataset = await loadShowsWithActiveDeals(db, now.toISOString());
  const all = filterShowsWithDeals(dataset, query, now);
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(40, Math.max(1, query.pageSize ?? 20));
  const start = (page - 1) * pageSize;

  return {
    total: all.length,
    page,
    pageSize,
    items: all.slice(start, start + pageSize),
  };
}

export async function suggestShows(db: AppDb, rawQ: string) {
  const q = rawQ.trim();
  if (!q) return [];
  const like = `%${q}%`;
  const [matchedShows, matchedActors] = await Promise.all([
    db
      .select({ id: shows.id, label: shows.title, sub: shows.venueName })
      .from(shows)
      .where(or(sql`${shows.title} LIKE ${like}`, sql`${shows.venueName} LIKE ${like}`))
      .limit(5),
    db
      .select({ id: actors.id, label: actors.name, followers: actors.followerCount })
      .from(actors)
      .where(sql`${actors.name} LIKE ${like}`)
      .limit(3),
  ]);

  return [
    ...matchedShows.map((s) => ({ type: "SHOW" as const, id: s.id, label: s.label, meta: s.sub })),
    ...matchedActors.map((a) => ({
      type: "ACTOR" as const,
      id: a.id,
      label: a.label,
      meta: `배우 · 팔로워 ${a.followers.toLocaleString("ko-KR")}`,
    })),
  ].slice(0, 8);
}

export async function getShowDetail(db: AppDb, showId: number, now = new Date()) {
  const nowIso = now.toISOString();
  const [show] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1);
  if (!show) return null;

  const [dealRows, castRows] = await Promise.all([
    db
      .select()
      .from(deals)
      .where(and(eq(deals.showId, showId), activeDealCondition(nowIso))),
    db
      .select({
        id: actors.id,
        name: actors.name,
        profileImageUrl: actors.profileImageUrl,
        followerCount: actors.followerCount,
        roleName: showActors.roleName,
      })
      .from(showActors)
      .innerJoin(actors, eq(showActors.actorId, actors.id))
      .where(eq(showActors.showId, showId)),
  ]);

  const todayKst = formatKstDate(now);
  const pricedDeals = dealRows
    .filter((d) => d.salePrice !== null || d.discountRate !== null || d.dealType === "LOTTERY")
    .map((d) => {
      const rawDates = parseJsonArray<string>(d.eventDatesJson);
      const labelDates =
        rawDates.length === 0 || !d.expiresAt
          ? extractDiscountDatesFromLabel(d.conditionSummary, {
              showStartDate: show.startDate,
              showEndDate: show.endDate,
              now,
            })
          : { bookingExpiresAt: null, applicableDates: [] };
      const eventDates =
        rawDates.length > 0
          ? normalizeEventDates(rawDates, { showStartDate: show.startDate, showEndDate: show.endDate, now })
          : labelDates.applicableDates;
      const effectiveExpiresAt = d.expiresAt ?? labelDates.bookingExpiresAt;
      return {
        id: d.id,
        channelName: d.channelName,
        dealType: d.dealType,
        seatGrade: d.seatGrade,
        basePrice: d.basePrice,
        salePrice: d.salePrice,
        discountRate: d.discountRate,
        isUnconditional: Boolean(d.isUnconditional),
        conditionTags: parseJsonArray<ConditionTag>(d.conditionTagsJson),
        conditionSummary: d.conditionSummary,
        feeInfo: d.feeInfo,
        externalUrl: d.externalUrl,
        opensAt: d.opensAt,
        expiresAt: effectiveExpiresAt,
        eventDates,
        dDay: effectiveExpiresAt ? calcKstDDay(effectiveExpiresAt, now) : null,
        sourceType: d.sourceType,
        reporterNickname: d.reporterNickname,
        clickCount: d.clickCount,
        helpfulCount: d.helpfulCount,
        lastVerifiedAt: d.lastVerifiedAt,
      };
    })
    .filter((d) => isDealActiveNow({ opensAt: d.opensAt, expiresAt: d.expiresAt, eventDates: d.eventDates }, now))
    .sort((a, b) => {
      const uncA = a.isUnconditional ? 1 : 0;
      const uncB = b.isUnconditional ? 1 : 0;
      if (uncA !== uncB) return uncB - uncA;
      const rateA = a.discountRate ?? -1;
      const rateB = b.discountRate ?? -1;
      if (rateA !== rateB) return rateB - rateA;
      return compareDealsForDisplay(a, b);
    });

  const events = dealRows
    .filter(
      (d) =>
        d.dealType === "SINGALONG" ||
        d.dealType === "CURTAIN_CALL" ||
        d.dealType === "PERK_GOODS" ||
        (d.dealType === "SPECIAL_DAY" && d.salePrice === null && d.discountRate === null),
    )
    .map((d) => ({
      id: d.id,
      channelName: d.channelName,
      dealType: d.dealType,
      opensAt: d.opensAt,
      eventDates: normalizeEventDates(parseJsonArray<string>(d.eventDatesJson), {
        showStartDate: show.startDate,
        showEndDate: show.endDate,
        fallbackText: [d.conditionSummary, d.perkSummary].filter(Boolean).join(" "),
        now,
      }),
      perkSummary: d.perkSummary,
      conditionSummary: d.conditionSummary,
      externalUrl: d.externalUrl,
      expiresAt: d.expiresAt,
      lastVerifiedAt: d.lastVerifiedAt,
    }))
    .filter((ev) => ev.eventDates.length === 0 || ev.eventDates[ev.eventDates.length - 1] >= todayKst)
    .sort((a, b) => compareDatedBenefitPriority(a.eventDates, b.eventDates, todayKst) || a.id - b.id);

  const seatGrades = Array.from(new Set(pricedDeals.map((d) => d.seatGrade)));
  const summary = summarizeLowestDeals(pricedDeals);
  const lastVerifiedAt =
    dealRows
      .map((d) => d.lastVerifiedAt)
      .sort()
      .at(-1) ?? show.updatedAt;

  return {
    show: {
      id: show.id,
      title: show.title,
      posterUrl: show.posterUrl,
      venueName: show.venueName,
      venueAddress: show.venueAddress,
      region: show.region,
      subRegion: show.subRegion,
      startDate: show.startDate,
      endDate: show.endDate,
      synopsis: show.synopsis,
      basePrices: parseBasePrices(show.basePricesJson),
      status: show.status,
    },
    seatGrades,
    summary,
    deals: pricedDeals,
    events,
    actors: castRows,
    lastVerifiedAt,
    disclaimer:
      "MuDeal은 자체 결제·발권을 제공하지 않으며, 실제 가격·잔여좌석·할인 조건은 이동한 외부 예매처 기준으로 최종 적용됩니다.",
  };
}

export async function listActors(db: AppDb, rawQ = "") {
  const q = rawQ.trim();
  const baseQuery = db.select().from(actors);
  if (!q) {
    return baseQuery.orderBy(desc(actors.followerCount)).limit(30);
  }
  const like = `%${q}%`;
  return baseQuery
    .where(sql`${actors.name} LIKE ${like}`)
    .orderBy(desc(actors.followerCount))
    .limit(30);
}

export async function getActorDetail(db: AppDb, actorId: number, now = new Date()) {
  const nowIso = now.toISOString();
  const [actor] = await db.select().from(actors).where(eq(actors.id, actorId)).limit(1);
  if (!actor) return null;

  const appearances = await db
    .select({ show: shows, roleName: showActors.roleName })
    .from(showActors)
    .innerJoin(shows, eq(showActors.showId, shows.id))
    .where(eq(showActors.actorId, actorId));

  const showIds = appearances.map((a) => a.show.id);
  const activeDeals =
    showIds.length > 0
      ? await db.select().from(deals).where(activeDealCondition(nowIso))
      : [];

  const dealsByShow = new Map<number, (typeof deals.$inferSelect)[]>();
  for (const d of activeDeals) {
    if (!d.showId || !showIds.includes(d.showId)) continue;
    const list = dealsByShow.get(d.showId) ?? [];
    list.push(d);
    dealsByShow.set(d.showId, list);
  }

  // BP-SEARCH-003: actor detail always displays KOPIS shows even when active deals == 0
  return {
    actor,
    shows: appearances.map(({ show, roleName }) => {
      const showDeals = dealsByShow.get(show.id) ?? [];
      const priced = showDeals.filter((d) => d.salePrice !== null).sort(compareDealsForDisplay);
      return {
        id: show.id,
        title: show.title,
        posterUrl: show.posterUrl,
        venueName: show.venueName,
        subRegion: show.subRegion,
        startDate: show.startDate,
        endDate: show.endDate,
        status: show.status,
        roleName,
        basePrices: parseBasePrices(show.basePricesJson),
        activeDealCount: showDeals.length,
        lowestPrice: priced[0]?.salePrice ?? null,
        maxDiscountRate: priced[0]?.discountRate ?? null,
        primaryDealType: showDeals[0]?.dealType ?? null,
      };
    }),
  };
}

/** Parse URL search params into typed ShowSearchQuery safely. */
export function parseShowSearchParams(sp: URLSearchParams | Record<string, string | string[] | undefined>): ShowSearchQuery {
  const get = (key: string): string | undefined => {
    if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined;
    const v = sp[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const num = (key: string): number | undefined => {
    const raw = get(key);
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
  };

  const csv = <T extends string>(key: string, allowed: readonly T[]): T[] | undefined => {
    const raw = get(key);
    if (!raw) return undefined;
    const values = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is T => (allowed as readonly string[]).includes(s));
    return values.length > 0 ? values : undefined;
  };

  const datePresetRaw = get("datePreset");
  const datePreset =
    datePresetRaw === "TODAY" || datePresetRaw === "THIS_WEEKEND" || datePresetRaw === "THIS_MONTH"
      ? datePresetRaw
      : undefined;

  const categoryRaw = get("category");
  const category = (HOME_CATEGORIES as readonly string[]).includes(categoryRaw ?? "")
    ? (categoryRaw as HomeCategory)
    : undefined;

  const dealTypeRaw = get("dealType");
  const dealType = (DEAL_TYPES as readonly string[]).includes(dealTypeRaw ?? "")
    ? (dealTypeRaw as DealType)
    : undefined;

  const seatGradeRaw = get("seatGrade");
  const seatGrade = (SEAT_GRADES as readonly string[]).includes(seatGradeRaw ?? "")
    ? (seatGradeRaw as SeatGrade)
    : undefined;

  const sortRaw = get("sort");
  const sort: ShowSort | undefined =
    sortRaw === "LOWEST_PRICE" ||
    sortRaw === "HIGHEST_DISCOUNT" ||
    sortRaw === "CLOSING_SOON" ||
    sortRaw === "POPULAR"
      ? sortRaw
      : undefined;

  return {
    q: get("q")?.trim() || undefined,
    datePreset,
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(get("dateFrom") ?? "") ? get("dateFrom") : undefined,
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(get("dateTo") ?? "") ? get("dateTo") : undefined,
    priceMin: num("priceMin"),
    priceMax: num("priceMax"),
    regions: csv("region", SUB_REGIONS),
    category,
    dealType,
    seatGrade,
    unconditionalOnly: get("unconditionalOnly") === "true" || get("unconditionalOnly") === "1",
    conditionTags: csv("conditionTags", CONDITION_TAGS),
    source: get("source") === "USER_REPORT" ? "USER_REPORT" : undefined,
    sort,
    page: num("page"),
    pageSize: num("pageSize"),
  };
}
