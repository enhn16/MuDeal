import { describe, expect, it } from "vitest";
import { buildAutoCalendarEvents } from "@/server/modules/personal";

describe("personal calendar auto-event extraction", () => {
  it("extracts TICKET_OPEN, LOTTERY, and CURTAIN_CALL dates within KST range", () => {
    const events = buildAutoCalendarEvents(
      [
        {
          showTitle: "뮤지컬 <어쩌면 해피엔딩>",
          deal: {
            id: 8,
            showId: 3,
            channelName: "YES24티켓",
            dealType: "TICKET_OPEN",
            opensAt: "2026-11-28T05:00:00.000Z", // 2026-11-28 14:00 KST
            expiresAt: "2026-12-01T06:00:00.000Z",
            eventDatesJson: null,
            conditionSummary: "3차 오픈",
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
      eventTime: "14:00",
      category: "TICKET_OPEN",
    });
    expect(events[1]).toMatchObject({
      eventDate: "2026-11-29",
      category: "STAGE_EVENT",
    });
  });
});
