"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

function toSafeInternalPath(url: unknown): string {
  if (typeof url !== "string") return "/";
  if (!url.startsWith("/") || url.includes("//") || url.includes("\\") || /[\u0000-\u001F\u007F]/.test(url)) {
    return "/";
  }
  return url;
}

export function TermsSignupForm({ defaultNickname }: { defaultNickname: string }) {
  const router = useRouter();
  const [nickname, setNickname] = useState(defaultNickname);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nickname.trim()) {
      setError("사용할 닉네임을 입력해 주세요.");
      return;
    }
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
        body: JSON.stringify({ agreedTerms: true, agreedPrivacy: true, nickname: nickname.trim() }),
      });
      const json = (await res.json()) as { data?: { redirectUrl: string }; error?: { message: string } };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "가입을 마치지 못했어요. 다시 시도해 주세요.");
        return;
      }
      router.push(toSafeInternalPath(json.data.redirectUrl));
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
          placeholder="예: 대학로산책"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          className="h-10 w-full rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface placeholder:text-hint focus:border-secondary focus:bg-surface focus:outline-none"
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-sm text-body">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={agreedTerms}
            onChange={(e) => setAgreedTerms(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span>[필수] 서비스 이용약관 동의</span>
        </label>
        <Link href="/terms" target="_blank" className="text-xs text-muted underline hover:text-primary">
          보기
        </Link>
      </div>

      <div className="flex items-center justify-between gap-2 text-sm text-body">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={agreedPrivacy}
            onChange={(e) => setAgreedPrivacy(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span>[필수] 개인정보 최소 수집·이용 동의</span>
        </label>
        <Link href="/privacy" target="_blank" className="text-xs text-muted underline hover:text-primary">
          보기
        </Link>
      </div>

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
