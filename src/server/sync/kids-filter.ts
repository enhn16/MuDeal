const KIDS_TITLE_KEYWORDS = [
  "어린이",
  "가족뮤지컬",
  "가족 뮤지컬",
  "키즈",
  "베베핀",
  "헬로카봇",
  "티니핑",
  "뽀로로",
  "핑크퐁",
  "티시 태시",
  "아기돼지",
  "꼬마돼지",
  "잭과 콩나무",
  "흥부 놀부",
  "흥부놀부",
  "빨간 모자",
  "빨간모자",
  "성냥팔이 소녀",
  "혹부리 영감",
  "라푼젤",
  "백설공주",
  "피노키오",
  "신데렐라",
  "미녀와 야수",
  "미녀와야수",
  "피리부는 사나이",
  "호두까기",
  "오즈의 크리스마스",
  "오즈의마법사",
  "오즈의 마법사",
  "피터래빗",
  "별주부",
  "수리수리 마수리",
  "장수탕 선녀님",
  "알사탕",
  "마하랑 떠나요",
  "루돌프",
  "터치 파이브",
  "어른동생",
  "라이온 킹 [광명]",
  "겨울왕국: 겨울이야기",
  "겨울왕국 [성남]",
  "AI세계에서 살아남기",
  "타키포오",
  "배고픈 애벌레",
  "100층짜리 집",
  "과학마술",
  "멜로우TV",
  "명화배달부",
  "고래밥",
];

const KIDS_VENUE_KEYWORDS = [
  "어린이극장",
  "어린이소극장",
  "어린이대공원",
  "어린이문화회관",
  "레미어린이",
  "가족극장",
  "상상나라극장",
  "상상플레이스",
  "롯데마트",
  "뉴코아소극장",
  "NC소극장",
  "동아백화점",
  "잡월드",
  "과학체험관",
];

const KIDS_PRODUCER_KEYWORDS = [
  "마니마니",
  "할리퀸크리에이션즈",
  "극단레미",
  "극단 온누리",
  "극단 돼지",
  "브러쉬씨어터",
  "지니아트랩",
  "하쿠나마타타",
];

/** Heuristic fallback for excluding children's/family musicals when KOPIS kidstate=Y is unavailable (e.g. Excel/channels). */
export function isKidsMusical(
  title: string,
  venueName?: string | null,
  producer?: string | null,
): boolean {
  const t = title.trim();
  const v = (venueName ?? "").trim();
  const p = (producer ?? "").trim();

  if (KIDS_TITLE_KEYWORDS.some((k) => t.includes(k))) return true;
  if (v && KIDS_VENUE_KEYWORDS.some((k) => v.includes(k))) return true;
  if (p && KIDS_PRODUCER_KEYWORDS.some((k) => p.includes(k))) return true;
  return false;
}
