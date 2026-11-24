# API 설계서 — MuDeal

> 본 문서는 [요구사항명세서-SRS.md](../01-요구사항분석/요구사항명세서-SRS.md), [비즈니스정책서.md](../00-기획/비즈니스정책서.md), [데이터베이스설계서.md](데이터베이스설계서.md)를 기반으로 **MuDeal** REST API(`/api/v1/*`)의 엔드포인트, 요청/응답 계약, 인증·인가 및 에러 코드를 정의한 **Phase 2** 산출물입니다.

| 항목 | 내용 |
|------|------|
| **문서 ID** | API-MUDEAL-v0.1 |
| **프로젝트명** | MuDeal (가칭) |
| **문서 버전** | v0.1 |
| **작성일** | 2026-11-24 |
| **작성자** | 백엔드팀 · Gemini (Antigravity) |
| **승인자** | 프로젝트 오너 (미결 — G2 승인 대기) |
| **문서 상태** | 초안 |

---

## 1. API 설계 원칙 및 공통 규격

| 항목 | 규칙 |
|------|------|
| **Base Path / 버저닝** | `/api/v1/*` (URL Path 버저닝, 후행 슬래시 미사용) |
| **형식 / 네이밍** | JSON (`application/json`), URL `kebab-case`, Query·Body `camelCase`, 에러 코드 `UPPER_SNAKE_CASE` |
| **시간 형식** | 응답 타임스탬프는 ISO-8601 UTC (`2026-11-24T11:30:00Z`)로 내려주고, 마감 판정·D-Day 계산은 서버에서 `KST (UTC+9)` 기준으로 산출해 함께 제공 |
| **인증 방식** | `HttpOnly; Secure; SameSite=Lax` 쿠키 기반 서명 JWT (`Access 30분`, `Refresh 14일` 로테이션) |
| **권한 계층** | `GUEST`(비로그인: 탐색·검색·비교·외부이동) → `USER`(소셜 로그인: 제보·마이페이지·오류신고) → `ADMIN`(검수·혜택·운영 CRUD) |

### 공통 성공 / 목록 / 에러 응답 포맷

```json
// 단일 응답
{ "data": { ... } }

// 목록 응답
{
  "data": [ ... ],
  "pagination": { "page": 1, "pageSize": 20, "totalItems": 84, "totalPages": 5, "hasNext": true }
}

// 에러 응답
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "입력 정보를 다시 확인해주세요.",
    "details": [{ "field": "externalUrl", "message": "올바른 https:// 링크 주소를 입력해주세요." }],
    "requestId": "req-uuid"
  }
}
```

---

## 2. API 엔드포인트 전체 목록

### 2.1 공개 탐색 · 비교 · 외부 이동 (비로그인 `GUEST` 허용)

| Method | Endpoint | 설명 | 권한 | 관련 FR / BP |
|--------|----------|------|------|--------------|
| `GET` | `/api/v1/home` | 홈 히어로 배너, 마감임박 레일, 스포트라이트 밴드, 필터별 추천 카드 조회 | GUEST+ | FR-002, BP-DEAL-001 |
| `GET` | `/api/v1/shows` | 전국 뮤지컬 검색·필터·정렬 목록 조회 | GUEST+ | FR-003, BP-DEAL-001 |
| `GET` | `/api/v1/shows/suggest` | 검색창 자동완성 추천 (최대 8건) | GUEST+ | FR-003 |
| `GET` | `/api/v1/shows/{showId}` | 작품 상세 + 좌석등급별 최저가 요약 + 예매처별 가격 비교표 | GUEST+ | FR-004, BP-DEAL-001~002 |
| `POST` | `/api/v1/deals/{dealId}/clicks` | 아웃바운드 이동 클릭 기록 (10초 중복 제거) 및 유효 외부 URL 반환 | GUEST+ | FR-005, BP-DEAL-003, BP-STAT-001-1 |

### 2.2 인증 (카카오 / 구글 소셜 로그인 전용)

| Method | Endpoint | 설명 | 권한 | 관련 FR / BP |
|--------|----------|------|------|--------------|
| `GET` | `/api/v1/auth/oauth/{provider}` | OAuth 인가 URL 리다이렉트 (`kakao` / `google`, `redirectUrl`·`state` 포함) | GUEST+ | FR-006, BP-AUTH-001 |
| `GET` | `/api/v1/auth/oauth/{provider}/callback` | OAuth 콜백 처리 (기존 회원 로그인 / 신규 회원 약관 동의 토큰 반환) | GUEST+ | FR-006, BP-AUTH-001 |
| `POST` | `/api/v1/auth/oauth/complete-signup` | 신규 소셜 사용자 필수 약관 동의 후 계정 생성 및 세션 쿠키 발급 | GUEST | FR-006, BP-AUTH-001-2 |
| `POST` | `/api/v1/auth/refresh` | Refresh Token 로테이션 및 Access Token 재발급 | Cookie | FR-006, BP-AUTH-002 |
| `POST` | `/api/v1/auth/logout` | 현재 세션 무효화 및 쿠키 삭제 | USER+ | FR-006 |
| `GET` | `/api/v1/me` | 현재 로그인 사용자 기본 정보 (`id`, `nickname`, `role`) | USER+ | FR-006 |

### 2.3 사용자 제보 · 혜택 · 오류 신고 (`USER` 로그인 필수)

| Method | Endpoint | 설명 | 권한 | 관련 FR / BP |
|--------|----------|------|------|--------------|
| `POST` | `/api/v1/uploads/report-evidence` | 제보 증빙 이미지 R2 업로드 (JPG/PNG/WebP, 최대 5MB) | USER+ | FR-007 |
| `POST` | `/api/v1/reports` | 미등록 할인·이벤트 제보 제출 (KST 일 10건 한도) | USER+ | FR-007, BP-REPORT-001 |
| `GET` | `/api/v1/me/reports` | 내 제보 목록 및 검수 상태/반려 사유 조회 (`status` 필터) | USER+ | FR-008, BP-REPORT-002 |
| `GET` | `/api/v1/me/rewards` | 내 제보 승인 혜택 내역 및 지급 상태 조회 | USER+ | FR-008, BP-REPORT-004 |
| `POST` | `/api/v1/deals/{dealId}/issues` | 품절/가격/링크 오류 신고 접수 (`USER` 전용 확정) | USER+ | FR-011, BP-REPORT-003 |

### 2.4 관리자 콘솔 (`ADMIN` 전용 — 서버 측 RBAC 필수)

| Method | Endpoint | 설명 | 권한 | 관련 FR / BP |
|--------|----------|------|------|--------------|
| `GET` | `/api/v1/admin/reports` | 사용자 제보 대기열 조회 (`status=PENDING\|APPROVED\|REJECTED`) | ADMIN | FR-009 |
| `GET` | `/api/v1/admin/reports/{reportId}` | 사용자 제보 상세 + 동일 작품 기존 활성 딜 대조 목록 | ADMIN | FR-009 |
| `POST` | `/api/v1/admin/reports/{reportId}/approve` | 사용자 제보 승인 → 보정값으로 `Deal` 게시 + `Reward` 생성 (멱등) | ADMIN | FR-009, BP-REPORT-002/004 |
| `POST` | `/api/v1/admin/reports/{reportId}/reject` | 사용자 제보 반려 (반려 사유 필수) | ADMIN | FR-009, BP-REPORT-002-4 |
| `GET` | `/api/v1/admin/drafts` | 외부 배치·Vision/OCR 자동 추출 초안(`DRAFT`) 대기열 조회 (`channel`, `hasOcr`) | ADMIN | FR-001, FR-009, BP-SYNC-001-3 |
| `POST` | `/api/v1/admin/drafts/{dealId}/approve` | 자동 수집·OCR 초안 보정 후 정식 게시 (`DRAFT→ACTIVE`, `Reward` 미생성) | ADMIN | FR-009, BP-SYNC-001-3 |
| `POST` | `/api/v1/admin/drafts/{dealId}/discard` | 자동 수집·OCR 초안 폐기 (`DRAFT→DISCARDED`) | ADMIN | FR-009 |
| `GET` / `POST` | `/api/v1/admin/ocr-jobs`, `/api/v1/admin/ocr-jobs/{id}/retry` | 공지 이미지 OCR 추출 이력·원문 링크·추출 JSON 조회 및 실패 건 재시도 | ADMIN | FR-001, BP-SYNC-002 |
| `GET` | `/api/v1/admin/rewards` | 제보자 혜택 지급 대기/완료 목록 조회 | ADMIN | FR-009 |
| `PATCH` | `/api/v1/admin/rewards/{rewardId}` | 혜택 유형·메모·지급 상태(`PAID`) 갱신 | ADMIN | FR-009, BP-REPORT-004 |
| `POST` / `PATCH` | `/api/v1/admin/shows`, `/api/v1/admin/shows/{id}` | 공연 수동 등록/수정 | ADMIN | FR-010 |
| `POST` / `PATCH` | `/api/v1/admin/deals`, `/api/v1/admin/deals/{id}` | 할인 딜 수동 등록/수정/마감/숨김/`adminLocked` 설정 | ADMIN | FR-010, BP-SYNC-002-2 |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/v1/admin/curations` | 홈 히어로 배너·스포트라이트 큐레이션 관리 | ADMIN | FR-012 |
| `GET` / `PATCH` | `/api/v1/admin/issues`, `/api/v1/admin/issues/{id}` | 오류/품절 신고 목록 조회 및 처리 완료 | ADMIN | FR-011 |
| `GET` / `POST` | `/api/v1/admin/sync/runs`, `/api/v1/admin/sync/trigger` | 배치 실행 이력/연속 실패 확인 및 수동 재수집 트리거 | ADMIN | FR-001, BP-SYNC-003 |

---

## 3. 핵심 API 상세 명세

### 3.1 `GET /api/v1/shows/{showId}` — 작품 상세 및 가격 비교표

- **Query**: `seatGrade` (선택, `VIP|R|S|A|ALL`), `unconditionalOnly` (선택, `true|false`)
- **응답 (200 OK)**:
```json
{
  "data": {
    "show": {
      "id": 1024,
      "title": "뮤지컬 오페라의 유령",
      "posterUrl": "https://...",
      "venueName": "샤롯데씨어터",
      "region": "서울",
      "startDate": "2026-11-01",
      "endDate": "2027-02-28",
      "status": "ONGOING",
      "basePrices": { "VIP": 170000, "R": 140000, "S": 110000, "A": 80000 }
    },
    "seatGrades": ["VIP", "R", "S", "A"],
    "summary": {
      "generalLowest": { "dealId": 501, "channelName": "유니켓", "salePrice": 98000, "basePrice": 140000, "discountRate": 30 },
      "conditionalLowest": { "dealId": 502, "channelName": "NOL 로터리", "salePrice": 40000, "basePrice": 140000, "discountRate": 71 }
    },
    "deals": [
      {
        "id": 502,
        "channelName": "NOL 로터리",
        "dealType": "LOTTERY",
        "seatGrade": "R",
        "basePrice": 140000,
        "salePrice": 40000,
        "discountRate": 71,
        "isUnconditional": false,
        "badgeLabel": "조건부 최저가",
        "conditionSummary": "NOL 앱 당일 오전 10시 추첨",
        "feeInfo": "예매 수수료 2,000원",
        "expiresAt": "2026-11-25T01:00:00Z",
        "dDayLabel": "오늘 마감",
        "lastVerifiedAt": "2026-11-24T10:00:00Z",
        "isStale": false,
        "sourceType": "SYNC_APPROVED"
      }
    ],
    "events": [
      {
        "id": 510,
        "channelName": "YES24티켓",
        "dealType": "SINGALONG",
        "conditionSummary": "전석 대상 싱어롱 데이 회차",
        "eventDates": ["2026-12-05 19:30", "2026-12-12 19:30"],
        "perkSummary": "관객 전원 스페셜 포토카드 1종 증정",
        "lastVerifiedAt": "2026-11-24T10:00:00Z",
        "sourceType": "OCR_APPROVED"
      }
    ],
    "disclaimer": "표시된 가격과 혜택은 최종 확인 시각 기준이며, 실제 결제 금액·잔여 좌석·수수료는 이동한 외부 예매처 기준이 적용됩니다."
  }
}
```
> 정렬 규칙(`BP-DEAL-002-3`): `salePrice ASC` → `isUnconditional DESC` → `expiresAt DESC (NULLS FIRST)` → `lastVerifiedAt DESC`. 만료(`expires_at <= now`) 딜은 쿼리 시점에 즉시 제외.

### 3.2 `POST /api/v1/deals/{dealId}/clicks` — 아웃바운드 이동 기록

- **동작**: 딜 활성 상태 및 `https://` 스킴 재검증 → `sessionHash + dealId` 기준 최근 10초 내 기록이 없을 때만 `outbound_clicks` 삽입(`BP-STAT-001-1`) → `{ "data": { "externalUrl": "https://...", "counted": true } }` 반환 (`200 OK`).
- **만료 딜 클릭 시**: `410 Gone` (`DEAL_EXPIRED`, "마감된 할인 정보입니다.").

### 3.3 `POST /api/v1/reports` — 사용자 미등록 할인 제보 제출

- **인증**: `USER` 필수 (`401` 미로그인 시)
- **Request Body**:
```json
{
  "showId": 1024,
  "reportedShowTitle": "뮤지컬 오페라의 유령",
  "channelName": "L티켓",
  "externalUrl": "https://example.com/deal/123",
  "reportedPrice": 91000,
  "reportedDiscountRate": 35,
  "seatGrade": "R",
  "isUnconditional": true,
  "conditionNote": "선착순 100매 한정, 별도 카드 조건 없음",
  "expiresAt": "2026-11-30T14:59:59Z",
  "evidenceR2Key": "reports/2026/11/uuid.png"
}
```
- **검증**: `reportedPrice` 또는 `reportedDiscountRate` 중 최소 1개 필수, `externalUrl`은 `https://` 스킴 필수, KST 당일 제보 10건 초과 시 `429` (`DAILY_REPORT_LIMIT_EXCEEDED`).
- **응답 (201 Created)**: `{ "data": { "id": 88, "status": "PENDING", "createdAt": "..." } }`

### 3.4 `POST /api/v1/admin/reports/{reportId}/approve` — 관리자 제보 승인 (멱등)

- **인증**: `ADMIN` 필수 (비관리자 `403 FORBIDDEN`)
- **Request Body** (관리자 보정값 포함): `showId`, `channelName`, `dealType`, `seatGrade`, `basePrice`, `salePrice`, `isUnconditional`, `conditionSummary`, `feeInfo`, `externalUrl`, `expiresAt`, `rewardType`(기본 `UNDECIDED`), `rewardDetail`.
- **처리**:
  1. 조건부 `UPDATE deal_reports SET status='APPROVED' WHERE id=? AND status='PENDING'` 확인 (영향 0행이면 `409 REPORT_ALREADY_PROCESSED`).
  2. `deals`(`source_type='USER_REPORT'`, `source_report_id=reportId`) + `rewards`(`report_id=reportId`, `status='PENDING_PAYOUT'`) + `audit_logs` 생성.
  3. 관련 홈/작품 상세 Workers Cache 무효화.
- **응답 (200 OK)**: `{ "data": { "reportId": 88, "publishedDealId": 612, "rewardId": 41 } }`

### 3.5 `POST /api/v1/admin/reports/{reportId}/reject` — 관리자 제보 반려

- **Request Body**: `{ "rejectReasonCode": "DUPLICATE", "rejectReasonNote": "이미 유니켓 동일 할인 딜이 등록되어 있습니다." }` (사유 미입력 시 `400 VALIDATION_ERROR`, `BP-REPORT-002-4`).

### 3.6 `POST /api/v1/admin/drafts/{dealId}/approve` — 자동 수집·OCR 초안 승인 게시

- **인증**: `ADMIN` 필수 (`403 FORBIDDEN` 비관리자)
- **Request Body**: 관리자가 보정한 `showId`, `dealType`(`TIMESALE|LOTTERY|SINGALONG|CURTAIN_CALL|PERK_GOODS` 등), `seatGrade`, `salePrice`(순수 이벤트는 `null` 허용), `isUnconditional`, `conditionSummary`, `eventDates`, `perkSummary`, `externalUrl`, `expiresAt`.
- **처리**: `status='DRAFT'` 검증 → `ACTIVE` 전환 및 `source_type` 확정(`SYNC_APPROVED` 또는 `OCR_APPROVED`) → `audit_logs` 기록 → 관련 Workers Cache 무효화. (**`Reward`는 생성하지 않음** — `BP-REPORT-004-1`).

---

## 4. 에러 코드 및 Rate Limiting

### 4.1 주요 에러 코드

| 에러 코드 | HTTP | 메시지 | 발생 상황 |
|-----------|------|--------|-----------|
| `VALIDATION_ERROR` | 400 | 입력 정보를 다시 확인해주세요. | 필수값 누락, 반려 사유 누락, 비안전 URL(`javascript:`) |
| `UNAUTHORIZED` | 401 | 로그인이 필요한 기능입니다. | 미로그인으로 제보/마이페이지/오류신고 호출, 토큰 만료 |
| `FORBIDDEN` | 403 | 접근 권한이 없습니다. | `USER`의 `/admin/*` 접근 또는 타인 제보/혜택 조회 |
| `NOT_FOUND` | 404 | 요청하신 공연 또는 할인 정보를 찾을 수 없습니다. | 미존재 `showId`/`dealId`/`reportId` |
| `REPORT_ALREADY_PROCESSED` | 409 | 이미 처리된 제보입니다. | 승인/반려 완료된 제보에 중복 처리 요청 |
| `DEAL_EXPIRED` | 410 | 마감된 할인 정보입니다. | 마감 시각 경과 딜 이동/신고 요청 |
| `DAILY_REPORT_LIMIT_EXCEEDED` | 429 | 오늘의 제보 가능 횟수(10건)를 모두 사용했습니다. | KST 당일 제보 10건 초과 (`BP-REPORT-001-3`) |
| `RATE_LIMIT_EXCEEDED` | 429 | 요청이 너무 많습니다. 잠시 후 다시 시도해주세요. | WAF/API Rate Limit 초과 |

### 4.2 Rate Limiting (Cloudflare WAF + Workers)

| 대상 | 제한 기준 | 비고 |
|------|-----------|------|
| 공개 조회/검색 (`GET /home`, `/shows`) | IP당 120 req/min | 정상 탐색 여유 확보 |
| 아웃바운드 클릭 (`POST /deals/*/clicks`) | IP당 60 req/min | 서버 10초 중복 제거 병행 |
| 제보 제출 (`POST /reports`) | 사용자당 일 10건 (KST) + 분당 3건 | `BP-REPORT-001-3` |
| 오류 신고 (`POST /deals/*/issues`) | 사용자당 일 20건 + 분당 5건 | 스팸 신고 방지 |
| 어드민 API (`/api/v1/admin/*`) | 관리자 세션당 120 req/min | 전수 감사 로깅 |
