import type { Metadata } from "next";
import { cookies } from "next/headers";
import { TermsSignupForm } from "@/components/TermsSignupForm";
import { verifyJwt } from "@/lib/jwt";
import {
  PENDING_COOKIE,
  getJwtSecret,
  sanitizeRedirectUrl,
  type PendingSignupPayload,
} from "@/server/modules/auth";
import { getAuthEnv } from "@/server/modules/auth-runtime";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "소셜 로그인 — MuDeal",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const step = Array.isArray(sp.step) ? sp.step[0] : sp.step;
  const rawRedirect = Array.isArray(sp.redirectUrl) ? sp.redirectUrl[0] : sp.redirectUrl;
  const redirectUrl = sanitizeRedirectUrl(rawRedirect, "/");

  const cfEnv = getAuthEnv();
  const hasRealOAuth = Boolean(cfEnv.KAKAO_CLIENT_ID || cfEnv.GOOGLE_CLIENT_ID);

  let pending: PendingSignupPayload | null = null;
  if (step === "terms") {
    const store = await cookies();
    const raw = store.get(PENDING_COOKIE)?.value;
    if (raw) pending = await verifyJwt<PendingSignupPayload>(raw, getJwtSecret(cfEnv));
  }

  const kakaoHref = `/api/v1/auth/oauth/kakao?redirectUrl=${encodeURIComponent(redirectUrl)}`;
  const googleHref = `/api/v1/auth/oauth/google?redirectUrl=${encodeURIComponent(redirectUrl)}`;

  return (
    <div className="flex flex-1 items-center justify-center bg-surface-variant px-5 py-12">
      <section className="flex w-full max-w-md flex-col gap-6 rounded-lg border border-outline bg-surface p-8 shadow-e1">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">
            {pending ? "약관 동의 후 시작하기" : "간편 로그인으로 시작하기"}
          </h1>
          <p className="mt-2 text-[13px] text-muted">
            {pending
              ? "필수 약관에 동의하면 찜 · 뮤배 팔로우 · 제보를 바로 이용할 수 있어요."
              : "작품 찜, 뮤배 팔로우, 내 캘린더와 할인 제보를 이용할 수 있어요."}
          </p>
        </div>

        {pending ? (
          <TermsSignupForm defaultNickname={pending.nickname} />
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <a
                href={kakaoHref}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-curtain-noir px-4 text-[15px] font-semibold text-on-curtain-noir transition-colors hover:bg-mulberry"
              >
                <span className="material-symbols-outlined text-lg text-gold-soft" aria-hidden="true">
                  chat_bubble
                </span>
                <span>카카오로 시작하기</span>
              </a>

              <a
                href={googleHref}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-sm border border-outline-strong bg-surface px-4 text-[15px] font-semibold text-on-surface transition-colors hover:bg-surface-variant"
              >
                <span className="material-symbols-outlined text-lg text-primary" aria-hidden="true">
                  account_circle
                </span>
                <span>Google 계정으로 계속하기</span>
              </a>
            </div>

            {!hasRealOAuth && (
              <div className="rounded-md border border-outline bg-surface-variant p-3.5 text-xs text-muted">
                <p className="font-semibold text-on-surface">로컬 개발 모드 (OAuth 키 미설정)</p>
                <p className="mt-1">
                  카카오를 누르면 일반 회원(대학로산책), Google을 누르면 관리자(MuDeal운영)로 바로
                  로그인해요.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <a
                    href={`${kakaoHref}&as=new`}
                    className="rounded-xs border border-outline bg-surface px-2.5 py-1 font-semibold text-primary hover:bg-rose-mist"
                  >
                    신규 가입(약관 동의) 테스트 →
                  </a>
                </div>
              </div>
            )}

            <p className="text-center text-xs text-muted">
              로그인하면 이용약관과 개인정보처리방침에 동의하게 돼요.
            </p>
          </>
        )}

      </section>
    </div>
  );
}
