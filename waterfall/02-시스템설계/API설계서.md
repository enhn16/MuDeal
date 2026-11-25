# API 설계서 — MuDeal

> `API-MUDEAL-v1.0` · [요구사항명세서-SRS.md](../01-요구사항분석/요구사항명세서-SRS.md) (`v1.0`) · [데이터베이스설계서.md](데이터베이스설계서.md) (`v1.0`) 기준 REST API 계약서입니다.
> 금전 보상 API(`/admin/rewards`, `/me/rewards`)를 제거하고 **4축 검색**, **회원 전용 제보(`https://` URL 필수)+`제보해주신 딜`+`도움이 됐어요`**, **작품 찜 · 뮤배 팔로우 · 스토리 바 자동읽음/다시보기/저장 · 내장 캘린더** API를 반영했습니다.

---

## 1. 공통 규격
- **Base Path**: `/api/v1/*` · JSON(`camelCase`) · 에러 코드 `UPPER_SNAKE_CASE` · 시간 UTC ISO-8601 (판정·D-Day는 KST)
- **인증**: `HttpOnly; Secure; SameSite=Lax` 쿠키 기반 JWT(`Access 30분`, `Refresh 14일` 로테이션)
- **권한**: `GUEST`(탐색·4축검색·비교·외부이동·도움) · `USER`(**할인제보**·찜·뮤배팔로우·스토리바피드·내캘린더·프리셋·내기여·오류신고) · `ADMIN`(통합검수·운영 CRUD)

---

## 2. 엔드포인트 전체 목록

### 2.1 공개 탐색 · 4축 검색 · 비교 · `제보해주신 딜` (`GUEST`+)

| Method | Endpoint | 설명 | 권한 | 관련 FR |
|---|---|---|---|---|
| `GET` | `/api/v1/home` | 히어로, 마감임박 레일, 다크 스포트라이트, **`제보해주신 딜`** 섹션, 유형 필터 추천 | GUEST+ | FR-002 |
| `GET` | `/api/v1/community-deals` | **`제보해주신 딜`** 전용 목록 (최신순/확인순/도움순) | GUEST+ | FR-002, FR-006 |
| `GET` | `/api/v1/shows` | **4축 복합 필터 검색** (`dateFrom`, `dateTo`, `q`, `priceMin`, `priceMax`, `region`, `dealType`, `seatGrade`, `unconditionalOnly`, `conditionTags`, `sort`) | GUEST+ | FR-003 |
| `GET` | `/api/v1/shows/suggest` | 검색 자동완성 (작품명 + 배우명 함께 추천, 최대 8건) | GUEST+ | FR-003 |
| `GET` | `/api/v1/shows/{showId}` | 작품 상세 + 좌석별 가격 비교표 + 현장 이벤트/특전 + **출연 배우 목록(팔로우 상태 포함)** | GUEST+ | FR-004 |
| `GET` | `/api/v1/actors` | 뮤지컬 배우 검색·인기 목록 | GUEST+ | FR-003, FR-008 |
| `GET` | `/api/v1/actors/{actorId}` | 배우 상세 및 해당 배우 출연 뮤지컬(할인/특전 포함) 모아보기 | GUEST+ | FR-004, FR-008 |
| `POST` | `/api/v1/deals/{dealId}/clicks` | 외부 예매처 이동 클릭 기록(10초 중복 제거) + 제보 딜 확인 수 증가 | GUEST+ | FR-005 |
| `POST` | `/api/v1/deals/{dealId}/helpful` | 제보 딜 `도움이 됐어요` 반응 (회원 토글 / 비회원 세션당 1회) | GUEST+ | FR-006 |

### 2.2 제보 제출 (`USER` 로그인 필수 — 악성 링크·스팸 방지)

| Method | Endpoint | 설명 | 권한 | 관련 FR |
|---|---|---|---|---|
| `POST` | `/api/v1/uploads/report-evidence` | 제보 증빙 이미지 R2 업로드 (JPG/PNG/WebP, 최대 5MB) | **USER** | FR-006 |
| `POST` | `/api/v1/reports` | 미등록 할인·이벤트 제보 제출 (`https://` URL 필수, KST 일 10건 한도) | **USER** | FR-006 |

### 2.3 인증 & 로그인 개인화 (`USER` 전용 — 카카오/구글 소셜 로그인)

| Method | Endpoint | 설명 | 권한 | 관련 FR |
|---|---|---|---|---|
| `GET` | `/api/v1/auth/oauth/{provider}` | 카카오/구글 OAuth 시작 (`redirectUrl` 포함) | GUEST+ | FR-007 |
| `GET` / `POST` | `/api/v1/auth/oauth/{provider}/callback`, `/complete-signup` | OAuth 콜백 및 최초 필수 약관 동의 후 가입 완료 | GUEST | FR-007 |
| `POST` | `/api/v1/auth/refresh`, `/api/v1/auth/logout`, `GET /api/v1/me` | 토큰 갱신 · 로그아웃 · 내 정보(미읽음 알림 수 포함) | USER+ | FR-007 |
| `GET` / `POST` / `DELETE` | `/api/v1/me/bookmarks/shows`, `/shows/{showId}` | 찜한 뮤지컬 모아보기 및 작품 찜 추가/해제 | USER | FR-008 |
| `GET` / `POST` / `DELETE` | `/api/v1/me/follows/actors`, `/actors/{actorId}` | 팔로우 중인 배우 목록 및 배우 팔로우 추가/해제 | USER | FR-008 |
| `GET` | `/api/v1/me/actors/shows` | **`내 뮤배 극`** — 팔로우한 배우들의 현재/예정 출연 뮤지컬과 최저가·특전 모아보기 | USER | FR-008 |
| `GET` / `PATCH` | `/api/v1/me/notifications`, `/{id}/save` | **스토리 바 피드 조회**(`?mode=unread\|recent\|saved&actorId=&showId=&autoMarkRead=true`: 열람 시 자동 읽음, 프로필 30일 다시 보기, 저장함) 및 **`🔖 저장하기` 토글** | USER | FR-008 |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/v1/me/calendar`, `/me/calendar/{id}` | **마이페이지 내장 캘린더** 월간 조회(`?from=YYYY-MM-DD&to=YYYY-MM-DD`: 찜·팔로우 자동 일정 + 담은/직접 입력 일정 통합) 및 일정 추가·수정·삭제 | USER | FR-008 |
| `GET` / `POST` / `DELETE` | `/api/v1/me/search-presets`, `/me/search-presets/{id}` | 자주 쓰는 4축 검색 조건 프리셋 저장/조회/삭제 (최대 5개) | USER | FR-003, FR-008 |
| `GET` | `/api/v1/me/reports` | 로그인 상태 제출 제보 상태·반려 사유 + 누적 기여(`totalClicks`, `totalHelpful`) | USER | FR-008 |
| `POST` | `/api/v1/deals/{dealId}/issues` | 품절/가격/링크 오류 신고 (`USER` 전용) | USER | FR-011 |

### 2.4 경량 관리자 콘솔 (`ADMIN` 전용 — 서버 RBAC 필수)

| Method | Endpoint | 설명 | 권한 | 관련 FR |
|---|---|---|---|---|
| `GET` / `GET` | `/api/v1/admin/reports`, `/admin/reports/{id}` | 사용자 제보 대기열 및 상세(기존 활성 딜 대조 포함) | ADMIN | FR-009 |
| `POST` | `/api/v1/admin/reports/{id}/approve` | 사용자 제보 승인 → `ACTIVE` 게시(`제보해주신 딜` 노출 + 찜/팔로우·제보자 인앱 알림) | ADMIN | FR-009 |
| `POST` | `/api/v1/admin/reports/{id}/reject` | 사용자 제보 반려 (사유 필수) | ADMIN | FR-009 |
| `GET` / `POST` | `/api/v1/admin/drafts`, `/{dealId}/approve`, `/{dealId}/discard` | 외부 배치·Vision/OCR 초안(`DRAFT`) 검수·승인 게시·폐기 | ADMIN | FR-001, FR-009 |
| `GET` / `POST` | `/api/v1/admin/ocr-jobs`, `/{id}/retry` | 공지 이미지 OCR 추출 이력·원문 링크·추출 JSON 조회 및 재시도 | ADMIN | FR-001 |
| `POST` / `PATCH` | `/api/v1/admin/shows`, `/deals`, `/actors`, `/actors/merge` | 공연·딜·배우(동명이인 병합/매핑) 수동 CRUD 및 `adminLocked` 관리 | ADMIN | FR-010 |
| `CRUD` | `/api/v1/admin/curations`, `/issues`, `/sync/runs`, `/sync/trigger` | 홈 큐레이션 · 오류 신고 처리 · 배치 모니터링 및 수동 재수집 | ADMIN | FR-001, FR-011~012 |

---

## 3. 핵심 API 요청/응답 상세

### 3.1 `GET /api/v1/shows` — 4축 복합 필터 검색
- **Query Parameters**:
  - `dateFrom` / `dateTo`: `YYYY-MM-DD` (KST, 날짜/기간 겹침 필터 `BP-SEARCH-001`)
  - `q`: 작품명·공연장명·**배우명**·이벤트 키워드 (`BP-SEARCH-002`)
  - `priceMin` / `priceMax`: 최소/최대 금액(원, `BP-SEARCH-003`)
  - `region`: `DAEHAKRO` | `SEOUL_OTHER` | `GYEONGGI_INCHEON` | `BUSAN` | `DAEGU` | `DAEJEON_CHUNGCHEONG` | `GWANGJU_JEOLLA` | `GANGWON_JEJU` (복수 쉼표 허용, `BP-SEARCH-004`)
  - `dealType`, `seatGrade`, `unconditionalOnly`, **`conditionTags`**(`MATINEE,REWATCH,YOUTH_STUDENT,OFFICE_WORKER,CARD_PARTNER`), `sort` (`LOWEST_PRICE` | `HIGHEST_DISCOUNT` | `CLOSING_SOON` | `POPULAR`), `page`, `pageSize`

### 3.2 `GET /api/v1/shows/{showId}` — 작품 상세 (가격 비교 · 이벤트/특전 · 출연 배우)
- 응답 `data` 구성: `show` (`subRegion`, `basePrices`, `isBookmarked`), `seatGrades`, `summary` (`generalLowest`, `conditionalLowest`), `deals` (각 행에 `reporterNickname`, `clickCount`, `helpfulCount`, `isHelpfulVoted` 포함), `events` (싱어롱·커튼콜·특전 목록), **`actors`** (`[{ id, name, roleName, isFollowed }]`), `disclaimer`.

### 3.3 `POST /api/v1/deals/{dealId}/clicks` & `POST /api/v1/deals/{dealId}/helpful`
- `clicks`: 10초 중복 제거 후 `outbound_clicks` 기록 + `deals.click_count += 1` → `{ externalUrl, counted, clickCount }` (만료 시 `410 DEAL_EXPIRED`).
- `helpful`: `deal_helpful_votes` 중복 검증 후 `deals.helpful_count` 갱신 → `{ voted: true, helpfulCount: 14 }`.

### 3.4 `POST /api/v1/reports` — 로그인 회원 제보 제출 (`USER` 필수)
```json
{
  "showId": 1024,
  "reportedShowTitle": "뮤지컬 빨래",
  "channelName": "엘티켓",
  "dealType": "TIMESALE",
  "externalUrl": "https://www.l-ticket.co.kr/product/detail/123",
  "reportedPrice": 38500,
  "reportedDiscountRate": 45,
  "seatGrade": "R",
  "isUnconditional": true,
  "conditionNote": "평일 낮 공연 타임세일",
  "expiresAt": "2026-12-01T14:59:59Z",
  "reporterNickname": "대학로산책"
}
```
- 미로그인 시 `401 UNAUTHORIZED`, `externalUrl`은 `https://` 필수, KST 당일 10건 초과 시 `429 DAILY_REPORT_LIMIT_EXCEEDED`.

### 3.5 `GET /api/v1/me/notifications` (스토리 바 자동읽음/다시보기/저장) & `GET/POST /api/v1/me/calendar`
- `/me/notifications?mode=unread&actorId=12&autoMarkRead=true`:
  - `stories`: 팔로우 배우(모노그램/최근 출연작 포스터)·찜한 작품 원형 썸네일과 `unreadCount`
  - `items`: 선택한 대상의 **미확인 새 소식 피드 카드** 반환과 동시에 해당 건 자동 `is_read = 1` 처리(링 해제)
  - `mode=recent` (프로필 `최근 소식 다시 보기`, 30일 내) / `mode=saved` (`🔖 저장한 소식` 보관함) 지원
- `PATCH /api/v1/me/notifications/{id}/save`: `{ "isSaved": true }` 토글
- `/me/calendar?from=2026-12-01&to=2026-12-31`:
  - `autoEvents`: 찜·팔로우 작품의 **`TICKET_OPEN` 오픈 일시**·로터리 마감·싱어롱/커튼콜 회차(동적 조합)
  - `savedEvents`: 사용자가 `내 캘린더에 담기` 했거나 직접 입력한 개인 일정(`user_calendar_events`, CRUD 지원)

### 3.6 `POST /api/v1/admin/reports/{id}/approve` & `POST /api/v1/admin/drafts/{dealId}/approve`
- 둘 다 멱등 상태 전이(`PENDING`/`DRAFT` → `ACTIVE`, 중복 시 `409`) → `shows.min_active_price`/`max_discount_rate` 재계산 → 찜/팔로우 사용자에게 인앱 새 소식(`dedup_key` 중복 방지) 생성 → Workers Cache 무효화 → `audit_logs` 기록. (**금전 보상 미생성**).

---

## 4. 에러 코드 및 Rate Limit
- 에러 코드: `VALIDATION_ERROR(400)`, `UNAUTHORIZED(401)`, `FORBIDDEN(403)`, `NOT_FOUND(404)`, `REPORT_ALREADY_PROCESSED(409)`, `DEAL_EXPIRED(410)`, `DAILY_REPORT_LIMIT_EXCEEDED(429)`, `RATE_LIMIT_EXCEEDED(429)`.
- Rate Limit: 공개 조회/4축 검색 IP당 `120 req/min`, 제보 `POST /reports` 회원 계정당 KST 일 `10건` + 분당 `3건`, 도움 반응 분당 `20건`, 어드민 `120 req/min`.
