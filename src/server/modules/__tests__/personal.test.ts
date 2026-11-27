import { describe, expect, it, vi } from "vitest";
import {
  addActorFollow,
  buildAutoCalendarEvents,
  chunkArray,
  removeActorFollow,
  withdrawUserAccount,
} from "@/server/modules/personal";

describe("personal calendar auto-event extraction", () => {
  it("extracts LOTTERY and CURTAIN_CALL dates within KST range", () => {
    const events = buildAutoCalendarEvents(
      [
        {
          showTitle: "뮤지컬 <알라딘>",
          deal: {
            id: 1,
            showId: 1,
            channelName: "NOL티켓",
            dealType: "LOTTERY",
            opensAt: null,
            expiresAt: "2026-11-28T14:59:59.000Z", // 2026-11-28 23:59 KST
            eventDatesJson: null,
            conditionSummary: "로터리 추첨 응모",
            perkSummary: null,
          },
        },
        {
          showTitle: "뮤지컬 <알라딘>",
          deal: {
            id: 4,
            showId: 1,
            channelName: "샤롯데씨어터",
            dealType: "CURTAIN_CALL",
            opensAt: null,
            expiresAt: "2026-12-06T14:59:59.000Z",
            eventDatesJson: '["2026-11-29","2026-12-05"]',
            conditionSummary: "커튼콜 촬영 가능",
            perkSummary: "포토카드 증정",
          },
        },
      ],
      "2026-11-01",
      "2026-11-30",
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      eventDate: "2026-11-28",
      category: "LOTTERY",
    });
    expect(events[1]).toMatchObject({
      eventDate: "2026-11-29",
      category: "STAGE_EVENT",
    });
  });

  it("withdrawUserAccount revokes sessions, deletes personal data, anonymizes reports, and marks WITHDRAWN", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const deleteCalls = vi.fn(async () => undefined);
    let selectStep = 0;

    const mockDb = {
      update: () => ({
        set: (vals: Record<string, unknown>) => {
          updateCalls.push(vals);
          return { where: async () => undefined };
        },
      }),
      select: () => ({
        from: () => ({
          where: async () => {
            selectStep += 1;
            if (selectStep === 1) return [{ actorId: 1 }]; // followed actors
            return [{ id: 10, evidenceR2Key: "reports/42/123-abcd.png" }]; // user reports
          },
        }),
      }),
      delete: () => ({ where: deleteCalls }),
    } as unknown as Parameters<typeof withdrawUserAccount>[0];

    const bucketDelete = vi.fn(async () => undefined);
    await withdrawUserAccount(mockDb, 42, new Date("2026-11-26T00:00:00.000Z"), {
      evidenceBucket: { delete: bucketDelete },
    });

    // 5 personal tables + dealHelpfulVotes
    expect(deleteCalls).toHaveBeenCalledTimes(6);
    expect(bucketDelete).toHaveBeenCalledWith("reports/42/123-abcd.png");
    expect(updateCalls.some((u) => "revokedAt" in u)).toBe(true);
    expect(updateCalls.some((u) => u.reporterNickname === "익명의 관객" && u.evidenceR2Key === null)).toBe(true);
    expect(
      updateCalls.some(
        (u) =>
          u.status === "WITHDRAWN" &&
          u.email === null &&
          typeof u.oauthSubject === "string" &&
          u.oauthSubject.startsWith("withdrawn:42:"),
      ),
    ).toBe(true);
  });

  it("ignores invalid expiresAt in buildAutoCalendarEvents without throwing and chunks large ID arrays", () => {
    const events = buildAutoCalendarEvents(
      [
        {
          showTitle: "뮤지컬 <알라딘>",
          deal: {
            id: 99,
            showId: 1,
            channelName: "NOL티켓",
            dealType: "LOTTERY",
            opensAt: null,
            expiresAt: "내일까지",
            eventDatesJson: null,
            conditionSummary: null,
            perkSummary: null,
          },
        },
      ],
      "2026-11-01",
      "2026-11-30",
    );
    expect(events).toEqual([]);
    expect(chunkArray(Array.from({ length: 120 }, (_, i) => i), 50).map((c) => c.length)).toEqual([50, 50, 20]);
  });

  it("only updates followerCount when follow insert/delete actually affects a row", async () => {
    let updateCount = 0;
    const conflictFollowDb = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ id: 1 }] }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({ returning: async () => [] }),
        }),
      }),
      delete: () => ({
        where: () => ({ returning: async () => [] }),
      }),
      update: () => {
        updateCount += 1;
        return { set: () => ({ where: async () => undefined }) };
      },
    } as unknown as Parameters<typeof addActorFollow>[0];

    await addActorFollow(conflictFollowDb, 2, 1);
    await removeActorFollow(conflictFollowDb, 2, 1);
    expect(updateCount).toBe(0);
  });
});
