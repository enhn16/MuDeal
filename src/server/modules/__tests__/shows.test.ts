import { describe, expect, it } from "vitest";
import type { deals, shows } from "@/db/schema";
import { filterShowsWithDeals, parseShowSearchParams } from "@/server/modules/shows";

type ShowRow = typeof shows.$inferSelect;
type DealRow = typeof deals.$inferSelect;

function makeShow(overrides: Partial<ShowRow>): ShowRow {
  return {
    id: 1,
    kopisId: "PF1",
    title: "뮤지컬 <빨래>",
    normalizedTitle: "뮤지컬빨래",
    posterUrl: null,
    venueName: "유니플렉스 2관",
    venueAddress: "서울 종로구 대학로",
    region: "서울",
    subRegion: "DAEHAKRO",
    startDate: "2026-11-01",
    endDate: "2027-01-31",
    synopsis: null,
    synopsisImageUrl: null,
    channelLinksJson: null,
    basePricesJson: '{"R":70000}',
    minActivePrice: 38500,
    maxDiscountRate: 45,
    status: "ONGOING",
    viewCount: 100,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

function makeDeal(overrides: Partial<DealRow>): DealRow {
  return {
    id: 1,
    showId: 1,
    channelName: "엘티켓",
    dealType: "TIMESALE",
    seatGrade: "R",
    basePrice: 70000,
    salePrice: 38500,
    discountRate: 45,
    isUnconditional: 1,
    conditionTagsJson: '["MATINEE"]',
    conditionSummary: "평일 마티네",
    opensAt: null,
    eventDatesJson: null,
    perkSummary: null,
    feeInfo: null,
    externalUrl: "https://www.l-ticket.co.kr/1",
    externalKey: null,
    expiresAt: "2026-12-10T14:59:59.000Z",
    status: "ACTIVE",
    sourceType: "USER_REPORT",
    sourceReportId: null,
    sourceOcrJobId: null,
    reporterNickname: "대학로산책",
    clickCount: 10,
    helpfulCount: 3,
    adminLocked: 0,
    lastVerifiedAt: "2026-11-25T00:00:00Z",
    createdAt: "2026-11-25T00:00:00Z",
    updatedAt: "2026-11-25T00:00:00Z",
    ...overrides,
  };
}

describe("4-axis show search filter", () => {
  const now = new Date("2026-11-25T03:00:00.000Z"); // 2026-11-25 Wed KST

  const dataset = [
    {
      show: makeShow({ id: 1, title: "뮤지컬 <빨래>", subRegion: "DAEHAKRO" }),
      deals: [makeDeal({ id: 1, showId: 1, salePrice: 38500, conditionTagsJson: '["MATINEE"]' })],
      actorNames: ["홍광호"],
    },
    {
      show: makeShow({ id: 2, title: "뮤지컬 <알라딘>", subRegion: "SEOUL_OTHER", venueName: "샤롯데씨어터" }),
      deals: [
        makeDeal({
          id: 2,
          showId: 2,
          salePrice: 95000,
          isUnconditional: 0,
          dealType: "LOTTERY",
          conditionTagsJson: null,
          sourceType: "SYNC_APPROVED",
        }),
      ],
      actorNames: ["김준수"],
    },
    {
      show: makeShow({ id: 3, title: "마감된 극", subRegion: "DAEHAKRO" }),
      deals: [makeDeal({ id: 3, showId: 3, expiresAt: "2026-11-25T02:00:00.000Z" })], // expired
      actorNames: ["김준수"],
    },
  ];

  it("filters by [THIS_WEEKEND] + [DAEHAKRO] + [<=50000] + [MATINEE] combined", () => {
    const res = filterShowsWithDeals(
      dataset,
      { datePreset: "THIS_WEEKEND", regions: ["DAEHAKRO"], priceMax: 50000, conditionTags: ["MATINEE"] },
      now,
    );
    expect(res.map((s) => s.id)).toEqual([1]);
  });

  it("compares expiresAt against KST dateFrom (keeps deals expiring 00:00~08:59 KST on dateFrom)", () => {
    const boundaryDataset = [
      {
        show: makeShow({ id: 21, title: "토요일 오전 KST 마감 딜", subRegion: "DAEHAKRO" }),
        deals: [makeDeal({ id: 21, showId: 21, expiresAt: "2026-11-27T23:00:00.000Z" })], // 2026-11-28 08:00 KST
        actorNames: [],
      },
      {
        show: makeShow({ id: 22, title: "금요일 자정 직전 KST 마감 딜", subRegion: "DAEHAKRO" }),
        deals: [makeDeal({ id: 22, showId: 22, expiresAt: "2026-11-27T14:59:59.000Z" })], // 2026-11-27 23:59:59 KST
        actorNames: [],
      },
    ];
    const res = filterShowsWithDeals(boundaryDataset, { datePreset: "THIS_WEEKEND" }, now);
    expect(res.map((s) => s.id)).toEqual([21]);
  });

  it("matches by actor name and excludes expired deals", () => {
    const res = filterShowsWithDeals(dataset, { q: "김준수" }, now);
    expect(res.map((s) => s.id)).toEqual([2]);
  });

  it("parses CSV regions and conditionTags safely from URLSearchParams", () => {
    const parsed = parseShowSearchParams(
      new URLSearchParams("region=DAEHAKRO,INVALID&priceMin=20000&priceMax=50000&conditionTags=MATINEE,REWATCH&unconditionalOnly=1&category=PERK"),
    );
    expect(parsed.regions).toEqual(["DAEHAKRO"]);
    expect(parsed.priceMin).toBe(20000);
    expect(parsed.priceMax).toBe(50000);
    expect(parsed.conditionTags).toEqual(["MATINEE", "REWATCH"]);
    expect(parsed.unconditionalOnly).toBe(true);
    expect(parsed.category).toBe("PERK");
  });

  it("filters by custom priceMin and priceMax range", () => {
    expect(filterShowsWithDeals(dataset, { priceMin: 40000, priceMax: 100000 }, now).map((s) => s.id)).toEqual([2]);
    expect(filterShowsWithDeals(dataset, { priceMin: 30000, priceMax: 50000 }, now).map((s) => s.id)).toEqual([1]);
    expect(filterShowsWithDeals(dataset, { priceMin: 0, priceMax: 100000 }, now).map((s) => s.id)).toEqual([1, 2]);
    const parsedEmpty = parseShowSearchParams(new URLSearchParams("priceMin=&priceMax=50000"));
    expect(parsedEmpty.priceMin).toBeUndefined();
    expect(parsedEmpty.priceMax).toBe(50000);
  });

  it("classifies shows across DISCOUNT, PERK, and EVENT even when a show has priced deals", () => {
    const multiDealDataset = [
      {
        show: makeShow({ id: 10, title: "뮤지컬 <알라딘>" }),
        deals: [
          makeDeal({ id: 101, showId: 10, dealType: "TIMESALE", salePrice: 123500 }),
          makeDeal({
            id: 102,
            showId: 10,
            dealType: "CURTAIN_CALL",
            salePrice: null,
            discountRate: null,
            conditionSummary: "주말 커튼콜 촬영 가능",
            perkSummary: "스페셜 포토카드 1종 증정",
            eventDatesJson: '["2026-12-05"]',
          }),
        ],
        actorNames: ["김준수"],
      },
      {
        show: makeShow({ id: 11, title: "뮤지컬 <어쩌면 해피엔딩>" }),
        deals: [
          makeDeal({
            id: 103,
            showId: 11,
            dealType: "PERK_GOODS",
            salePrice: null,
            discountRate: null,
            perkSummary: "미공개 OST 엽서 증정",
          }),
        ],
        actorNames: ["전미도"],
      },
    ];

    const all = filterShowsWithDeals(multiDealDataset, {}, now);
    const aladdin = all.find((s) => s.id === 10)!;
    expect(aladdin.categories).toEqual(["DISCOUNT", "PERK", "EVENT"]);
    expect(aladdin.perkHighlight).toContain("포토카드");
    expect(aladdin.eventHighlight?.dealType).toBe("CURTAIN_CALL");

    expect(filterShowsWithDeals(multiDealDataset, { category: "DISCOUNT" }, now).map((s) => s.id)).toEqual([10]);
    expect(filterShowsWithDeals(multiDealDataset, { category: "PERK" }, now).map((s) => s.id)).toEqual([10, 11]);
    expect(filterShowsWithDeals(multiDealDataset, { category: "EVENT" }, now).map((s) => s.id)).toEqual([10]);
  });

  it("headlines unconditional discount price by default and switches to conditional price when filtered by condition tag", () => {
    const mixedDataset = [
      {
        show: makeShow({ id: 30, title: "뮤지컬 <여신님이 보고 계셔>" }),
        deals: [
          makeDeal({
            id: 301,
            showId: 30,
            basePrice: 88000,
            salePrice: 61600,
            discountRate: 30,
            isUnconditional: 1,
            conditionTagsJson: null,
            conditionSummary: "오프닝 위크 할인 30%",
          }),
          makeDeal({
            id: 302,
            showId: 30,
            basePrice: 88000,
            salePrice: 52800,
            discountRate: 40,
            isUnconditional: 0,
            conditionTagsJson: '["MILITARY_PUBLIC"]',
            conditionSummary: "군인 할인(1인2매/증빙지참) 40%",
          }),
        ],
        actorNames: [],
      },
    ];

    const defaultCards = filterShowsWithDeals(mixedDataset, {}, now);
    expect(defaultCards[0].lowestPrice).toBe(61600);
    expect(defaultCards[0].isUnconditional).toBe(true);

    const militaryCards = filterShowsWithDeals(mixedDataset, { conditionTags: ["MILITARY_PUBLIC"] }, now);
    expect(militaryCards[0].lowestPrice).toBe(52800);
    expect(militaryCards[0].isUnconditional).toBe(false);
  });

  it("picks currently active biggest unconditional discount and prioritizes active/earliest benefit dates", () => {
    const richDataset = [
      {
        show: makeShow({ id: 40, title: "뮤지컬 <여신님이 보고 계셔>", startDate: "2026-11-24", endDate: "2027-03-01" }),
        deals: [
          makeDeal({
            id: 401,
            showId: 40,
            basePrice: 88000,
            salePrice: 61600,
            discountRate: 30,
            isUnconditional: 1,
            conditionSummary: "오프닝 위크 할인 30%",
            expiresAt: "2026-12-10T14:59:59.000Z",
          }),
          makeDeal({
            id: 402,
            showId: 40,
            basePrice: 88000,
            salePrice: 44000,
            discountRate: 50,
            isUnconditional: 1,
            conditionSummary: "타임세일 50%",
            eventDatesJson: '["2026-11-25","2026-11-26","2026-11-27"]',
            expiresAt: "2026-11-27T14:59:59.000Z",
          }),
          makeDeal({
            id: 403,
            showId: 40,
            dealType: "PERK_GOODS",
            salePrice: null,
            discountRate: null,
            perkSummary: "12월 중순 특전",
            eventDatesJson: '["2026-12-15"]',
          }),
          makeDeal({
            id: 404,
            showId: 40,
            dealType: "PERK_GOODS",
            salePrice: null,
            discountRate: null,
            perkSummary: "현재 진행 중 탁상달력 특전",
            eventDatesJson: '["2026-11-24","2026-11-25","2026-11-26"]',
          }),
        ],
        actorNames: [],
      },
    ];

    const [card] = filterShowsWithDeals(richDataset, {}, now); // now = 2026-11-25
    expect(card.maxDiscountRate).toBe(50);
    expect(card.lowestPrice).toBe(44000);
    expect(card.discountDates).toEqual(["2026-11-25", "2026-11-26", "2026-11-27"]);
    expect(card.discountDDay).toBe(2); // 2026-11-27 KST from top deal's expiresAt
    expect(card.perkHighlight).toBe("현재 진행 중 탁상달력 특전");
    expect(card.perkDates).toEqual(["2026-11-24", "2026-11-25", "2026-11-26"]);
  });
});
