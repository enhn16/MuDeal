import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  auditLogs,
  dealReports,
  deals,
  showActors,
  shows,
  userActorFollows,
  userNotifications,
  userShowBookmarks,
  type DealType,
  type SeatGrade,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { isExpired, normalizeEventDates, startOfKstDayUtc } from "@/lib/kst";
import { calcDiscountRate } from "@/lib/pricing";
import { parseSafeExternalUrl } from "@/lib/url";
import type { AuthUser } from "./auth";

export const DAILY_REPORT_LIMIT = 10;

export async function writeAuditLog(
  db: AppDb,
  actorUserId: number,
  action: string,
  targetType: string,
  targetId: string | number,
  payload?: unknown,
) {
  await db.insert(auditLogs).values({
    actorUserId,
    action,
    targetType,
    targetId: String(targetId),
    payloadJson: payload !== undefined ? JSON.stringify(payload) : null,
  });
}

export async function recomputeShowPriceCache(db: AppDb, showId: number, now = new Date()) {
  const rows = await db
    .select()
    .from(deals)
    .where(and(eq(deals.showId, showId), eq(deals.status, "ACTIVE")));

  const activePriced = rows.filter((d) => !isExpired(d.expiresAt, now) && d.salePrice !== null);
  const unconditionalPriced = activePriced.filter((d) => d.isUnconditional === 1);
  // Default headline price reflects unconditional discounts first; falls back to conditional only if none exist.
  const headlinePool = unconditionalPriced.length > 0 ? unconditionalPriced : activePriced;
  const minActivePrice =
    headlinePool.length > 0 ? Math.min(...headlinePool.map((d) => d.salePrice!)) : null;
  const rates = headlinePool
    .map((d) => d.discountRate)
    .filter((r): r is number => r !== null);
  const maxDiscountRate = rates.length > 0 ? Math.max(...rates) : null;

  await db
    .update(shows)
    .set({ minActivePrice, maxDiscountRate, updatedAt: now.toISOString() })
    .where(eq(shows.id, showId));
}

async function fanoutNewDealNotifications(
  db: AppDb,
  deal: { id: number; showId: number; channelName: string; conditionSummary: string | null },
  showTitle: string,
) {
  const [bookmarkers, castRows] = await Promise.all([
    db
      .select({ userId: userShowBookmarks.userId })
      .from(userShowBookmarks)
      .where(eq(userShowBookmarks.showId, deal.showId)),
    db
      .select({ actorId: showActors.actorId })
      .from(showActors)
      .where(eq(showActors.showId, deal.showId)),
  ]);

  const actorIds = castRows.map((c) => c.actorId);
  const followers =
    actorIds.length > 0
      ? await db
          .select({ userId: userActorFollows.userId, actorId: userActorFollows.actorId })
          .from(userActorFollows)
          .where(inArray(userActorFollows.actorId, actorIds))
      : [];

  const toInsert: Array<typeof userNotifications.$inferInsert> = [];
  const seenUsers = new Set<number>();

  for (const b of bookmarkers) {
    seenUsers.add(b.userId);
    toInsert.push({
      userId: b.userId,
      notiType: "BOOKMARKED_SHOW_DEAL",
      showId: deal.showId,
      dealId: deal.id,
      title: `${showTitle} · ${deal.channelName} 새 소식`,
      body: deal.conditionSummary || "새로운 할인·이벤트가 게시되었습니다.",
      dedupKey: `deal:${deal.id}:u:${b.userId}`,
    });
  }

  for (const f of followers) {
    if (seenUsers.has(f.userId)) continue;
    seenUsers.add(f.userId);
    toInsert.push({
      userId: f.userId,
      notiType: "FOLLOWED_ACTOR_DEAL",
      showId: deal.showId,
      dealId: deal.id,
      actorId: f.actorId,
      title: `${showTitle} · ${deal.channelName} 새 소식`,
      body: deal.conditionSummary || "팔로우 중인 배우 출연작에 새 할인·이벤트가 등록되었습니다.",
      dedupKey: `deal:${deal.id}:u:${f.userId}`,
    });
  }

  if (toInsert.length > 0) {
    await db.insert(userNotifications).values(toInsert).onConflictDoNothing();
  }
}

export interface SubmitReportInput {
  showId?: number | null;
  reportedShowTitle: string;
  channelName: string;
  dealType: DealType;
  seatGrade?: SeatGrade;
  externalUrl: string;
  reportedPrice?: number | null;
  reportedDiscountRate?: number | null;
  isUnconditional?: boolean;
  conditionNote?: string | null;
  expiresAt?: string | null;
  reporterNickname?: string | null;
  evidenceR2Key?: string | null;
}

/** FR-006 / BP-REPORT-001: logged-in USER report with mandatory https:// URL and KST 10/day limit. */
export async function submitDealReport(
  db: AppDb,
  user: AuthUser,
  input: SubmitReportInput,
  now = new Date(),
) {
  const safeUrl = parseSafeExternalUrl(input.externalUrl);
  if (!safeUrl) {
    throw new AppError("VALIDATION_ERROR", "유효한 https:// 원문 예매처 링크를 입력해 주세요.");
  }

  const kstStart = startOfKstDayUtc(now);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(dealReports)
    .where(and(eq(dealReports.reporterId, user.id), gte(dealReports.createdAt, kstStart)));

  if (Number(countRow?.count ?? 0) >= DAILY_REPORT_LIMIT) {
    throw new AppError(
      "DAILY_REPORT_LIMIT_EXCEEDED",
      `하루 최대 ${DAILY_REPORT_LIMIT}건까지 제보할 수 있습니다.`,
    );
  }

  const [created] = await db
    .insert(dealReports)
    .values({
      reporterId: user.id,
      reporterNickname: input.reporterNickname?.trim() || user.nickname,
      showId: input.showId ?? null,
      reportedShowTitle: input.reportedShowTitle.trim(),
      channelName: input.channelName.trim(),
      externalUrl: safeUrl,
      dealType: input.dealType,
      seatGrade: input.seatGrade ?? "ALL",
      reportedPrice: input.reportedPrice ?? null,
      reportedDiscountRate: input.reportedDiscountRate ?? null,
      isUnconditional: input.isUnconditional === false ? 0 : 1,
      conditionNote: input.conditionNote?.trim() || null,
      expiresAt: input.expiresAt || null,
      evidenceR2Key: input.evidenceR2Key || null,
      status: "PENDING",
    })
    .returning();

  return created;
}

export interface ApproveReportOverrides {
  showId: number;
  channelName?: string;
  dealType?: DealType;
  seatGrade?: SeatGrade;
  basePrice?: number | null;
  salePrice?: number | null;
  discountRate?: number | null;
  isUnconditional?: boolean;
  conditionSummary?: string | null;
  maskNickname?: boolean;
}

/** FR-009 / BP-REPORT-002: idempotent PENDING -> APPROVED, publish USER_REPORT deal, notify users, audit. */
export async function approveUserReport(
  db: AppDb,
  adminId: number,
  reportId: number,
  overrides: ApproveReportOverrides,
  now = new Date(),
) {
  const [report] = await db
    .select()
    .from(dealReports)
    .where(eq(dealReports.id, reportId))
    .limit(1);
  if (!report) throw new AppError("NOT_FOUND", "제보 내역을 찾을 수 없습니다.");

  const [show] = await db.select().from(shows).where(eq(shows.id, overrides.showId)).limit(1);
  if (!show) throw new AppError("VALIDATION_ERROR", "매핑할 KOPIS 작품을 선택해 주세요.");

  const nowIso = now.toISOString();
  const updated = await db
    .update(dealReports)
    .set({
      status: "APPROVED",
      showId: show.id,
      reviewerId: adminId,
      reviewedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(and(eq(dealReports.id, reportId), eq(dealReports.status, "PENDING")))
    .returning({ id: dealReports.id });

  if (updated.length === 0) {
    throw new AppError("REPORT_ALREADY_PROCESSED", "이미 검수가 완료된 제보입니다.");
  }

  const salePrice = overrides.salePrice !== undefined ? overrides.salePrice : report.reportedPrice;
  const basePrice = overrides.basePrice ?? null;
  const computedRate =
    overrides.discountRate !== undefined
      ? overrides.discountRate
      : (calcDiscountRate(basePrice, salePrice) ?? report.reportedDiscountRate);
  const displayNickname = overrides.maskNickname ? "익명의 관객" : report.reporterNickname;
  const finalDealType = overrides.dealType ?? report.dealType;
  const finalConditionSummary =
    overrides.conditionSummary !== undefined ? overrides.conditionSummary : report.conditionNote;
  const isEventOrPerk =
    finalDealType === "PERK_GOODS" ||
    finalDealType === "SINGALONG" ||
    finalDealType === "CURTAIN_CALL" ||
    finalDealType === "SPECIAL_DAY";
  const parsedEventDates = isEventOrPerk
    ? normalizeEventDates([], {
        showStartDate: show.startDate,
        showEndDate: show.endDate,
        fallbackText: finalConditionSummary,
        now,
      })
    : [];
  const latestEventDate = parsedEventDates.at(-1) ?? null;

  const [published] = await db
    .insert(deals)
    .values({
      showId: show.id,
      channelName: overrides.channelName?.trim() || report.channelName,
      dealType: finalDealType,
      seatGrade: overrides.seatGrade ?? report.seatGrade,
      basePrice,
      salePrice,
      discountRate: computedRate,
      isUnconditional:
        overrides.isUnconditional !== undefined
          ? overrides.isUnconditional
            ? 1
            : 0
          : report.isUnconditional,
      conditionSummary: finalConditionSummary,
      perkSummary: finalDealType === "PERK_GOODS" ? finalConditionSummary : null,
      eventDatesJson: parsedEventDates.length > 0 ? JSON.stringify(parsedEventDates) : null,
      externalUrl: report.externalUrl,
      expiresAt:
        report.expiresAt ??
        (latestEventDate ? new Date(`${latestEventDate}T23:59:59+09:00`).toISOString() : null),
      status: "ACTIVE",
      sourceType: "USER_REPORT",
      sourceReportId: report.id,
      reporterNickname: displayNickname,
      lastVerifiedAt: nowIso,
    })
    .returning();

  await recomputeShowPriceCache(db, show.id, now);
  await fanoutNewDealNotifications(
    db,
    {
      id: published.id,
      showId: show.id,
      channelName: published.channelName,
      conditionSummary: published.conditionSummary,
    },
    show.title,
  );
  await db
    .insert(userNotifications)
    .values({
      userId: report.reporterId,
      notiType: "REPORT_APPROVED",
      showId: show.id,
      dealId: published.id,
      reportId: report.id,
      title: `제보 승인 완료 · ${show.title}`,
      body: `'제보해주신 딜' 판에 ${displayNickname}님 이름으로 게시되었습니다.`,
      dedupKey: `report-approved:${report.id}`,
    })
    .onConflictDoNothing();

  await writeAuditLog(db, adminId, "REPORT_APPROVED", "deal_report", report.id, {
    publishedDealId: published.id,
    showId: show.id,
    masked: Boolean(overrides.maskNickname),
  });

  return { publishedDealId: published.id };
}

export async function rejectUserReport(
  db: AppDb,
  adminId: number,
  reportId: number,
  reasonNote: string,
  reasonCode = "OTHER",
  now = new Date(),
) {
  const cleaned = reasonNote.trim();
  if (!cleaned) throw new AppError("VALIDATION_ERROR", "반려 사유를 반드시 입력해 주세요.");

  const [report] = await db
    .select()
    .from(dealReports)
    .where(eq(dealReports.id, reportId))
    .limit(1);
  if (!report) throw new AppError("NOT_FOUND", "제보 내역을 찾을 수 없습니다.");

  const nowIso = now.toISOString();
  const updated = await db
    .update(dealReports)
    .set({
      status: "REJECTED",
      reviewerId: adminId,
      rejectReasonCode: reasonCode,
      rejectReasonNote: cleaned,
      reviewedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(and(eq(dealReports.id, reportId), eq(dealReports.status, "PENDING")))
    .returning({ id: dealReports.id });

  if (updated.length === 0) {
    throw new AppError("REPORT_ALREADY_PROCESSED", "이미 검수가 완료된 제보입니다.");
  }

  await db
    .insert(userNotifications)
    .values({
      userId: report.reporterId,
      notiType: "REPORT_REJECTED",
      reportId: report.id,
      title: `제보 반려 안내 · ${report.reportedShowTitle}`,
      body: `반려 사유: ${cleaned}`,
      dedupKey: `report-rejected:${report.id}`,
    })
    .onConflictDoNothing();

  await writeAuditLog(db, adminId, "REPORT_REJECTED", "deal_report", report.id, {
    reasonCode,
    reasonNote: cleaned,
  });

  return { rejectedReportId: report.id };
}

export async function approveDraftDeal(
  db: AppDb,
  adminId: number,
  dealId: number,
  overrides: { showId?: number; salePrice?: number | null; discountRate?: number | null; conditionSummary?: string | null } = {},
  now = new Date(),
) {
  const [draft] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!draft) throw new AppError("NOT_FOUND", "초안 딜을 찾을 수 없습니다.");

  const targetShowId = overrides.showId ?? draft.showId;
  if (!targetShowId) throw new AppError("VALIDATION_ERROR", "작품을 매핑한 뒤 승인해 주세요.");
  const [show] = await db.select().from(shows).where(eq(shows.id, targetShowId)).limit(1);
  if (!show) throw new AppError("VALIDATION_ERROR", "유효하지 않은 작품 ID입니다.");

  const nowIso = now.toISOString();
  const updated = await db
    .update(deals)
    .set({
      showId: show.id,
      salePrice: overrides.salePrice !== undefined ? overrides.salePrice : draft.salePrice,
      discountRate: overrides.discountRate !== undefined ? overrides.discountRate : draft.discountRate,
      conditionSummary:
        overrides.conditionSummary !== undefined ? overrides.conditionSummary : draft.conditionSummary,
      status: "ACTIVE",
      lastVerifiedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(and(eq(deals.id, dealId), eq(deals.status, "DRAFT")))
    .returning();

  if (updated.length === 0) {
    throw new AppError("REPORT_ALREADY_PROCESSED", "이미 처리된 초안입니다.");
  }

  await recomputeShowPriceCache(db, show.id, now);
  await fanoutNewDealNotifications(
    db,
    {
      id: updated[0].id,
      showId: show.id,
      channelName: updated[0].channelName,
      conditionSummary: updated[0].conditionSummary,
    },
    show.title,
  );
  await writeAuditLog(db, adminId, "DRAFT_APPROVED", "deal", dealId, { showId: show.id });
  return { publishedDealId: dealId };
}

export async function discardDraftDeal(db: AppDb, adminId: number, dealId: number, now = new Date()) {
  const nowIso = now.toISOString();
  const updated = await db
    .update(deals)
    .set({ status: "DISCARDED", updatedAt: nowIso })
    .where(and(eq(deals.id, dealId), eq(deals.status, "DRAFT")))
    .returning({ id: deals.id });

  if (updated.length === 0) {
    throw new AppError("REPORT_ALREADY_PROCESSED", "이미 처리되었거나 존재하지 않는 초안입니다.");
  }

  await writeAuditLog(db, adminId, "DRAFT_DISCARDED", "deal", dealId);
  return { discardedDealId: dealId };
}
