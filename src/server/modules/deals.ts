import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { dealHelpfulVotes, deals, outboundClicks } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { isExpired } from "@/lib/kst";
import { parseSafeExternalUrl } from "@/lib/url";

const CLICK_DEDUP_WINDOW_MS = 10_000;

export async function hashSessionIdentity(req: Request): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "local";
  const ua = req.headers.get("user-agent") ?? "unknown";
  const bytes = new TextEncoder().encode(`${ip}|${ua}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** FR-005 / BP-STAT-001-1: 10s dedup outbound click tracking + safe URL guard + expiry 410. */
export async function recordOutboundClick(
  db: AppDb,
  dealId: number,
  sessionHash: string,
  now = new Date(),
) {
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) throw new AppError("NOT_FOUND", "해당 딜을 찾을 수 없습니다.");

  if (deal.status !== "ACTIVE" || isExpired(deal.expiresAt, now)) {
    throw new AppError("DEAL_EXPIRED", "이미 마감된 할인/이벤트입니다.");
  }

  const safeUrl = parseSafeExternalUrl(deal.externalUrl, {
    allowHttp: deal.sourceType === "ADMIN",
  });
  if (!safeUrl) {
    throw new AppError("VALIDATION_ERROR", "안전하지 않은 외부 URL입니다.");
  }

  const cutoffIso = new Date(now.getTime() - CLICK_DEDUP_WINDOW_MS).toISOString();
  const [recent] = await db
    .select({ id: outboundClicks.id })
    .from(outboundClicks)
    .where(
      and(
        eq(outboundClicks.sessionHash, sessionHash),
        eq(outboundClicks.dealId, deal.id),
        gt(outboundClicks.clickedAt, cutoffIso),
      ),
    )
    .orderBy(desc(outboundClicks.clickedAt))
    .limit(1);

  if (recent || !deal.showId) {
    return { externalUrl: safeUrl, counted: false, clickCount: deal.clickCount };
  }

  await db.insert(outboundClicks).values({
    dealId: deal.id,
    showId: deal.showId,
    channelName: deal.channelName,
    sourceType: deal.sourceType,
    sessionHash,
    clickedAt: now.toISOString(),
  });

  await db
    .update(deals)
    .set({ clickCount: sql`${deals.clickCount} + 1` })
    .where(eq(deals.id, deal.id));

  return { externalUrl: safeUrl, counted: true, clickCount: deal.clickCount + 1 };
}

/** FR-006 / BP-STAT-001-2: helpful vote (user toggle, or guest 1x per session). */
export async function voteDealHelpful(
  db: AppDb,
  dealId: number,
  identity: { userId?: number; sessionHash: string },
  now = new Date(),
) {
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) throw new AppError("NOT_FOUND", "해당 딜을 찾을 수 없습니다.");

  if (deal.status !== "ACTIVE" || isExpired(deal.expiresAt, now)) {
    throw new AppError("DEAL_EXPIRED", "이미 마감되었거나 비활성화된 할인/이벤트입니다.");
  }

  if (identity.userId) {
    const [existing] = await db
      .select({ id: dealHelpfulVotes.id })
      .from(dealHelpfulVotes)
      .where(and(eq(dealHelpfulVotes.dealId, dealId), eq(dealHelpfulVotes.userId, identity.userId)))
      .limit(1);

    if (existing) {
      const deleted = await db
        .delete(dealHelpfulVotes)
        .where(and(eq(dealHelpfulVotes.dealId, dealId), eq(dealHelpfulVotes.userId, identity.userId)))
        .returning({ id: dealHelpfulVotes.id });
      if (deleted.length > 0) {
        const [updated] = await db
          .update(deals)
          .set({ helpfulCount: sql`max(0, ${deals.helpfulCount} - 1)` })
          .where(eq(deals.id, dealId))
          .returning({ helpfulCount: deals.helpfulCount });
        return { voted: false, helpfulCount: updated?.helpfulCount ?? Math.max(0, deal.helpfulCount - 1) };
      }
      return { voted: false, helpfulCount: deal.helpfulCount };
    }

    const inserted = await db
      .insert(dealHelpfulVotes)
      .values({ dealId, userId: identity.userId })
      .onConflictDoNothing()
      .returning({ id: dealHelpfulVotes.id });
    if (inserted.length > 0) {
      const [updated] = await db
        .update(deals)
        .set({ helpfulCount: sql`${deals.helpfulCount} + 1` })
        .where(eq(deals.id, dealId))
        .returning({ helpfulCount: deals.helpfulCount });
      return { voted: true, helpfulCount: updated?.helpfulCount ?? deal.helpfulCount + 1 };
    }
    return { voted: true, helpfulCount: deal.helpfulCount };
  }

  const inserted = await db
    .insert(dealHelpfulVotes)
    .values({ dealId, sessionHash: identity.sessionHash })
    .onConflictDoNothing()
    .returning({ id: dealHelpfulVotes.id });

  if (inserted.length > 0) {
    const [updated] = await db
      .update(deals)
      .set({ helpfulCount: sql`${deals.helpfulCount} + 1` })
      .where(eq(deals.id, dealId))
      .returning({ helpfulCount: deals.helpfulCount });
    return { voted: true, helpfulCount: updated?.helpfulCount ?? deal.helpfulCount + 1 };
  }

  return { voted: true, helpfulCount: deal.helpfulCount };
}
