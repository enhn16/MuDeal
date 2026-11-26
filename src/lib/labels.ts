import type { ConditionTag, DealType, SeatGrade, SubRegion } from "@/db/schema";
import type { HomeCategory } from "@/server/modules/shows";

export const HOME_CATEGORY_LABELS: Record<HomeCategory, string> = {
  DISCOUNT: "할인",
  PERK: "특전",
  EVENT: "싱어롱·특별 커튼콜",
};

export const SUB_REGION_LABELS: Record<SubRegion, string> = {
  DAEHAKRO: "서울 · 대학로(혜화)",
  SEOUL_OTHER: "서울 (대극장·기타)",
  GYEONGGI_INCHEON: "경기 · 인천",
  BUSAN: "부산",
  DAEGU: "대구",
  DAEJEON_CHUNGCHEONG: "대전 · 충청",
  GWANGJU_JEOLLA: "광주 · 전라",
  GANGWON_JEJU: "강원 · 제주",
};

export const SUB_REGION_SHORT: Record<SubRegion, string> = {
  DAEHAKRO: "대학로",
  SEOUL_OTHER: "서울",
  GYEONGGI_INCHEON: "경기·인천",
  BUSAN: "부산",
  DAEGU: "대구",
  DAEJEON_CHUNGCHEONG: "대전·충청",
  GWANGJU_JEOLLA: "광주·전라",
  GANGWON_JEJU: "강원·제주",
};

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  TIMESALE: "타임세일",
  LOTTERY: "로터리",
  DISCOUNT_SITE: "할인사이트",
  CARD_EVENT: "카드·제휴",
  SPECIAL_DAY: "스페셜 데이",
  SINGALONG: "싱어롱",
  CURTAIN_CALL: "커튼콜",
  PERK_GOODS: "굿즈·특전",
};

export const CONDITION_TAG_LABELS: Record<ConditionTag, string> = {
  MATINEE: "마티네",
  REWATCH: "재관람",
  YOUTH_STUDENT: "청년·학생",
  OFFICE_WORKER: "직장인",
  CARD_PARTNER: "카드·제휴",
};

export const SEAT_GRADE_LABELS: Record<SeatGrade, string> = {
  VIP: "VIP석",
  R: "R석",
  S: "S석",
  A: "A석",
  ALL: "전석",
};

export const EVENT_DEAL_TYPES = new Set<DealType>([
  "SINGALONG",
  "CURTAIN_CALL",
  "PERK_GOODS",
]);

/** Role-mapped badge classes strictly within 5-tier wine + champagne gold + warm neutral. */
export function dealBadgeClass(dealType: DealType, isUnconditional: number | boolean): string {
  if (dealType === "LOTTERY" || dealType === "PERK_GOODS") {
    return "border border-champagne-gold bg-gold-wash text-on-surface";
  }
  if (dealType === "TIMESALE") {
    return "bg-urgent-wash text-urgent";
  }
  if (dealType === "SINGALONG" || dealType === "CURTAIN_CALL" || isUnconditional) {
    return "bg-rose-mist text-primary";
  }
  return "bg-surface-sunken text-on-surface-variant";
}
