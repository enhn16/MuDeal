import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  actors,
  dealReports,
  deals,
  showActors,
  shows,
  userActorFollows,
  userCalendarEvents,
  userNotifications,
  userSearchPresets,
  userShowBookmarks,
  users,
  type SubRegion,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { formatKstDate } from "@/lib/kst";
import { compareDealsForDisplay } from "@/lib/pricing";
import { parseBasePrices } from "./shows";

export const MAX_CALENDAR_EVENTS = 200;
export const MAX_SEARCH_PRESETS = 5;
const RECENT_NOTI_DAYS = 30;

export interface CalendarAutoEvent {
  id: string;
  eventDate: string; // YYYY-MM-DD KST
  eventTime: string | null;
  category: "LOTTERY" | "STAGE_EVENT";
  badgeLabel: string;
  title: string;
  detail: string;
  showId: number;
  dealId: number;
  readOnly: true;
}

export interface CalendarSavedEvent {
  id: number;
  eventDate: string;
  eventTime: string | null;
  category: "WATCH" | "TICKETING" | "EVENT" | "CUSTOM";
  title: string;
  memo: string | null;
  sourceShowId: number | null;
  sourceDealId: number | null;
  readOnly: false;
}

/** Pure helper: extract auto calendar entries from deals within [from, to] KST range. */
export function buildAutoCalendarEvents(
  rows: Array<{
    deal: Pick<
      typeof deals.$inferSelect,
      "id" | "showId" | "channelName" | "dealType" | "opensAt" | "expiresAt" | "eventDatesJson" | "conditionSummary" | "perkSummary"
    >;
    showTitle: string;
  }>,
  from: string,
  to: string,
): CalendarAutoEvent[] {
  const out: CalendarAutoEvent[] = [];
  const inRange = (d: string) => d >= from && d <= to;

  for (const { deal, showTitle } of rows) {
    if (!deal.showId) continue;

    if (deal.dealType === "LOTTERY" && deal.expiresAt) {
      const kstDate = formatKstDate(new Date(deal.expiresAt));
      if (inRange(kstDate)) {
        out.push({
          id: `auto-lot-${deal.id}`,
          eventDate: kstDate,
          eventTime: null,
          category: "LOTTERY",
          badgeLabel: "로터리 마감",
          title: `${showTitle} ${deal.channelName}`,
          detail: deal.conditionSummary ?? "로터리 응모 마감",
          showId: deal.showId,
          dealId: deal.id,
          readOnly: true,
        });
      }
      continue;
    }

    if (deal.eventDatesJson) {
      try {
        const dates = JSON.parse(deal.eventDatesJson);
        if (Array.isArray(dates)) {
          for (const rawDate of dates) {
            if (typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && inRange(rawDate)) {
              out.push({
                id: `auto-ev-${deal.id}-${rawDate}`,
                eventDate: rawDate,
                eventTime: null,
                category: "STAGE_EVENT",
                badgeLabel: deal.dealType === "SINGALONG" ? "싱어롱" : "커튼콜·특전",
                title: showTitle,
                detail: [deal.conditionSummary, deal.perkSummary].filter(Boolean).join(" · ") || deal.channelName,
                showId: deal.showId,
                dealId: deal.id,
                readOnly: true,
              });
            }
          }
        }
      } catch {
        // Ignore malformed JSON
      }
    }
  }

  return out.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}

export async function updateNickname(db: AppDb, userId: number, nickname: string) {
  const cleaned = nickname.trim();
  if (!cleaned || cleaned.length > 20) {
    throw new AppError("VALIDATION_ERROR", "닉네임은 1~20자로 입력해 주세요.");
  }
  await db
    .update(users)
    .set({ nickname: cleaned, updatedAt: new Date().toISOString() })
    .where(eq(users.id, userId));
  return { nickname: cleaned };
}

// --- Bookmarks (Shows) ---
export async function listBookmarkedShows(db: AppDb, userId: number, now = new Date()) {
  const rows = await db
    .select({ show: shows, bookmarkedAt: userShowBookmarks.createdAt })
    .from(userShowBookmarks)
    .innerJoin(shows, eq(userShowBookmarks.showId, shows.id))
    .where(eq(userShowBookmarks.userId, userId))
    .orderBy(desc(userShowBookmarks.createdAt));

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.show.id);
  const nowIso = now.toISOString();
  const activeDeals = await db
    .select()
    .from(deals)
    .where(and(inArray(deals.showId, ids), eq(deals.status, "ACTIVE")));

  const validDeals = activeDeals.filter((d) => !d.expiresAt || d.expiresAt > nowIso);

  return rows.map(({ show }) => {
    const priced = validDeals
      .filter((d) => d.showId === show.id && d.salePrice !== null)
      .sort(compareDealsForDisplay);
    const minBase = Object.values(parseBasePrices(show.basePricesJson)).sort((a, b) => a - b)[0] ?? null;
    return {
      id: show.id,
      title: show.title,
      posterUrl: show.posterUrl,
      venueName: show.venueName,
      subRegion: show.subRegion as SubRegion,
      startDate: show.startDate,
      endDate: show.endDate,
      lowestPrice: priced[0]?.salePrice ?? null,
      maxDiscountRate: priced[0]?.discountRate ?? null,
      minBasePrice: minBase,
    };
  });
}

export async function addShowBookmark(db: AppDb, userId: number, showId: number) {
  const [exists] = await db.select({ id: shows.id }).from(shows).where(eq(shows.id, showId)).limit(1);
  if (!exists) throw new AppError("NOT_FOUND", "작품을 찾을 수 없습니다.");
  await db.insert(userShowBookmarks).values({ userId, showId }).onConflictDoNothing();
  return { bookmarked: true, showId };
}

export async function removeShowBookmark(db: AppDb, userId: number, showId: number) {
  await db
    .delete(userShowBookmarks)
    .where(and(eq(userShowBookmarks.userId, userId), eq(userShowBookmarks.showId, showId)));
  return { bookmarked: false, showId };
}

export async function isShowBookmarked(db: AppDb, userId: number, showId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: userShowBookmarks.id })
    .from(userShowBookmarks)
    .where(and(eq(userShowBookmarks.userId, userId), eq(userShowBookmarks.showId, showId)))
    .limit(1);
  return Boolean(row);
}

// --- Follows (Actors) & 내 뮤배 극 ---
export async function listFollowedActors(db: AppDb, userId: number) {
  return db
    .select({
      id: actors.id,
      name: actors.name,
      followerCount: actors.followerCount,
      followedAt: userActorFollows.createdAt,
    })
    .from(userActorFollows)
    .innerJoin(actors, eq(userActorFollows.actorId, actors.id))
    .where(eq(userActorFollows.userId, userId))
    .orderBy(desc(userActorFollows.createdAt));
}

export async function addActorFollow(db: AppDb, userId: number, actorId: number) {
  const [exists] = await db.select({ id: actors.id }).from(actors).where(eq(actors.id, actorId)).limit(1);
  if (!exists) throw new AppError("NOT_FOUND", "배우를 찾을 수 없습니다.");

  const already = await isActorFollowed(db, userId, actorId);
  if (!already) {
    await db.insert(userActorFollows).values({ userId, actorId }).onConflictDoNothing();
    await db
      .update(actors)
      .set({ followerCount: sql`${actors.followerCount} + 1` })
      .where(eq(actors.id, actorId));
  }
  return { followed: true, actorId };
}

export async function removeActorFollow(db: AppDb, userId: number, actorId: number) {
  const already = await isActorFollowed(db, userId, actorId);
  if (already) {
    await db
      .delete(userActorFollows)
      .where(and(eq(userActorFollows.userId, userId), eq(userActorFollows.actorId, actorId)));
    await db
      .update(actors)
      .set({ followerCount: sql`max(0, ${actors.followerCount} - 1)` })
      .where(eq(actors.id, actorId));
  }
  return { followed: false, actorId };
}

export async function isActorFollowed(db: AppDb, userId: number, actorId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: userActorFollows.id })
    .from(userActorFollows)
    .where(and(eq(userActorFollows.userId, userId), eq(userActorFollows.actorId, actorId)))
    .limit(1);
  return Boolean(row);
}

export async function listFollowedActorShows(db: AppDb, userId: number, now = new Date()) {
  const followed = await listFollowedActors(db, userId);
  if (followed.length === 0) return { actors: [], shows: [] };

  const actorIds = followed.map((a) => a.id);
  const castRows = await db
    .select({ show: shows, actorId: actors.id, actorName: actors.name })
    .from(showActors)
    .innerJoin(shows, eq(showActors.showId, shows.id))
    .innerJoin(actors, eq(showActors.actorId, actors.id))
    .where(inArray(showActors.actorId, actorIds));

  const byShow = new Map<
    number,
    { show: typeof shows.$inferSelect; actorIds: number[]; actorNames: string[] }
  >();
  for (const r of castRows) {
    const entry = byShow.get(r.show.id) ?? { show: r.show, actorIds: [], actorNames: [] };
    entry.actorIds.push(r.actorId);
    entry.actorNames.push(r.actorName);
    byShow.set(r.show.id, entry);
  }

  const showIds = Array.from(byShow.keys());
  const nowIso = now.toISOString();
  const activeDeals =
    showIds.length > 0
      ? (await db.select().from(deals).where(and(inArray(deals.showId, showIds), eq(deals.status, "ACTIVE")))).filter(
          (d) => !d.expiresAt || d.expiresAt > nowIso,
        )
      : [];

  return {
    actors: followed,
    shows: Array.from(byShow.values()).map(({ show, actorIds: aIds, actorNames }) => {
      const showDeals = activeDeals.filter((d) => d.showId === show.id);
      const priced = showDeals.filter((d) => d.salePrice !== null).sort(compareDealsForDisplay);
      const channels = new Set(showDeals.map((d) => d.channelName));
      const minBase = Object.values(parseBasePrices(show.basePricesJson)).sort((a, b) => a - b)[0] ?? null;
      return {
        id: show.id,
        title: show.title,
        posterUrl: show.posterUrl,
        venueName: show.venueName,
        subRegion: show.subRegion as SubRegion,
        actorIds: aIds,
        actorNames,
        channelCount: channels.size,
        lowestPrice: priced[0]?.salePrice ?? null,
        maxDiscountRate: priced[0]?.discountRate ?? null,
        minBasePrice: minBase,
      };
    }),
  };
}

// --- Story Bar & Notifications (auto-read / 30d recent / saved) ---
export async function getNotificationsFeed(
  db: AppDb,
  userId: number,
  opts: {
    mode?: "unread" | "recent" | "saved";
    actorId?: number;
    showId?: number;
    autoMarkRead?: boolean;
  } = {},
  now = new Date(),
) {
  const mode = opts.mode ?? "unread";
  const [bookmarks, followed, allUnread] = await Promise.all([
    db
      .select({ id: shows.id, name: shows.title, posterUrl: shows.posterUrl })
      .from(userShowBookmarks)
      .innerJoin(shows, eq(userShowBookmarks.showId, shows.id))
      .where(eq(userShowBookmarks.userId, userId)),
    db
      .select({ id: actors.id, name: actors.name })
      .from(userActorFollows)
      .innerJoin(actors, eq(userActorFollows.actorId, actors.id))
      .where(eq(userActorFollows.userId, userId)),
    db
      .select()
      .from(userNotifications)
      .where(and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, 0))),
  ]);

  const unreadByShow = new Map<number, number>();
  const unreadByActor = new Map<number, number>();
  for (const n of allUnread) {
    if (n.showId) unreadByShow.set(n.showId, (unreadByShow.get(n.showId) ?? 0) + 1);
    if (n.actorId) unreadByActor.set(n.actorId, (unreadByActor.get(n.actorId) ?? 0) + 1);
  }

  const stories = [
    ...bookmarks.map((s) => ({
      targetType: "SHOW" as const,
      targetId: s.id,
      name: s.name,
      posterUrl: s.posterUrl,
      unreadCount: unreadByShow.get(s.id) ?? 0,
    })),
    ...followed.map((a) => ({
      targetType: "ACTOR" as const,
      targetId: a.id,
      name: a.name,
      posterUrl: null,
      unreadCount: unreadByActor.get(a.id) ?? 0,
    })),
  ].sort((a, b) => b.unreadCount - a.unreadCount);

  const conditions = [eq(userNotifications.userId, userId)];
  if (opts.actorId) conditions.push(eq(userNotifications.actorId, opts.actorId));
  if (opts.showId) conditions.push(eq(userNotifications.showId, opts.showId));

  if (mode === "unread") {
    conditions.push(eq(userNotifications.isRead, 0));
  } else if (mode === "saved") {
    conditions.push(eq(userNotifications.isSaved, 1));
  } else {
    const cutoff = new Date(now.getTime() - RECENT_NOTI_DAYS * 86_400_000).toISOString();
    conditions.push(gte(userNotifications.createdAt, cutoff));
  }

  const items = await db
    .select()
    .from(userNotifications)
    .where(and(...conditions))
    .orderBy(desc(userNotifications.createdAt))
    .limit(50);

  if (opts.autoMarkRead && mode === "unread" && items.length > 0) {
    const idsToRead = items.map((i) => i.id);
    await db
      .update(userNotifications)
      .set({ isRead: 1 })
      .where(and(eq(userNotifications.userId, userId), inArray(userNotifications.id, idsToRead)));
  }

  return { stories, totalUnread: allUnread.length, items };
}

export async function toggleSaveNotification(db: AppDb, userId: number, notiId: number, isSaved?: boolean) {
  const [row] = await db
    .select()
    .from(userNotifications)
    .where(and(eq(userNotifications.id, notiId), eq(userNotifications.userId, userId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "해당 소식을 찾을 수 없습니다.");

  const next = isSaved !== undefined ? (isSaved ? 1 : 0) : row.isSaved ? 0 : 1;
  await db
    .update(userNotifications)
    .set({ isSaved: next })
    .where(eq(userNotifications.id, row.id));
  return { id: row.id, isSaved: Boolean(next) };
}

// --- Calendar (Auto + Saved/Personal CRUD, max 200) ---
export async function getMyCalendar(db: AppDb, userId: number, from: string, to: string, now = new Date()) {
  const [savedRows, bookmarkedIds, followedActorIds] = await Promise.all([
    db
      .select()
      .from(userCalendarEvents)
      .where(
        and(
          eq(userCalendarEvents.userId, userId),
          gte(userCalendarEvents.eventDate, from),
          lte(userCalendarEvents.eventDate, to),
        ),
      )
      .orderBy(asc(userCalendarEvents.eventDate), asc(userCalendarEvents.eventTime)),
    db
      .select({ showId: userShowBookmarks.showId })
      .from(userShowBookmarks)
      .where(eq(userShowBookmarks.userId, userId)),
    db
      .select({ actorId: userActorFollows.actorId })
      .from(userActorFollows)
      .where(eq(userActorFollows.userId, userId)),
  ]);

  const showIdSet = new Set(bookmarkedIds.map((b) => b.showId));
  if (followedActorIds.length > 0) {
    const actorShows = await db
      .select({ showId: showActors.showId })
      .from(showActors)
      .where(inArray(showActors.actorId, followedActorIds.map((a) => a.actorId)));
    for (const r of actorShows) showIdSet.add(r.showId);
  }

  let autoEvents: CalendarAutoEvent[] = [];
  if (showIdSet.size > 0) {
    const nowIso = now.toISOString();
    const dealRows = await db
      .select({ deal: deals, showTitle: shows.title })
      .from(deals)
      .innerJoin(shows, eq(deals.showId, shows.id))
      .where(
        and(
          inArray(deals.showId, Array.from(showIdSet)),
          eq(deals.status, "ACTIVE"),
          or(eq(deals.dealType, "LOTTERY"), eq(deals.dealType, "SINGALONG"), eq(deals.dealType, "CURTAIN_CALL"), eq(deals.dealType, "PERK_GOODS")),
        ),
      );
    const activeOnly = dealRows.filter(({ deal }) => !deal.expiresAt || deal.expiresAt > nowIso);
    autoEvents = buildAutoCalendarEvents(activeOnly, from, to);
  }

  const savedEvents: CalendarSavedEvent[] = savedRows.map((r) => ({
    id: r.id,
    eventDate: r.eventDate,
    eventTime: r.eventTime,
    category: r.category,
    title: r.title,
    memo: r.memo,
    sourceShowId: r.sourceShowId,
    sourceDealId: r.sourceDealId,
    readOnly: false,
  }));

  return { autoEvents, savedEvents };
}

export async function createCalendarEvent(
  db: AppDb,
  userId: number,
  input: {
    eventDate: string;
    eventTime?: string | null;
    category: "WATCH" | "TICKETING" | "EVENT" | "CUSTOM";
    title: string;
    memo?: string | null;
    sourceShowId?: number | null;
    sourceDealId?: number | null;
  },
) {
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(userCalendarEvents)
    .where(eq(userCalendarEvents.userId, userId));

  if (Number(countRow?.count ?? 0) >= MAX_CALENDAR_EVENTS) {
    throw new AppError("VALIDATION_ERROR", `내 캘린더 일정은 최대 ${MAX_CALENDAR_EVENTS}건까지 저장할 수 있습니다.`);
  }

  const [created] = await db
    .insert(userCalendarEvents)
    .values({
      userId,
      eventDate: input.eventDate,
      eventTime: input.eventTime || null,
      category: input.category,
      title: input.title.trim(),
      memo: input.memo?.trim() || null,
      sourceShowId: input.sourceShowId ?? null,
      sourceDealId: input.sourceDealId ?? null,
    })
    .returning();

  return created;
}

export async function deleteCalendarEvent(db: AppDb, userId: number, eventId: number) {
  const deleted = await db
    .delete(userCalendarEvents)
    .where(and(eq(userCalendarEvents.id, eventId), eq(userCalendarEvents.userId, userId)))
    .returning({ id: userCalendarEvents.id });
  if (deleted.length === 0) throw new AppError("NOT_FOUND", "일정을 찾을 수 없습니다.");
  return { deletedId: eventId };
}

// --- Search Presets (max 5) ---
export async function listSearchPresets(db: AppDb, userId: number) {
  return db
    .select()
    .from(userSearchPresets)
    .where(eq(userSearchPresets.userId, userId))
    .orderBy(desc(userSearchPresets.createdAt));
}

export async function createSearchPreset(
  db: AppDb,
  userId: number,
  name: string,
  queryParamsJson: string,
) {
  const existing = await listSearchPresets(db, userId);
  if (existing.length >= MAX_SEARCH_PRESETS) {
    throw new AppError("VALIDATION_ERROR", `검색 프리셋은 최대 ${MAX_SEARCH_PRESETS}개까지 저장할 수 있습니다.`);
  }
  const [created] = await db
    .insert(userSearchPresets)
    .values({ userId, name: name.trim(), queryParamsJson })
    .returning();
  return created;
}

export async function deleteSearchPreset(db: AppDb, userId: number, presetId: number) {
  const deleted = await db
    .delete(userSearchPresets)
    .where(and(eq(userSearchPresets.id, presetId), eq(userSearchPresets.userId, userId)))
    .returning({ id: userSearchPresets.id });
  if (deleted.length === 0) throw new AppError("NOT_FOUND", "프리셋을 찾을 수 없습니다.");
  return { deletedId: presetId };
}

// --- My Reports & Contribution Summary ---
export async function getMyReportsSummary(db: AppDb, userId: number) {
  const reports = await db
    .select()
    .from(dealReports)
    .where(eq(dealReports.reporterId, userId))
    .orderBy(desc(dealReports.createdAt))
    .limit(30);

  const reportIds = reports.map((r) => r.id);
  let totalClicks = 0;
  let totalHelpful = 0;

  if (reportIds.length > 0) {
    const published = await db
      .select({ clickCount: deals.clickCount, helpfulCount: deals.helpfulCount })
      .from(deals)
      .where(inArray(deals.sourceReportId, reportIds));
    for (const p of published) {
      totalClicks += p.clickCount;
      totalHelpful += p.helpfulCount;
    }
  }

  return { totalClicks, totalHelpful, items: reports };
}
