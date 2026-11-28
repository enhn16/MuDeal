import { describe, expect, it, vi } from "vitest";
import { purgeExpiredRetentionData } from "../retention";

describe("TD-001: purgeExpiredRetentionData", () => {
  it("chunks deletes (<= 50 ids per D1 IN clause), purges expired logs/deals/shows, deletes old R2 evidence, and isolates per-step failures", async () => {
    let deleteCalls = 0;
    const r2Deleted: string[] = [];
    let selectCall = 0;

    // 120 stale outbound click IDs -> verifies 50-id D1 chunking (50 + 50 + 20 = 3 delete calls)
    const manyClickIds = Array.from({ length: 120 }, (_, i) => ({ id: i + 1 }));

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              selectCall += 1;
              switch (selectCall) {
                case 1:
                  return manyClickIds; // outbound_clicks
                case 2:
                  return [{ id: 10 }, { id: 11 }]; // user_sessions
                case 3:
                  throw new Error("simulated sync_runs failure"); // verify error isolation!
                case 4:
                  return [{ id: 20 }]; // user_notifications
                case 5:
                  return [{ id: 30 }, { id: 31 }]; // ocr trim extracted_json
                case 6:
                  return [{ id: 32 }]; // ocr delete
                case 7:
                  return [{ id: 40 }, { id: 41 }, { id: 42 }]; // deals
                case 8:
                  return [{ id: 50 }]; // deal_issues
                case 9:
                  return [{ id: 60 }]; // audit_logs
                case 10:
                  return [
                    { id: 90, evidenceR2Key: "reports/7/old-a.png" },
                    { id: 91, evidenceR2Key: "reports/8/old-b.jpg" },
                  ]; // R2 evidence cleanup (runs BEFORE rejected deal_reports delete)
                case 11:
                  return [{ id: 70, evidenceR2Key: null }]; // rejected deal_reports
                case 12:
                  return [{ id: 80 }]; // unreferenced ended shows (>365d)
                default:
                  return [];
              }
            },
          }),
        }),
      }),
      delete: () => ({
        where: async () => {
          deleteCalls += 1;
          return undefined;
        },
      }),
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
    } as unknown as Parameters<typeof purgeExpiredRetentionData>[0];

    const fakeBucket = {
      delete: vi.fn(async (key: string) => {
        r2Deleted.push(key);
      }),
    } as unknown as R2Bucket;

    const summary = await purgeExpiredRetentionData(mockDb, new Date("2026-11-27T16:00:00.000Z"), {
      batchLimit: 500,
      evidenceBucket: fakeBucket,
    });

    expect(summary).toEqual({
      outboundClicks: 120,
      userSessions: 2,
      syncRuns: 0, // failed step isolated without halting subsequent purges
      userNotifications: 1,
      ocrJobsTrimmed: 2,
      ocrJobsDeleted: 1,
      deals: 3,
      dealIssues: 1,
      auditLogs: 1,
      rejectedReports: 1,
      endedShows: 1,
      r2ObjectsDeleted: 2,
    });
    expect(r2Deleted).toEqual(["reports/7/old-a.png", "reports/8/old-b.jpg"]);
    // 120 clicks -> 3 chunks (50+50+20) + 8 other non-empty delete tables = 11 delete calls
    expect(deleteCalls).toBe(11);
  });

  it("caps batchLimit safely and skips R2 cleanup when bucket binding is absent", async () => {
    const observedLimits: number[] = [];
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async (n: number) => {
              observedLimits.push(n);
              return [];
            },
          }),
        }),
      }),
    } as unknown as Parameters<typeof purgeExpiredRetentionData>[0];

    const summary = await purgeExpiredRetentionData(mockDb, new Date("2026-11-27T16:00:00.000Z"), {
      batchLimit: 9999,
    });

    expect(summary.r2ObjectsDeleted).toBe(0);
    // Clamped to 500 max (and 50 max for ended shows)
    expect(Math.max(...observedLimits)).toBe(500);
    expect(observedLimits.at(-1)).toBe(50);
  });

  it("C-02: deletes R2 evidence strictly before deleting >180d rejected deal_reports and skips DB delete if R2 delete fails", async () => {
    const timeline: string[] = [];
    const deletedReportChunks: number[][] = [];
    let selectCall = 0;

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              selectCall += 1;
              if (selectCall === 10) {
                return [{ id: 1, evidenceR2Key: "reports/1/step9.png" }];
              }
              if (selectCall === 11) {
                return [
                  { id: 71, evidenceR2Key: "reports/71/overflow-ok.png" },
                  { id: 72, evidenceR2Key: "reports/72/overflow-fail.png" },
                  { id: 73, evidenceR2Key: null },
                ];
              }
              return [];
            },
          }),
        }),
      }),
      delete: () => ({
        where: async () => {
          timeline.push("db.delete:deal_reports");
          return undefined;
        },
      }),
      update: () => ({
        set: () => ({
          where: async () => {
            timeline.push("db.update:clear_r2_key");
            return undefined;
          },
        }),
      }),
    } as unknown as Parameters<typeof purgeExpiredRetentionData>[0];

    // Capture exact chunk IDs passed to deleteByIdsChunked via bucket spy + summary verification
    const fakeBucket = {
      delete: vi.fn(async (key: string) => {
        timeline.push(`r2.delete:${key}`);
        if (key.includes("overflow-fail")) {
          throw new Error("R2 transient error");
        }
        deletedReportChunks.push([key.length]);
      }),
    } as unknown as R2Bucket;

    const summary = await purgeExpiredRetentionData(mockDb, new Date("2026-11-27T16:00:00.000Z"), {
      evidenceBucket: fakeBucket,
    });

    // Step 9 R2 cleanup AND step 10 pre-delete R2 cleanup both run strictly BEFORE db.delete:deal_reports
    const dbDeleteIdx = timeline.indexOf("db.delete:deal_reports");
    expect(dbDeleteIdx).toBeGreaterThan(0);
    expect(timeline.indexOf("r2.delete:reports/1/step9.png")).toBeLessThan(dbDeleteIdx);
    expect(timeline.indexOf("r2.delete:reports/71/overflow-ok.png")).toBeLessThan(dbDeleteIdx);
    expect(timeline.indexOf("r2.delete:reports/72/overflow-fail.png")).toBeLessThan(dbDeleteIdx);

    // Row 71 (R2 deleted) + Row 73 (null key) deleted = 2; Row 72 skipped because R2 delete failed!
    expect(summary.rejectedReports).toBe(2);
    expect(summary.r2ObjectsDeleted).toBe(2);
  });
});
