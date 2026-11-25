import { and, eq, lt, lte, ne } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { deals, shows } from "@/db/schema";
import { formatKstDate } from "@/lib/kst";
import { recomputeShowPriceCache } from "@/server/modules/reports";

/** BP-RESET-001-3: expire ACTIVE deals past expires_at and shows past KST end_date, then refresh min/max cache. */
export async function expireEndedDeals(
  db: AppDb,
  now = new Date(),
): Promise<{ expiredDeals: number; endedShows: number }> {
  const nowIso = now.toISOString();
  const todayKst = formatKstDate(now);

  const expired = await db
    .update(deals)
    .set({ status: "EXPIRED", updatedAt: nowIso })
    .where(and(eq(deals.status, "ACTIVE"), lte(deals.expiresAt, nowIso)))
    .returning({ showId: deals.showId });

  const ended = await db
    .update(shows)
    .set({ status: "ENDED", minActivePrice: null, maxDiscountRate: null, updatedAt: nowIso })
    .where(and(ne(shows.status, "ENDED"), lt(shows.endDate, todayKst)))
    .returning({ id: shows.id });

  const affectedShows = new Set<number>();
  for (const row of expired) {
    if (row.showId) affectedShows.add(row.showId);
  }
  for (const row of ended) {
    await db
      .update(deals)
      .set({ status: "EXPIRED", updatedAt: nowIso })
      .where(and(eq(deals.showId, row.id), eq(deals.status, "ACTIVE")));
    affectedShows.delete(row.id);
  }

  for (const showId of affectedShows) {
    await recomputeShowPriceCache(db, showId, now);
  }

  return { expiredDeals: expired.length, endedShows: ended.length };
}
