import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  actors,
  dealIssues,
  dealReports,
  deals,
  homeCurations,
  ocrImageJobs,
  showActors,
  shows,
  syncRuns,
  userActorFollows,
  userNotifications,
  type DealType,
  type SeatGrade,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { calcDiscountRate } from "@/lib/pricing";
import { parseSafeExternalUrl } from "@/lib/url";
import { recomputeShowPriceCache, writeAuditLog } from "./reports";

export async function getAdminSidebarCounts(db: AppDb) {
  const [[pendingReports], [draftDeals], [openIssues]] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(dealReports).where(eq(dealReports.status, "PENDING")),
    db.select({ count: sql<number>`count(*)` }).from(deals).where(eq(deals.status, "DRAFT")),
    db.select({ count: sql<number>`count(*)` }).from(dealIssues).where(eq(dealIssues.status, "OPEN")),
  ]);
  return {
    pendingReviewCount: Number(pendingReports?.count ?? 0) + Number(draftDeals?.count ?? 0),
    pendingReportsCount: Number(pendingReports?.count ?? 0),
    draftDealsCount: Number(draftDeals?.count ?? 0),
    openIssuesCount: Number(openIssues?.count ?? 0),
  };
}

export async function listAdminReviewQueue(db: AppDb) {
  const [reports, drafts, showOptions] = await Promise.all([
    db
      .select()
      .from(dealReports)
      .where(eq(dealReports.status, "PENDING"))
      .orderBy(asc(dealReports.createdAt))
      .limit(50),
    db
      .select({
        deal: deals,
        showTitle: shows.title,
        ocrConfidence: ocrImageJobs.confidence,
        ocrExtractedJson: ocrImageJobs.extractedJson,
        ocrSourceChannel: ocrImageJobs.sourceChannel,
      })
      .from(deals)
      .leftJoin(shows, eq(deals.showId, shows.id))
      .leftJoin(ocrImageJobs, eq(deals.sourceOcrJobId, ocrImageJobs.id))
      .where(eq(deals.status, "DRAFT"))
      .orderBy(asc(deals.createdAt))
      .limit(50),
    db
      .select({ id: shows.id, title: shows.title, kopisId: shows.kopisId })
      .from(shows)
      .orderBy(asc(shows.title)),
  ]);

  return { reports, drafts, showOptions };
}

export async function listAdminDealsWorkspace(db: AppDb) {
  const [dealRows, showOptions, actorList, latestSync, curations] = await Promise.all([
    db
      .select({ deal: deals, showTitle: shows.title })
      .from(deals)
      .leftJoin(shows, eq(deals.showId, shows.id))
      .orderBy(desc(deals.updatedAt))
      .limit(60),
    db.select({ id: shows.id, title: shows.title }).from(shows).orderBy(asc(shows.title)),
    db.select().from(actors).orderBy(asc(actors.name)),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(5),
    db
      .select()
      .from(homeCurations)
      .orderBy(asc(homeCurations.slotType), asc(homeCurations.sortOrder)),
  ]);

  return {
    deals: dealRows.map(({ deal, showTitle }) => ({ ...deal, showTitle: showTitle ?? "(미매핑)" })),
    showOptions,
    actors: actorList,
    latestSync,
    curations,
  };
}

export async function createAdminDeal(
  db: AppDb,
  adminId: number,
  input: {
    showId: number;
    channelName: string;
    dealType: DealType;
    seatGrade: SeatGrade;
    basePrice?: number | null;
    salePrice?: number | null;
    isUnconditional: boolean;
    conditionSummary?: string | null;
    externalUrl: string;
    expiresAt?: string | null;
    adminLocked?: boolean;
  },
) {
  const safeUrl = parseSafeExternalUrl(input.externalUrl, { allowHttp: true });
  if (!safeUrl) throw new AppError("VALIDATION_ERROR", "유효한 외부 URL을 입력해 주세요.");

  const [show] = await db.select({ id: shows.id }).from(shows).where(eq(shows.id, input.showId)).limit(1);
  if (!show) throw new AppError("NOT_FOUND", "대상 작품을 찾을 수 없습니다.");

  const discountRate = calcDiscountRate(input.basePrice ?? null, input.salePrice ?? null);
  const [created] = await db
    .insert(deals)
    .values({
      showId: input.showId,
      channelName: input.channelName.trim(),
      dealType: input.dealType,
      seatGrade: input.seatGrade,
      basePrice: input.basePrice ?? null,
      salePrice: input.salePrice ?? null,
      discountRate,
      isUnconditional: input.isUnconditional ? 1 : 0,
      conditionSummary: input.conditionSummary?.trim() || null,
      externalUrl: safeUrl,
      expiresAt: input.expiresAt || null,
      status: "ACTIVE",
      sourceType: "ADMIN",
      adminLocked: input.adminLocked ? 1 : 0,
    })
    .returning();

  await recomputeShowPriceCache(db, input.showId);
  await writeAuditLog(db, adminId, "DEAL_CREATED", "deal", created.id, { showId: input.showId });
  return created;
}

export async function updateAdminDeal(
  db: AppDb,
  adminId: number,
  dealId: number,
  patch: {
    salePrice?: number | null;
    basePrice?: number | null;
    status?: "ACTIVE" | "EXPIRED" | "HIDDEN";
    adminLocked?: boolean;
    conditionSummary?: string | null;
  },
) {
  const [existing] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!existing) throw new AppError("NOT_FOUND", "딜을 찾을 수 없습니다.");

  const nextBase = patch.basePrice !== undefined ? patch.basePrice : existing.basePrice;
  const nextSale = patch.salePrice !== undefined ? patch.salePrice : existing.salePrice;
  const nextRate = calcDiscountRate(nextBase, nextSale);
  const nowIso = new Date().toISOString();

  const [updated] = await db
    .update(deals)
    .set({
      basePrice: nextBase,
      salePrice: nextSale,
      discountRate: nextRate,
      status: patch.status ?? existing.status,
      adminLocked: patch.adminLocked !== undefined ? (patch.adminLocked ? 1 : 0) : existing.adminLocked,
      conditionSummary:
        patch.conditionSummary !== undefined ? patch.conditionSummary : existing.conditionSummary,
      updatedAt: nowIso,
    })
    .where(eq(deals.id, dealId))
    .returning();

  if (existing.showId) await recomputeShowPriceCache(db, existing.showId);
  await writeAuditLog(db, adminId, "DEAL_UPDATED", "deal", dealId, patch);
  return updated;
}

/** DD-007: safely merge duplicate actor records into targetActorId and clean up source. */
export async function mergeActors(
  db: AppDb,
  adminId: number,
  sourceActorId: number,
  targetActorId: number,
) {
  if (sourceActorId === targetActorId) {
    throw new AppError("VALIDATION_ERROR", "서로 다른 두 배우를 선택해 주세요.");
  }
  const [src] = await db.select().from(actors).where(eq(actors.id, sourceActorId)).limit(1);
  const [tgt] = await db.select().from(actors).where(eq(actors.id, targetActorId)).limit(1);
  if (!src || !tgt) throw new AppError("NOT_FOUND", "병합할 배우를 찾을 수 없습니다.");

  const [srcCasts, srcFollows] = await Promise.all([
    db.select().from(showActors).where(eq(showActors.actorId, sourceActorId)),
    db.select().from(userActorFollows).where(eq(userActorFollows.actorId, sourceActorId)),
  ]);

  for (const c of srcCasts) {
    await db
      .insert(showActors)
      .values({ showId: c.showId, actorId: targetActorId, roleName: c.roleName, sourceType: "ADMIN" })
      .onConflictDoNothing();
  }
  for (const f of srcFollows) {
    await db
      .insert(userActorFollows)
      .values({ userId: f.userId, actorId: targetActorId })
      .onConflictDoNothing();
  }

  await db
    .update(userNotifications)
    .set({ actorId: targetActorId })
    .where(eq(userNotifications.actorId, sourceActorId));

  await db.delete(actors).where(eq(actors.id, sourceActorId));

  const [cnt] = await db
    .select({ count: sql<number>`count(*)` })
    .from(userActorFollows)
    .where(eq(userActorFollows.actorId, targetActorId));

  await db
    .update(actors)
    .set({ followerCount: Number(cnt?.count ?? 0), updatedAt: new Date().toISOString() })
    .where(eq(actors.id, targetActorId));

  await writeAuditLog(db, adminId, "ACTORS_MERGED", "actor", targetActorId, {
    mergedFromId: sourceActorId,
    mergedFromName: src.name,
  });

  return { targetActorId, mergedFromId: sourceActorId };
}

// --- Deal Issues (FR-011) ---
export async function submitDealIssue(
  db: AppDb,
  userId: number,
  dealId: number,
  issueType: "SOLD_OUT" | "PRICE_MISMATCH" | "BROKEN_LINK" | "ENDED" | "OTHER",
  note?: string | null,
) {
  const [deal] = await db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) throw new AppError("NOT_FOUND", "신고 대상 딜을 찾을 수 없습니다.");

  const [created] = await db
    .insert(dealIssues)
    .values({
      dealId,
      reporterId: userId,
      issueType,
      note: note?.trim() || null,
      status: "OPEN",
    })
    .returning();

  return created;
}

export async function listAdminIssues(db: AppDb) {
  return db
    .select({
      issue: dealIssues,
      channelName: deals.channelName,
      dealStatus: deals.status,
      showId: deals.showId,
      showTitle: shows.title,
    })
    .from(dealIssues)
    .innerJoin(deals, eq(dealIssues.dealId, deals.id))
    .leftJoin(shows, eq(deals.showId, shows.id))
    .where(eq(dealIssues.status, "OPEN"))
    .orderBy(desc(dealIssues.createdAt))
    .limit(50);
}

export async function resolveAdminIssue(
  db: AppDb,
  adminId: number,
  issueId: number,
  action: "EXPIRE_DEAL" | "RESOLVE" | "DISMISS",
) {
  const [issue] = await db.select().from(dealIssues).where(eq(dealIssues.id, issueId)).limit(1);
  if (!issue) throw new AppError("NOT_FOUND", "오류 신고를 찾을 수 없습니다.");

  const nowIso = new Date().toISOString();
  if (action === "EXPIRE_DEAL") {
    const [deal] = await db
      .update(deals)
      .set({ status: "EXPIRED", updatedAt: nowIso })
      .where(eq(deals.id, issue.dealId))
      .returning({ showId: deals.showId });
    if (deal?.showId) await recomputeShowPriceCache(db, deal.showId);
  }

  const nextStatus = action === "DISMISS" ? "DISMISSED" : "RESOLVED";
  await db
    .update(dealIssues)
    .set({ status: nextStatus, resolvedBy: adminId, resolvedAt: nowIso, updatedAt: nowIso })
    .where(eq(dealIssues.id, issueId));

  await writeAuditLog(db, adminId, `ISSUE_${action}`, "deal_issue", issueId, { dealId: issue.dealId });
  return { issueId, status: nextStatus };
}
