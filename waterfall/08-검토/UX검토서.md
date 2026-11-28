# UX 검토서 (UX Review Document) — MuDeal

| 항목 | 내용 |
|---|---|
| **프로젝트명** | MuDeal (전국 뮤지컬 할인·특전·싱어롱/커튼콜 비교 플랫폼) |
| **문서 버전** | v1.0 (Phase 3 UX 개선 및 Playwright `360px` 라이브 실측 반영) |
| **작성일** | 2026-11-27 |
| **작성자** | `frontend-ux-polisher` · `qa-reviewer` · 메인 에이전트 |
| **검토 기준** | [DESIGN.md](../../DESIGN.md) (Velvet Burgundy Edition) · [PRD.md](../../PRD.md) v1.2 · WCAG 2.1 AA |

---

## 1. 검토 범위 및 화면별 상태

| 화면 ID | 경로 | 화면명 | 정적 감사 | Phase 3 반영 | 라이브 확인 (`360px` Playwright) |
|---|---|---|---|---|---|
| SCR-01 | `/` | 홈 (3분류 탐색 · 마감임박 · 제보해주신 딜) | 완료 | 완료 | **통과** (`scrollWidth 345 <= 360`, 콘솔 오류 0) |
| SCR-02 | `/search` | 4축 복합 필터 검색 · 페이지네이션 | 완료 | 완료 | **통과** (`scrollWidth 345 <= 360`, 필터 내 키워드 입력창 확인, 콘솔 오류 0) |
| SCR-03 | `/shows/[id]` | 작품 상세 · 좌석별 가격 비교 · 이벤트/특전 | 완료 | 완료 | 미실행 (로컬 시드 미적재 상태, 단위/정적 검증 완료) |
| SCR-04 | `/actors/[id]` | 배우 상세 · 출연작(`출연 중`/`예정`/`종료`) | 완료 | 완료 | 미실행 (정적 검증 완료) |
| SCR-05 | `/login` | 카카오·구글 소셜 로그인 / 약관 동의 | 완료 | 완료 | 이전 QA 통과 ([테스트결과보고서.md](../05-테스트/테스트결과보고서.md)) |
| SCR-06 | `/reports/new` | 회원 할인·이벤트 제보 폼 | 완료 | 완료 | 미실행 (정적·빌드 검증 완료) |
| SCR-07 | `/my` | 마이페이지 (스토리 바 · 캘린더 · 찜/팔로우 · 기여) | 완료 | 완료 | 이전 QA 통과 + Phase 3 KST/레이스 방어 반영 |
| SCR-08~10 | `/admin/*` | 통합 검수(제보+OCR) · 딜/동기화 · 오류 신고 | 완료 | 완료 | 이전 QA 통과 + Phase 3 OCR 원본 이미지/보정 폼 반영 |

---

## 2. 핵심 UX·접근성 점검 결과 및 조치 내역

| ID | 화면 | 심각도 | 발견 내용 | 조치 결과 | 상태 |
|---|---|---|---|---|---|
| **UX-001** | 상세·홈·검색 (`DealActions.tsx`) | Critical (P0) | `OutboundButton`이 `e.preventDefault()` 후 비동기 `window.open`을 호출해 Safari/모바일 팝업 차단 위험 | 네이티브 `<a target="_blank" rel="noopener noreferrer">` 동기 이동 + `keepalive: true` 비동기 클릭 로깅 + `410` `role="alert"` 안내로 전환 | **해결** |
| **UX-002** | `/admin/reports` (`AdminReviewConsole.tsx`) | Critical (P0) | OCR 초안 검수 시 원본 공지 이미지 미노출 및 추출 값 보정 불가, 사용자 제보 미매핑 시 첫 작품 자동 선택 | `ocrImageUrl` 미리보기(`no-referrer` + 폴백 + 새 탭 링크), 구조화 인라인 보정 폼(`approveDraftDeal` 연동), 사용자 제보 기본값 `""` 강제 선택 적용 | **해결** |
| **UX-003** | `/shows/[id]` (`ShowComparePanel.tsx`) | Major (P1) | 조건 필터 선택 시 우측 사이드바 대표가·CTA 미동기화, 오류 신고가 1위 딜에만 고정 | 필터된 `visible` 결과와 사이드바 대표가·CTA 동기화, 대상 딜 선택 드롭다운으로 행별 오류 신고 지원 + `409` 중복 안내 | **해결** |
| **UX-004** | `/search` (`search/page.tsx`) | Major (P1) | 20건 초과 시 페이지네이션 부재, 헤더 검색 시 기존 4축 필터 초기화, 날짜/가격 역전 무안내 | `page` 이전/다음 페이지네이션, 필터 카드 내 키워드 검색창(기존 쿼리 유지), 역전 입력 `role="alert"` 안내 추가 | **해결** |
| **UX-005** | 헤더·제보 폼 (`SiteHeader.tsx`, `ReportForm.tsx`) | Major (P1) | 모바일 `360px`에서 `할인 제보` 아이콘 링크 `aria-label` 누락·검색창 폭 협소, 제보 폼 3열 버튼 높이 초과·네트워크 실패 `catch`/초기화 누락 | `aria-label="할인 제보"`, 모바일 검색창 2행 확장(`scrollWidth 345px` 실측 통과), 제보 폼 `min-h-11`·임시저장 `catch`·추가 제보 초기화·`if (busy) return` 적용 | **해결** |
| **UX-006** | `/my` · `/actors/[id]` (`MyPageWorkspace.tsx`, `ActorShowsGrid.tsx`) | Major (P1) | UTC `.slice` 날짜 -1일 오류, 빠른 월 전환 레이스 컨디션, `ENDED` 공연을 `"공연 중"` 오표시, 스토리 썸네일 `onError` 부재 | `formatKstDate` 통일, `AbortController` + 시퀀스 번호 레이스 방어, `ENDED` 탭/배지 분리, `no-referrer`·폴백·`<label>`/`aria-label` 보강 | **해결** |
| **UX-007** | 디자인 시스템 (`globals.css`, `AdminReviewConsole.tsx`, `ShowCard.tsx`) | Minor (P2) | 저신뢰 OCR·배우 미읽음 링에 샴페인 골드 오남용, `.hero-scrim` 순수 블랙, `prefers-reduced-motion` 미적용, 하십시오체 혼용 | 샴페인 골드 희소성 원칙 복원(와인/루비 톤 분기), 와인 틴트 스크림 + 모션 축소 미디어 쿼리 적용, 전 화면 해요체·`"이벤트/오픈"` 잔재 제거 | **해결** |

---

## 3. Playwright 모바일 `360px` 라이브 실측 기록 (2026-11-27)

- **측정 환경**: Local `vite dev` (`http://localhost:5173`), Playwright Viewport `360 × 800`
- **결과**:
  - `/` (홈): `scrollWidth = 345px` (가로 스크롤 **없음**), `할인 제보` 링크 `aria-label="할인 제보"` 확인, 콘솔 에러/경고 **0건**, `/api/v1/home` 응답 헤더 `Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=120` 실측 확인.
  - `/search` (검색): `scrollWidth = 345px` (가로 스크롤 **없음**), 필터 내 키워드 입력창(`main input[name="q"]`) 존재 확인, 콘솔 에러/경고 **0건**, `/api/v1/shows` 응답 헤더 `Cache-Control` 실측 확인.

---

## 4. 미검토 / 배포 후 실기기 권장 확인 항목

- **iOS Safari 실기기**: 팝업 차단 활성화 상태에서 외부 예매처(`OutboundButton`) 새 탭 이동 및 뒤로가기 복귀 확인.
- **실데이터 시각 확인**: 운영 배포 URL에서 KOPIS·예매처 실 포스터(`referrerPolicy="no-referrer"`) 로딩, 어드민 OCR 원본 공지 이미지 렌더링, `.hero-scrim` 위 텍스트 명도 대비(4.5:1) 실측.
