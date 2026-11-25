"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TermsSignupForm({ defaultNickname }: { defaultNickname: string }) {
  const router = useRouter();
  const [nickname, setNickname] = useState(defaultNickname);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreedTerms || !agreedPrivacy) {
      setError("필수 이용약관과 개인정보처리방침에 모두 동의해 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/complete-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agreedTerms: true, agreedPrivacy: true, nickname }),
      });
      const json = (await res.json()) as { data?: { redirectUrl: string }; error?: { message: string } };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "가입 완료 처리에 실패했습니다.");
        return;
      }
      router.push(json.data.redirectUrl);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="signup-nickname" className="mb-1.5 block text-xs font-semibold text-on-surface">
          표시 닉네임 (제보 시 사용)
        </label>
        <input
          id="signup-nickname"
          type="text"
          maxLength={20}
          required
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          className="h-10 w-full rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface focus:border-secondary focus:bg-surface focus:outline-none"
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-body">
        <input
          type="checkbox"
          checked={agreedTerms}
          onChange={(e) => setAgreedTerms(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        <span>[필수] 서비스 이용약관 동의</span>
      </label>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-body">
        <input
          type="checkbox"
          checked={agreedPrivacy}
          onChange={(e) => setAgreedPrivacy(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        <span>[필수] 개인정보 최소 수집·이용 동의</span>
      </label>

      {error && <p className="text-xs font-semibold text-urgent">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="h-12 w-full rounded-sm bg-secondary text-[15px] font-semibold text-on-secondary shadow-cta transition-colors hover:bg-secondary-hover disabled:opacity-60"
      >
        {busy ? "처리 중..." : "동의하고 시작하기"}
      </button>
    </form>
  );
}
