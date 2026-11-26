import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { recordOutboundClick } from "@/server/modules/deals";
import { approveUserReport, rejectUserReport, submitDealReport } from "@/server/modules/reports";
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
});
