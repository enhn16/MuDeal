import { describe, expect, it } from "vitest";
import {
  calcKstDDay,
  compareDatedBenefitPriority,
  expandDateRange,
  extractDatesFromKoreanText,
  extractDiscountDatesFromLabel,
  formatBookingDeadline,
  formatEventDates,
  formatEventDateWithDow,
  formatKstDate,
  isExpired,
  normalizeEventDates,
  normalizeExpiresAtToUtcIso,
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

  it("validates expiresAt strictly without RangeError and defends invalid Date inputs", () => {
    expect(normalizeExpiresAtToUtcIso("2026-12-01")).toBe("2026-12-01T14:59:59.000Z");
    expect(normalizeExpiresAtToUtcIso("2026-12-01T23:59:59")).toBe("2026-12-01T14:59:59.000Z");
    expect(normalizeExpiresAtToUtcIso("2026-12-01T24:00:00")).toBeNull();
    expect(normalizeExpiresAtToUtcIso("2026-02-30")).toBeNull();
    expect(normalizeExpiresAtToUtcIso("내일까지")).toBeNull();

    expect(formatKstDate(new Date("invalid"))).toBe("");
    expect(isExpired("내일까지", new Date("2026-11-27T00:00:00Z"))).toBe(false);
    expect(Number.isNaN(calcKstDDay("invalid-date", new Date("2026-11-27T00:00:00Z")))).toBe(true);
  });

  it("handles year-boundary ranges without leaking prior-year ghost dates and blocks non-date numbers", () => {
    const krCrossYear = extractDatesFromKoreanText("12월 24일 ~ 1월 5일 연말연시 특전", 2026);
    expect(krCrossYear[0]).toBe("2026-12-24");
    expect(krCrossYear.at(-1)).toBe("2027-01-05");
    expect(krCrossYear).not.toContain("2026-01-05");

    const numCrossYear = extractDatesFromKoreanText("12/28 ~ 1/3 스페셜 위크", 2026);
    expect(numCrossYear[0]).toBe("2026-12-28");
    expect(numCrossYear.at(-1)).toBe("2027-01-03");
    expect(numCrossYear).not.toContain("2026-01-03");

    expect(extractDatesFromKoreanText("1/2 가격 할인 · 3/4분기 특가 · 1-2-3차 오픈 · 1.5~2시간", 2026)).toEqual([]);
  });

  it("preserves bilateral performance ranges and resolves year-boundary booking deadlines near now", () => {
    const decNow = new Date("2026-12-20T03:00:00.000Z");

    const perfRange1 = extractDiscountDatesFromLabel("오프닝 위크 할인 (11/24~12/1 공연)", {
      now: new Date("2026-11-20T03:00:00.000Z"),
    });
    expect(perfRange1.bookingExpiresAt).toBeNull();
    expect(perfRange1.applicableDates[0]).toBe("2026-11-24");
    expect(perfRange1.applicableDates.at(-1)).toBe("2026-12-01");

    const perfRange2 = extractDiscountDatesFromLabel("12월 24일~12월 31일 연말 할인", { now: decNow });
    expect(perfRange2.bookingExpiresAt).toBeNull();
    expect(perfRange2.applicableDates[0]).toBe("2026-12-24");
    expect(perfRange2.applicableDates.at(-1)).toBe("2026-12-31");

    // Standalone Jan booking deadline in Dec -> resolves to next year (2027-01-10)
    const janBooking = extractDiscountDatesFromLabel("조기예매(~1/10까지 예매시) 20%", { now: decNow });
    expect(janBooking.bookingExpiresAt).toBe("2027-01-10T14:59:59.000Z");

    // Earlybird deadline >14d before Feb 2027 opening -> stays Dec 2026 (NOT shifted to Dec 2027)
    const preOpenBooking = extractDiscountDatesFromLabel("조기예매(~12/20까지 예매시) 20%", {
      showStartDate: "2027-02-01",
      showEndDate: "2027-12-31",
      now: new Date("2026-12-10T03:00:00.000Z"),
    });
    expect(preOpenBooking.bookingExpiresAt).toBe("2026-12-20T14:59:59.000Z");
  });

  it("picks closest valid year on multi-year shows and drops sentinel 2099 dates", () => {
    const now = new Date("2026-12-01T03:00:00.000Z");
    expect(
      normalizeEventDates(["2023-12-25", "2099-12-31"], {
        showStartDate: "2025-11-01",
        showEndDate: "2027-03-01",
        now,
      }),
    ).toEqual(["2026-12-25"]);
  });
});
