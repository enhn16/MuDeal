# MuDeal Design System (Inspired by TimeTicket · Velvet Burgundy Edition)

> **Reference Analysis**: `https://timeticket.co.kr/`의 정보 구조, 5:7 포스터 중심 그리드, 따뜻한 뉴트럴 서피스, 멀티 레이어 엘리베이션, 모바일/데스크톱 전환 패턴을 기반으로 설계하고, 브랜드 메인 컬러를 **고급스러운 와인/버건디(Velvet Burgundy)** 계열과 **샴페인 골드(Champagne Gold)** 포인트로 재정의한 **MuDeal(뮤지컬 티켓 할인 비교 서비스)** 전용 디자인 시스템입니다.

---

## 1. Visual Theme & Atmosphere

MuDeal의 디자인 시스템은 **극장 벨벳 커튼의 품격과 타임커머스의 명료한 정보 밀도**를 결합한 **에디토리얼 티켓팅(Editorial Ticketing)** 스타일입니다. 차가운 무채색 회색 대신 **미세한 로즈·포슬린 톤이 감도는 따뜻한 뉴트럴 서피스**(`#ffffff` / `#fcf8f7` / `#f6efef` / `#eae0e1`) 위에, 대극장 커튼을 연상시키는 **5단계 와인·버건디(Velvet Burgundy)** 컬러 시스템을 역할별로 엄격하게 배치합니다.

원본 TimeTicket의 높은 탐색 효율성(`1100px` 컴팩트 셸, 5:7 세로 포스터 중심의 고밀도 카드 그리드, 정가 대비 할인가의 즉각적 스캔 구조)은 그대로 계승하되, 경쾌한 코랄 레드(`#ff4b4b`)의 캐주얼함을 덜어내고 **절제된 딥 버건디(`#6E182B`) · 와인 액센트(`#8A1E37`) · 커튼 누아르(`#2B0D16`)**로 시각적 신뢰도와 프리미엄 무드를 끌어올립니다. **샴페인 골드(`#B89352`)**는 일반 장식색이 아니라 **로터리 티켓(NOL 로터리 등)·단독 최저가·별점** 같은 특별한 희소성 시그널에만 제한적으로 사용합니다.

타이포그래피는 **Pretendard Variable**을 전면에 배치해 한글 공연명·예매처명·좌석등급·할인율의 가독성을 극대화하며, 모든 숫자(할인율, 판매가, 정가 취소선, 평점, 캘린더 날짜, D-Day)에는 예외 없이 `font-variant-numeric: tabular-nums`를 적용해 가격 비교 시 세로 정렬이 흔들리지 않도록 합니다. 히어로 스포트라이트나 에디토리얼 배너의 극적 모멘트에만 세리프(`Noto Serif KR` / `Playfair Display`)를 제한적으로 허용해 대극장 프로그램북 같은 품격을 더합니다.

**Key Characteristics:**
- **5-Tier Wine / Burgundy 브랜드 시스템**: 단일 버건디를 남용하지 않고 Velvet Burgundy(브랜드 앵커) / Wine Accent(CTA·할인율) / Curtain Noir(다크 스포트라이트 밴드) / Mulberry(다크 보조) / Rosé Mist(소프트 틴트)를 서피스 역할별로 매핑
- **Champagne Gold 희소성 원칙**: 골드(`#B89352`)는 로터리 티켓, 최저가 1위 배지, 별점에만 사용 — 일반 강조색으로 남용 금지
- **웜 포슬린·블러시 뉴트럴 캔버스**: 순백(`#ffffff`) 캔버스에 차가운 `#f5f5f5` 대신 미세한 와인 언더톤이 섞인 `#fcf8f7` / `#f6efef` / `#eae0e1`을 층위별로 배치해 버건디 브랜드 컬러와 자연스럽게 융합
- **5:7 공연 포스터 중심 아키텍처**: 모든 포스터 카드에 `aspect-ratio: 5/7`, `8px` 라운드, `1px` 내부 헤어라인(`inset 0 0 0 1px rgba(9,9,11,0.06)`)을 적용해 흰 배경 포스터의 경계 붕괴를 방지
- **Pretendard Variable + Tabular Numbers**: 본문 `14px`, 타이트한 네거티브 자간(`-0.02em` ~ `-0.03em`)과 `tabular-nums`로 다중 예매처 가격 비교의 스캔 속도 최적화
- **TimeTicket형 멀티 덴시티 홈 리듬**: 3열 정사각 히어로 → 6열 마감임박 레일 → 5열 랭킹 그리드 → 50/50 비대칭 스플릿(신규 오픈 | 로터리·특가) → 3열 탭형 예매처별 리스트 → 다크 버건디 스포트라이트 밴드 → 2단 푸터
- **속삭이는 듯한 다층 엘리베이션**: 무거운 단일 그림자 대신 3겹 저불투명도(`0.03`~`0.06`) 링+드롭 섀도우와 은은한 버건디 CTA 글로우 사용

**Page Rhythm (Homepage Color-Block Flow):**
화이트 2단 헤더(`158px`, `--md-e1`) → 3열 정사각 히어로 캐러셀 → 화이트 캔버스 위 6열 마감임박 레일 & 5열 랭킹 그리드 → 50/50 비대칭 스플릿(신규 할인 | 로터리·초대) → **딥 커튼 누아르(`#2B0D16`) 스페셜 특가 밴드(Yes24데이·NOL 로터리 스포트라이트)** → 탭형 예매처/할인유형 리스트 → 4~5열 할인 카드 그리드 → 화이트 상단 + 웜 아이보리(`#fcf8f7`) 하단 2단 푸터.

---

## 2. Color Palette & Roles

**Source pages analyzed (`timeticket.co.kr`):** Homepage (`/`), Musical Category Listing (`/genre/musical`), Search Results (`/search/result?keyword=뮤지컬`), Musical Product Detail Page (`/product/4896`).

> **Color Adaptation Mapping**: TimeTicket 원본의 코랄 레드(`#ff4b4b`), 로즈 크림슨(`#e11d48`), 웜 블러시 뉴트럴(`#fcf5f4`/`#f6eeed`/`#eae3e2`) 구조를 계승하되, 브랜드 핵심 컬러를 고품격 **Wine / Burgundy** 팔레트로 전면 재설계하고, 과도한 보라색 그라데이션(원본 AI 요약 카드)은 시스템 일관성을 위해 **Rosé Mist + Champagne Gold** 에디토리얼 톤으로 정제했습니다.

### Primary (5-Tier Wine / Burgundy System)

- **Velvet Burgundy (`--md-primary`)** `#6E182B`: 브랜드의 중심이 되는 딥 와인 버건디. 워드마크 로고, 활성 내비게이션 언더라인(`3px`), 활성 탭 텍스트, 선택된 캘린더 날짜 원형, 주요 섹션 브랜드 앵커에 사용. (White 대비 명도비 `10.8:1` — WCAG AAA)
- **Wine Accent (`--md-accent`)** `#8A1E37`: Velvet Burgundy보다 한 톤 밝고 생동감 있는 주얼 와인. 주요 채움형 CTA 버튼(`최저가 예매처 보기`, `적용하기`, `알림 받기`), 카드 할인율(`%`), 활성 찜하기 하트, 활성 필터 보더에 사용. (White 대비 명도비 `8.2:1` — WCAG AAA)
- **Wine Accent Hover (`--md-accent-hover`)** `#72162C`: Primary CTA 및 인터랙티브 와인 요소의 hover/pressed 상태.
- **Curtain Noir (`--md-curtain`)** `#2B0D16`: 극장 벨벳 암막을 연상시키는 초심(Deep Merlot) 버건디. 풀와이드 스페셜 특가 밴드(Yes24데이/로터리 스포트라이트), 랭킹 넘버 태그, 다크 강조 패널, 고급 프로모션 섹션 배경에 사용.
- **Mulberry Uplift (`--md-mulberry`)** `#4A1525`: 다크 밴드(`#2B0D16`) 내부의 보조 카드 서피스, 구분선, 칩 배경 등 다크 톤 위에서의 층위 분리에 제한적으로 사용.
- **Rosé Mist (`--md-primary-soft`)** `#F9ECEF`: 연한 와인 블러시 워시. 활성화된 옵션·회차 버튼 배경, `D-Day` 배지 배경, 캘린더 호버 원형, 좋아요/선택 칩 배경에 사용. (보더 페어링: `#E6C4CC`)

### Secondary & Ceremony Accent (Champagne Gold)

- **Champagne Gold (`--md-gold`)** `#B89352`: **희소성·프리미엄 시그널 전용**. 별점 아이콘(`★`), `로터리 티켓` 배지 보더/텍스트, `역대 최저가` 인증 배지, 다크 밴드(`#2B0D16`) 위 하이라이트 텍스트에만 사용. 일반 버튼이나 링크에 사용하지 않음.
- **Gold Soft (`--md-gold-soft`)** `#DFC89F`: 다크 커튼 누아르 서피스 위 보조 골드 라인, 아이콘, 미세 구분선.
- **Gold Wash (`--md-gold-wash`)** `#FAF6EE`: 로터리/단독 제휴 특가 카드, 에디토리얼 요약 박스 배경 워시.

### Urgent Deal & Channel Accents

- **Ruby Urgent (`--md-timesale`)** `#A81B3A`: `타임세일`, `오늘 마감`, `YES24데이` 등 시급한 특가 칩 및 쿠폰 버튼에 사용 (원본 `#e11d48`의 역할을 버건디 톤과 이질감 없이 계승).
- **Ruby Soft (`--md-timesale-soft`)** `#FBE9ED`: `타임세일` / `마감임박` 필 배지 배경.
- **Community Pick Tag (`--md-community`)** `#6E182B` on `#F9ECEF` (Border `#E6C4CC`): **"제보해주신 딜"** 섹션 카드에 표시되는 제보자 닉네임 배지(`○○님 제보`) 및 `도움이 됐어요` 반응 필.
- **Actor Follow Pill**: 팔로우 전 `#FFFFFF` + `1px solid #EAE0E1` (`#534649` 텍스트), 팔로우 중 `#F9ECEF` + `1px solid #8A1E37` (`#6E182B` 텍스트 + 채움 하트/별).
- **Stage Event Plum (`--md-event`)** `#6E182B` on `#F9ECEF` (Border `#E6C4CC`): `싱어롱 데이`, `커튼콜 데이` 등 공연장 현장 이벤트 배지 (와인 톤으로 통일).
- **Perk / Goods Gold (`--md-gold`)** `#B89352` on `#FAF6EE` (Border `#DFC89F`): `굿즈·특전 증정(포토카드/스페셜 티켓)`, `로터리 티켓`, `최저가 1위` 등 희소 혜택 배지.
- **Indigo Open (`--md-new`)** `#3B52B8`: `NEW`, `오늘 오픈`, `티켓오픈 공지` 배지 및 2차 정보성 칩(예: 조건부 할인 안내 아이콘).
- **Indigo Soft (`--md-new-soft`)** `#EAEFFD`: `NEW` / `오늘 오픈` 필 배지 배경.

### Surface & Background (Warm Porcelain & Wine-Undertone Neutrals)

- **Pure Surface (`--md-surface`)** `#FFFFFF`: 기본 페이지 캔버스, 상품 카드, 헤더, 데스크톱 스티키 사이드바.
- **Porcelain Variant (`--md-surface-variant`)** `#FCF8F7`: 검색 입력창 필 배경, 카드/리스트 행 호버, 푸터 하단 사업자 정보 바, 스켈레톤 하이라이트.
- **Sunken Blush (`--md-surface-sunken`)** `#F6EFEF`: 포스터 로딩 플레이스홀더, 보조 칩, 상세페이지 가격 비교 요약 박스, 모바일 푸터 배경.
- **Sunken Deep (`--md-surface-sunken-2`)** `#EFE5E6`: 칩 호버 상태, 날짜 보조 칩, 중립 선택 영역.
- **Detail Outer Backdrop (`--md-backdrop`)** `#F6F4F4`: 상세/가격비교 페이지(PDP)의 좌우 외부 여백 배경(`1100px` 작업 영역을 부각).
- **Section Band Divider (`--md-band`)** `#F1ECEC`: 상세 페이지 내 섹션 간 `8px` (`0.5rem`) 구분 띠, 테이블 헤더, 타임라인 세로선.

### Borders & Dividers

- **Default Border (`--md-border`)** `#EAE0E1`: 내비게이션 하단선, 필터 필 테두리, 카드 리스트 행 구분선, 푸터 상단선, 드롭다운 외곽선.
- **Strong Border (`--md-border-strong`)** `#D2C5C7`: 세로 파이프(`|`) 구분자, `더보기` 버튼 테두리, 수량 스테퍼, 모달 그래버(grabber).
- **Subtle Hairline (`--md-hairline`)** `#F2ECEC`: FAQ 아코디언 행 구분선, 가격 비교표 내부 미세 행선.

### Neutrals & Text

- **Primary Ink (`--md-ink`)** `#1F1719`: 미세한 와인 기운을 품은 딥 차콜. 메인 제목, 할인가, 활성 내비게이션, 강조 본문에 사용(순수 `#000` 대신 사용해 따뜻한 캔버스와 조화).
- **Body Base (`--md-body`)** `#352D2F`: 기본 본문 텍스트 및 상세 페이지 설명 카피.
- **Secondary Ink (`--md-ink-2`)** `#534649`: 비활성 상단 내비게이션, 섹션 `더보기` 링크, 푸터 링크, 예매처 조건 보조 텍스트.
- **Muted Text (`--md-muted`)** `#736468`: 공연장명, 지역/장르 메타데이터, 리뷰 수, 서브타이틀, 수수료/조건 안내. (White 대비 `5.6:1` — WCAG AA 충족)
- **Hint & Strikethrough (`--md-hint`)** `#B3A6A9`: 검색창 플레이스홀더, **정가 취소선(`50,000원`)**, 메타 아이콘, 저작권 표기.
- **Text on Dark (`--md-ink-inverse`)** `#FFFFFF`: Curtain Noir(`#2B0D16`) 밴드 및 버건디 CTA 위 주 텍스트.
- **Text Soft on Dark (`--md-ink-inverse-soft`)** `rgba(255, 255, 255, 0.74)`: 다크 버건디 서피스 위 보조 설명·캡션.

### Semantic & Status

- **Success / Verified Lowest (`--md-success`)**: `#266D45` on `#EBF5EE` (실시간 가격 확인 완료, 무조건 할인 가능 상태)
- **Warning / Low Stock (`--md-warning`)**: `#8C6214` on `#FBF2E2` (잔여 매수 임박 예: `2매 남음`, 조건부 할인 주의)
- **Danger / Sold Out (`--md-danger`)**: `#B4232A` on `#FDECEC` (매진 제보, 폼 오류, 유효하지 않은 입력)
- **Saturday Blue (`--md-sat`)**: `#4366D9` (캘린더 토요일) / **Sunday Wine**: `#8A1E37` (캘린더 일요일·공휴일)

### Alpha Ladders & Scrims

- **Dark Overlay Scale**: `rgba(31, 23, 25, 0.04)` ~ `rgba(31, 23, 25, 0.85)` — 포스터 인셋 링(`0.06`), 찜하기 하트 비활성 채움(`0.24`), 모달 딤 백드롭(`0.42`), 히어로 하단 스크림(`0% → 38% → 78%`).
- **Light Overlay Scale**: `rgba(255, 255, 255, 0.12)` ~ `rgba(255, 255, 255, 0.90)` — 다크 커튼 누아르 밴드 위 아웃라인 버튼, 뱃지, 호버 레이어.

### Gradient Policy

- **구조적 서피스에는 그라데이션을 사용하지 않습니다.** (솔리드 컬러 블록 원칙)
- 허용되는 예외는 딱 2가지입니다:
  1. **히어로 배너 하단 가독성 스크림**: `linear-gradient(180deg, rgba(31,23,25,0) 30%, rgba(31,23,25,0.38) 58%, rgba(43,13,22,0.82) 100%)`
  2. **상세 이미지 접힘 페이드**: `linear-gradient(180deg, rgba(255,255,255,0) 0%, #ffffff 100%)`
- TimeTicket 원본의 보라색 AI 요약 카드 그라데이션은 MuDeal에서 배제하고, **Gold Wash(`#FAF6EE`) + `1px solid #E8DEC8`** 기반의 정제된 에디토리얼 요약 카드로 대체합니다.

---

## 3. Typography Rules

### Font Family

- **Primary (UI & Data):** `"Pretendard Variable", "Pretendard", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif` — 자사 호스팅 서브셋 WOFF2 권장 (`font-weight: 45 920`). 한글·영문·숫자 밸런스가 뛰어나 공연명과 가격표에 최적화.
- **Editorial Serif (Spotlight Only):** `"Noto Serif KR", "Gowun Batang", Georgia, serif` — 다크 커튼 누아르(`#2B0D16`) 스페셜 특가 밴드 헤드라인이나 월간 기획전(예: "5월의 로터리 & 시크릿 딜") 타이틀에만 제한적으로 사용. 일반 카드·검색·가격표에는 절대 혼용하지 않음.
- **Numeric Feature:** 모든 가격, 할인율, 잔여석, 평점, 날짜 요소에 `font-variant-numeric: tabular-nums` 필수 적용.

### Hierarchy

Root font-size는 `16px` (`html { font-size: 16px }`), 기본 본문은 `0.875rem` (`14px`) / `line-height: 1.5`입니다.

| Role / Element | Desktop Size | Mobile Size | Weight | Line Height | Letter Spacing | Color Token |
|---|---|---|---|---|---|---|
| **Category / Page Title** | `1.5rem` (`24px`, 랜딩 대형 `2.25rem`/`36px`) | `1.375rem` (`22px`) | `700` | `1.2` | `-0.025em` | `--md-ink` |
| **Hero Banner Headline** | `clamp(1.125rem, 6.8cqw, 1.625rem)` (`18–26px`) | container query 동일 | `700` | `1.3` | `-0.02em` | `#ffffff` |
| **Hero Banner Subtitle** | `clamp(0.75rem, 4cqw, 1rem)` (`12–16px`) | container query 동일 | `500` | `1.4` | `normal` | `rgba(255,255,255,0.88)` |
| **Search Results Heading** | `1.375rem` (`22px`) | `1.25rem` (`20px`) | `600` | `1.35` | `-0.025em` | `--md-ink` |
| **Section Title** | `1.25rem` (`20px`) | `1.125rem` (`18px`) | `600` | `1.4` (`1.3` mob) | `-0.02em` | `--md-ink` |
| **PDP Show Title (H1)** | `1.25rem` (`20px`) | `1.25rem` (`20px`) | `700` | `1.35` | `-0.03em` | `--md-ink` |
| **PDP Section Title (H2)** | `1.125rem` (`18px`) | `1.125rem` (`18px`) | `700` | `1.35` | `-0.03em` | `--md-ink` |
| **Top Nav Links** | `1.125rem` (`18px`) | Bottom Tab `10px` | `600` | `1.2` | `0.01em` | `--md-ink-2` (`--md-ink` active) |
| **Top Nav Utility Chips** | `1rem` (`16px`) | N/A | `700` (특가) / `500` | `1.2` | `normal` | `--md-timesale` / `--md-ink-2` |
| **Search Input** | `0.9375rem` (`15px`) | `1rem` (`16px`) | `600` (`400` placeholder) | `1.25` | `-0.01em` | `--md-ink` (`--md-hint`) |
| **Card Title** | `0.9375rem` (`15px`, 4열 `16px`) | `0.875rem` (`14px`) | `500` (`600` 강조형) | `1.4` (`1.35` mob) | `-0.01em` | `--md-ink` |
| **Card Discount %** | `0.9375rem` (`15px`) | `0.8125rem` (`13px`) | `700` | `1.5` | `-0.01em` | `--md-accent` (`tabular-nums`) |
| **Card Sale Price** | `0.9375rem` (`15px`) | `0.8125rem` (`13px`) | `700` | `1.5` | `-0.01em` | `--md-ink` (`tabular-nums`) |
| **PDP Lowest Discount % / Price** | `1.25rem` (`20px`) | `1.125rem` (`18px`) | `700` | `1.25` | `-0.03em` | `--md-accent` / `--md-ink` |
| **Original Strikethrough Price** | `0.8125rem` (`13px`) | `0.75rem` (`12px`) | `400` | `1.4` | `-0.02em` | `--md-hint` (`line-through`) |
| **Venue / Metadata** | `0.8125rem` (`13px`) | `0.75rem` (`12px`) | `400` | `1.5` (`1.4` mob) | `normal` | `--md-muted` |
| **Badges / Channel / Promo Chips** | `0.75rem` (`12px`) | `0.6875rem` (`11px`) | `600` | `1.3` | `0` | Role-mapped |
| **Footer Links / Labels** | `0.8125rem` (`13px`) / `12px` tag | `0.8125rem` (`13px`) | `400` (`700` tag) | `1.5` | `0.12em` (uppercase tag) | `--md-ink-2` / `--md-ink` |

### Principles

- **타이트한 한글 헤드라인 트래킹**: `18px` 이상 제목과 대형 가격 숫자는 `-0.02em` ~ `-0.03em`을 적용해 시각적 밀도와 무게감을 확보합니다.
- **할인 정보의 즉각적 계층**: 홈/리스트 카드에서는 `[할인율%(Wine Accent 700)] [최저가(Ink 700)]`만 간결하게 노출하고, 정가 취소선(`--md-hint`)과 좌석별·예매처별 상세 가격대는 검색 가격비교 행 및 상세 페이지(PDP)에서 전개합니다.
- **광학 트림(Optical Trim) & 말줄임**: 카드 제목은 데스크톱 `2줄 클램프(-webkit-line-clamp: 2)`, 모바일 `1줄 말줄임`으로 행 높이를 일정하게 유지합니다.

### Note on Font Substitutes

- **Pretendard Variable**은 오픈소스(SIL OFL)로 CDN 또는 자체 호스팅이 가능합니다.
- 대체 폰트가 필요한 경우: **SUIT Variable** 또는 **Spoqa Han Sans Neo** (숫자 가독성 우수).
- Editorial Serif 대체: **Noto Serif KR**, **Gowun Batang**, 영문 전용 헤더에는 **Cormorant Garamond** 또는 **Playfair Display**.

---

## 4. Component Stylings

### Buttons

**1. Primary Filled CTA — "최저가 예매처 보기 / 적용하기 / 할인 알림 받기"**
- Background: `#8A1E37` (Wine Accent), Hover: `#72162C`
- Text: `#FFFFFF`, Font: `15px–16px`, Weight `600`, Letter-spacing `-0.01em`
- Height: `48px`–`50px` (`3rem`–`3.125rem`) for primary bar / modal actions; `36px` (`2.25rem`) for inline CTAs
- Radius: `8px` (`0.5rem`) for rectangular confirmation/booking buttons (`12px` in modal footer); `9999px` (full pill) for filter/nav/banner pills
- Shadow: `var(--md-shadow-cta)` (`0 1px 2px rgba(110,24,43,0.18), 0 4px 12px -2px rgba(110,24,43,0.22)`)
- Active state: `transform: scale(0.98)` (`transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1)`)
- Disabled state: Background `#D6CDD0`, Text `#FFFFFF`, Shadow none

**2. Secondary Outlined — "가격 전체보기 / 조건 상세"**
- Background: `#FFFFFF`, Hover: `#FCF8F7`
- Text: `#1F1719` (또는 브랜드 강조 시 `#6E182B`)
- Border: `1px solid #EAE0E1` (강조형 `1px solid #6E182B`)
- Radius: `10px` (`0.625rem`) or `8px` (`0.5rem`), Height: `44px`–`48px`

**3. Inverted on Dark Band — "오늘의 로터리 확인하기" (Curtain Noir `#2B0D16` 위)**
- Background: `#FFFFFF`, Text: `#6E182B`, Weight `700`
- Radius: `9999px` (full pill), Padding: `10px 22px`
- Secondary pair: Transparent bg, `#FFFFFF` text, `1px solid rgba(255,255,255,0.45)` border

**4. Filter Pill Chip (Listing & Search)**
- Height: `36px` (`2.25rem`), Padding: `0 16px`, Radius: `9999px`
- Default: `#FFFFFF` bg, `1px solid #EAE0E1`, Text `#534649`, `15px / 500`
- Hover: `#F6EFEF` bg
- Active (`.is-active`): `#F9ECEF` bg, `1px solid #8A1E37`, Text `#6E182B`, Weight `600`

**5. Square Icon Utility Button (찜하기 / 공유하기 — PDP)**
- Size: `44px × 44px` (`2.75rem`), Radius: `8px` (`0.5rem`), Border: `1px solid #EAE0E1`, Background: `#FFFFFF`
- Active Wish state: `#8A1E37` filled heart on `#F9ECEF` bg + `#E6C4CC` border

**6. Load More Button (`.md-more`)**
- Desktop Width: `320px` (`20rem`), Height: `48px` (`3rem`), Centered
- Background: `#FFFFFF` (Hover `#FCF8F7`), Border: `1px solid #D2C5C7`, Radius: `8px`

**7. Floating Scroll-Up / Quick Alert Button**
- Desktop: `56px × 56px` circular (`50%`, TimeTicket 원본 `70px` 대비 시각적 간섭 축소), Mobile: `48px × 48px`
- Background: `#FFFFFF` with `1px solid #EAE0E1` and `--md-e2` shadow (또는 Primary 강조 시 `#6E182B` fill + white chevron)
- Position: `fixed; bottom: 40px; right: 40px` (Mobile: `bottom: calc(76px + env(safe-area-inset-bottom)); right: 16px`)

### Navigation & Header

**Desktop Two-Tier Global Header (Total Height: `158px`)**
- Background: `#FFFFFF`, Elevation: `var(--md-e1)`
- **Tier 1 — Utility & Search Row (`max-width: 1100px`, `padding: 28px 0 4px`)**:
  - Left: MuDeal 워드마크 로고 (`width: 160px–192px`, Velvet Burgundy `#6E182B`)
  - Center/Right: **Full-Pill Search Bar** (`width: 300px–360px` — 검색 비교 핵심성을 위해 원본 `264px`에서 확장, `height: 44px`, `background: #FCF8F7`, hover `#F6EFEF`, `border-radius: 9999px`, focus `box-shadow: 0 0 0 1.5px #8A1E37, var(--md-e2)`) + 자동완성 드롭다운 (`border-radius: 12px`, `padding: 6px`, `var(--md-e2)`)
  - Far Right: `찜한 공연`, `할인 제보/로그인` 아이콘+라벨(`11px / 500`) 스택 버튼
- **Tier 2 — Category & Deal Bar (`max-width: 1100px`, `height: 68px`)**:
  - Left: 오늘 날짜 캘린더 아이콘(`36px`, 상단 `#6E182B` 밴드 + `#F6EFEF` 바디 + `tabular-nums` 일자) + 메인 메뉴 (`홈`, `4축 검색`, `티켓오픈 임박`, `제보해주신 딜`, `로터리·특가`, `싱어롱·특전` — 문구는 개발 중 유연 조정) — `18px / 600`, `gap: 18px`, 활성 탭 하단 `3px solid #6E182B` 인디케이터
  - Right: `할인 제보하기` 강조 필 (`height: 36px`, `border-radius: 9999px`, `#8A1E37` 텍스트, `#F9ECEF` 배경)

### Cards & Containers

**1. Ticket Show Card (`.md-card` — Home Rails, Ranking & Grids)**
- Background: Transparent over `#FFFFFF` canvas (카드 외곽 박스 대신 포스터 경계와 여백으로 구분 — TimeTicket 핵심 구조)
- **Poster Container**: `aspect-ratio: 5/7`, `border-radius: 8px`, `background: #F6EFEF`, `box-shadow: inset 0 0 0 1px rgba(31,23,25,0.06)`, 이미지 호버 시 `transform: scale(1.04)` (`0.2s cubic-bezier(0.4,0,0.2,1)`)
- **Overlay Elements**:
  - Top-left (랭킹 전용): `30px × 30px` Curtain Noir(`#2B0D16`) 라운드 코너 순위 태그 (`#FFFFFF` bold tabular-nums; 1~3위는 Champagne Gold `#DFC89F` 숫자)
  - Top-right: `28px` (모바일 `32px`) 찜하기 하트 버튼 (`#FFFFFF` 스트로크, `rgba(31,23,25,0.24)` 채움, 활성 시 `#8A1E37`)
- **Text Stack (`margin-top: 12px`, 내부 간격 `6px`–`8px`)**:
  1. 메타 행: `[서울·대학로]` 등 지역 태그 + `예매처 수(예: 4곳 비교)` (좌) + 핀 아이콘 + 공연장명 (우, `#736468`, `13px`)
  2. 공연명: `15px / 500` (`#1F1719`), 데스크톱 2줄 클램프 / 모바일 1줄
  3. 가격+배지 행: `45%` (`#8A1E37`, `700`) + `66,000원~` (`#1F1719`, `700`) + 할인·이벤트 칩 (`로터리`/`특전` 골드 / `싱어롱·커튼콜` 플럼 / `티켓오픈` 인디고)
  4. 시그널 행 (선택): `D-2 마감` (`#F9ECEF`·`#6E182B`), 또는 제보 딜 카드의 `○○님 제보 · 128명 확인 · 👍 24` (후기/별점은 MVP 제외)

**2. Price Comparison Row / Table (MuDeal 핵심 — 검색 & 상세 페이지)**
- TimeTicket 상세페이지의 `.detail-price-summary` 티어 리스트를 **다중 예매처 가격 비교 모듈**로 특화 확장
- Container: `#FFFFFF` 카드, `border: 1px solid #EAE0E1`, `border-radius: 12px`, `overflow: hidden`
- **Seat Grade Tabs**: 상단 `VIP / R / S / A / 전석` 필 또는 언더라인 탭 (`height: 44px`, 활성 시 `2px solid #6E182B`, `#6E182B` bold)
- **Lowest Price Summary Box**: `#F6EFEF` 배경, `padding: 16px`, `border-radius: 10px` — 일반 할인 최저가 vs 조건부/로터리 최저가를 분리 표기 (`정가 취소선 #B3A6A9` + `할인율 #8A1E37` + `최저가 #1F1719`)
- **Per-Channel Row**: `padding: 14px 16px`, `border-bottom: 1px solid #F2ECEC`, `display: flex; align-items: center; justify-content: space-between`
  - Left: 예매처 로고/배지(`유니켓`, `L티켓`, `NOL 로터리`, `Yes24`, `타임티켓`) + 할인 조건 칩(`무조건` `#EBF5EE/#266D45` vs `추첨/조건부` `#FBF2E2/#8C6214`) + 예매 수수료 표기(`12px #736468`)
  - Right: 할인율(`#8A1E37 700`) + 최종가(`#1F1719 700 tabular-nums`) + `예매처 이동 ↗` 아웃라인/와인 버튼 (`height: 34px`, `border-radius: 8px`) + 미세 `품절 제보` 텍스트 버튼
  - **Best Deal Row Highlight**: 1위 최저가 행은 좌측 `3px solid #B89352` (Champagne Gold) 액센트 + `#FAF6EE` 미세 배경 + `최저가` 골드 배지 부여

**3. Hero Carousel (`.md-banner`)**
- Desktop: `3`열 정사각 (`aspect-ratio: 1`), `gap: 20px`, `border-radius: 12px` (모바일 `16px`), 하단 다크 버건디 스크림 + 좌하단 헤드라인/서브카피
- Controls: `2px` 프로그레스 트랙(`#EAE0E1`) + `#6E182B` 활성 바(`min-width: 40px`) + `36px × 36px` 원형 이전/다음 버튼(`#FFFFFF`, `1px solid #EAE0E1`)

**4. Dark Spotlight Feature Band (Curtain Noir `#2B0D16`)**
- 풀와이드 `#2B0D16` 배경, 내부 `1100px` 컨테이너, `padding: 48px 0` (모바일 `36px 20px`)
- Left (60%): Champagne Gold(`#DFC89F`) 아이브로우 라벨(`SPECIAL LOTTERY · D-DAY`) + Editorial Serif `26px–32px` 화이트 헤드라인 + `rgba(255,255,255,0.74)` 설명 카피 + Inverted White Pill CTA + Outlined White Secondary CTA
- Right (40%): Mulberry(`#4A1525`) 프레임에 담긴 특가 공연 포스터 2~3종 스택 또는 카운트다운 카드

**5. Product Detail Page (PDP) Split Layout**
- Outer Canvas: `#F6F4F4` (`.detail-page-bg`), Inner Shell: `1100px` = Left `670px` + Gap `30px` + Right Sticky `400px` (`position: sticky; top: 20px; max-height: calc(100vh - 40px)`)
- **Blurred Poster Header**: `aspect-ratio: 700/320`, 블러 배경(`filter: blur(14px) brightness(0.65)`) + 좌측 `28.5%` 선명한 5:7 포스터(`border-radius: 6px`) + 우하단 스플릿 타임세일/로터리 배지
- **Sticky Right Panel**: `background: #FFFFFF`, `border: 1px solid #EAE0E1`, `border-radius: 12px` — 좌석등급 선택 칩 + 할인 조건 필터(`무조건만 보기` 토글) + 예매처별 실시간 가격 비교 리스트 + 하단 `최저가 예매처로 이동` (`#8A1E37`, `height: 50px`)
- **Single-Scroll Stacked Sections**: 탭 전환 없이 `8px` (`#F1ECEC`) 구분 띠로 스택 (`가격 비교표` → `현장 이벤트·특전 안내(싱어롱·커튼콜·굿즈)` → `출연 배우(팔로우)` → `공연장 정보(클릭 시 해당 공연장 작품 모아보기)`)

**6. Filter Modal & Sort Dropdown**
- **Filter Modal (Desktop)**: `max-width: 480px`, `border-radius: 20px`, `padding: 24px`, `box-shadow: 0 10px 40px rgba(31,23,25,0.20)`, Backdrop `rgba(31,23,25,0.42)` + `backdrop-filter: blur(2px)`. 내부 옵션 칩은 `border-radius: 24px` (`#F6EFEF` 기본 / `#8A1E37` 화이트 텍스트 선택) + 하단 풀와이드 `적용하기` CTA.
- **Sort Dropdown**: `min-width: 144px`, `border-radius: 12px`, `padding: 6px`, `border: 1px solid #EAE0E1`, `box-shadow: 0 8px 24px rgba(31,23,25,0.12)`. 항목 패딩 `10px 14px`, `border-radius: 8px`, 선택 항목 우측 `#6E182B` 체크마크.

### Image & Poster Treatment

- **5:7 공연 포스터**: `object-fit: cover`, `border-radius: 8px`, `#F6EFEF` 플레이스홀더, `inset 0 0 0 1px rgba(31,23,25,0.06)` 인셋 링 필수.
- **종료·마감 공연**: `filter: saturate(0); opacity: 0.55` + 중앙/좌상단 `마감` 다크 뱃지.
- **이미지 로드 트랜지션**: `opacity 0.25s ease-in` 페이드 인, 스켈레톤은 `#F6EFEF` → `#FCF8F7` 미세 쉬머.

---

## 5. Layout Principles

### Spacing System

`1rem = 16px` 기준의 4px/8px 배수 시맨틱 스케일입니다.

| Token | Rem | Pixels | Typical Use |
|---|---|---|---|
| `--space-1` | `0.25rem` | `4px` | 배지 내부 세로 여백, 아이콘-텍스트 초근접 간격 |
| `--space-2` | `0.5rem` | `8px` | 칩 간격, 포스터 라운드, PDP 섹션 구분 띠 |
| `--space-3` | `0.75rem` | `12px` | 카드 포스터-텍스트 간격, 모바일 카드 간격 |
| `--space-4` | `1rem` | `16px` | 기본 패딩, 가격 요약 박스 패딩, 필터 칩 좌우 |
| `--space-5` | `1.25rem` | `20px` | 데스크톱 그리드 열 간격(`gap`), 모바일 좌우 거터 |
| `--space-6` | `1.5rem` | `24px` | 모달 패딩, 비대칭 카드 내부 열 간격 |
| `--space-7` | `2rem` | `32px` | 히어로 상단 여백, PDP 좌우 컬럼 간격(`30px`~`32px`) |
| `--space-8` | `2.5rem` | `40px` | 그리드 행 간격(`row-gap`), 푸터 상하 패딩 |
| `--space-9` | `3.5rem` | `56px` | 모바일 섹션 간 간격 |
| `--space-10` | `4.5rem` | `72px` | 데스크톱 섹션 간 간격(`.md-sec`), 메인 하단 여백 |

### Grid & Container

- **Global Shell Width (`--md-shell`)**: `68.75rem` (`1100px`), 중앙 정렬(`margin: 0 auto`). `1440px` 뷰포트에서 좌우 약 `170px`의 여유로운 화이트 여백 형성.
- **Desktop Multi-Density Grids**:
  - **Hero Carousel**: `3`열 (`gap: 20px`)
  - **Horizontal Deal Rail (마감임박/오늘의 특가)**: `6`열 (`calc((100% - 100px) / 6)` ≈ `166.7px` 카드 폭, `gap: 20px`)
  - **Ranking & Category Grid**: `5`열 (`204px` 카드 폭, `gap: 40px 20px`)
  - **Search Results Grid**: `4`열 (`260px` 카드 폭, `gap: 40px 20px`) — 검색 시 가격·예매처 배지 정보가 많아 4열로 여유 확보
  - **Asymmetric Pair Split (신규 할인 | 로터리·특가)**: `1fr 1fr`, `column-gap: 64px`
  - **Channel/Regional Tabbed List**: `3`열, `column-gap: 40px`, 상단 `1px solid #EAE0E1` 행 구분선
  - **PDP Workspace**: `670px` (좌측 메인) + `30px` (갭) + `400px` (우측 스티키 가격비교/예매 패널)

### Whitespace Philosophy

- **카드는 박스로 가두지 않고 여백으로 숨 쉬게 합니다.** 홈과 리스트의 공연 카드에 외곽 테두리나 그림자를 두르지 않고, `20px` 열 간격과 `40px` 행 간격, 그리고 포스터의 `1px` 인셋 링만으로 깔끔한 시각적 질서를 만듭니다.
- 섹션 간 수직 여백을 데스크톱 `72px` / 모바일 `56px`로 넉넉히 두어, 고밀도 포스터 그리드가 답답해 보이지 않도록 리듬을 유지합니다.

### Border Radius Scale

| Value | Token | Use |
|---|---|---|
| `4px` (`0.25rem`) | `--radius-xs` | 소형 타임세일 스플릿 태그, 인라인 키보드/조건 뱃지 |
| `8px` (`0.5rem`) | `--radius-sm` | **5:7 공연 포스터**, 사각 액션 버튼, 더보기 버튼, 드롭다운 메뉴 항목 |
| `10px` (`0.625rem`) | `--radius-md` | 가격 요약 박스, 아웃라인 보조 버튼, 지도 임베드 컨테이너 |
| `12px` (`0.75rem`) | `--radius-lg` | **히어로 배너**, 검색 자동완성, 정렬 드롭다운, 가격비교 카드, 스티키 사이드바 |
| `20px` (`1.25rem`) | `--radius-xl` | 데스크톱 필터 모달 (`20px 20px 0 0` 모바일 바텀시트) |
| `9999px` | `--radius-pill` | 검색창, 필터 칩, 타임세일/할인유형 배지, 다크 밴드 CTA, 옵션 칩 |
| `50%` | `--radius-full` | 캐러셀 화살표, 찜하기 원형 버튼, 캘린더 선택일, 스크롤 업 버튼 |

---

## 6. Depth & Elevation

| Level | CSS Shadow Value | Use |
|---|---|---|
| **Poster Hairline** | `inset 0 0 0 1px rgba(31, 23, 25, 0.06)` | 모든 5:7 포스터 이미지 외곽 (밝은 포스터 경계 보호) |
| **Elevation 1 (`--md-e1`)** | `0 0 0 1px rgba(31,23,25,0.03), 0 1px 2px rgba(31,23,25,0.04), 0 1px 3px rgba(31,23,25,0.06)` | 글로벌 상단 헤더, 미세 리프트 카드 |
| **Elevation 2 (`--md-e2`)** | `0 0 0 1px rgba(31,23,25,0.04), 0 4px 8px -4px rgba(31,23,25,0.05), 0 12px 24px -8px rgba(31,23,25,0.08)` | 검색 자동완성 드롭다운, 헤더 팝오버, 포커스된 검색 필, 플로팅 버튼 |
| **Dropdown / Popover** | `0 8px 24px rgba(31, 23, 25, 0.12)` | 정렬 드롭다운(`.md-sort__menu`), 툴팁 |
| **Modal / Dialog** | `0 10px 40px rgba(31, 23, 25, 0.20)` | 필터 모달, 품절 제보/할인 상세 모달 |
| **Primary CTA Glow (`--md-shadow-cta`)** | `0 1px 2px rgba(110,24,43,0.18), 0 4px 12px -2px rgba(110,24,43,0.22)` | 와인 액센트 Primary 확인/예매 이동 CTA 버튼 |

**Shadow Philosophy:**
단일하고 탁한 회색 드롭 섀도우를 금지합니다. 미세한 `1px` 외곽 링과 2겹의 저불투명도 앰비언트 그림자를 겹쳐 종이 포스터와 극장 티켓이 자연광 아래 살짝 떠 있는 듯한 절제된 입체감을 구현합니다.

---

## 7. Do's and Don'ts

### Do
- **와인/버건디 5단계 역할 분리 준수**: 브랜드 앵커(`#6E182B`), CTA·할인율(`#8A1E37`), 다크 밴드(`#2B0D16`), 소프트 틴트(`#F9ECEF`)를 지정된 용도에 맞춰 사용
- **웜 포슬린·블러시 뉴트럴 사용**: 보조 배경과 구분선에 차가운 회색(`#f3f4f6`, `#e5e7eb`) 대신 `#FCF8F7`, `#F6EFEF`, `#EAE0E1`을 사용해 버건디와 온도를 맞춤
- **Champagne Gold(`#B89352`)의 희소성 유지**: 로터리 티켓, 역대 최저가 1위, 별점 등 "특별한 가치" 시그널에만 사용
- **모든 숫자에 `tabular-nums` 적용**: 할인율, 판매가, 정가 취소선, 잔여석, 캘린더 일자 정렬 일관성 보장
- **5:7 포스터에 `1px` 인셋 링 적용**: 흰 여백이 많은 뮤지컬 포스터가 흰 캔버스와 섞이지 않도록 보호
- **검색·상세에서 조건부 할인 명시**: 무조건 할인(`#266D45`)과 추첨/카드/재관람 조건부 할인(`#8C6214`)을 색상·라벨로 즉시 구분
- **모바일·데스크톱 전환을 표준 CSS 반응형으로 구현**: TimeTicket의 UA 분기(`is-web`/`is-mobile`) 한계를 개선해 모든 뷰포트에서 가로 스크롤 없이 자연스럽게 리플로우

### Don't
- **형광 레드/코랄(`#ff4b4b`, `#ff0000`) 혼입 금지**: 와인/버건디의 고급스러운 무드를 즉시 무너뜨림
- **단일 버건디로 모든 UI 칠하기 금지**: 헤더·카드·배지를 전부 `#6E182B`로 채우면 무겁고 답답해짐 — 화이트 캔버스 75%+, 웜 뉴트럴 15%, 와인/골드 10% 이내 비율 유지
- **보라/네온 그라데이션 남용 금지**: 원본 TimeTicket의 AI 요약 카드 같은 무지개/라벤더 그라데이션을 넣지 말고 솔리드 컬러 블록 유지
- **홈 카드에 과도한 텍스트 누적 금지**: 홈/그리드 카드에 정가 취소선·예매처 전체 목록·긴 할인 조건을 다 넣지 말고, 핵심(`[할인율] [최저가] [핵심 배지]`)만 노출 후 상세/비교 화면으로 유도
- **Editorial Serif 남용 금지**: 카드 제목, 내비게이션, 가격 비교표에는 무조건 `Pretendard Variable`만 사용
- **순수 블랙(`#000000`) 텍스트·그림자 사용 금지**: 와인 톤이 미세하게 섞인 `#1F1719` 잉크와 `rgba(31,23,25,...)` 그림자로 통일

---

## 8. Responsive Behavior

> **Architecture Improvement over TimeTicket**: TimeTicket은 UA 감지 기반 `body.is-web` / `body.is-mobile` 분기를 사용해 좁은 데스크톱 창에서 가로 스크롤이 발생합니다. MuDeal은 TimeTicket의 검증된 모바일 UI 패턴(52px GNB, 56px 하단 탭바, 3.2열 레일, 바텀시트, 하단 고정 CTA 바)을 **표준 CSS `@media` 브레이크포인트**로 구현합니다.

### Breakpoints

| Name | Width | Shell / Gutter | Grid & Navigation Changes |
|---|---|---|---|
| **Mobile (xs/sm)** | `< 640px` | `100%`, 좌우 패딩 `20px` | 상단 `52px` 미니 GNB + 하단 `56px` 고정 탭바; 5열 퀵 카테고리 아이콘; 히어로 `calc(100% - 60px)` 슬라이드 + 우상단 카운터 필; 가로 레일 `3.2`열(`gap: 10px`); 기본 그리드 `2`열(`gap: 20px 12px`); 검색/리스트는 단일 열 가로형 리스트 카드(`104px` 5:7 포스터) 전환 가능 |
| **Tablet (md)** | `640px–1023px` | `100%`, 좌우 패딩 `24px` | 상단 1단 검색 포함 헤더; 히어로 `2`열; 기본 그리드 `3`열; PDP는 단일 컬럼 스택 + 하단 고정 `buy-bar` 유지 |
| **Desktop Compact (lg)** | `1024px–1199px` | `100%` (`padding: 0 24px`) | 2단 데스크톱 헤더 전환; 히어로 `3`열; 랭킹/카테고리 `4`열; PDP 좌우 스플릿 활성화 (`1fr + 340px` 스티키) |
| **Desktop Standard (xl)** | `1200px+` | `1100px` (`68.75rem`) 중앙 고정 | 풀 스펙 적용: 6열 마감임박 레일, 5열 랭킹/장르 그리드, 4열 검색 결과, `670px + 30px + 400px` PDP 스플릿 |

### Touch Targets & Mobile Ergonomics

- 모바일 하단 탭바: `height: 56px + env(safe-area-inset-bottom)`, 상단 `1px solid #EAE0E1`, 미세 그림자 `0 -1px 4px rgba(31,23,25,0.06)`, 탭당 `22px` 아이콘 + `10px` 라벨 (활성 `#6E182B`, 비활성 `#736468`).
- 모바일 찜하기 하트: `32px × 32px` 이상(터치 영역 `44px` 확장), 모든 필터 필 및 CTA 버튼 최소 높이 `44px` 권장.
- 모바일 필터/정렬: 데스크톱 중앙 모달(`480px`) 대신 하단 고정 **바텀시트**(`border-radius: 20px 20px 0 0`, 상단 `36px × 4px` `#D2C5C7` 그래버)로 전환.
- 모바일 PDP: 우측 스티키 사이드바를 숨기고, 하단 고정 **`.md-buy-bar`** (`padding: 12px 16px`, `border-top: 1px solid #EAE0E1`, 찜/공유 `44px` 버튼 + 풀와이드 `#8A1E37` `50px` `예매처 가격 비교하기` CTA)를 노출해 탭 시 풀스크린 가격비교 시트를 오픈.

### Image & Motion Behavior

- `@media (prefers-reduced-motion: reduce)` 감지 시 포스터 `scale(1.04)` 줌, 캐러셀 트랜지션, 스켈레톤 애니메이션을 즉시 비활성화.
- `@media (hover: hover)` 내부에만 포스터 호버 줌과 카드 배경 하이라이트를 적용해 모바일 터치 시 잔상(sticky hover) 방지.

---

## 9. Agent Prompt Guide

### Quick Color Reference

- **Brand Anchor / Active Tab**: Velvet Burgundy (`#6E182B`)
- **Primary CTA / Discount %**: Wine Accent (`#8A1E37`) · Hover (`#72162C`)
- **Dark Spotlight Band**: Curtain Noir (`#2B0D16`) · Inner Surface: Mulberry (`#4A1525`)
- **Soft Active Tint**: Rosé Mist (`#F9ECEF`) · Border (`#E6C4CC`)
- **Ceremony / Lottery / Star / #1 Lowest**: Champagne Gold (`#B89352`) · Soft (`#DFC89F`) · Wash (`#FAF6EE`)
- **Urgent Timesale / D-Day**: Ruby Urgent (`#A81B3A`) on Ruby Soft (`#FBE9ED`)
- **Page Canvas**: Pure White (`#FFFFFF`)
- **Warm Neutral Surfaces**: Porcelain (`#FCF8F7`) / Sunken Blush (`#F6EFEF`) / Sunken Deep (`#EFE5E6`)
- **Borders**: Default (`#EAE0E1`) / Strong (`#D2C5C7`)
- **Text**: Primary Ink (`#1F1719`) / Secondary (`#534649`) / Muted (`#736468`) / Hint & Strikethrough (`#B3A6A9`)

### Example Component Prompts

1. **Global Two-Tier Header**:
   > "Build MuDeal's desktop two-tier header (`158px` total height, `#FFFFFF` background, `--md-e1` shadow) centered at `1100px` max-width. Top row: Velvet Burgundy (`#6E182B`) wordmark on the left, a `340px × 44px` full-pill search input (`#FCF8F7` bg, `#B3A6A9` placeholder '뮤지컬, 공연장, 할인 이벤트 검색', focus ring `1.5px #8A1E37`), and right utility icon-label buttons (`찜`, `로그인`). Second row (`68px` height): today's calendar icon badge (`#6E182B` top bar) + primary nav links (`홈`, `대극장`, `대학로`, `로터리·특가`, `할인 캘린더`) in Pretendard `18px/600` (`#534649`, active `#1F1719` with `3px #6E182B` bottom bar), and right-aligned `타임세일` pill (`#A81B3A` text on `#FBE9ED` hover bg) + `최저가 랭킹`."

2. **5:7 Musical Deal Card (Home Grid & Rail)**:
   > "Create a MuDeal 5:7 musical ticket card with no outer card box/border on a `#FFFFFF` canvas. Poster: `aspect-ratio: 5/7`, `8px` radius, `#F6EFEF` fallback, `inset 0 0 0 1px rgba(31,23,25,0.06)` hairline, subtle `scale(1.04)` hover zoom, top-right `28px` wishlist heart (`rgba(31,23,25,0.24)` fill, `#8A1E37` active). Below poster (`12px` top gap): muted metadata row (`서울 | 4개 예매처` left, venue right in `13px #736468`), 2-line clamped show title (`15px/500 #1F1719`), price row (`45%` in `#8A1E37 700` + `66,000원~` in `#1F1719 700`, `tabular-nums`) paired with a `12px` pill badge (`로터리` gold outline `#B89352` or `타임세일` `#FBE9ED/#A81B3A`), and a social/rating line with Champagne Gold (`#B89352`) star icon."

3. **Search Price-Comparison Panel (Core MuDeal Feature)**:
   > "Build a MuDeal price-comparison card (`#FFFFFF` bg, `1px solid #EAE0E1`, `12px` radius). Top: seat-grade tab bar (`VIP`, `R석`, `S석`, `A석`) with `2px solid #6E182B` active underline + right-aligned `무조건 할인만` toggle switch. Below tabs: a `#F6EFEF` lowest-price summary box (`16px` padding, `10px` radius) showing general lowest price vs lottery/conditional lowest price with `#B3A6A9` strikethrough original price (`13px`), `#8A1E37` discount % (`20px/700`), and `#1F1719` final price (`20px/700`, `tabular-nums`). Underneath: stacked channel rows (`유니켓`, `L티켓`, `NOL 로터리`, `Yes24`) separated by `1px solid #F2ECEC`. Highlight the #1 lowest row with a `3px solid #B89352` left accent, `#FAF6EE` wash, and Champagne Gold `최저가` badge. Each row shows channel name, condition badge (`무조건` `#EBF5EE/#266D45` or `추첨/조건` `#FBF2E2/#8C6214`), fee info (`12px #736468`), tabular price, and a `예매처 이동 ↗` button (`#8A1E37` for #1, outlined `#EAE0E1` for others)."

4. **Curtain Noir Spotlight Band (Yes24데이 · NOL 로터리)**:
   > "Design a full-width dark theater feature band in Curtain Noir (`#2B0D16`) with an `1100px` inner container (`48px` vertical padding). Left column (60%): Champagne Gold (`#DFC89F`) uppercase eyebrow label (`TODAY'S LOTTERY & SECRET DEAL`), an Editorial Serif (`Noto Serif KR`) headline in `28px/700 #FFFFFF`, secondary body copy in `rgba(255,255,255,0.74)`, and a CTA row with a white-filled `#6E182B`-text full-pill primary button (`오늘의 특가 보기`) and a white-outlined secondary pill (`알림 설정`). Right column (40%): Mulberry (`#4A1525`) showcase card with `12px` radius displaying 2 featured 5:7 posters and a live `D-Day` countdown in `tabular-nums`."

5. **Search & Category Filter Bar + Modal**:
   > "Create a clean listing header (`1100px` shell) with left title (`22px/600 #1F1719`) and right-aligned `36px` full-pill filter chips (`좌석등급`, `할인유형`, `예매처`, `지역`) in `#FFFFFF` with `1px solid #EAE0E1` (`#F9ECEF` bg + `#8A1E37` border + `#6E182B` text when active) plus a sort dropdown (`최저가순`, `할인율순`, `마감임박순`, `인기순`) in a `12px`-radius menu (`#FFFFFF`, `--md-e2` shadow, `#6E182B` checkmark). Clicking a filter opens a `480px` desktop modal (`20px` radius, `blur(2px)` dim backdrop) or mobile bottom sheet with `24px`-radius option chips (`#F6EFEF` default, `#8A1E37` selected) and a full-width `#8A1E37` `적용하기` button (`50px` height, `--md-shadow-cta`)."

6. **Product Detail Page (PDP) Split Layout**:
   > "Build a MuDeal show detail page on a `#F6F4F4` outer backdrop framing an `1100px` layout: left `670px` white column and right `400px` sticky sidebar (`top: 20px`, `12px` radius, `1px solid #EAE0E1`). Left top features a `700:320` blurred-poster hero (`filter: blur(14px) brightness(0.65)`) with a crisp foreground 5:7 poster and a bottom-right split badge (`#A81B3A` label + `#F6EFEF` timer). Stack sections below separated by `8px solid #F1ECEC` bands: show summary with `44px` square wish/share buttons, full channel price comparison table, discount condition guide, historical discount timeline, and venue info. Collapse to single column below `1024px` with a fixed bottom mobile CTA bar (`#FFFFFF`, `1px solid #EAE0E1`, wish/share icons + full-width `#8A1E37` `50px` CTA)."

7. **Two-Tier Footer**:
   > "Build a two-tier desktop footer bordered top by `1px solid #EAE0E1`. Upper section (`#FFFFFF` bg, `40px` vertical padding, `1100px` shell) splits `1.3fr 2fr`: Velvet Burgundy (`#6E182B`) wordmark + service description/contact on the left, and 3 link columns (`SERVICE`, `POLICY`, `PARTNER`) with `1px solid #EAE0E1` left dividers (`12px/700` uppercase tracked `0.12em` headers + `13px #534649` links) on the right. Lower legal bar sits on Porcelain (`#FCF8F7`, `28px` vertical padding) with `#736468` disclaimer text noting real-time price sync with external ticketing platforms."

### Iteration Guide

1. 한 번에 **하나의 화면 또는 컴포넌트**에 집중해 수정합니다.
2. 컬러 지시 시 추상적 표현("빨간색", "어두운 색") 대신 반드시 **토큰명과 Hex 코드**(`Velvet Burgundy #6E182B`, `Wine Accent #8A1E37`, `Curtain Noir #2B0D16`, `Porcelain #FCF8F7`)를 병기합니다.
3. 와인/버건디 비중이 과도해 보이지 않도록 **화이트 캔버스(`#FFFFFF`) 여백과 웜 뉴트럴(`#F6EFEF`/`#EAE0E1`)의 비율**을 먼저 점검합니다.
4. 모든 가격·할인율·날짜·랭킹 영역에 `tabular-nums`가 빠지지 않았는지 확인합니다.
5. `Champagne Gold(#B89352)`가 로터리/최저가/별점 외의 일반 UI에 새어 나가지 않도록 점검합니다.

### Known Gaps

- **실제 예매처 브랜드 로고/아이콘 가이드**: 외부 티켓사(Yes24, NOL, 유니켓, L티켓, 타임티켓 등)의 파비콘/배지 크기(`16px–20px` 원형/스퀘어)와 컬러 충돌 방지 규칙은 실제 연동 대상 확정 후 보강 필요.
- **할인 히스토리 차트 팔레트**: 향후 "역대 할인 추이 그래프" 도입 시 사용할 다중 시리즈 차트 컬러(버건디·골드·슬레이트 조합) 및 툴팁 스펙은 차트 라이브러리 선정 후 추가 정의 필요.
- **다크 모드**: 현재 시스템은 극장 벨벳 포인트(`#2B0D16` 밴드)를 품은 **라이트 모드 전용**으로 설계되었으며, 전체 다크 모드 토큰 매핑은 별도 확장 과제.
- **관리자 / 딜 헌터 백오피스 톤**: 역할 모델 확정 후 Admin/제보 폼 전용 테이블 밀도·상태 배지 스펙 추가 가능.
