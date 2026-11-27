import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { recordOutboundClick, voteDealHelpful } from "@/server/modules/deals";
import {
  approveDraftDeal,
  approveUserReport,
  detectAllowedImageMagic,
  fanoutNewDealNotifications,
  rejectUserReport,
  submitDealReport,
  validateUserEvidenceKey,
} from "@/server/modules/reports";
import type { AuthUser } from "@/server/modules/auth";

const USER: AuthUser = {
  id: 2,
  nickname: "대학로산책",
  email: "walker@mudeal.local",
  role: "USER",
  oauthProvider: "KAKAO",
};

describe("reports & review policy boundaries", () => {
  it("blocks unsafe URLs on report submission with 400", async () => {
    const dummyDb = {} as Parameters<typeof submitDealReport>[0];
    await expect(
      submitDealReport(dummyDb, USER, {
        reportedShowTitle: "뮤지컬 빨래",
        channelName: "엘티켓",
        dealType: "TIMESALE",
        externalUrl: "javascript:alert(1)",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 } satisfies Partial<AppError>);
  });

  it("blocks report submission once KST daily count reaches 10 with 429", async () => {
    const dbAtLimit = {
      select: () => ({
        from: () => ({
          where: async () => [{ count: 10 }],
        }),
      }),
    } as unknown as Parameters<typeof submitDealReport>[0];

    await expect(
      submitDealReport(dbAtLimit, USER, {
        reportedShowTitle: "뮤지컬 빨래",
        channelName: "엘티켓",
        dealType: "TIMESALE",
        externalUrl: "https://www.l-ticket.co.kr/1",
      }),
    ).rejects.toMatchObject({
      code: "DAILY_REPORT_LIMIT_EXCEEDED",
      status: 429,
    } satisfies Partial<AppError>);
  });

  it("requires non-empty reject reason (400) and blocks double approval (409)", async () => {
    const dummyDb = {} as Parameters<typeof rejectUserReport>[0];
    await expect(rejectUserReport(dummyDb, 1, 1, "   ")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });

    // Simulate report already processed (UPDATE ... WHERE status='PENDING' returns [])
    let selectCalls = 0;
    const processedDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              selectCalls += 1;
              return selectCalls === 1
                ? [{ id: 1, reporterId: 2, reporterNickname: "관객", status: "APPROVED" }]
                : [{ id: 1, title: "뮤지컬 <알라딘>" }];
            },
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [],
          }),
        }),
      }),
    } as unknown as Parameters<typeof approveUserReport>[0];

    await expect(approveUserReport(processedDb, 1, 1, { showId: 1 })).rejects.toMatchObject({
      code: "REPORT_ALREADY_PROCESSED",
      status: 409,
    });
  });

  it("allows http:// outbound clicks only for ADMIN-created deals and blocks USER_REPORT http://", async () => {
    const makeClickDb = (sourceType: "ADMIN" | "USER_REPORT") => {
      let call = 0;
      return {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                call += 1;
                return call === 1
                  ? [
                      {
                        id: 9,
                        showId: 1,
                        channelName: "레거시극장",
                        sourceType,
                        externalUrl: "http://legacy-theater.kr/event",
                        status: "ACTIVE",
                        expiresAt: null,
                        clickCount: 4,
                      },
                    ]
                  : [];
              },
              orderBy: () => ({ limit: async () => [{ id: 1 }] }),
            }),
          }),
        }),
      } as unknown as Parameters<typeof recordOutboundClick>[0];
    };

    const adminRes = await recordOutboundClick(makeClickDb("ADMIN"), 9, "sess-hash");
    expect(adminRes.externalUrl).toBe("http://legacy-theater.kr/event");

    await expect(recordOutboundClick(makeClickDb("USER_REPORT"), 9, "sess-hash")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("validates & normalizes expiresAt to UTC ISO and enforces evidenceR2Key ownership", async () => {
    const insertedValues: Array<Record<string, unknown>> = [];
    const okDb = {
      select: () => ({
        from: () => ({
          where: async () => [{ count: 0 }],
        }),
      }),
      insert: () => ({
        values: (vals: Record<string, unknown>) => {
          insertedValues.push(vals);
          return { returning: async () => [{ id: 10, ...vals }] };
        },
      }),
    } as unknown as Parameters<typeof submitDealReport>[0];

    await expect(
      submitDealReport(okDb, USER, {
        reportedShowTitle: "뮤지컬 빨래",
        channelName: "엘티켓",
        dealType: "TIMESALE",
        externalUrl: "https://www.l-ticket.co.kr/1",
        expiresAt: "내일까지",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });

    // Cross-user IDOR key blocked
    await expect(
      submitDealReport(okDb, USER, {
        reportedShowTitle: "뮤지컬 빨래",
        channelName: "엘티켓",
        dealType: "TIMESALE",
        externalUrl: "https://www.l-ticket.co.kr/1",
        evidenceR2Key: "reports/999/1700000000-abcdef12.png",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });

    expect(validateUserEvidenceKey("reports/2/1700000000-abcdef12.png", 2)).toBe(
      "reports/2/1700000000-abcdef12.png",
    );

    const created = await submitDealReport(okDb, USER, {
      reportedShowTitle: "뮤지컬 빨래",
      channelName: "엘티켓",
      dealType: "TIMESALE",
      externalUrl: "https://www.l-ticket.co.kr/1",
      expiresAt: "2026-12-01T18:00:00+09:00",
      evidenceR2Key: "reports/2/1700000000-abcdef12.png",
    });
    expect(created.expiresAt).toBe("2026-12-01T09:00:00.000Z");
    expect(insertedValues[0].evidenceR2Key).toBe("reports/2/1700000000-abcdef12.png");
  });

  it("detects JPEG/PNG/WebP strictly from magic bytes and rejects spoofed HTML/text payloads", () => {
    expect(detectAllowedImageMagic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      mime: "image/jpeg",
      ext: "jpg",
    });
    expect(
      detectAllowedImageMagic(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toEqual({ mime: "image/png", ext: "png" });
    expect(
      detectAllowedImageMagic(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toEqual({ mime: "image/webp", ext: "webp" });
    // Spoofed HTML payload
    expect(detectAllowedImageMagic(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
  });

  it("chunks fanoutNewDealNotifications in batches of 8 rows to stay within D1 bind limits", async () => {
    const batchSizes: number[] = [];
    let selectStep = 0;
    const manyBookmarkers = Array.from({ length: 20 }, (_, i) => ({ userId: i + 1 }));
    const db = {
      select: () => ({
        from: () => ({
          where: async () => {
            selectStep += 1;
            if (selectStep === 1) return manyBookmarkers;
            return []; // no cast actors
          },
        }),
      }),
      insert: () => ({
        values: (rows: unknown[]) => {
          batchSizes.push(rows.length);
          return { onConflictDoNothing: async () => undefined };
        },
      }),
    } as unknown as Parameters<typeof fanoutNewDealNotifications>[0];

    await fanoutNewDealNotifications(
      db,
      { id: 1, showId: 1, channelName: "NOL티켓", conditionSummary: "특가" },
      "뮤지컬 <알라딘>",
    );
    expect(batchSizes).toEqual([8, 8, 4]);
  });

  it("blocks unsafe URL on approveDraftDeal, recalculates discountRate, and locks adminLocked=1", async () => {
    const baseDraft = {
      id: 50,
      showId: 1,
      channelName: "NOL티켓",
      dealType: "TIMESALE",
      seatGrade: "R",
      basePrice: 100000,
      salePrice: 70000,
      discountRate: 30,
      conditionSummary: "기존",
      perkSummary: null,
      expiresAt: null,
      externalUrl: "http://insecure.example.com/deal",
      status: "DRAFT",
      adminLocked: 0,
    };

    const unsafeDb = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [baseDraft] }),
        }),
      }),
    } as unknown as Parameters<typeof approveDraftDeal>[0];

    await expect(approveDraftDeal(unsafeDb, 1, 50)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });

    const updatedPayloads: Array<Record<string, unknown>> = [];
    let selectStep = 0;
    const validDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              selectStep += 1;
              if (selectStep === 1) return [{ ...baseDraft, externalUrl: "https://tickets.interpark.com/1" }];
              return [{ id: 1, title: "뮤지컬 <알라딘>" }];
            },
            then: (resolve: (v: unknown) => void) => resolve([]),
          }),
        }),
      }),
      update: () => ({
        set: (vals: Record<string, unknown>) => {
          updatedPayloads.push(vals);
          return {
            where: () => ({
              returning: async () => [{ ...baseDraft, ...vals, id: 50 }],
              then: (resolve: (v: unknown) => void) => resolve(undefined),
            }),
          };
        },
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: async () => undefined,
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        }),
      }),
    } as unknown as Parameters<typeof approveDraftDeal>[0];

    await approveDraftDeal(validDb, 1, 50, {
      salePrice: 60000,
      expiresAt: "2026-12-10",
      perkSummary: "포토카드",
    });

    expect(updatedPayloads[0]).toMatchObject({
      salePrice: 60000,
      discountRate: 40,
      adminLocked: 1,
      status: "ACTIVE",
      perkSummary: "포토카드",
      expiresAt: "2026-12-10T14:59:59.000Z",
    });
  });

  it("blocks helpful votes on expired/non-ACTIVE deals and avoids 500 on concurrent guest duplicate", async () => {
    const expiredDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              { id: 1, status: "DRAFT", expiresAt: null, helpfulCount: 0 },
            ],
          }),
        }),
      }),
    } as unknown as Parameters<typeof voteDealHelpful>[0];

    await expect(voteDealHelpful(expiredDb, 1, { sessionHash: "abc" })).rejects.toMatchObject({
      code: "DEAL_EXPIRED",
      status: 410,
    });

    let updateCalled = false;
    const conflictDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              { id: 1, status: "ACTIVE", expiresAt: null, helpfulCount: 5 },
            ],
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => [], // duplicate conflict
          }),
        }),
      }),
      update: () => {
        updateCalled = true;
        return { set: () => ({ where: () => ({ returning: async () => [] }) }) };
      },
    } as unknown as Parameters<typeof voteDealHelpful>[0];

    const res = await voteDealHelpful(conflictDb, 1, { sessionHash: "dup" });
    expect(res).toEqual({ voted: true, helpfulCount: 5 });
    expect(updateCalled).toBe(false);
  });

  it("reverts report status to PENDING if deal insert fails and isolates fanout failures", async () => {
    const revertedUpdates: Array<Record<string, unknown>> = [];
    let selectCall = 0;
    const insertFailDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              selectCall += 1;
              if (selectCall === 1) {
                return [
                  {
                    id: 11,
                    reporterId: 2,
                    reporterNickname: "관객",
                    channelName: "NOL티켓",
                    dealType: "TIMESALE",
                    seatGrade: "R",
                    reportedPrice: 50000,
                    reportedDiscountRate: 30,
                    isUnconditional: 1,
                    conditionNote: "특가",
                    externalUrl: "https://tickets.interpark.com/1",
                    expiresAt: null,
                    status: "PENDING",
                  },
                ];
              }
              return [{ id: 1, title: "뮤지컬 <알라딘>", startDate: "2026-11-01", endDate: "2027-01-31" }];
            },
          }),
        }),
      }),
      update: () => ({
        set: (vals: Record<string, unknown>) => {
          revertedUpdates.push(vals);
          return {
            where: () => ({
              returning: async () => [{ id: 11 }],
              catch: () => Promise.resolve(undefined),
              then: (resolve: (v: unknown) => void) => resolve(undefined),
            }),
          };
        },
      }),
      insert: () => ({
        values: () => ({
          returning: async () => {
            throw new Error("D1 write failure");
          },
        }),
      }),
    } as unknown as Parameters<typeof approveUserReport>[0];

    await expect(approveUserReport(insertFailDb, 1, 11, { showId: 1 })).rejects.toThrow("D1 write failure");
    expect(revertedUpdates.some((u) => u.status === "PENDING" && u.reviewerId === null)).toBe(true);
  });
});
