import type { ConditionTag, DealType } from "@/db/schema";
import { calcDiscountRate } from "@/lib/pricing";

const STATUTORY_DISCOUNT_KEYWORDS = [
  "국가유공자",
  "국가 유공자",
  "독립유공자",
  "유공자",
  "장애인",
  "장애 할인",
  "장애할인",
  "복지할인",
  "복지 할인",
  "복지카드",
  "복지 카드",
  "경로우대",
  "경로할인",
  "경로 할인",
  "보훈",
  "의사상자",
  "임산부",
  "다자녀",
  "문화누리",
  "기초생활",
  "차상위",
];

const SPECIAL_PROMO_KEYWORDS = [
  "타임세일",
  "타임특가",
  "로터리",
  "조기예매",
  "얼리버드",
  "프리뷰",
  "마티네",
  "재관람",
  "수험생",
  "학생",
  "청년",
  "군인",
  "직장인",
  "카드",
  "제휴",
  "커플",
  "패키지",
  "무조건",
  "특전",
  "굿즈",
  "포토카드",
  "싱어롱",
  "커튼콜",
  "스페셜",
  "슈가",
  "예스24데이",
  "yes24데이",
  "넵프라이즈",
  "엔젤티켓",
  "예스특가",
];

const EVENT_OR_PERK_TYPES = new Set<DealType>(["PERK_GOODS", "SINGALONG", "CURTAIN_CALL", "LOTTERY"]);

/** Returns true if a discount label refers to statutory/welfare discounts (always excluded from MuDeal). */
export function isStatutoryDiscount(text: string | null | undefined): boolean {
  const s = (text ?? "").trim();
  if (!s) return false;
  return STATUTORY_DISCOUNT_KEYWORDS.some((k) => s.includes(k));
}

/** Returns true if the text describes only baseline statutory/welfare discounts (e.g. 국가유공자/장애인/경로우대). */
export function isStatutoryOnlyDiscount(text: string | null | undefined): boolean {
  const s = (text ?? "").trim();
  if (!s) return false;
  const hasStatutory = STATUTORY_DISCOUNT_KEYWORDS.some((k) => s.includes(k));
  if (!hasStatutory) return false;
  const lower = s.toLowerCase();
  const hasSpecial = SPECIAL_PROMO_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
  return !hasSpecial;
}

export interface DiscountClassification {
  isStatutory: boolean;
  dealType: DealType;
  isUnconditional: boolean;
  conditionTags: ConditionTag[];
  conditionSummary: string;
}

/**
 * Deterministic 3-tier discount classifier for ticketing price tables (NOL, YES24, L.TICKET, OCR).
 * - STATUTORY: welfare/veteran/disability/senior discounts -> excluded completely.
 * - CONDITIONAL: matinee, military, student/exam, office worker, rewatch, local resident, package, card, proof-required.
 * - UNCONDITIONAL: open to any buyer without identity/schedule/proof restrictions (earlybird, preview, timesale, special-day, etc.).
 */
export function classifyDiscountLabel(rawLabel: string, extraHints: string[] = []): DiscountClassification {
  const cleanedLabel = rawLabel.replace(/^\s*-\s*/, "").replace(/\s+/g, " ").trim();
  const combined = [cleanedLabel, ...extraHints].filter(Boolean).join(" ");

  if (isStatutoryDiscount(cleanedLabel)) {
    return {
      isStatutory: true,
      dealType: "DISCOUNT_SITE",
      isUnconditional: false,
      conditionTags: [],
      conditionSummary: cleanedLabel,
    };
  }

  const tags: ConditionTag[] = [];
  const addTag = (tag: ConditionTag) => {
    if (!tags.includes(tag)) tags.push(tag);
  };

  if (/마티네|낮\s*공연|낮공|평일\s*낮/i.test(combined)) {
    addTag("MATINEE");
  }
  if (/군인|장병|현역|국군|의무복무|경찰|소방|공무원|군무원/i.test(combined)) {
    addTag("MILITARY_PUBLIC");
  }
  if (/청소년|학생|초중고|대학생|수험생|수험표|청년|문화패스|만\s*24세/i.test(combined)) {
    addTag("YOUTH_STUDENT");
  }
  if (/직장인|사원증|명함/i.test(combined)) {
    addTag("OFFICE_WORKER");
  }
  if (/재관람|이전\s*시즌|유료\s*티켓|레퍼토리|마니아|할인권\s*소지|실물\s*할인권|쿠폰\s*소지|패밀리(?!세일)/i.test(combined)) {
    addTag("REWATCH");
  }
  if (/지역|거주자|근무자|구민|시민|도민/i.test(combined)) {
    addTag("LOCAL_RESIDENT");
  }
  if (/패키지|[2-9]\s*인\s*(?:할인|패키지|예매|관람)|커플|단체|가족\s*할인/i.test(combined)) {
    addTag("GROUP_PACKAGE");
  }
  if (/카드|제휴|멤버십|토스페이|네이버페이|카카오페이|신한|현대|삼성|국민|우리|하나|롯데카드/i.test(combined)) {
    addTag("CARD_PARTNER");
  }
  if (
    /드레스\s*코드|생일|SNS|팔로우|인증|소지자|증빙|지참|본인만|본인한정|확인필수/i.test(combined) &&
    tags.length === 0
  ) {
    addTag("EVENT_CONDITION");
  }

  let dealType: DealType = "DISCOUNT_SITE";
  if (/로터리/i.test(combined)) {
    dealType = "LOTTERY";
  } else if (/슈가\s*day|슈가데이|yes24\s*데이|예스24\s*데이|스페셜\s*데이/i.test(combined)) {
    dealType = "SPECIAL_DAY";
  } else if (
    /타임세일|타임특가|넵프라이즈|예스특가|네이버특가|엔젤티켓|놀특가|nol특가|개막\s*특가|오프닝\s*위크|프리뷰|조기예매|얼리버드|오픈\s*기념/i.test(
      combined,
    )
  ) {
    dealType = "TIMESALE";
  } else if (tags.length === 1 && tags[0] === "CARD_PARTNER") {
    dealType = "CARD_EVENT";
  }

  const isUnconditional = dealType !== "LOTTERY" && tags.length === 0;

  return {
    isStatutory: false,
    dealType,
    isUnconditional,
    conditionTags: tags,
    conditionSummary: cleanedLabel || extraHints.join(" · "),
  };
}

/** Ensures only meaningful special price discounts, lotteries, perks, or singalong/curtain-call events become deals. */
export function hasMeaningfulBenefit(input: {
  dealType: DealType;
  basePrice?: number | null;
  salePrice?: number | null;
  discountRate?: number | null;
  conditionSummary?: string | null;
  perkSummary?: string | null;
}): boolean {
  if (EVENT_OR_PERK_TYPES.has(input.dealType)) {
    return true;
  }

  if (isStatutoryDiscount(input.conditionSummary)) {
    return false;
  }

  const effectiveRate =
    input.discountRate ?? calcDiscountRate(input.basePrice ?? null, input.salePrice ?? null);

  if (effectiveRate !== null && effectiveRate > 0) {
    return true;
  }

  if (
    input.salePrice !== null &&
    input.salePrice !== undefined &&
    input.basePrice !== null &&
    input.basePrice !== undefined &&
    input.salePrice < input.basePrice
  ) {
    return true;
  }

  return false;
}
