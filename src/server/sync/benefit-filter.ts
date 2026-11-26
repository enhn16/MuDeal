import type { DealType } from "@/db/schema";
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
];

const EVENT_OR_PERK_TYPES = new Set<DealType>(["PERK_GOODS", "SINGALONG", "CURTAIN_CALL", "LOTTERY"]);

/** Returns true if the text describes only baseline statutory/welfare discounts (e.g. 국가유공자/장애인/경로우대). */
export function isStatutoryOnlyDiscount(text: string | null | undefined): boolean {
  const s = (text ?? "").trim();
  if (!s) return false;
  const hasStatutory = STATUTORY_DISCOUNT_KEYWORDS.some((k) => s.includes(k));
  if (!hasStatutory) return false;
  const hasSpecial = SPECIAL_PROMO_KEYWORDS.some((k) => s.includes(k));
  return !hasSpecial;
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

  if (isStatutoryOnlyDiscount(input.conditionSummary)) {
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
