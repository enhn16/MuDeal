# 요구사항 추적 매트릭스 (RTM) — MuDeal

> Requirements Traceability Matrix (`RTM-MUDEAL-v1.2`)
> MVP 전체 요구사항 19건(`FR-001`~`FR-012`, `NFR-001`~`NFR-007`)의 설계(`DD-001`~`DD-008`), 실제 구현 코드, 테스트 결과를 100% 연결한 Phase 4~5 기준선입니다.

| 항목 | 내용 |
|------|------|
| 프로젝트명 | MuDeal |
| 문서 번호 | RTM-MUDEAL-v1.2 |
| 버전 | v1.2 (Phase 4~5 구현·검증 완료) |
| 작성일 | 2026-11-25 |
| SRS 기준선 · 대상 릴리스 | `SRS-MUDEAL-v1.1` / MVP v1.0 |

---

## 1. 기능 요구사항 추적 매트릭스

| FR-ID · 요구사항명 | 우선순위 | 설계 위치 | 구현 코드 위치 | 검증 테스트 | 판정 |
|---|---|---|---|---|---|
| **FR-001** KOPIS·채널 저빈도 배치·Vision/OCR·자동마감 | P1 | `DD-006` | `src/server/sync/{kopis,channels,ocr,expiry}.ts`, `worker/index.ts`, `src/app/api/v1/admin/sync/*`, `/ocr-jobs/*` | `src/server/sync/__tests__/sync.test.ts` (6 tests) | **통과** |
| **FR-002** 홈 추천 · 티켓오픈 임박 · 제보해주신 딜 | P1 | `DD-002, DD-008` | `src/app/page.tsx`, `src/app/api/v1/home/route.ts`, `/community-deals/route.ts` | 라이브 `200 OK` + `shows.test.ts` | **통과** |
| **FR-003** 4축 복합 필터 검색 · 프리셋 · 동적 OG | P1 | `DD-002, DD-005` | `src/app/search/page.tsx`, `src/server/modules/shows.ts`, `src/app/api/v1/shows/*` | `shows.test.ts` (3 tests) + `core.test.ts` | **통과** |
| **FR-004** 작품 상세 가격 비교 · 이벤트/특전 · 출연 배우 | P1 | `DD-002, DD-008` | `src/app/shows/[id]/page.tsx`, `src/app/actors/[id]/page.tsx`, `src/components/ShowComparePanel.tsx` | `core.test.ts` (할인율·정렬) + 라이브 `200 OK` | **통과** |
| **FR-005** 외부 예매처 이동 및 10초 중복 제거 집계 | P1 | `DD-003` | `src/server/modules/deals.ts`, `src/app/api/v1/deals/[id]/clicks/route.ts`, `src/components/DealActions.tsx` | `core.test.ts` (URL 검증) + `build` | **통과** |
| **FR-006** 회원 전용 제보(URL 필수 · 일 10건) & 도움 반응 | P1 | `DD-003, DD-004` | `src/app/reports/new/page.tsx`, `src/server/modules/reports.ts`, `/api/v1/reports`, `/uploads/report-evidence`, `/helpful` | `reports.test.ts` (400/429) + 라이브 `200 OK` | **통과** |
| **FR-007** 카카오/구글 소셜 로그인 · Refresh 로테이션 · RBAC | P1 | `DD-001` | `src/lib/jwt.ts`, `src/server/modules/{auth,auth-runtime}.ts`, `src/app/login/page.tsx`, `/api/v1/auth/*` | `auth.test.ts` (4 tests) + 라이브 E2E(`401/403/200`) | **통과** |
| **FR-008** 개인화(찜·뮤배 팔로우·스토리 바·상세 피드·캘린더·프리셋) | P1 | `DD-005, DD-008` | `src/server/modules/personal.ts`, `src/app/my/page.tsx`, `src/components/{MyPageWorkspace,TargetNewsFeed,PersonalButtons}.tsx`, `/api/v1/me/*` | `personal.test.ts` + 라이브 `/my`·`/calendar`·`/notifications` `200 OK` | **통과** |
| **FR-009** 관리자 통합 검수 (제보 + 배치/OCR 초안, 멱등 승인) | P1 | `DD-004` | `src/app/admin/reports/page.tsx`, `src/components/AdminReviewConsole.tsx`, `/api/v1/admin/reports/*`, `/drafts/*` | `reports.test.ts` (400/409) + 라이브 `403/200` | **통과** |
| **FR-010** 관리자 공연·배우 병합·딜 CRUD · `admin_locked` | P1 | `DD-007` | `src/app/admin/deals/page.tsx`, `src/server/modules/admin.ts`, `/api/v1/admin/{deals,actors/merge}` | 라이브 `200 OK` + `typecheck`/`build` | **통과** |
| **FR-011** 품절/가격 오류 신고 및 관리자 처리 | P2 | `DD-007` | `src/app/admin/issues/page.tsx`, `/api/v1/deals/[id]/issues`, `/api/v1/admin/issues/*` | 라이브 `200 OK` + `typecheck`/`build` | **통과** |
| **FR-012** 관리자 홈 배너 큐레이션 관리 | P2 | `DD-007` | `/api/v1/admin/curations/*`, `src/components/AdminDealsConsole.tsx` | `typecheck` + `build` + 라이브 `200 OK` | **통과** |

---

## 2. 비기능 요구사항 추적 매트릭스

| NFR-ID · 요구사항명 | 검증 방식 | 결과 |
|---|---|---|
| **NFR-001** 응답시간 & 번들 경량화 | `vite build` 프로덕션 번들 확인 + 로컬 D1 인덱스(`idx_shows_4axis`, `idx_deals_compare`) 적용 | **충족** |
| **NFR-002** OAuth·RBAC·URL 보안·감사 로그 | `auth.test.ts`, `core.test.ts`, `reports.test.ts` + 실서버 비관리자 `403` 차단 + `audit_logs` 기록 | **충족** |
| **NFR-003** KST 마감·멱등 승인·알림 중복 방지 | `core.test.ts`(KST 경계), `reports.test.ts`(중복 승인 `409`), `dedup_key UNIQUE` + `onConflictDoNothing` | **충족** |
| **NFR-004** 디자인 일관성·반응형·`tabular-nums` | `DESIGN.md` 5-Tier 와인/골드 토큰 + Stitch 시안(`mudeal_1~9`, `mudeal_my`) UI 통일 | **충족** |
| **NFR-005** 3회 실패 경보·제보 로컬 복원·10초 클릭 중복 제거 | `hasConsecutiveFailureAlert`, `ReportForm` localStorage 임시저장, `recordOutboundClick` 10초 윈도우 | **충족** |
| **NFR-006** 최소 수집 동의·이미지 미재배포·면책 고지 | `complete-signup` 약관 동의, OCR 메모리 처리(R2 미저장), 비교표·푸터 면책 고지 | **충족** |
| **NFR-007** CI 자동 검증·추적성 | `.github/workflows/ci.yml` (`typecheck` → `test` → `build`) 및 RTM/인계서/테스트/배포 문서 갱신 | **충족** |

---

## 3. 커버리지 요약 (Phase 4~5 완료 기준선)

| 지표 | 실적 (분모: MVP 대상 19건) |
|---|---|
| 설계 매핑률 (G1~G3) | **19 / 19 (100%)** |
| 구현 완료율 (G4) | **19 / 19 (100%)** |
| 검증 완료율 (G5) | **19 / 19 (100%)** |
