import { and, eq, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  auditLogs,
  chunkArray,
  dealIssues,
  dealReports,
  deals,
  ocrImageJobs,
  outboundClicks,
  shows,
  syncRuns,
  userCalendarEvents,
  userNotifications,
  userSessions,
  userShowBookmarks,
} from "@/db/schema";
import { formatKstDate } from "@/lib/kst";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionPurgeSummary {
  outboundClicks: number;
  userSessions: number;
  syncRuns: number;
  userNotifications: number;
  ocrJobsTrimmed: number;
  ocrJobsDeleted: number;
  deals: number;
  dealIssues: number;
  auditLogs: number;
  rejectedReports: number;
  endedShows: number;
  r2ObjectsDeleted: number;
}

function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function daysAgoKstDate(now: Date, days: number): string {
  return formatKstDate(new Date(now.getTime() - days * DAY_MS));
}

async function deleteByIdsChunked(
  ids: number[],
  deleteChunk: (chunk: number[]) => Promise<unknown>,
): Promise<number> {
  for (const chunk of chunkArray(ids)) {
    await deleteChunk(chunk);
  }
  return ids.length;
}

/**
 * TD-001: Daily retention purge keeping D1 Free (<500MB, <100K writes/day) and R2 Free (<10GB) healthy.
 * Runs at the end of the 01:00 KST daily Cron (`0 16 * * *`) with bounded per-table batch limits.
 */
export async function purgeExpiredRetentionData(
  db: AppDb,
  now = new Date(),
  opts?: { batchLimit?: number; evidenceBucket?: R2Bucket },
): Promise<RetentionPurgeSummary> {
  const limit = Math.max(1, Math.min(500, opts?.batchLimit ?? 500));
  const summary: RetentionPurgeSummary = {
    outboundClicks: 0,
    userSessions: 0,
    syncRuns: 0,
    userNotifications: 0,
    ocrJobsTrimmed: 0,
    ocrJobsDeleted: 0,
    deals: 0,
    dealIssues: 0,
    auditLogs: 0,
    rejectedReports: 0,
    endedShows: 0,
    r2ObjectsDeleted: 0,
  };

  // 1. outbound_clicks: 14 days (aggregates live on deals.click_count)
  try {
    const cutoff = daysAgoIso(now, 14);
    const rows = await db
      .select({ id: outboundClicks.id })
      .from(outboundClicks)
      .where(lt(outboundClicks.clickedAt, cutoff))
      .limit(limit);
    summary.outboundClicks = await deleteByIdsChunked(
      rows.map((r) => r.id),
      (chunk) => db.delete(outboundClicks).where(inArray(outboundClicks.id, chunk)),
    );
  } catch (err) {
    console.error("[retention:outbound_clicks] failed:", err);
  }

  // 2. user_sessions: expired or revoked > 7 days ago
  try {
    const cutoff = daysAgoIso(now, 7);
    const rows = await db
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(
        or(
          lt(userSessions.expiresAt, cutoff),
          and(isNotNull(userSessions.revokedAt), lt(userSessions.revokedAt, cutoff)),
        ),
      )
      .limit(limit);
    summary.userSessions = await deleteByIdsChunked(
      rows.map((r) => r.id),
      (chunk) => db.delete(userSessions).where(inArray(userSessions.id, chunk)),
    );
  } catch (err) {
    console.error("[retention:user_sessions] failed:", err);
  }

  // 3. sync_runs: 30 days
  try {
    const cutoff = daysAgoIso(now, 30);
    const rows = await db
      .select({ id: syncRuns.id })
      .from(syncRuns)
      .where(lt(syncRuns.startedAt, cutoff))
      .limit(limit);
    summary.syncRuns = await deleteByIdsChunked(
      rows.map((r) => r.id),
      (chunk) => db.delete(syncRuns).where(inArray(syncRuns.id, chunk)),
    );
  } catch (err) {
    console.error("[retention:sync_runs] failed:", err);
  }

  // 4. user_notifications: unsaved read > 30d OR unsaved unread > 90d (never touches is_saved=1)
  try {
    const readCutoff = daysAgoIso(now, 30);
    const unreadCutoff = daysAgoIso(now, 90);
    const rows = await db
      .select({ id: userNotifications.id })
      .from(userNotifications)
      .where(
        and(
          eq(userNotifications.isSaved, 0),
          or(
            and(eq(userNotifications.isRead, 1), lt(userNotifications.createdAt, readCutoff)),
            and(eq(userNotifications.isRead, 0), lt(userNotifications.createdAt, unreadCutoff)),
          ),
        ),
      )
      .limit(limit);
    summary.userNotifications = await deleteByIdsChunked(
      rows.map((r) => r.id),
      (chunk) => db.delete(userNotifications).where(inArray(userNotifications.id, chunk)),
    );
  } catch (err) {
    console.error("[retention:user_notifications] failed:", err);
  }

  // 5a. ocr_image_jobs: clear bulky extracted_json after 30 days (keep image_hash for dedup)
  try {
    const trimCutoff = daysAgoIso(now, 30);
    const rows = await db
      .select({ id: ocrImageJobs.id })
      .from(ocrImageJobs)
      .where(
        and(
          sql`${ocrImageJobs.ocrStatus} IN ('DONE', 'FAILED')`,
          lt(ocrImageJobs.updatedAt, trimCutoff),
          isNotNull(ocrImageJobs.extractedJson),
          sql`${ocrImageJobs.extractedJson} NOT LIKE '%"skippedDuplicate":true%'`,
        ),
      )
      .limit(limit);
    summary.ocrJobsTrimmed = await deleteByIdsChunked(
      rows.map((r) => r.id),
      (chunk) => db.update(ocrImageJobs).set({ extractedJson: null }).where(inArray(ocrImageJobs.id, chunk)),
    );
  } catch (err) {
    console.error("[retention:ocr_trim] failed:", err);
  }

  // 5b. ocr_image_jobs: delete unreferenced DONE/FAILED jobs older than 90 days
  try {
    const deleteCutoff = daysAgoIso(now, 90);
    const rows = await db
      .select({ id: ocrImageJobs.id })
      .from(ocrImageJobs)
      .where(
        and(
          sql`${ocrImageJobs.ocrStatus} IN ('DONE', 'FAILED')`,
          lt(ocrImageJobs.updatedAt, deleteCutoff),
          sql`NOT EXISTS (SELECT 1 FROM ${deals} WHERE ${deals.sourceOcrJobId} = ${ocrImageJobs.id})`,
        ),
      )
      .limit(limit);
    summary.ocrJobsDeleted = await deleteByIdsChunked(
      rows.map((r) => r.id),
      (chunk) => db.delete(ocrImageJobs).where(inArray(ocrImageJobs.id, chunk)),
    );
  } catch (err) {
    console.error("[retention:ocr_delete] failed:", err);
  }

  // 6. deals: expired/discarded/hidden non-USER_REPORT deals older than 90 days
  try {
    const cutoff = daysAgoIso(now, 90);
    const rows = await db
      .select({ id: deals.id })
      .from(deals)
      .where(
        and(
          sql`${deals.status} IN ('EXPIRED', 'DISCARDED', 'HIDDEN')`,
          ne(deals.sourceType, "USER_REPORT"),
          lt(deals.updatedAt, cutoff),
        ),
      )
      .limit(limit);
    summary.deals = await deleteByIdsChunked(
      rows.map((r) => r.id),
      (chunk) => db.delete(deals).where(inArray(deals.id, chunk)),
    );
  } catch (err) {
    console.error("[retention:deals] failed:", err);
  }

  // 7. deal_issues: resolved/dismissed > 90 days
  try {
    const cutoff = daysAgoIso(now, 90);
    const rows = await db
      .select({ id: dealIssues.id })
      .from(dealIssues)
      .where(and(sql`${dealIssues.status} IN ('RESOLVED', 'DISMISSED')`, lt(dealIssues.updatedAt, cutoff)))
      .limit(limit);
    summary.dealIssues = await deleteByIdsChunked(
      rows.map((r) => r.id),
      (chunk) => db.delete(dealIssues).where(inArray(dealIssues.id, chunk)),
    );
  } catch (err) {
    console.error("[retention:deal_issues] failed:", err);
  }

  // 8. audit_logs: 180 days
  try {
    const cutoff = daysAgoIso(now, 180);
    const rows = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(lt(auditLogs.createdAt, cutoff))
      .limit(limit);
    summary.auditLogs = await deleteByIdsChunked(
      rows.map((r) => r.id),
      (chunk) => db.delete(auditLogs).where(inArray(auditLogs.id, chunk)),
    );
  } catch (err) {
    console.error("[retention:audit_logs] failed:", err);
  }

  // 9. R2 processed report evidence images older than 30 days (MUST run BEFORE rejected deal_reports DB deletion so R2 keys are never orphaned)
  if (opts?.evidenceBucket) {
    try {
      const r2Cutoff = daysAgoIso(now, 30);
      const rows = await db
        .select({ id: dealReports.id, evidenceR2Key: dealReports.evidenceR2Key })
        .from(dealReports)
        .where(
          and(
            sql`${dealReports.status} IN ('APPROVED', 'REJECTED')`,
            isNotNull(dealReports.evidenceR2Key),
            lt(dealReports.updatedAt, r2Cutoff),
          ),
        )
        .limit(20);

      for (const row of rows) {
        if (!row.evidenceR2Key) continue;
        try {
          await opts.evidenceBucket.delete(row.evidenceR2Key);
          await db
            .update(dealReports)
            .set({ evidenceR2Key: null })
            .where(eq(dealReports.id, row.id));
          summary.r2ObjectsDeleted += 1;
        } catch (err) {
          console.error(`[retention:r2:${row.evidenceR2Key}] failed:`, err);
        }
      }
    } catch (err) {
      console.error("[retention:r2] failed:", err);
    }
  }

  // 10. deal_reports: rejected reports > 180 days (delete any remaining R2 evidence key first if bucket is bound)
  try {
    const cutoff = daysAgoIso(now, 180);
    const rows = await db
      .select({ id: dealReports.id, evidenceR2Key: dealReports.evidenceR2Key })
      .from(dealReports)
      .where(and(eq(dealReports.status, "REJECTED"), lt(dealReports.updatedAt, cutoff)))
      .limit(limit);

    const deletableIds: number[] = [];
    for (const row of rows) {
      if (opts?.evidenceBucket && row.evidenceR2Key) {
        try {
          await opts.evidenceBucket.delete(row.evidenceR2Key);
          summary.r2ObjectsDeleted += 1;
        } catch (err) {
          console.error(`[retention:r2:${row.evidenceR2Key}] failed before report delete:`, err);
          continue;
        }
      }
      deletableIds.push(row.id);
    }

    summary.rejectedReports = await deleteByIdsChunked(
      deletableIds,
      (chunk) => db.delete(dealReports).where(inArray(dealReports.id, chunk)),
    );
  } catch (err) {
    console.error("[retention:deal_reports] failed:", err);
  }

  // 11. shows: ENDED > 365 days with ZERO bookmark/calendar/report/deal references
  try {
    const cutoffDate = daysAgoKstDate(now, 365);
    const rows = await db
      .select({ id: shows.id })
      .from(shows)
      .where(
        and(
          eq(shows.status, "ENDED"),
          ne(shows.endDate, ""),
          lt(shows.endDate, cutoffDate),
          sql`NOT EXISTS (SELECT 1 FROM ${userShowBookmarks} WHERE ${userShowBookmarks.showId} = ${shows.id})`,
          sql`NOT EXISTS (SELECT 1 FROM ${userCalendarEvents} WHERE ${userCalendarEvents.sourceShowId} = ${shows.id})`,
          sql`NOT EXISTS (SELECT 1 FROM ${dealReports} WHERE ${dealReports.showId} = ${shows.id})`,
          sql`NOT EXISTS (SELECT 1 FROM ${deals} WHERE ${deals.showId} = ${shows.id})`,
        ),
      )
      .limit(Math.min(limit, 50));
    summary.endedShows = await deleteByIdsChunked(
      rows.map((r) => r.id),
      (chunk) => db.delete(shows).where(inArray(shows.id, chunk)),
    );
  } catch (err) {
    console.error("[retention:shows] failed:", err);
  }

  return summary;
}
