import { describe, expect, it, vi } from "vitest";
import { buildAutoCalendarEvents, withdrawUserAccount } from "@/server/modules/personal";

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
            return [{ id: 10 }]; // user reports
          },
        }),
      }),
      delete: () => ({ where: deleteCalls }),
    } as unknown as Parameters<typeof withdrawUserAccount>[0];

    await withdrawUserAccount(mockDb, 42, new Date("2026-11-26T00:00:00.000Z"));

    expect(deleteCalls).toHaveBeenCalledTimes(5);
    expect(updateCalls.some((u) => "revokedAt" in u)).toBe(true);
    expect(updateCalls.some((u) => u.reporterNickname === "익명의 관객")).toBe(true);
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
});
