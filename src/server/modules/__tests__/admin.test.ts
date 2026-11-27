import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  createAdminDeal,
  resolveAdminIssue,
  submitDealIssue,
  updateAdminDeal,
  validateCurationImageUrl,
  validateCurationLinkUrl,
} from "@/server/modules/admin";

describe("admin module guards & curation validation", () => {
  it("blocks javascript:/data:/protocol-relative URLs in curations and allows internal paths & https", () => {
    expect(validateCurationLinkUrl("/search?category=PERK")).toBe("/search?category=PERK");
    expect(validateCurationLinkUrl("https://mudeal.kr/shows/1")).toBe("https://mudeal.kr/shows/1");
    expect(() => validateCurationLinkUrl("javascript:alert(1)")).toThrowError(AppError);
    expect(() => validateCurationLinkUrl("//evil.com/phish")).toThrowError(AppError);
    expect(() => validateCurationLinkUrl("http://insecure.com")).toThrowError(AppError);

    expect(validateCurationImageUrl(null)).toBeNull();
    expect(validateCurationImageUrl("https://cdn.example.com/hero.jpg")).toBe(
      "https://cdn.example.com/hero.jpg",
    );
    expect(() => validateCurationImageUrl("javascript:alert(1)")).toThrowError(AppError);
    expect(() => validateCurationImageUrl("data:text/html,hi")).toThrowError(AppError);
  });

  it("validates and normalizes expiresAt on createAdminDeal", async () => {
    const dummyDb = {} as Parameters<typeof createAdminDeal>[0];
    await expect(
      createAdminDeal(dummyDb, 1, {
        showId: 1,
        channelName: "NOL티켓",
        dealType: "TIMESALE",
        seatGrade: "ALL",
        isUnconditional: true,
        externalUrl: "https://tickets.interpark.com/1",
        expiresAt: "잘못된날짜",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("defaults adminLocked=1 on content edits and preserves discountRate on rate-only deals", async () => {
    const updatedPayloads: Array<Record<string, unknown>> = [];
    const rateOnlyDeal = {
      id: 7,
      showId: 1,
      basePrice: null,
      salePrice: null,
      discountRate: 35,
      status: "ACTIVE",
      adminLocked: 0,
      conditionSummary: "얼리버드 35%",
      expiresAt: null,
    };

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [rateOnlyDeal],
            then: (resolve: (v: unknown) => void) => resolve([]),
          }),
        }),
      }),
      update: () => ({
        set: (vals: Record<string, unknown>) => {
          updatedPayloads.push(vals);
          return {
            where: () => ({
              returning: async () => [{ ...rateOnlyDeal, ...vals }],
              then: (resolve: (v: unknown) => void) => resolve(undefined),
            }),
          };
        },
      }),
      insert: () => ({
        values: async () => undefined,
      }),
    } as unknown as Parameters<typeof updateAdminDeal>[0];

    await updateAdminDeal(mockDb, 1, 7, { adminLocked: true });
    expect(updatedPayloads[0]).toMatchObject({
      discountRate: 35,
      adminLocked: 1,
    });

    await updateAdminDeal(mockDb, 1, 7, { conditionSummary: "수정된 조건", expiresAt: "2026-12-20" });
    const contentEdit = updatedPayloads.find((p) => p.conditionSummary === "수정된 조건");
    expect(contentEdit).toMatchObject({
      discountRate: 35,
      adminLocked: 1,
      expiresAt: "2026-12-20T14:59:59.000Z",
    });
  });

  it("blocks duplicate OPEN deal issues with 409 and enforces idempotent resolveAdminIssue with adminLocked=1", async () => {
    let selectCall = 0;
    const dupIssueDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              selectCall += 1;
              return [{ id: selectCall === 1 ? 10 : 99 }];
            },
          }),
        }),
      }),
    } as unknown as Parameters<typeof submitDealIssue>[0];

    await expect(submitDealIssue(dupIssueDb, 2, 10, "ENDED")).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });

    // Already resolved issue -> 409 CONFLICT
    const alreadyResolvedDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: 5, dealId: 10, status: "RESOLVED" }],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [] }),
        }),
      }),
    } as unknown as Parameters<typeof resolveAdminIssue>[0];

    await expect(resolveAdminIssue(alreadyResolvedDb, 1, 5, "EXPIRE_DEAL")).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });

    // Fresh OPEN issue + EXPIRE_DEAL -> sets deal status=EXPIRED and adminLocked=1
    const dealUpdates: Array<Record<string, unknown>> = [];
    let updateIdx = 0;
    const openIssueDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: 5, dealId: 10, status: "OPEN" }],
            then: (resolve: (v: unknown) => void) => resolve([]),
          }),
        }),
      }),
      update: () => ({
        set: (vals: Record<string, unknown>) => {
          updateIdx += 1;
          if (updateIdx === 2) dealUpdates.push(vals);
          return {
            where: () => ({
              returning: async () => (updateIdx === 1 ? [{ id: 5 }] : [{ showId: 1 }]),
              then: (resolve: (v: unknown) => void) => resolve(undefined),
            }),
          };
        },
      }),
      insert: () => ({ values: async () => undefined }),
    } as unknown as Parameters<typeof resolveAdminIssue>[0];

    await resolveAdminIssue(openIssueDb, 1, 5, "EXPIRE_DEAL");
    expect(dealUpdates[0]).toMatchObject({ status: "EXPIRED", adminLocked: 1 });
  });
});
