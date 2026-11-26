import { describe, expect, it, vi } from "vitest";
import {
  classifySubRegion,
  normalizeTitle,
  parseBasePricesText,
  parseCastText,
  parseKopisXmlDetail,
  parseKopisXmlList,
  syncKopisShows,
} from "@/server/sync/kopis";
import {
  AUTO_PUBLISH_CONFIDENCE,
  matchShowThreeFactor,
  matchShowWithConfidence,
  normalizeCoreTitle,
  type ShowMatchCandidate,
} from "@/server/sync/channels";
import { isKidsMusical } from "@/server/sync/kids-filter";
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

  it("excludes kids musicals via KOPIS kidstate=Y & keyword filter, sorts recent-first, and caches venues", async () => {
    const fetchedUrls: string[] = [];
    const listXml = `<dbs>
      <db><mt20id>PF1</mt20id><prfnm>뮤지컬 A</prfnm><prfpdfrom>2026.10.01</prfpdfrom><prfpdto>2026.12.31</prfpdto><fcltynm>유니플렉스 1관</fcltynm><area>서울특별시</area><prfstate>공연중</prfstate></db>
      <db><mt20id>PF2</mt20id><prfnm>뮤지컬 B</prfnm><prfpdfrom>2026.11.20</prfpdfrom><prfpdto>2026.12.31</prfpdto><fcltynm>유니플렉스 2관</fcltynm><area>서울특별시</area><prfstate>공연중</prfstate></db>
      <db><mt20id>PF3</mt20id><prfnm>이미수집작</prfnm><prfpdfrom>2026.09.01</prfpdfrom><prfpdto>2026.12.31</prfpdto><fcltynm>샤롯데씨어터</fcltynm><area>서울특별시</area><prfstate>공연중</prfstate></db>
      <db><mt20id>PF_KID</mt20id><prfnm>아기돼지 삼형제</prfnm><prfpdfrom>2026.11.25</prfpdfrom><prfpdto>2026.12.31</prfpdto><fcltynm>아띠홀</fcltynm><area>인천</area><prfstate>공연중</prfstate></db>
    </dbs>`;
    const kidXml = `<dbs><db><mt20id>PF_KID</mt20id><prfnm>아기돼지 삼형제</prfnm></db></dbs>`;

    const fakeFetch = vi.fn(async (input: string | URL | Request) => {
      const u = String(input);
      fetchedUrls.push(u);
      if (u.includes("kidstate=Y")) return new Response(kidXml, { status: 200 });
      if (u.includes("/pblprfr?")) return new Response(listXml, { status: 200 });
      if (u.includes("/pblprfr/PF")) {
        const id = u.includes("PF2") ? "PF2" : "PF1";
        return new Response(
          `<dbs><db><mt20id>${id}</mt20id><pcseguidance>R석 70,000원</pcseguidance><prfcast></prfcast><mt10id>FC_SAME</mt10id></db></dbs>`,
          { status: 200 },
        );
      }
      return new Response(`<dbs><db><adres>서울특별시 종로구 대학로12길</adres></db></dbs>`, { status: 200 });
    }) as unknown as typeof fetch;

    let selectIdx = 0;
    const mockDb = {
      insert: () => ({
        values: () => ({
          returning: async () => [{ id: 100 }],
          onConflictDoNothing: async () => undefined,
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              selectIdx += 1;
              // Recent-first order: PF2 (11.20) -> PF1 (10.01) -> PF3 (09.01, already populated -> skip detail)
              if (selectIdx === 3) return [{ id: 3, basePricesJson: '{"VIP":190000}', venueAddress: "송파구" }];
              return [];
            },
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    } as unknown as Parameters<typeof syncKopisShows>[0];

    const res = await syncKopisShows(mockDb, "test-key", new Date("2026-11-26T00:00:00Z"), {
      maxPages: 1,
      maxDetailFetches: 10,
      fetchFn: fakeFetch,
    });

    expect(res.status).toBe("SUCCESS");
    expect(res.fetchedCount).toBe(3); // PF_KID excluded!
    expect(res.detailFetchCount).toBe(2); // PF2 & PF1 only; PF3 skipped!
    const detailCalls = fetchedUrls.filter((u) => u.includes("/pblprfr/PF"));
    expect(detailCalls[0]).toContain("PF2"); // Most recent startDate fetched first!
    expect(detailCalls[1]).toContain("PF1");
    expect(fetchedUrls.filter((u) => u.includes("/prfplc/"))).toHaveLength(1);
  });

  it("matches cross-channel core titles with high confidence and filters kids shows", () => {
    expect(isKidsMusical("어린이 캣츠 [검단]", "아띠홀")).toBe(true);
    expect(isKidsMusical("겨울왕국 [서울]", "샤롯데씨어터")).toBe(false);
    expect(isKidsMusical("레베카 [서울]", "충무아트센터")).toBe(false);

    const match = matchShowWithConfidence(
      [
        {
          id: 42,
          normalizedTitle: normalizeCoreTitle("곤 투모로우 [대학로]"),
          venueName: "홍익대 대학로 아트센터",
          region: "서울",
          subRegion: "DAEHAKRO",
          startDate: "2026-09-15",
          endDate: "2026-11-29",
        },
      ],
      {
        showTitle: "뮤지컬 <곤 투모로우> 10주년 기념 공연",
        venueName: "홍익대 대학로 아트센터 대극장",
        regionHint: "서울",
      },
    );
    expect(match?.showId).toBe(42);
    expect(match!.confidence).toBeGreaterThanOrEqual(AUTO_PUBLISH_CONFIDENCE);
  });
});
