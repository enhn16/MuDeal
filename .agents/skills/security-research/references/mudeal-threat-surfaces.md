# MuDeal 위협 표면 및 기존 보안 통제 맵

`security-research` 스킬의 3인 Hunter와 2인 Verifier가 공통으로 참조하는 MuDeal 코드베이스 보안 지도입니다.

## 1. 아키텍처 & 런타임 요약

- **런타임**: Cloudflare Workers (`wrangler.jsonc`, `nodejs_compat`, `worker/index.ts`) + Vinext (Next.js App Router) + React 19
- **데이터 저장소**: Cloudflare D1 (`DB`, Drizzle ORM `src/db/schema.ts`), Cloudflare R2 (`EVIDENCE_BUCKET`, 증빙 이미지 선택 바인딩)
- **역할 모델**: `GUEST` (비로그인) / `USER` (OAuth 가입 회원) / `ADMIN` (운영자)
- **외부 연동**: Kakao·Google OAuth, KOPIS Open API, 예매처 채널(NOL·엘티켓·YES24), Gemini Vision/Synopsis API
- **민감 시크릿 (`src/env.d.ts`)**: `JWT_SECRET`, `KAKAO_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`, `KOPIS_API_KEY`, `GEMINI_API_KEY`, `ADMIN_KAKAO_IDS`, `ADMIN_OAUTH_EMAILS`

---

## 2. 영역별 감사 대상 파일 및 핵심 점검 포인트

### A. Surface Hunter (`mudeal-surface-hunter`) — 진입점 · 헤더 · 프론트엔드 노출

| 표면 | 주요 파일 | 점검 포인트 |
|---|---|---|
| Workers 진입점 / 보안 헤더 / Cron | `worker/index.ts`, `wrangler.jsonc` | 글로벌 헤더(`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, CSP 부재 영향), 5개 Cron 분기 예외·자원 소비 |
| Public API | `src/app/api/v1/home/route.ts`, `shows/**`, `actors/**`, `community-deals/route.ts`, `deals/[id]/clicks\|helpful\|issues/route.ts` | 비로그인 허용 범위, 만료 딜(`410`) 노출 여부, 비공개/DRAFT/REJECTED 데이터 유출 여부 |
| Auth API | `src/app/api/v1/auth/oauth/[provider]/route.ts`, `callback/route.ts`, `complete-signup/route.ts`, `refresh/route.ts`, `logout/route.ts` | 인증 진입점, 콜백 분기, 쿠키 발급/폐기, 리다이렉트 경로 |
| Member API | `src/app/api/v1/me/**`, `src/app/api/v1/reports/route.ts`, `src/app/api/v1/uploads/report-evidence/route.ts` | 로그인 필수 가드 누락 여부, 사용자 입력 바디/쿼리 경계 |
| Admin API & UI | `src/app/api/v1/admin/**`, `src/app/admin/**/page.tsx`, `src/components/Admin*.tsx` | 서버/클라이언트 양측 권한 체크, 운영 로그·내부 에러 노출 여부 |
| SSR / Client 렌더링 | `src/app/**/page.tsx`, `src/components/**` | `dangerouslySetInnerHTML`, 외부 `href` 스킴 검증, `target="_blank"` `rel="noopener noreferrer"`, RSC payload에 민감 필드 직렬화 여부 |

### B. Auth & Data Hunter (`mudeal-auth-data-hunter`) — 인증 · 인가 · IDOR · D1 · 악용 방지

| 영역 | 주요 파일 | 이미 구현된 방어선 (우회·엣지케이스 집중 점검) |
|---|---|---|
| JWT & 시크릿 | `src/lib/jwt.ts`, `src/server/modules/auth.ts`, `src/server/modules/auth-runtime.ts` | Web Crypto HS256(`alg === "HS256"` 강제), `JWT_SECRET` 미설정 시 Fail-Fast (`allowDevFallback`은 localhost만 허용) → **`Host` 헤더 스푸핑(`getServerJwtSecret`)·`dev` OAuth 우회 조건 검증 필수** |
| OAuth & 세션 | `src/app/api/v1/auth/**`, `src/server/modules/auth.ts` | `STATE_COOKIE` JWT 검증, `sanitizeRedirectUrl` 단일 `/` 강제, `userSessions` Refresh 토큰 SHA-256 해시·회전, `HttpOnly; SameSite=Lax` → **CSRF(상태 변경 POST/PATCH/DELETE), Refresh 재사용/동시성, `pending_signup` 재사용, `ADMIN_OAUTH_EMAILS`/`ADMIN_KAKAO_IDS` 권한 승격 검증** |
| 3역할 RBAC & IDOR | `src/server/modules/personal.ts`, `reports.ts`, `admin.ts`, `src/app/api/v1/me/**`, `src/app/api/v1/admin/**` | `requireRuntimeAuth` / `requireRuntimeAdmin`, `validateUserEvidenceKey` 소유자 prefix 강제 → **모든 `/api/v1/me/*` 삭제·수정 IDOR, 관리자 승인/병합 멱등성(`409`)·권한 경계 누락 검증** |
| 남용 방지 & 정합성 | `src/server/modules/deals.ts`, `reports.ts`, `shows.ts` | KST 일 10건 제보 한도(`429`), 10초 클릭 중복 제거(`hashSessionIdentity`), `helpful` 중복 투표 방지 → **`report-evidence` 선업로드 후 제보 미제출로 R2 무한 적재 가능성, `x-forwarded-for` 스푸핑, 동시 요청 레이스 컨디션, Drizzle `sql` raw 보간/페이지네이션 상한 검증** |

### C. Edge & Sync Hunter (`mudeal-edge-sync-hunter`) — SSRF · R2 · 외부 동기화 · OCR · 설정

| 영역 | 주요 파일 | 이미 구현된 방어선 (우회·엣지케이스 집중 점검) |
|---|---|---|
| URL / SSRF 방어 | `src/lib/url.ts`, `src/server/sync/channels.ts`, `kopis.ts`, `ocr.ts` | `parseSafeExternalUrl` (`https://` 강제, `ADMIN`만 `http://`), `parseSafeServerFetchUrl` + `isPrivateOrInternalHost` → **리다이렉트 체인(`MAX_REDIRECTS`) 재검증 누락, IPv6/특수 호스트 우회, `normalizeExternalHttpsUrl` 엣지케이스 검증** |
| R2 업로드 & 조회 | `src/app/api/v1/uploads/report-evidence/route.ts`, `src/app/api/v1/admin/evidence/route.ts`, `src/server/sync/retention.ts` | 5MB 제한, 바이너리 매직바이트 검사(`detectAllowedImageMagic`), `reports/` prefix·`..`·`\` 차단, `Content-Security-Policy: sandbox` + `nosniff` → **URL 인코딩·제어문자, 고아 R2 객체 누적 및 `retention.ts` 정리 누락, MIME 결정 로직 검증** |
| Gemini OCR & 외부 파싱 | `src/server/sync/ocr.ts`, `channels.ts`, `kopis.ts`, `benefit-filter.ts`, `kids-filter.ts`, `src/app/api/v1/admin/sync/trigger/route.ts` | `OcrExtractSchema` Zod 상한, `OCR_DAILY_LIMIT` 일일 상한, 타임아웃 → **외부 포스터/공지 텍스트를 통한 프롬프트 인젝션(`AUTO_PUBLISH_CONFIDENCE` 자동 게시 오염), 외부 응답 크기 무제한 메모리 소비, `admin/sync/trigger` 반복 호출에 의한 비용·자원 소진, 에러/감사로그 내 API 키 노출 검증** |
| 설정 & 공급망 | `wrangler.jsonc`, `package.json`, `vite.config.ts`, `.env.example`, `.gitignore`, `.github/workflows/ci.yml` | `.dev.vars`/`.env` gitignore 여부, 클라이언트 번들 시크릿 혼입, 의존성 취약점 |

---

## 3. 로컬 검증 명령 및 기존 테스트 스위트

감사 중 로컬 검증과 회귀 테스트 작성 시 아래 테스트 파일을 기준 패턴으로 사용합니다.

- 전체 타입/테스트 확인:
  - `npm run typecheck`
  - `npm test`
- 도메인별 타겟 Vitest:
  - 인증/RBAC/세션: `npx vitest run src/server/modules/__tests__/auth.test.ts`
  - 제보/증빙/감사로그: `npx vitest run src/server/modules/__tests__/reports.test.ts`
  - 개인화/IDOR: `npx vitest run src/server/modules/__tests__/personal.test.ts`
  - 관리자 API: `npx vitest run src/server/modules/__tests__/admin.test.ts`
  - 라우트 통합: `npx vitest run src/app/api/v1/__tests__/td004-routes.test.ts`
  - URL/JWT/핵심 유틸: `npx vitest run src/lib/__tests__/core.test.ts`
  - 동기화/OCR/보존기간: `npx vitest run src/server/sync/__tests__/sync.test.ts src/server/sync/__tests__/retention.test.ts`

## 4. 감사 후 수정 위임 매핑 (선택)

사용자가 발견된 취약점의 실제 수정까지 요청할 경우, 기존 프로젝트 서브에이전트 경계에 맞춰 위임합니다.

- DB·API·인증/RBAC·`src/lib/jwt.ts`·`src/lib/url.ts`: `backend-security-engineer`
- 외부 수집·OCR·보존기간·`worker/index.ts` Cron: `sync-data-engineer`
- 화면 XSS/링크 속성·관리자/사용자 UI 노출: `frontend-ux-polisher`
