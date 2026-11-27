import { describe, expect, it, vi } from "vitest";
import {
  classifySubRegion,
  normalizeTitle,
  parseBasePricesText,
  parseCastText,
  parseKopisRelates,
  parseKopisXmlDetail,
  parseKopisXmlList,
  syncKopisShows,
} from "@/server/sync/kopis";
import {
  AUTO_PUBLISH_CONFIDENCE,
  classifyYes24NoticeTitle,
  DEFAULT_CHANNEL_ADAPTERS,
  isLTicketNonMusical,
  kstDateTimeToIso,
  matchShowThreeFactor,
  matchShowWithConfidence,
  normalizeCoreTitle,
  parseLTicketAllSeatPrices,
  parseLTicketDetailHtml,
  parseNolMusicalHtml,
  parseNolNoticeImages,
  parseNolProductDetailHtml,
  parseNolPromoBanners,
  parseYes24CastHtml,
  parseYes24GenreListHtml,
  parseYes24PromotionHtml,
  parseYes24PromotionIds,
  runChannelAdapter,
  type ChannelSyncAdapter,
  type ShowMatchCandidate,
} from "@/server/sync/channels";
import {
  classifyDiscountLabel,
  hasMeaningfulBenefit,
  isStatutoryDiscount,
  isStatutoryOnlyDiscount,
} from "@/server/sync/benefit-filter";
import { isKidsMusical } from "@/server/sync/kids-filter";
import {
  createGeminiVisionExtractor,
  OcrExtractSchema,
  parseDailyLimit,
  processPendingOcrJobs,
  safeFetchImage,
} from "@/server/sync/ocr";
import { expireEndedDeals } from "@/server/sync/expiry";

describe("KOPIS parsers, relates extractor & Daehakro classifier", () => {
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
    expect(classifySubRegion("서울특별시", "", "미정", true)).toBe("DAEHAKRO");
    expect(classifySubRegion("서울특별시", "서울특별시 송파구 올림픽로 240", "샤롯데씨어터")).toBe("SEOUL_OTHER");
    expect(classifySubRegion("부산광역시", "부산 남구", "드림씨어터")).toBe("BUSAN");
    expect(classifySubRegion("경기도", "성남시", "성남아트센터")).toBe("GYEONGGI_INCHEON");
  });

  it("parses KOPIS XML list, detail, styurl, daehakro flag, and NOL/YES24/LTICKET relates (excluding Ticketlink)", () => {
    const xml = `<dbs><db><mt20id>PF999</mt20id><prfnm>뮤지컬 &lt;빨래&gt;</prfnm><prfpdfrom>2026.11.01</prfpdfrom><prfpdto>2027.02.28</prfpdto><fcltynm>유니플렉스</fcltynm><area>서울특별시</area><prfstate>공연중</prfstate></db></dbs>`;
    const list = parseKopisXmlList(xml);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kopisId: "PF999", startDate: "2026-11-01", endDate: "2027-02-28" });

    const detailXml = `<dbs><db>
      <mt20id>PF999</mt20id>
      <pcseguidance>전석 66,000원</pcseguidance>
      <prfcast>홍광호, 김준수 등</prfcast>
      <mt10id>FC123</mt10id>
      <daehakro>Y</daehakro>
      <styurls><styurl>http://www.kopis.or.kr/upload/pfmIntroImage/PF_999.jpg</styurl></styurls>
      <relates>
        <relate><relatenm>놀유니버스</relatenm><relateurl>http://ticket.interpark.com/Ticket/Goods/GoodsInfo.asp?GoodsCode=26015729</relateurl></relate>
        <relate><relatenm>예스24</relatenm><relateurl>https://ticket.yes24.com/Perf/60940</relateurl></relate>
        <relate><relatenm>L티켓</relatenm><relateurl>https://l-ticket.co.kr/product/detail/142</relateurl></relate>
        <relate><relatenm>NHN티켓링크</relatenm><relateurl>http://www.ticketlink.co.kr/product/65165</relateurl></relate>
      </relates>
    </db></dbs>`;

    expect(parseKopisRelates(detailXml)).toEqual({
      nol: "26015729",
      yes24: "60940",
      lticket: "142",
    });

    expect(parseKopisXmlDetail(detailXml)).toEqual({
      kopisId: "PF999",
      pcseguidance: "전석 66,000원",
      prfcast: "홍광호, 김준수 등",
      venueId: "FC123",
      isDaehakro: true,
      synopsisImageUrl: "https://www.kopis.or.kr/upload/pfmIntroImage/PF_999.jpg",
      channelLinks: { nol: "26015729", yes24: "60940", lticket: "142" },
    });
  });

  it("queries KOPIS directly with kidstate=N, filters kids keywords, sorts recent-first, and caches venues", async () => {
    const fetchedUrls: string[] = [];
    const listXml = `<dbs>
      <db><mt20id>PF1</mt20id><prfnm>뮤지컬 A</prfnm><prfpdfrom>2026.10.01</prfpdfrom><prfpdto>2026.12.31</prfpdto><fcltynm>유니플렉스 1관</fcltynm><area>서울특별시</area><prfstate>공연중</prfstate></db>
      <db><mt20id>PF2</mt20id><prfnm>뮤지컬 B</prfnm><prfpdfrom>2026.11.20</prfpdfrom><prfpdto>2026.12.31</prfpdto><fcltynm>유니플렉스 2관</fcltynm><area>서울특별시</area><prfstate>공연중</prfstate></db>
      <db><mt20id>PF3</mt20id><prfnm>이미수집작</prfnm><prfpdfrom>2026.09.01</prfpdfrom><prfpdto>2026.12.31</prfpdto><fcltynm>샤롯데씨어터</fcltynm><area>서울특별시</area><prfstate>공연중</prfstate></db>
      <db><mt20id>PF_KID</mt20id><prfnm>아기돼지 삼형제</prfnm><prfpdfrom>2026.11.25</prfpdfrom><prfpdto>2026.12.31</prfpdto><fcltynm>아띠홀</fcltynm><area>인천</area><prfstate>공연중</prfstate></db>
    </dbs>`;

    const fakeFetch = vi.fn(async (input: string | URL | Request) => {
      const u = String(input);
      fetchedUrls.push(u);
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
              if (selectIdx === 3) {
                return [
                  {
                    id: 3,
                    basePricesJson: '{"VIP":190000}',
                    venueAddress: "송파구",
                    channelLinksJson: '{"nol":"26007416"}',
                    synopsisImageUrl: "https://www.kopis.or.kr/img.jpg",
                  },
                ];
              }
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
    expect(res.fetchedCount).toBe(3); // PF_KID excluded by kids filter
    expect(res.detailFetchCount).toBe(2); // PF2 & PF1 only; PF3 already complete
    expect(fetchedUrls[0]).toContain("kidstate=N");
    expect(fetchedUrls[0]).toContain("rows=100");
    const detailCalls = fetchedUrls.filter((u) => u.includes("/pblprfr/PF"));
    expect(detailCalls[0]).toContain("PF2");
    expect(detailCalls[1]).toContain("PF1");
    expect(fetchedUrls.filter((u) => u.includes("/prfplc/"))).toHaveLength(1);
  });
});

describe("3-factor matching, channel adapters (NOL / YES24 / L.TICKET) & no Ticketlink", () => {
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

  it("excludes Ticketlink from default channel adapters", () => {
    expect(DEFAULT_CHANNEL_ADAPTERS.map((a) => a.sourceName)).toEqual(["NOL", "YES24", "LTICKET"]);
  });

  it("separates Seoul vs Busan tours and strips lottery/SugarDay prefixes cleanly", () => {
    expect(
      matchShowThreeFactor(candidates, {
        showTitle: "오페라의 유령",
        regionHint: "부산",
        startDate: "2026-12-01",
      }),
    ).toBe(2);
    expect(matchShowThreeFactor(candidates, { showTitle: "오페라의 유령" })).toBeNull();
    expect(normalizeCoreTitle("［로터리 티켓 - 앵콜］ 뮤지컬 〈렛미플라이〉")).toBe("렛미플라이");
    expect(normalizeCoreTitle("［슈가데이#8］ 뮤지컬 〈렛미플라이〉")).toBe("렛미플라이");
    expect(normalizeCoreTitle("뮤지컬 [아가사 AGATHA]")).toBe("아가사agatha");
  });

  it("matches cross-channel core titles with high confidence and filters kids shows", () => {
    expect(isKidsMusical("어린이 캣츠 [검단]", "아띠홀")).toBe(true);
    expect(isKidsMusical("겨울왕국 [서울]", "샤롯데씨어터")).toBe(false);
    expect(isKidsMusical("레베카 [서울]", "충무아트센터")).toBe(false);

    const match = matchShowWithConfidence(
      [
        {
          id: 42,
          kopisId: "PF300001",
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

    // KOPIS "(구. ...)" / "(스콘1관)" venue formatting & duplicate XLSX/PF rows must resolve cleanly to canonical PF* row
    const dupMatch = matchShowWithConfidence(
      [
        {
          id: 184,
          kopisId: "XLSX_legacy",
          normalizedTitle: normalizeCoreTitle("렛미플라이 [서울]"),
          venueName: "두산아트센터 연강홀",
          region: "서울",
          subRegion: "SEOUL_OTHER",
          startDate: "2026-10-06",
          endDate: "2027-01-03",
        },
        {
          id: 259,
          kopisId: "PF299346",
          normalizedTitle: normalizeCoreTitle("렛미플라이 [서울]"),
          venueName: "두산아트센터 (연강홀)",
          region: "서울특별시",
          subRegion: "SEOUL_OTHER",
          startDate: "2026-10-06",
          endDate: "2027-01-03",
        },
      ],
      {
        showTitle: "［로터리 티켓 - 앵콜］ 뮤지컬 〈렛미플라이〉",
        venueName: "두산아트센터 연강홀",
      },
    );
    expect(dupMatch?.showId).toBe(259);
    expect(dupMatch!.confidence).toBeGreaterThanOrEqual(AUTO_PUBLISH_CONFIDENCE);

    const oldVenueMatch = matchShowWithConfidence(
      [
        {
          id: 262,
          kopisId: "PF297794",
          normalizedTitle: normalizeCoreTitle("엠. 버터플라이"),
          venueName: "예스24 스테이지(구. DCF대명문화공장)",
          region: "서울특별시",
          subRegion: "DAEHAKRO",
          startDate: "2026-09-22",
          endDate: "2026-12-13",
        },
      ],
      {
        showTitle: "뮤지컬 [엠. 버터플라이]",
        venueName: "예스24스테이지 1관",
      },
    );
    expect(oldVenueMatch?.showId).toBe(262);
    expect(oldVenueMatch!.confidence).toBeGreaterThanOrEqual(AUTO_PUBLISH_CONFIDENCE);
  });

  it("parses NOL full prices.all, lottery timestamps, castCredits, and promo banners", () => {
    const genrePayload = JSON.stringify(
      `3b:["$","$L41",null,{"data":{"header":{"title":"지금 할인중"},"items":[{"prices":[{"discountRate":"30%","originPrice":"88,000원","discountPrice":"61,600원"}],"id":"26014511:26001247","action":{"web":"https://nol.yanolja.com/ticket/places/26001247/products/26014511"},"thumbnail":"https://ticketimage.interpark.com/Play/image/large/26/26014511_p.gif","benefitBadges":[{"text":"재관람 할인"}],"title":"여신님이 보고 계셔","locationDetails":["NOL 유니플렉스 1관"]}]}}]{"alt":"로터리티켓 - 렛미플라이(발표)","imageUrl":"https://img.example/1.jpg","action":{"web":"https://nol.yanolja.com/ticket/products/26016273"}}{"alt":"［슈가데이#8］ 뮤지컬 〈렛미플라이〉","imageUrl":"https://img.example/2.jpg","action":{"web":"https://nol.yanolja.com/ticket/places/17001136/products/26016519"}}`,
    );
    const genreHtml = `<script>self.__next_f.push([1,${genrePayload}])</script>`;
    expect(parseNolMusicalHtml(genreHtml)).toHaveLength(1);
    expect(parseNolPromoBanners(genreHtml)).toEqual([
      { goodsCode: "26016273", alt: "로터리티켓 - 렛미플라이(발표)", kind: "LOTTERY" },
      { goodsCode: "26016519", alt: "［슈가데이#8］ 뮤지컬 〈렛미플라이〉", kind: "SPECIAL_DAY" },
    ]);

    const detailPayload = JSON.stringify(
      `{"goodsDetail":{"goodsCode":"26014511","goodsName":"뮤지컬 〈여신님이 보고 계셔〉","placeName":"NOL 유니플렉스 1관","playStartDate":"2026-11-24","playEndDate":"2027-03-01","posterImageUrl":"http://ticketimage.interpark.com/poster.gif","detail":{"contentInfo":"<img src=\\"http://ticketimage.interpark.com/intro.jpg\\"/>","lotteryApplyStartDateTime":"2026-11-23 10:00:00","lotteryApplyEndDateTime":"2026-11-25 23:59:59","lotteryAnnounceDateTime":"2026-11-26 14:00:00"}}}
      "castCredits":[{"characterName":"아라곤","manNo":"30672","manName":"손승연","manSmallImageUrl":"http://ticketimage.interpark.com/actor1.gif"}]
      {"prices":{"all":[
        {"seatGrade":"1","priceGrade":"01","seatGradeName":"VIP석","priceGradeName":"일반","salesPrice":88000,"priceType":"basic"},
        {"seatGrade":"1","priceGrade":"02","seatGradeName":"VIP석","priceGradeName":"오프닝 위크 할인30%","salesPrice":61600,"priceType":"discount"},
        {"seatGrade":"1","priceGrade":"03","seatGradeName":"VIP석","priceGradeName":"군인 할인(1인2매/증빙지참)40%","salesPrice":52800,"priceType":"discount"}
      ]}}`,
    );
    const parsed = parseNolProductDetailHtml(`<script>self.__next_f.push([1,${detailPayload}])</script>`, "26014511");
    expect(parsed.title).toBe("뮤지컬 〈여신님이 보고 계셔〉");
    expect(parsed.synopsisImageUrl).toBe("https://ticketimage.interpark.com/intro.jpg");
    expect(parsed.lotteryApplyEnd).toBe("2026-11-25T14:59:59.000Z");
    expect(parsed.discounts).toHaveLength(2);
    expect(parsed.discounts[0]).toMatchObject({ seatGrade: "VIP", basePrice: 88000, salePrice: 61600 });
    expect(parsed.discounts[1]).toMatchObject({ seatGrade: "VIP", basePrice: 88000, salePrice: 52800 });
    expect(parsed.castCredits).toEqual([
      {
        name: "손승연",
        roleName: "아라곤",
        externalPlaydbId: "30672",
        profileImageUrl: "https://ticketimage.interpark.com/actor1.gif",
        sourceType: "NOL",
      },
    ]);

    expect(
      parseNolNoticeImages(`<img src="https://ticketimage.interpark.com/Play/ITM/Data/Modify/2026/11/2026112313091517.jpg" />`),
    ).toEqual(["https://ticketimage.interpark.com/Play/ITM/Data/Modify/2026/11/2026112313091517.jpg"]);
  });

  it("parses YES24 popPerfPromotion full price table, GenreList, cast links, and PromotionInfo IDs", () => {
    const promoHtml = `
      <table>
        <tr><th rowspan='4'>R석</th><td class='rn-pop-black'>기본가</td><td class='rn-pop-red'>80,000원</td></tr>
        <tr><td>-복지 할인(본인한정)</td><td>40,000원</td></tr>
        <tr><td>-수험생 할인(본인만)</td><td>48,000원</td></tr>
        <tr><td>-2차 조기예매 할인</td><td>60,000원</td></tr>
      </table>
      <table>
        <tr><th rowspan='2'>S석</th><td>기본가</td><td>60,000원</td></tr>
        <tr><td>-마티네 할인</td><td>42,000원</td></tr>
      </table>
    `;
    const rows = parseYes24PromotionHtml(promoHtml);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ seatGrade: "R", basePrice: 80000, label: "복지 할인(본인한정)", salePrice: 40000 });
    expect(rows[2]).toMatchObject({ seatGrade: "R", basePrice: 80000, label: "2차 조기예매 할인", salePrice: 60000 });
    expect(rows[3]).toMatchObject({ seatGrade: "S", basePrice: 60000, label: "마티네 할인", salePrice: 42000 });

    const genreHtml = `<a onclick='jsf_base_GoToPerfDetail(60940);' title='뮤지컬 [아가사 AGATHA]'><img data-src='//tkfile.yes24.com/60940.jpg'/><p class='list-b-tit2 v2'>2026.12.09 ~ 2027.02.28</p><p class='list-b-tit2 v2'>NOL 서경스퀘어 스콘1관</p></a>`;
    expect(parseYes24GenreListHtml(genreHtml)).toEqual([
      {
        perfId: "60940",
        title: "뮤지컬 [아가사 AGATHA]",
        startDate: "2026-12-09",
        endDate: "2027-02-28",
        venueName: "NOL 서경스퀘어 스콘1관",
        posterUrl: "https://tkfile.yes24.com/60940.jpg",
      },
    ]);

    const castHtml = `<a href='#' class='rn-product-peole'>최수진</a> <a href='#' class='rn-product-peole'>백은혜</a>`;
    expect(parseYes24CastHtml(castHtml)).toEqual([
      { name: "최수진", sourceType: "YES24" },
      { name: "백은혜", sourceType: "YES24" },
    ]);

    expect(parseYes24PromotionIds(`<a href="/Pages/Events/HotEvent/PromotionInfo.aspx?id=4036"></a><a href="/Pages/Events/HotEvent/PromotionInfo.aspx?id=2577"></a>`)).toEqual([
      "4036",
      "2577",
    ]);
  });

  it("parses L.TICKET all seat grades and discount accordion images", () => {
    const ltHtml = `
      <meta property="og:title" content="L.TICKET" />
      <script>items: [{ item_id: '142', item_name: '뮤지컬 〈연의 편지〉', item_category: '뮤지컬·연극', price: 28500 }]</script>
      <a class="detail_place_link"><span>플러스씨어터 </span></a>
      <tr><th scope="row">R석</th><td><div class="seat_price_value"><strong>70,000원</strong><span class="max_discount">최대할인가 38,500원</span></div></td></tr>
      <tr><th scope="row">S석</th><td><div class="seat_price_value"><strong>55,000원</strong><span class="max_discount">최대할인가 28,500원</span></div></td></tr>
      <div class="info_accordion"><h3>할인정보</h3><div class="info_accordion_body"><img src="https://cdn.l-ticket.co.kr/images/disc_142.jpg"></div></div>
    `;
    const all = parseLTicketAllSeatPrices(ltHtml);
    expect(all.seats).toHaveLength(2);
    expect(all.discountImageUrls).toEqual(["https://cdn.l-ticket.co.kr/images/disc_142.jpg"]);
    expect(parseLTicketDetailHtml(ltHtml)).toMatchObject({
      title: "뮤지컬 〈연의 편지〉",
      venueName: "플러스씨어터",
      seatGrade: "S",
      basePrice: 55000,
      salePrice: 28500,
    });
  });
});

describe("3-tier discount classification (unconditional / conditional / statutory exclusion) & OCR schema", () => {
  it("excludes statutory/welfare discounts completely", () => {
    expect(isStatutoryDiscount("국가유공자 할인 50%")).toBe(true);
    expect(isStatutoryDiscount("장애인 중증 할인(1~3급/동반1인)50%")).toBe(true);
    expect(isStatutoryDiscount("복지 할인(증빙필참/본인만)50%")).toBe(true);
    expect(isStatutoryDiscount("경로우대 40%")).toBe(true);
    expect(classifyDiscountLabel("복지 할인(본인한정)").isStatutory).toBe(true);
    expect(isStatutoryOnlyDiscount("국가유공자 할인 50%")).toBe(true);
    expect(isStatutoryOnlyDiscount("평일 마티네 타임세일 40%")).toBe(false);
    expect(hasMeaningfulBenefit({ dealType: "DISCOUNT_SITE", basePrice: null, salePrice: null })).toBe(false);
    expect(
      hasMeaningfulBenefit({
        dealType: "DISCOUNT_SITE",
        basePrice: 100000,
        salePrice: 50000,
        discountRate: 50,
        conditionSummary: "국가유공자 본인 50% 할인",
      }),
    ).toBe(false);
  });

  it("classifies matinee, military, student/exam, office worker, rewatch, local resident, package, and dress code as conditional", () => {
    expect(classifyDiscountLabel("마티네 할인30%")).toMatchObject({
      isStatutory: false,
      isUnconditional: false,
      conditionTags: ["MATINEE"],
    });
    expect(classifyDiscountLabel("군인 할인(1인2매/증빙지참)40%")).toMatchObject({
      isStatutory: false,
      isUnconditional: false,
      conditionTags: ["MILITARY_PUBLIC"],
    });
    expect(classifyDiscountLabel("2027수험생할인(수험표지참)")).toMatchObject({
      isStatutory: false,
      isUnconditional: false,
      conditionTags: ["YOUTH_STUDENT"],
    });
    expect(classifyDiscountLabel("직장인 할인(1인2매/증빙지참)20%")).toMatchObject({
      isStatutory: false,
      isUnconditional: false,
      conditionTags: ["OFFICE_WORKER"],
    });
    expect(classifyDiscountLabel("송파지역(거주자 또는 근무자)할인")).toMatchObject({
      isStatutory: false,
      isUnconditional: false,
      conditionTags: ["LOCAL_RESIDENT"],
    });
    expect(classifyDiscountLabel("4인패키지")).toMatchObject({
      isStatutory: false,
      isUnconditional: false,
      conditionTags: ["GROUP_PACKAGE"],
    });
    expect(classifyDiscountLabel("드레스 코드 할인(1인1매)30%")).toMatchObject({
      isStatutory: false,
      isUnconditional: false,
      conditionTags: ["EVENT_CONDITION"],
    });
  });

  it("classifies earlybird, preview, YES24/NOL special days, and timesales as unconditional", () => {
    expect(classifyDiscountLabel("2차 조기예매 할인")).toMatchObject({
      isStatutory: false,
      isUnconditional: true,
      dealType: "TIMESALE",
      conditionTags: [],
    });
    expect(classifyDiscountLabel("프리뷰 할인30%")).toMatchObject({
      isStatutory: false,
      isUnconditional: true,
      dealType: "TIMESALE",
    });
    expect(classifyDiscountLabel("슈가DAY 할인(1인4매)40%")).toMatchObject({
      isStatutory: false,
      isUnconditional: true,
      dealType: "SPECIAL_DAY",
    });
    expect(classifyDiscountLabel("넵프라이즈티켓")).toMatchObject({
      isStatutory: false,
      isUnconditional: true,
      dealType: "TIMESALE",
    });
    expect(classifyDiscountLabel("로터리 티켓")).toMatchObject({
      isStatutory: false,
      isUnconditional: false,
      dealType: "LOTTERY",
    });
  });

  it("validates Vision/OCR JSON output contract including new condition tags", () => {
    const parsed = OcrExtractSchema.parse({
      hasRelevantInfo: true,
      confidence: 0.91,
      discounts: [
        {
          seatGrade: "R",
          salePrice: 38500,
          discountRate: 45,
          isUnconditional: false,
          conditionTags: ["MILITARY_PUBLIC", "MATINEE"],
          conditionSummary: "군인·마티네 할인",
          expiresAtKst: "2026-12-10T23:59:59",
        },
      ],
      events: [],
    });
    expect(parsed.discounts[0].conditionTags).toEqual(["MILITARY_PUBLIC", "MATINEE"]);
    expect(() => OcrExtractSchema.parse({ hasRelevantInfo: true, confidence: 1.5 })).toThrow();
  });
});

describe("Phase 1 P0/P1 regression tests (matching, parsers, filters, OCR safety, expiry, KOPIS)", () => {
  it("prevents false auto-publish on missing place hint, broad region partial matches, venue mismatch, and generic venue base", () => {
    const cands: ShowMatchCandidate[] = [
      {
        id: 10,
        normalizedTitle: normalizeCoreTitle("영웅"),
        venueName: "세종문화회관 대극장",
        region: "서울특별시",
        subRegion: "SEOUL_OTHER",
        startDate: "2026-11-01",
        endDate: "2027-01-31",
      },
      {
        id: 11,
        normalizedTitle: normalizeCoreTitle("봄"),
        venueName: "대학로 자유극장",
        region: "서울특별시",
        subRegion: "DAEHAKRO",
        startDate: "2026-11-01",
        endDate: "2027-01-31",
      },
    ];

    // Exact title WITHOUT place hint -> capped at 0.80 (< AUTO_PUBLISH_CONFIDENCE)
    const noPlace = matchShowWithConfidence(cands, { showTitle: "영웅" });
    expect(noPlace?.showId).toBe(10);
    expect(noPlace!.confidence).toBeLessThan(AUTO_PUBLISH_CONFIDENCE);

    // Partial title + broad regionHint "서울" ONLY -> must NOT auto-publish
    const partialSeoul = matchShowWithConfidence(cands, { showTitle: "영웅본색", regionHint: "서울" });
    expect(partialSeoul?.confidence ?? 0).toBeLessThan(AUTO_PUBLISH_CONFIDENCE);

    // 1-char candidate title "봄" must NOT partial-match "봄의 제전"
    expect(matchShowWithConfidence(cands, { showTitle: "봄의 제전", regionHint: "서울" })).toBeNull();

    // Explicit venue mismatch must NOT be overridden by broad regionHint "서울"
    expect(
      matchShowWithConfidence(cands, {
        showTitle: "영웅",
        venueName: "블루스퀘어 신한카드홀",
        regionHint: "서울",
      }),
    ).toBeNull();

    // Generic venue base ("대학로 아트홀" -> "대학로") must NOT match "대학로 자유극장"
    expect(
      matchShowWithConfidence(
        [
          {
            id: 12,
            normalizedTitle: normalizeCoreTitle("빨래"),
            venueName: "대학로 자유극장",
            region: "서울특별시",
            subRegion: "DAEHAKRO",
            startDate: "2026-11-01",
            endDate: "2027-01-31",
          },
        ],
        { showTitle: "빨래", venueName: "대학로 아트홀" },
      ),
    ).toBeNull();
  });

  it("parses YES24 multi-grade single table with thead, card-isolated GenreList, and blocks noisy notices", () => {
    const singleTableHtml = `
      <table>
        <thead><tr><th>좌석등급</th><th>할인종류</th><th>가격</th></tr></thead>
        <tbody>
          <tr><th rowspan="2">VIP석</th><td>정가</td><td>170,000원</td></tr>
          <tr><td>-조기예매 할인</td><td>136,000원</td></tr>
          <tr><th rowspan="2">R석</th><td>일반가</td><td>140,000원</td></tr>
          <tr><td>-마티네 할인</td><td>98,000원</td></tr>
        </tbody>
      </table>
    `;
    const rows = parseYes24PromotionHtml(singleTableHtml);
    expect(rows).toEqual([
      { seatGrade: "VIP", seatGradeName: "VIP석", basePrice: 170000, label: "조기예매 할인", salePrice: 136000 },
      { seatGrade: "R", seatGradeName: "R석", basePrice: 140000, label: "마티네 할인", salePrice: 98000 },
    ]);

    // Card A has no <img>, Card B has http:// image & double quotes -> must NOT bleed B into A
    const genreHtml = `
      <a onclick="jsf_base_GoToPerfDetail(100001);" title="뮤지컬 A"><p class="list-b-tit2">2026.11.01 ~ 2026.12.31</p><p class="list-b-tit2">극장 A</p></a>
      <a onclick="jsf_base_GoToPerfDetail(100002);" title="뮤지컬 B"><img src="http://tkfile.yes24.com/b.jpg"/><p class="list-b-tit2">2026.12.01 ~ 2027.01.31</p><p class="list-b-tit2">극장 B</p></a>
    `;
    const parsedList = parseYes24GenreListHtml(genreHtml);
    expect(parsedList).toHaveLength(2);
    expect(parsedList[0]).toMatchObject({ perfId: "100001", title: "뮤지컬 A", venueName: "극장 A", posterUrl: null });
    expect(parsedList[1]).toMatchObject({
      perfId: "100002",
      title: "뮤지컬 B",
      venueName: "극장 B",
      posterUrl: "https://tkfile.yes24.com/b.jpg",
    });

    expect(classifyYes24NoticeTitle("[안내] 뮤지컬 A 커튼콜 촬영 불가 안내")).toBeNull();
    expect(classifyYes24NoticeTitle("[공지] 뮤지컬 A MD 굿즈 판매 안내")).toBeNull();
    expect(classifyYes24NoticeTitle("[티켓오픈] 뮤지컬 A 3차 티켓오픈 안내")).toBeNull();
    expect(classifyYes24NoticeTitle("[티켓오픈] 뮤지컬 A 3차 티켓오픈 및 포토카드 증정 안내")).toBe("PERK_GOODS");
    expect(classifyYes24NoticeTitle("뮤지컬 A YES24데이 특가 안내")).toBe("SPECIAL_DAY");
  });

  it("parses L.TICKET nested discount accordion, percentage-prefixed max_discount, and blocks non-musicals", () => {
    const ltHtml = `
      <script>items: [{ item_id: '200', item_name: '뮤지컬 It\\'s Showtime', item_category: '뮤지컬·연극' }]</script>
      <a class="detail_place_link"><span>샤롯데씨어터</span></a>
      <tr><th scope="row">VIP석</th><td class="price"><div class="seat_price_value"><strong>170,000원</strong><span class="max_discount">최대 50% 할인가 85,000원</span></div></td></tr>
      <div class="info_accordion">
        <h3>할인정보</h3>
        <div class="info_accordion_body">
          <div class="inner"><p>안내</p></div>
          <div class="imgs"><img src="//cdn.l-ticket.co.kr/images/disc_200.png" /></div>
        </div>
      </div>
    `;
    const parsed = parseLTicketAllSeatPrices(ltHtml);
    expect(parsed.title).toBe("뮤지컬 It's Showtime");
    expect(parsed.seats).toEqual([
      { seatGrade: "VIP", seatGradeName: "VIP석", basePrice: 170000, salePrice: 85000 },
    ]);
    expect(parsed.discountImageUrls).toEqual(["https://cdn.l-ticket.co.kr/images/disc_200.png"]);

    expect(isLTicketNonMusical("[대학로] 연극 <옥탑방고양이>", "뮤지컬·연극")).toBe(true);
    expect(isLTicketNonMusical("2026 김준수 콘서트", "콘서트")).toBe(true);
    expect(isLTicketNonMusical("뮤지컬 <연의 편지>", "뮤지컬·연극")).toBe(false);
  });

  it("parses NOL regularPrice fallback, start/end KST bounds, and invalid sentinel dates safely", () => {
    expect(kstDateTimeToIso("20261201", "start")).toBe("2026-11-30T15:00:00.000Z");
    expect(kstDateTimeToIso("20261201", "end")).toBe("2026-12-01T14:59:59.000Z");
    expect(kstDateTimeToIso("2026-12-01T14:30:00", "end")).toBe("2026-12-01T05:30:00.000Z");
    expect(kstDateTimeToIso("9999-99-99", "end")).toBeNull();

    const detailPayload = JSON.stringify(
      `{"goodsDetail":{"goodsCode":"26099999","goodsName":"뮤지컬 테스트","playStartDate":"20261101","playEndDate":"20270131","bookingEndTime":"9999-99-99"},"prices":{"summary":{},"all":[{"seatGradeName":"OP석","priceGrade":"02","priceGradeName":"조기예매","regularPrice":150000,"salesPrice":105000,"priceType":"discount","priceStartDate":"2026-11-01","priceEndDate":"2026-11-30"}]}}`,
    );
    const parsed = parseNolProductDetailHtml(`<script>self.__next_f.push([1,${detailPayload}])</script>`, "26099999");
    expect(parsed.startDate).toBe("2026-11-01");
    expect(parsed.endDate).toBe("2027-01-31");
    expect(parsed.bookingEndTime).toBeNull();
    expect(parsed.discounts[0]).toMatchObject({
      seatGrade: "VIP",
      seatGradeName: "OP석",
      basePrice: 150000,
      salePrice: 105000,
      discountStartDate: "2026-10-31T15:00:00.000Z",
      discountEndDate: "2026-11-30T14:59:59.000Z",
    });
    expect(
      parseNolNoticeImages(`<img src="HTTP://ticketimage.interpark.com/Play/ITM/Data/Modify/2026/11/abc.png" />`),
    ).toEqual(["https://ticketimage.interpark.com/Play/ITM/Data/Modify/2026/11/abc.png"]);
  });

  it("hardens benefit-filter and kids-filter against FP/FN", () => {
    expect(isStatutoryDiscount("중증장애(1~3급) 50%")).toBe(true);
    expect(isStatutoryDiscount("실버 할인(1959년이전출생)")).toBe(true);
    expect(isStatutoryDiscount("서울 다둥이행복카드 30%")).toBe(true);
    expect(isStatutoryDiscount("장애물 없는 공연")).toBe(false);

    expect(classifyDiscountLabel("시야제한석 40%").isUnconditional).toBe(false);
    expect(classifyDiscountLabel("화수목 평일 할인 20%").isUnconditional).toBe(false);
    expect(classifyDiscountLabel("10인 단체 할인 30%").isUnconditional).toBe(false);
    expect(classifyDiscountLabel("예술인패스 25%").isUnconditional).toBe(false);
    expect(classifyDiscountLabel("초/중/고 학생 할인").isUnconditional).toBe(false);

    // Photocard & show title "우리 읍내" must NOT falsely trigger CARD_PARTNER
    const photoPromo = classifyDiscountLabel("포토카드 증정 조기예매 할인");
    expect(photoPromo.conditionTags).not.toContain("CARD_PARTNER");
    expect(photoPromo.isUnconditional).toBe(true);
    expect(classifyDiscountLabel("슈가DAY 할인", ["우리 읍내"]).conditionTags).not.toContain("CARD_PARTNER");
    expect(hasMeaningfulBenefit({ dealType: "SPECIAL_DAY" })).toBe(true);

    // Adult/major-theater classic musicals must NOT be blocked by kids-filter
    expect(isKidsMusical("황태자 루돌프", "충무아트센터")).toBe(false);
    expect(isKidsMusical("신데렐라", "충무아트센터")).toBe(false);
    expect(isKidsMusical("미녀와 야수", "샤롯데씨어터")).toBe(false);
    // Kids variants and missing kids IPs ARE blocked (case-insensitive)
    expect(isKidsMusical("가족뮤지컬 신데렐라", "어린이극장")).toBe(true);
    expect(isKidsMusical("신비아파트 뮤지컬", "올림픽홀")).toBe(true);
    expect(isKidsMusical("브레드이발소", "성남아트센터")).toBe(true);
    expect(isKidsMusical("어린왕자", "nc소극장")).toBe(true);
  });

  it("enforces OCR SSRF/redirect/size/content-type defense, dailyLimit safety, and Gemini model fallback", async () => {
    expect(parseDailyLimit(undefined)).toBe(100);
    expect(parseDailyLimit("not-a-number")).toBe(100);
    expect(parseDailyLimit(0)).toBe(100);
    expect(parseDailyLimit(-3)).toBe(100);
    expect(parseDailyLimit("40")).toBe(40);

    // SSRF & private IP blocking
    const neverCalled = vi.fn();
    await expect(safeFetchImage("http://example.com/a.jpg", neverCalled)).rejects.toThrow(/unsafe/i);
    await expect(safeFetchImage("https://127.0.0.1/a.jpg", neverCalled)).rejects.toThrow(/unsafe/i);
    await expect(safeFetchImage("https://169.254.169.254/latest/meta-data", neverCalled)).rejects.toThrow(/unsafe/i);
    expect(neverCalled).not.toHaveBeenCalled();

    // Redirect to private IP blocked
    const redirectToLocal = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "https://localhost/secret.png" } }),
    ) as unknown as typeof fetch;
    await expect(safeFetchImage("https://cdn.example.com/a.png", redirectToLocal)).rejects.toThrow(/redirect/i);

    // Non-image Content-Type blocked
    const htmlFetch = vi.fn(async () =>
      new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    ) as unknown as typeof fetch;
    await expect(safeFetchImage("https://cdn.example.com/a.png", htmlFetch)).rejects.toThrow(/Content-Type/i);

    // Oversized stream blocked
    const bigStreamFetch = vi.fn(async () =>
      new Response(new Uint8Array(2048), { status: 200, headers: { "content-type": "image/png" } }),
    ) as unknown as typeof fetch;
    await expect(safeFetchImage("https://cdn.example.com/a.png", bigStreamFetch, { maxBytes: 1024 })).rejects.toThrow(
      /max size/i,
    );

    // Schema bounds
    const bounded = OcrExtractSchema.parse({
      hasRelevantInfo: true,
      confidence: 0.9,
      discounts: [{ salePrice: 500, discountRate: 99, conditionSummary: "이상치" }],
      events: [],
    });
    expect(bounded.discounts[0].salePrice).toBeNull();
    expect(bounded.discounts[0].discountRate).toBeNull();

    // Gemini extractor strips code fences and falls back to 2nd model on invalid JSON
    let geminiCall = 0;
    const mockGeminiFetch = vi.fn(async () => {
      geminiCall += 1;
      if (geminiCall === 1) {
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not-json" }] } }] }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '```json\n{"hasRelevantInfo":true,"confidence":0.9,"discounts":[],"events":[]}\n```' }],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const extractor = createGeminiVisionExtractor("test-key", mockGeminiFetch);
    const extracted = await extractor(new Uint8Array([1, 2, 3]).buffer, "image/png");
    expect(geminiCall).toBe(2);
    expect(extracted.confidence).toBe(0.9);
  });

  it("isolates OCR discount anomalies as DRAFT while auto-publishing clean high-confidence deals", async () => {
    const insertedDeals: Array<Record<string, unknown>> = [];
    const jobUpdates: Array<Record<string, unknown>> = [];
    let selectCall = 0;

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => {
            selectCall += 1;
            // 1: stale PROCESSING jobs
            if (selectCall === 1) return Promise.resolve([]);
            // 2: usedToday count
            if (selectCall === 2) return Promise.resolve([{ count: 0 }]);
            // 3: queued jobs
            if (selectCall === 3) {
              return {
                orderBy: () => ({
                  limit: async () => [
                    {
                      id: 77,
                      showId: 5,
                      sourceChannel: "NOL티켓",
                      sourcePageUrl: "https://nol.yanolja.com/ticket/products/26014511",
                      imageUrl: "https://ticketimage.interpark.com/notice.png",
                      ocrStatus: "QUEUED",
                      errorMessage: null,
                    },
                  ],
                }),
              };
            }
            // 4: dup imageHash check
            if (selectCall === 4) return { limit: async () => [] };
            // 5: showMeta
            if (selectCall === 5) {
              return {
                limit: async () => [
                  {
                    title: "뮤지컬 테스트",
                    startDate: "2026-11-01",
                    endDate: "2027-01-31",
                    status: "ONGOING",
                    basePricesJson: '{"VIP":170000,"R":100000,"A":80000}',
                  },
                ],
              };
            }
            // 6: existingShowDeals
            if (selectCall === 6) return Promise.resolve([]);
            // 7..9: existing deals by externalKey
            if (selectCall >= 7 && selectCall <= 9) return { limit: async () => [] };
            // 10+: recomputeShowPriceCache query
            return Promise.resolve([]);
          },
        }),
      }),
      insert: () => ({
        values: (val: Record<string, unknown>) => {
          insertedDeals.push(val);
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: (val: Record<string, unknown>) => {
          jobUpdates.push(val);
          return {
            where: () => ({
              returning: async () => [{ id: 77 }],
            }),
          };
        },
      }),
    } as unknown as Parameters<typeof processPendingOcrJobs>[0];

    const imgFetch = vi.fn(async () =>
      new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } }),
    ) as unknown as typeof fetch;

    const res = await processPendingOcrJobs(
      mockDb,
      {
        dailyLimit: 50,
        fetchFn: imgFetch,
        extractor: async () => ({
          hasRelevantInfo: true,
          confidence: 0.92,
          discounts: [
            // Clean discount: R 70,000 / 30% off 100,000 -> ACTIVE (invalid T24:00:00 safely ignored)
            {
              seatGrade: "R",
              salePrice: 70000,
              discountRate: 30,
              isUnconditional: true,
              conditionTags: [],
              conditionSummary: "조기예매 할인",
              expiresAtKst: "2026-12-20T24:00:00",
              applicableDates: [],
            },
            // Anomaly: salePrice 95,000 claims 50% off 100,000 (>15%p mismatch) -> isolated as DRAFT
            {
              seatGrade: "R",
              salePrice: 95000,
              discountRate: 50,
              isUnconditional: true,
              conditionTags: [],
              conditionSummary: "오추출 타임세일",
              expiresAtKst: null,
              applicableDates: [],
            },
            // Seat-grade base price anomaly: A seat basePrice is 80,000, salePrice 90,000 (>= gradeBase) -> DRAFT
            {
              seatGrade: "A",
              salePrice: 90000,
              discountRate: 10,
              isUnconditional: true,
              conditionTags: [],
              conditionSummary: "A석 오추출 할인",
              expiresAtKst: null,
              applicableDates: [],
            },
          ],
          events: [],
        }),
      },
      new Date("2026-11-27T03:00:00.000Z"),
    );

    expect(res.processed).toBe(1);
    expect(insertedDeals).toHaveLength(3);
    expect(insertedDeals[0]).toMatchObject({ externalKey: "ocr:77:disc:0", status: "ACTIVE", expiresAt: null });
    expect(insertedDeals[1]).toMatchObject({ externalKey: "ocr:77:disc:1", status: "DRAFT" });
    expect(insertedDeals[2]).toMatchObject({ externalKey: "ocr:77:disc:2", status: "DRAFT" });
  });

  it("blocks in-place ACTIVE deal enrichment on low-confidence or anomalous OCR and enforces stale PROCESSING retry cap", async () => {
    const dealUpdates: Array<Record<string, unknown>> = [];
    const insertedDeals: Array<Record<string, unknown>> = [];
    const staleUpdates: Array<Record<string, unknown>> = [];
    let selectCall = 0;

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => {
            selectCall += 1;
            // 1: stale PROCESSING jobs (one under cap [retry:2], one at cap [retry:3])
            if (selectCall === 1) {
              return Promise.resolve([
                { id: 10, errorMessage: "[retry:2] Recovered stale PROCESSING job" },
                { id: 11, errorMessage: "[retry:3] Recovered stale PROCESSING job" },
              ]);
            }
            // 2: usedToday count
            if (selectCall === 2) return Promise.resolve([{ count: 0 }]);
            // 3: queued jobs (low-confidence job 88 + high-confidence anomalous job 89)
            if (selectCall === 3) {
              return {
                orderBy: () => ({
                  limit: async () => [
                    {
                      id: 88,
                      showId: 5,
                      sourceChannel: "NOL티켓",
                      sourcePageUrl: "https://nol.yanolja.com/ticket/products/26014511",
                      imageUrl: "https://ticketimage.interpark.com/low.png",
                      ocrStatus: "QUEUED",
                      errorMessage: null,
                    },
                    {
                      id: 89,
                      showId: 5,
                      sourceChannel: "NOL티켓",
                      sourcePageUrl: "https://nol.yanolja.com/ticket/products/26014511",
                      imageUrl: "https://ticketimage.interpark.com/anom.png",
                      ocrStatus: "QUEUED",
                      errorMessage: null,
                    },
                  ],
                }),
              };
            }
            // Job 88: 4=dup, 5=showMeta, 6=existingDeal by externalKey (existingShowDeals skipped because canAutoPublishBase=false)
            if (selectCall === 4) return { limit: async () => [] };
            if (selectCall === 5) {
              return {
                limit: async () => [
                  {
                    title: "뮤지컬 테스트",
                    startDate: "2026-11-01",
                    endDate: "2027-01-31",
                    status: "ONGOING",
                    basePricesJson: '{"R":100000}',
                  },
                ],
              };
            }
            if (selectCall === 6) return { limit: async () => [] };

            // Job 89: 7=dup, 8=showMeta, 9=existingShowDeals (contains matching ACTIVE deal!), 10=existingDeal by externalKey
            if (selectCall === 7) return { limit: async () => [] };
            if (selectCall === 8) {
              return {
                limit: async () => [
                  {
                    title: "뮤지컬 테스트",
                    startDate: "2026-11-01",
                    endDate: "2027-01-31",
                    status: "ONGOING",
                    basePricesJson: '{"R":100000}',
                  },
                ],
              };
            }
            if (selectCall === 9) {
              return Promise.resolve([
                {
                  id: 999,
                  seatGrade: "R",
                  discountRate: 30,
                  conditionSummary: "조기예매 할인",
                  expiresAt: null,
                  eventDatesJson: null,
                  adminLocked: 0,
                },
              ]);
            }
            return { limit: async () => [] };
          },
        }),
      }),
      insert: () => ({
        values: (val: Record<string, unknown>) => {
          insertedDeals.push(val);
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: (val: Record<string, unknown>) => {
          if (typeof val.errorMessage === "string" && val.errorMessage.includes("Recovered stale")) {
            staleUpdates.push(val);
          } else if ("expiresAt" in val || "eventDatesJson" in val) {
            dealUpdates.push(val);
          }
          return {
            where: () => ({
              returning: async () => [{ id: 88 }],
            }),
          };
        },
      }),
    } as unknown as Parameters<typeof processPendingOcrJobs>[0];

    let imgCall = 0;
    const imgFetch = vi.fn(async () => {
      imgCall += 1;
      return new Response(new Uint8Array([137, 80, 78, imgCall]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof fetch;

    let extractCall = 0;
    const res = await processPendingOcrJobs(
      mockDb,
      {
        dailyLimit: 50,
        fetchFn: imgFetch,
        extractor: async () => {
          extractCall += 1;
          if (extractCall === 1) {
            // Job 88: low confidence (0.65 < 0.85)
            return {
              hasRelevantInfo: true,
              confidence: 0.65,
              discounts: [
                {
                  seatGrade: "R",
                  salePrice: 70000,
                  discountRate: 30,
                  isUnconditional: true,
                  conditionTags: [],
                  conditionSummary: "조기예매 할인",
                  expiresAtKst: "2026-12-20T23:59:59",
                  applicableDates: [],
                },
              ],
              events: [],
            };
          }
          // Job 89: high confidence (0.95) BUT anomalous price (salePrice 120,000 >= R basePrice 100,000)
          return {
            hasRelevantInfo: true,
            confidence: 0.95,
            discounts: [
              {
                seatGrade: "R",
                salePrice: 120000,
                discountRate: 30,
                isUnconditional: true,
                conditionTags: [],
                conditionSummary: "조기예매 할인",
                expiresAtKst: "2026-12-20T23:59:59",
                applicableDates: [],
              },
            ],
            events: [],
          };
        },
      },
      new Date("2026-11-27T03:00:00.000Z"),
    );

    expect(res.processed).toBe(2);
    // Stale PROCESSING recovery respects retry cap (3 max): retry 3 -> QUEUED, retry 4 -> FAILED
    expect(staleUpdates).toEqual([
      expect.objectContaining({ ocrStatus: "QUEUED", errorMessage: "[retry:3] Recovered stale PROCESSING job" }),
      expect.objectContaining({ ocrStatus: "FAILED", errorMessage: "[retry:4] Recovered stale PROCESSING job" }),
    ]);
    // Neither low-confidence nor anomalous OCR mutated the existing ACTIVE deal in-place!
    expect(dealUpdates).toHaveLength(0);
    // Both were safely isolated into DRAFT deals instead
    expect(insertedDeals).toHaveLength(2);
    expect(insertedDeals[0]).toMatchObject({ externalKey: "ocr:88:disc:0", status: "DRAFT" });
    expect(insertedDeals[1]).toMatchObject({ externalKey: "ocr:89:disc:0", status: "DRAFT" });
  });

  it("protects shows backfill on low-confidence DRAFT, respects forceDraft & admin_locked, and skips ended deals in runChannelAdapter", async () => {
    const insertedDeals: Array<Record<string, unknown>> = [];
    const updatedTables: Array<Record<string, unknown>> = [];
    let selectIdx = 0;

    const mockDb = {
      insert: () => ({
        values: (val: Record<string, unknown>) => {
          if ("externalKey" in val) insertedDeals.push(val);
          return {
            returning: async () => [{ id: 1 }],
            onConflictDoNothing: async () => undefined,
          };
        },
      }),
      select: () => ({
        from: () => {
          selectIdx += 1;
          // 1: shows
          if (selectIdx === 1) {
            return Promise.resolve([
              {
                id: 1,
                kopisId: "PF1",
                title: "뮤지컬 영웅",
                normalizedTitle: "영웅",
                posterUrl: null,
                synopsisImageUrl: null,
                channelLinksJson: null,
                venueName: "세종문화회관",
                region: "서울특별시",
                subRegion: "SEOUL_OTHER",
                startDate: "2026-11-01",
                endDate: "2027-01-31",
                status: "ONGOING",
              },
              {
                id: 2,
                kopisId: "PF2",
                title: "뮤지컬 종료작",
                normalizedTitle: "종료작",
                posterUrl: null,
                synopsisImageUrl: null,
                channelLinksJson: null,
                venueName: "충무아트센터",
                region: "서울특별시",
                subRegion: "SEOUL_OTHER",
                startDate: "2025-01-01",
                endDate: "2025-12-31",
                status: "ENDED",
              },
            ]);
          }
          // 2: showActors
          if (selectIdx === 2) return Promise.resolve([]);
          // 3+: deals lookup by externalKey
          return {
            where: () => ({
              limit: async () => [],
            }),
          };
        },
      }),
      update: () => ({
        set: (val: Record<string, unknown>) => {
          updatedTables.push(val);
          return { where: async () => undefined };
        },
      }),
    } as unknown as Parameters<typeof runChannelAdapter>[0];

    const adapter: ChannelSyncAdapter = {
      sourceName: "TEST_CH",
      async fetchDrafts() {
        return [
          // 1. Low-confidence match (no place hint -> 0.80 < 0.85) -> DRAFT and MUST NOT backfill shows.channelLinksJson
          {
            externalKey: "k-low",
            channelName: "테스트",
            showTitle: "영웅",
            dealType: "TIMESALE",
            basePrice: 100000,
            salePrice: 70000,
            externalUrl: "https://nol.yanolja.com/ticket/products/26000001",
            posterUrl: "https://example.com/poster.jpg",
          },
          // 2. forceDraft (e.g. L.TICKET) with directShowId -> MUST stay DRAFT
          {
            externalKey: "k-forced-draft",
            channelName: "엘티켓",
            directShowId: 1,
            showTitle: "영웅",
            dealType: "DISCOUNT_SITE",
            basePrice: 100000,
            salePrice: 50000,
            isUnconditional: false,
            forceDraft: true,
            externalUrl: "https://www.l-ticket.co.kr/product/detail/142",
          },
          // 3. Already expired deal -> MUST be skipped
          {
            externalKey: "k-expired",
            channelName: "테스트",
            directShowId: 1,
            showTitle: "영웅",
            dealType: "TIMESALE",
            basePrice: 100000,
            salePrice: 70000,
            expiresAt: "2026-11-01T00:00:00.000Z",
            externalUrl: "https://example.com/expired",
          },
        ];
      },
    };

    const res = await runChannelAdapter(mockDb, adapter, new Date("2026-11-27T03:00:00.000Z"));
    expect(res.status).toBe("SUCCESS");
    expect(insertedDeals).toHaveLength(2);
    expect(insertedDeals[0]).toMatchObject({ externalKey: "k-low", status: "DRAFT" });
    expect(insertedDeals[1]).toMatchObject({ externalKey: "k-forced-draft", status: "DRAFT" });
    // Ensure shows.channelLinksJson / posterUrl was NOT mutated by low-confidence or forceDraft items
    expect(updatedTables.some((u) => "channelLinksJson" in u || "posterUrl" in u)).toBe(false);
  });

  it("expires non-normalized expiresAt, past eventDatesJson, and deals on KOPIS-ended shows", async () => {
    const expiredIds: number[] = [];
    let selectIdx = 0;

    const mockDb = {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [],
          }),
        }),
      }),
      select: () => ({
        from: () => {
          selectIdx += 1;
          if (selectIdx === 1) {
            // Deals on already-ENDED shows
            return {
              innerJoin: () => ({
                where: async () => [{ id: 101, showId: 10 }],
              }),
            };
          }
          // Dated active deals: non-normalized KST string + past eventDatesJson + future deal
          return {
            where: async () => [
              { id: 102, showId: 11, expiresAt: "2026-11-26 23:59:59", eventDatesJson: null },
              { id: 103, showId: 11, expiresAt: null, eventDatesJson: '["2026-11-20","2026-11-25"]' },
              { id: 104, showId: 11, expiresAt: "2026-12-31T14:59:59.000Z", eventDatesJson: '["2026-12-01"]' },
            ],
          };
        },
      }),
    } as unknown as Parameters<typeof expireEndedDeals>[0];

    // Spy update calls to count expired deal updates (after show update #1)
    let updateCall = 0;
    (mockDb as unknown as { update: unknown }).update = () => ({
      set: (val: Record<string, unknown>) => ({
        where: () => {
          updateCall += 1;
          if (updateCall === 1) return { returning: async () => [] };
          if (val.status === "EXPIRED") expiredIds.push(updateCall);
          return Promise.resolve();
        },
      }),
    });

    const res = await expireEndedDeals(mockDb, new Date("2026-11-27T03:00:00.000Z"));
    expect(res.expiredDeals).toBe(3); // 101 (ended show) + 102 (non-normalized expiresAt) + 103 (past eventDatesJson)
    expect(expiredIds).toHaveLength(3);
  });

  it("preserves existing DAEHAKRO subRegion and posterUrl when KOPIS re-sync skips detail fetch", async () => {
    const updatedSets: Array<Record<string, unknown>> = [];
    const listXml = `<dbs><db><mt20id>PF_DH</mt20id><prfnm>대학로 뮤지컬</prfnm><prfpdfrom>2026.11.01</prfpdfrom><prfpdto>2027.01.31</prfpdto><fcltynm>소극장 A</fcltynm><area>서울특별시</area><prfstate>공연중</prfstate></db></dbs>`;
    const fakeFetch = vi.fn(async () => new Response(listXml, { status: 200 })) as unknown as typeof fetch;

    const mockDb = {
      insert: () => ({
        values: () => ({ returning: async () => [{ id: 1 }], onConflictDoNothing: async () => undefined }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                id: 9,
                kopisId: "PF_DH",
                posterUrl: "https://www.kopis.or.kr/existing.jpg",
                subRegion: "DAEHAKRO",
                basePricesJson: '{"ALL":50000}',
                venueAddress: "서울 종로구",
                channelLinksJson: '{"nol":"26000001"}',
                synopsisImageUrl: "https://www.kopis.or.kr/syn.jpg",
              },
            ],
          }),
        }),
      }),
      update: () => ({
        set: (val: Record<string, unknown>) => {
          updatedSets.push(val);
          return { where: async () => undefined };
        },
      }),
    } as unknown as Parameters<typeof syncKopisShows>[0];

    const res = await syncKopisShows(mockDb, "test-key", new Date("2026-11-27T00:00:00Z"), {
      maxPages: 1,
      fetchFn: fakeFetch,
    });
    expect(res.status).toBe("SUCCESS");
    expect(res.detailFetchCount).toBe(0);
    const showUpdate = updatedSets.find((s) => "subRegion" in s);
    expect(showUpdate?.subRegion).toBe("DAEHAKRO");
    expect(showUpdate?.posterUrl).toBe("https://www.kopis.or.kr/existing.jpg");
  });

  it("stops immediately on Gemini 429 without falling back to 2nd model or failing queued OCR jobs", async () => {
    // 1. Vision extractor must NOT fall back to 2nd model on 429
    let fetchCalls = 0;
    const rateLimitedFetch = vi.fn(async () => {
      fetchCalls += 1;
      return new Response("quota exceeded", { status: 429 });
    }) as unknown as typeof fetch;

    const extractor = createGeminiVisionExtractor("test-key", rateLimitedFetch);
    await expect(extractor(new Uint8Array([1, 2, 3]).buffer, "image/png")).rejects.toThrow("429");
    expect(fetchCalls).toBe(1);

    // 2. processPendingOcrJobs must pause batch on 429, requeue without [retry:N], and skip job #2
    const jobUpdates: Array<Record<string, unknown>> = [];
    let selectIdx = 0;
    const mockDb = {
      select: () => ({
        from: () => {
          selectIdx += 1;
          if (selectIdx === 1) return { where: async () => [] }; // stale PROCESSING
          if (selectIdx === 2) return { where: async () => [{ count: 0 }] }; // daily usage
          if (selectIdx === 3) {
            return {
              where: () => ({
                orderBy: () => ({
                  limit: async () => [
                    {
                      id: 501,
                      showId: 1,
                      sourceChannel: "NOL",
                      sourcePageUrl: "https://tickets.interpark.com/goods/1",
                      imageUrl: "https://cdn.example.com/notice1.png",
                      errorMessage: "[retry:3] prior 503",
                    },
                    {
                      id: 502,
                      showId: 1,
                      sourceChannel: "NOL",
                      sourcePageUrl: "https://tickets.interpark.com/goods/2",
                      imageUrl: "https://cdn.example.com/notice2.png",
                      errorMessage: null,
                    },
                  ],
                }),
              }),
            };
          }
          if (selectIdx === 4) return { where: () => ({ limit: async () => [] }) }; // dup hash
          return {
            where: () => ({
              limit: async () => [
                { title: "테스트", startDate: "2026-11-01", endDate: "2026-12-31", status: "ONGOING", basePricesJson: null },
              ],
            }),
          };
        },
      }),
      update: () => ({
        set: (val: Record<string, unknown>) => {
          jobUpdates.push(val);
          return {
            where: () => ({
              returning: async () => [{ id: 501 }],
            }),
          };
        },
      }),
    } as unknown as Parameters<typeof processPendingOcrJobs>[0];

    const imgFetch = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "image/png" } }),
    ) as unknown as typeof fetch;
    const throwingExtractor = vi.fn(async () => {
      throw new Error("Gemini Vision HTTP 429");
    });

    const out = await processPendingOcrJobs(mockDb, {
      dailyLimit: 100,
      extractor: throwingExtractor,
      fetchFn: imgFetch,
      interCallDelayMs: 0,
    });

    expect(out.skippedByLimit).toBe(true);
    expect(out.remainingDailyLimit).toBe(0);
    expect(throwingExtractor).toHaveBeenCalledTimes(1); // Job #2 was NOT attempted
    expect(jobUpdates.at(-1)).toMatchObject({ ocrStatus: "QUEUED" });
    expect(String(jobUpdates.at(-1)?.errorMessage)).not.toContain("[retry:");
  });
});
