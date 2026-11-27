import { and, eq, isNotNull, lt, ne, or } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { deals, shows } from "@/db/schema";
import { formatKstDate, isExpired, isValidIsoDate } from "@/lib/kst";
import { recomputeShowPriceCache } from "@/server/modules/reports";

function isEventDatesEnded(eventDatesJson: string | null | undefined, todayKst: string): boolean {
  if (!eventDatesJson || !todayKst) return false;
  try {
    const parsed = JSON.parse(eventDatesJson);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    const valid = parsed
      .filter((d): d is string => typeof d === "string" && isValidIsoDate(d))
      .sort();
    if (valid.length === 0) return false;
    return valid[valid.length - 1] < todayKst;
  } catch {
    return false;
  }
}

/**
 * BP-RESET-001-3: expire ACTIVE deals past expires_at (including non-normalized strings),
 * past eventDatesJson last date, or belonging to ENDED shows (including KOPIS-ended shows),
 * then refresh min/max cache safely per show.
 */
export async function expireEndedDeals(
  db: AppDb,
  now = new Date(),
): Promise<{ expiredDeals: number; endedShows: number }> {
  const nowIso = now.toISOString();
  const todayKst = formatKstDate(now);
  const expiredDealIds = new Set<number>();
  const affectedShows = new Set<number>();

  // 1. Transition newly ended shows (guard against empty endDate)
  const ended = await db
    .update(shows)
    .set({ status: "ENDED", minActivePrice: null, maxDiscountRate: null, updatedAt: nowIso })
    .where(and(ne(shows.status, "ENDED"), ne(shows.endDate, ""), lt(shows.endDate, todayKst)))
    .returning({ id: shows.id });

  const newlyEndedShowIds = new Set(ended.map((r) => r.id));

  // 2. Expire all ACTIVE deals belonging to ANY ENDED show (catches KOPIS-ended shows as well)
  const endedShowDeals = await db
    .select({ id: deals.id, showId: deals.showId })
    .from(deals)
    .innerJoin(shows, eq(deals.showId, shows.id))
    .where(and(eq(deals.status, "ACTIVE"), eq(shows.status, "ENDED")));

  for (const row of endedShowDeals) {
    await db
      .update(deals)
      .set({ status: "EXPIRED", updatedAt: nowIso })
      .where(eq(deals.id, row.id));
    expiredDealIds.add(row.id);
    if (row.showId !== null && !newlyEndedShowIds.has(row.showId)) {
      affectedShows.add(row.showId);
    }
  }

  // 3. Inspect remaining ACTIVE deals with expiresAt or eventDatesJson (safe against non-normalized timestamps)
  const datedActiveDeals = await db
    .select({
      id: deals.id,
      showId: deals.showId,
      expiresAt: deals.expiresAt,
      eventDatesJson: deals.eventDatesJson,
    })
    .from(deals)
    .where(
      and(
        eq(deals.status, "ACTIVE"),
        or(isNotNull(deals.expiresAt), isNotNull(deals.eventDatesJson)),
      ),
    );

  for (const row of datedActiveDeals) {
    if (expiredDealIds.has(row.id)) continue;
    if (isExpired(row.expiresAt, now) || isEventDatesEnded(row.eventDatesJson, todayKst)) {
      await db
        .update(deals)
        .set({ status: "EXPIRED", updatedAt: nowIso })
        .where(eq(deals.id, row.id));
      expiredDealIds.add(row.id);
      if (row.showId !== null && !newlyEndedShowIds.has(row.showId)) {
        affectedShows.add(row.showId);
      }
    }
  }

  for (const showId of affectedShows) {
    try {
      await recomputeShowPriceCache(db, showId, now);
    } catch {
      // Isolate single-show price cache recomputation failures
    }
  }

  return { expiredDeals: expiredDealIds.size, endedShows: ended.length };
}
