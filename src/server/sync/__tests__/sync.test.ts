import { describe, expect, it } from "vitest";
import {
  classifySubRegion,
  normalizeTitle,
  parseBasePricesText,
  parseCastText,
  parseKopisXmlDetail,
  parseKopisXmlList,
} from "@/server/sync/kopis";
import { matchShowThreeFactor, type ShowMatchCandidate } from "@/server/sync/channels";
import { OcrExtractSchema } from "@/server/sync/ocr";

describe("KOPIS parsers & Daehakro classifier", () => {
  it("parses pcseguidance base prices into seat map", () => {
    expect(parseBasePricesText("VIP석 170,000원, R석 140,000원, S석 110,000원, A석 80,000원")).toEqual({
      VIP: 170000,
      R: 140000,
      S: 110000,
      A: 80000,
    });
    expect(parseBasePricesText("전석 66,000원")).toEqual({ ALL: 66000 });
    expect(parseBasePricesText("무료 공연")).toBeNull();
  });

  it("parses prfcast into deduplicated actor names", () => {
    expect(parseCastText("홍광호, 김준수, 박은태 등")).toEqual(["홍광호", "김준수", "박은태"]);
    expect(parseCastText("전미도(클레어), 김재범 / 외 4명")).toEqual(["전미도", "김재범"]);
  });

  it("classifies Seoul-Daehakro separately from Seoul-Other and regions", () => {
    expect(classifySubRegion("서울특별시", "서울특별시 종로구 대학로12길 64", "유니플렉스 2관")).toBe("DAEHAKRO");
    expect(classifySubRegion("서울특별시", "서울특별시 송파구 올림픽로 240", "샤롯데씨어터")).toBe("SEOUL_OTHER");
    expect(classifySubRegion("부산광역시", "부산 남구", "드림씨어터")).toBe("BUSAN");
    expect(classifySubRegion("경기도", "성남시", "성남아트센터")).toBe("GYEONGGI_INCHEON");
  });

  it("parses KOPIS XML list and detail cleanly", () => {
    const xml = `<dbs><db><mt20id>PF999</mt20id><prfnm>뮤지컬 &lt;빨래&gt;</prfnm><prfpdfrom>2026.11.01</prfpdfrom><prfpdto>2027.02.28</prfpdto><fcltynm>유니플렉스</fcltynm><area>서울특별시</area><prfstate>공연중</prfstate></db></dbs>`;
    const list = parseKopisXmlList(xml);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kopisId: "PF999", startDate: "2026-11-01", endDate: "2027-02-28" });

    const detailXml = `<dbs><db><mt20id>PF999</mt20id><pcseguidance>전석 66,000원</pcseguidance><prfcast>홍광호, 김준수 등</prfcast><mt10id>FC123</mt10id></db></dbs>`;
    expect(parseKopisXmlDetail(detailXml)).toEqual({
      kopisId: "PF999",
      pcseguidance: "전석 66,000원",
      prfcast: "홍광호, 김준수 등",
      venueId: "FC123",
    });
  });
});

describe("3-factor regional tour matching & OCR schema", () => {
  const candidates: ShowMatchCandidate[] = [
    {
      id: 1,
      normalizedTitle: normalizeTitle("뮤지컬 <오페라의 유령>"),
      venueName: "샤롯데씨어터",
      region: "서울특별시",
      subRegion: "SEOUL_OTHER",
      startDate: "2026-11-01",
      endDate: "2027-01-31",
    },
    {
      id: 2,
      normalizedTitle: normalizeTitle("뮤지컬 <오페라의 유령>"),
      venueName: "드림씨어터",
      region: "부산광역시",
      subRegion: "BUSAN",
      startDate: "2026-11-20",
      endDate: "2027-01-25",
    },
  ];

  it("separates Seoul vs Busan tours and returns null when ambiguous", () => {
    expect(
      matchShowThreeFactor(candidates, {
        showTitle: "오페라의 유령",
        regionHint: "부산",
        startDate: "2026-12-01",
      }),
    ).toBe(2);

    // Ambiguous without region/venue -> must return null for admin manual DRAFT confirmation
    expect(matchShowThreeFactor(candidates, { showTitle: "오페라의 유령" })).toBeNull();
  });

  it("validates Vision/OCR JSON output contract", () => {
    const parsed = OcrExtractSchema.parse({
      hasRelevantInfo: true,
      confidence: 0.91,
      discounts: [
        {
          seatGrade: "R",
          salePrice: 38500,
          discountRate: 45,
          isUnconditional: true,
          conditionTags: ["MATINEE"],
          conditionSummary: "평일 낮 마티네",
          expiresAtKst: "2026-12-10T23:59:59",
        },
      ],
      events: [],
    });
    expect(parsed.discounts[0].seatGrade).toBe("R");
    expect(() => OcrExtractSchema.parse({ hasRelevantInfo: true, confidence: 1.5 })).toThrow();
  });
});
