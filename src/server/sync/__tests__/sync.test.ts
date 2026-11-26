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
  DEFAULT_CHANNEL_ADAPTERS,
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
  type ShowMatchCandidate,
} from "@/server/sync/channels";
import {
  classifyDiscountLabel,
  hasMeaningfulBenefit,
  isStatutoryDiscount,
  isStatutoryOnlyDiscount,
} from "@/server/sync/benefit-filter";
import { isKidsMusical } from "@/server/sync/kids-filter";
import { OcrExtractSchema } from "@/server/sync/ocr";

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
