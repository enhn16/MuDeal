import { describe, expect, it } from "vitest";
import {
  compareDatedBenefitPriority,
  expandDateRange,
  extractDatesFromKoreanText,
  extractDiscountDatesFromLabel,
  formatBookingDeadline,
  formatEventDates,
  formatEventDateWithDow,
  normalizeEventDates,
} from "@/lib/kst";

describe("event date formatting & normalization", () => {
  it("formats single dates with Korean weekday", () => {
    expect(formatEventDateWithDow("2026-12-01")).toBe("12.01(화)");
    expect(formatEventDates(["2026-12-01"], "compact")).toBe("12.01(화)");
    expect(formatEventDates(["2026-12-01"], "full")).toBe("12.01(화)");
  });

  it("formats consecutive ranges cleanly", () => {
    const range = expandDateRange("2026-11-24", "2026-12-01");
    expect(range).toHaveLength(8);
    expect(formatEventDates(range, "full")).toBe("11.24(화) ~ 12.01(화)");
    expect(formatEventDates(range, "compact")).toBe("11.24(화) ~ 12.01(화)");
  });

  it("formats non-consecutive multiple dates differently for full vs compact", () => {
    const dates = ["2026-11-28", "2026-12-05", "2026-12-12"];
    expect(formatEventDates(dates, "full")).toBe("11.28(토) · 12.05(토) · 12.12(토)");
    expect(formatEventDates(dates, "compact")).toBe("11.28(토) 외 2일");
    expect(formatEventDates(["2026-11-28", "2026-12-05"], "compact")).toBe("11.28(토) · 12.05(토)");
  });

  it("extracts Korean ranges and comma lists without matching unrelated numbers", () => {
    expect(extractDatesFromKoreanText("11월 24일~29일 굿바이 포토카드 위크", 2026)).toEqual([
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(extractDatesFromKoreanText("11월 28일, 29일 막공 무대인사 회차", 2026)).toEqual([
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(extractDatesFromKoreanText("2027 탁상달력 1개 증정 · 10회차 관람 시", 2026)).toEqual([]);
  });

  it("corrects hallucinated past OCR years using show run period or current year", () => {
    const now = new Date("2026-11-27T03:00:00.000Z");
    expect(
      normalizeEventDates(["2023-11-28", "2023-11-29"], {
        showStartDate: "2026-09-01",
        showEndDate: "2026-12-20",
        now,
      }),
    ).toEqual(["2026-11-28", "2026-11-29"]);

    expect(
      normalizeEventDates([], {
        showStartDate: "2026-11-01",
        showEndDate: "2027-01-31",
        fallbackText: "11/28(토) ~ 11/29(일) 스페셜 커튼콜",
        now,
      }),
    ).toEqual(["2026-11-28", "2026-11-29"]);
  });

  it("extracts booking deadline and applicable performance dates separately from discount labels", () => {
    const now = new Date("2026-11-27T03:00:00.000Z");
    const early = extractDiscountDatesFromLabel("조기예매(~12/1까지 예매시)20%", { now });
    expect(formatBookingDeadline(early.bookingExpiresAt)).toBe("~12.01(화)");
    expect(early.applicableDates).toEqual([]);

    const yearEnd = extractDiscountDatesFromLabel(
      "연말 얼리버드 할인 (12월 24일~31일 전 회차, 11월 11일부터 12월 23일까지 예매 시 적용)",
      { now },
    );
    expect(formatBookingDeadline(yearEnd.bookingExpiresAt)).toBe("~12.23(수)");
    expect(yearEnd.applicableDates[0]).toBe("2026-12-24");
    expect(yearEnd.applicableDates.at(-1)).toBe("2026-12-31");

    const ageNoise = extractDiscountDatesFromLabel("실버 청춘 할인(1959년이전출생/본인만)50%", { now });
    expect(ageNoise.bookingExpiresAt).toBeNull();
    expect(ageNoise.applicableDates).toEqual([]);
  });

  it("ranks currently active benefits first, then earliest upcoming, then undated", () => {
    const today = "2026-11-27";
    const sorted = [
      { id: "undated", dates: [] as string[] },
      { id: "later", dates: ["2026-12-10"] },
      { id: "sooner", dates: ["2026-11-29"] },
      { id: "active", dates: ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"] },
    ].sort((a, b) => compareDatedBenefitPriority(a.dates, b.dates, today));
    expect(sorted.map((x) => x.id)).toEqual(["active", "sooner", "later", "undated"]);
  });
});
