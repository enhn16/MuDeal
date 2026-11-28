---
name: security-research
description: >-
  MuDeal 서비스(Cloudflare Workers · Vinext · D1 · R2 · OAuth/JWT · 외부 동기화 · Gemini Vision OCR)에
  맞춘 병렬 보안 감사 스킬. 3명의 공격면/취약점 탐색 서브에이전트와 2명의 검증/반증 서브에이전트를
  Antigravity `define_subagent` + `invoke_subagent`로 병렬 오케스트레이션해 실제 악용 가능성,
  CWE 근본 원인, 최소 수정안과 Vitest 회귀 테스트를 도출한다.
  Use for security review, vulnerability audit, pre-release security check, threat model validation,
  보안 리뷰, 취약점 감사, 릴리스 전 보안 점검, or `/security-research`.
---

# Security Research — MuDeal 병렬 보안 감사 스킬

일반적인 보안 권고가 아니라 **MuDeal 코드베이스에서 실제로 재현·성립하는 보안 결함**만 분리해 보고하는 5인 병렬 감사 워크플로입니다.
상세 파일 맵과 기존 방어선 목록은 [references/mudeal-threat-surfaces.md](./references/mudeal-threat-surfaces.md)를 먼저 확인합니다.

## 실행 전제 조건 (Hard Preconditions)

시작 전 아래 3가지를 확인합니다.

1. **메인 세션 실행**: 서브에이전트 내부가 아닌 메인 에이전트 세션에서 실행합니다(`define_subagent` · `invoke_subagent` 사용 가능해야 함).
2. **감사 범위 확정**: 사용자 지정 대상(PR, 커밋/브랜치 diff, 특정 라우트/모듈, 릴리스 후보)을 확인합니다. 지정이 없으면 `git diff` 변경분을 우선 감사하고, 변경분이 없으면 [references/mudeal-threat-surfaces.md](./references/mudeal-threat-surfaces.md)의 핵심 보안 표면을 감사합니다.
3. **비파괴·로컬 전용 원칙**: 운영 Cloudflare/D1/R2 및 외부 서비스(KOPIS, Kakao, Google, NOL/엘티켓/YES24, Gemini API)에 실제 요청이나 파괴적 테스트를 절대 실행하지 않습니다. 모든 검증은 로컬 mock/fixture 기반 Vitest 테스트, dry-run, 또는 정적 데이터 흐름 증명으로 수행합니다.

## 심각도 및 판정 기준

- **분류 기준**: CWE(근본 원인), OWASP ASVS/WSTG(통제 검증), CVSS v4.0 개념(악용 가능성 + 영향도).
- **공격 경로 없는 심각도 금지**: 구체적 공격자 권한, 진입점, 데이터 흐름, 영향이 없으면 취약점으로 보고하지 않습니다.
- **Critical / High 요건**: 실제 전제 조건과 재현 가능한 검증(Vitest 테스트 또는 반박 불가능한 정적 증명)이 모두 있어야 합니다.
- **CVSS 수치 과장 금지**: 메트릭 벡터를 실제로 산정하지 않았다면 숫자 점수(예: `9.8`)를 임의로 표기하지 않습니다.
- **런타임 환경 반영**: Cloudflare Workers 런타임 특성(`cf-connecting-ip` 엣지 주입, React 기본 이스케이프, `SameSite=Lax` 쿠키 동작 등)으로 실질적으로 차단되는 이론적 이슈는 하향(Downgrade) 또는 기각합니다.

## 5인 병렬 서브에이전트 구성

`define_subagent`로 아래 5개 역할을 정의하고 `invoke_subagent`로 병렬 호출합니다. (폴링 금지 — 완료 메시지가 도착할 때까지 대기합니다.)

| 역할명 (`Name`) | 쓰기 도구 (`EnableWriteTools`) | 담당 영역 |
|---|---|---|
| `mudeal-surface-hunter` | `false` (읽기 전용) | 진입점(`worker/index.ts`, `/api/v1/*`, SSR/RSC, Cron), `GUEST`/`USER`/`ADMIN` 신뢰 경계, 민감 자산·헤더 매핑 |
| `mudeal-auth-data-hunter` | `false` (읽기 전용) | OAuth/JWT(`auth.ts`, `auth-runtime.ts`, `jwt.ts`), 3역할 RBAC, IDOR(`/api/v1/me/*`, R2 키 소유권), CSRF, SQL/D1, 한도·중복 우회 |
| `mudeal-edge-sync-hunter` | `false` (읽기 전용) | `url.ts` SSRF/Open Redirect, R2 업로드/조회(`report-evidence`, `admin/evidence`), 외부 채널/KOPIS 파싱, Gemini OCR 프롬프트 인젝션·비용 소진, 시크릿/설정(`wrangler.jsonc`, `package.json`) |
| `mudeal-verifier-a` | `true` (검증 테스트 실행) | 상위 후보의 최소 로컬 재현(Vitest 단위/라우트 테스트 또는 정적 증명). 감사 전용 실행 시 임시 파일은 종료 전 원복 |
| `mudeal-verifier-b` | `false` (읽기 전용) | 후보 독립 재검증·반증(Falsification), Cloudflare/Vinext 실제 방어 여부 확인, 과대평가 심각도 하향 조정 |

### `define_subagent` 프롬프트 지침

- **3명의 Hunter 공통 지침**:
  - [references/mudeal-threat-surfaces.md](./references/mudeal-threat-surfaces.md)의 기존 방어선을 숙지하고, 단순 권고("CSP 추가 권장" 등 구체 경로 없는 조언)는 제외합니다.
  - 각 후보마다 `제목 / 파일:라인·함수 / 공격자 전제 조건 / 공격 경로 / 영향 / CWE 후보 / 코드 근거 / 안전한 로컬 검증 아이디어`를 반환합니다.
- **`mudeal-verifier-a` 지침**:
  - 기존 테스트 패턴(`src/server/modules/__tests__/*.test.ts`, `src/app/api/v1/__tests__/td004-routes.test.ts`, `src/lib/__tests__/core.test.ts`, `src/server/sync/__tests__/sync.test.ts`)에 맞춘 최소 로컬 Vitest 검증 또는 정적 데이터 흐름 증명을 작성·실행합니다.
  - 사용자가 수정까지 요청하지 않은 감사 단계에서는 워킹 트리에 임시 테스트 파일을 남기지 않습니다(`git status` 청결 유지).
- **`mudeal-verifier-b` 지침**:
  - `mudeal-verifier-a`와 독립적으로 각 후보를 코드·런타임 조건 기준으로 반증합니다. 실제 악용 경로가 끊어지면 기각 또는 심각도 하향 근거를 제시합니다.

## 감사 워크플로

### Phase 0: 범위 수집 및 베이스라인

메인 세션에서 먼저 수행합니다.

1. 대상 범위 확인: `git status --short`, `git log -n 5 --oneline`, 필요 시 `git diff --stat <base>...HEAD`.
2. [references/mudeal-threat-surfaces.md](./references/mudeal-threat-surfaces.md)를 읽어 감사 대상 파일과 기존 테스트 목록을 확정합니다.
3. 기준선 확인(선택/권장): `npm run typecheck`, `npm test` 통과 여부를 기록합니다. (직접 실행하지 않은 명령은 반드시 `미실행`으로 표기)

### Phase 1: 3인 Hunter 병렬 탐색

`mudeal-surface-hunter`, `mudeal-auth-data-hunter`, `mudeal-edge-sync-hunter`를 `invoke_subagent`로 **동시에** 호출합니다.

공통 입력 템플릿:

```text
[감사 대상]
{target summary & diff/file list}

[참고 기준]
.agents/skills/security-research/references/mudeal-threat-surfaces.md 를 먼저 읽고 담당 영역만 감사하세요.

[제약 사항]
- 외부 네트워크 호출 및 운영 자원 접근 금지.
- 일반론적 보안 강화 조언 제외, 실제 공격 경로가 성립하는 후보만 반환.
- 반환 필드: 제목 / 파일:라인·함수 / 공격자 전제 조건 / 공격 경로 / 영향 / CWE 후보 / 코드 근거 / 안전한 로컬 검증 아이디어
```

3명의 응답이 모두 도착할 때까지 대기합니다.

### Phase 2: 중복 제거 및 2인 검증·반증 병렬 실행

1. 3명의 후보를 통합·중복 제거하고 공격 경로가 구체적인 상위 후보를 선별합니다.
2. 선별된 후보 목록을 `mudeal-verifier-a`와 `mudeal-verifier-b`에 **동시에** 전달합니다.
   - `mudeal-verifier-a`: 각 후보에 대해 `Reproduced | Static-Proof | Falsified | Unsafe-to-Run` 판정, 정확한 명령/테스트 코드, 관측 결과, 권장 심각도 반환.
   - `mudeal-verifier-b`: 독립 반증 시도, Cloudflare Workers/D1/Vinext 환경에서의 실제 성립 여부, 하향/기각 근거 반환.

### Phase 3: 교차 검증 및 최소 수정안 확정

검증·반증 결과가 엇갈리거나 High 이상 후보가 있는 경우, 관련 서브에이전트에 `send_message`로 결과를 공유해 아래 4가지를 합의합니다.

1. 최종 생존 취약점 목록
2. 하향 또는 기각된 후보와 사유
3. MuDeal 아키텍처에 맞는 **최소 수정안(Minimal Fix)** 및 담당 영역(`backend-security-engineer` / `sync-data-engineer` / `frontend-ux-polisher`)
4. 재발 방지를 위한 Vitest 회귀 테스트 케이스

> 감사만 요청받은 경우 여기서 코드를 수정하지 않고 보고서로 종료합니다. 사용자가 수정을 요청하면 담당 소유 경계에 맞춰 기존 서브에이전트(`backend-security-engineer`, `sync-data-engineer`, `frontend-ux-polisher`)에 최소 수정과 회귀 테스트 추가를 위임합니다.

### Phase 4: 최종 보고서 작성

아래 형식으로 한국어 보고서를 출력합니다. 긴 보고서(후보 5건 이상)는 아티팩트(`.md`)로 저장하고 핵심 판정만 요약합니다.

```markdown
## MuDeal 보안 감사 결과

### 최종 판정 (Verdict)
PASS | PASS WITH FINDINGS | BLOCK

### 감사 범위
- 대상:
- 기준 브랜치/Diff:
- 실행한 검증 명령: (미실행 항목은 `미실행` 명시)

### 확인된 취약점 요약
| 심각도 | 제목 | CWE | 악용 가능성 | 영향 | 검증 상태 | 최소 수정 방향 |
|---|---|---|---|---|---|---|

### 상세 분석
각 항목마다:
- **근거 위치**: `경로:라인` (함수명)
- **전제 조건 및 공격 경로**:
- **검증 결과 (Vitest / 정적 증명)**:
- **심각도 판정 근거**:
- **최소 수정안 & 담당 영역**:
- **권장 회귀 테스트**:

### 하향 또는 기각된 후보
| 후보 | 판정 | 사유 |
|---|---|---|

### 잔여 리스크 (Residual Risk)
- 로컬 감사 범위에서 검증하지 못한 항목(예: Cloudflare 배포 환경 시크릿/WAF/R2 버킷 정책, 라이브 OAuth 공급자 설정)과 이유.
```

## 출력 규칙

- **판정(Verdict)을 최상단**에 배치하고, `BLOCK` 사유를 숨기지 않습니다.
- 검증되지 않은 추측을 확정 취약점으로 보고하지 않습니다.
- 생존한 모든 항목에는 **정확한 파일 경로·라인**과 **검증 명령 또는 정적 증명**을 포함합니다.
- 생존 취약점이 없으면 솔직하게 없음(`PASS`)을 선언하고 잔여 리스크만 명확히 남깁니다.
