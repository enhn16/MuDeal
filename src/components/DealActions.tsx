"use client";

import { useState } from "react";

export function OutboundButton({
  dealId,
  externalUrl,
  label = "예매처 이동 ↗",
  variant = "secondary",
  className = "",
}: {
  dealId: number;
  externalUrl: string;
  label?: string;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);

    try {
      const res = await fetch(`/api/v1/deals/${dealId}/clicks`, { method: "POST" });
      if (res.status === 410) {
        setNotice("이미 마감된 딜입니다.");
        return;
      }
      const body = (await res.json()) as { data?: { externalUrl?: string } };
      const target = body.data?.externalUrl ?? externalUrl;
      window.open(target, "_blank", "noopener,noreferrer");
    } catch {
      window.open(externalUrl, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  }

  const base =
    variant === "primary"
      ? "bg-secondary text-on-secondary hover:bg-secondary-hover"
      : "border border-outline bg-surface text-on-surface hover:bg-surface-variant";

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <a
        href={externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className={`inline-flex h-9 items-center justify-center rounded-sm px-3 text-[13px] font-semibold whitespace-nowrap transition-colors ${base} ${className}`}
      >
        {label}
      </a>
      {notice && <span className="text-[11px] font-medium text-urgent">{notice}</span>}
    </span>
  );
}

/** Stitch mudeal_1 parity helpful vote button with thumb_up icon. */
export function HelpfulButton({
  dealId,
  initialCount,
  showCount = false,
}: {
  dealId: number;
  initialCount: number;
  showCount?: boolean;
}) {
  const [count, setCount] = useState(initialCount);
  const [voted, setVoted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/deals/${dealId}/helpful`, { method: "POST" });
      if (!res.ok) return;
      const body = (await res.json()) as { data?: { voted: boolean; helpfulCount: number } };
      if (body.data) {
        setVoted(body.data.voted);
        setCount(body.data.helpfulCount);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={voted}
      className={`inline-flex h-8 items-center justify-center gap-1 rounded-xs border px-3 text-xs font-semibold tabular-nums transition-colors ${
        voted
          ? "border-secondary bg-rose-mist text-primary"
          : "border-outline bg-surface-variant text-on-surface-variant hover:bg-rose-mist hover:text-primary"
      }`}
    >
      <span className="material-symbols-outlined text-sm" aria-hidden="true">
        thumb_up
      </span>
      <span>{voted ? "도움 완료 ✓" : "도움이 됐어요"}</span>
      {showCount && <span>{count}</span>}
    </button>
  );
}

export function ShareLinkButton({
  label = "조건 링크 공유",
  iconOnly = false,
}: {
  label?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  }

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "링크 복사됨" : "공유하기"}
        title={copied ? "링크 복사됨 ✓" : "공유하기"}
        className={`inline-flex h-11 w-11 items-center justify-center rounded-sm border transition-colors ${
          copied
            ? "border-secondary bg-rose-mist text-primary"
            : "border-outline bg-surface text-on-surface-variant hover:bg-surface-variant"
        }`}
      >
        <span className="material-symbols-outlined text-xl" aria-hidden="true">
          {copied ? "check" : "share"}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex h-8 items-center gap-1 rounded-xs border border-outline bg-surface px-3 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-sunken"
    >
      <span className="material-symbols-outlined text-base" aria-hidden="true">
        {copied ? "check" : "share"}
      </span>
      <span>{copied ? "링크 복사됨 ✓" : label}</span>
    </button>
  );
}

export function FlagDealIssueButton({ dealId }: { dealId: number }) {
  const [done, setDone] = useState(false);

  async function reportIssue() {
    const note = window.prompt("품절/가격 불일치 내용을 간단히 입력해 주세요 (취소 시 미접수):");
    if (note === null) return;
    const res = await fetch(`/api/v1/deals/${dealId}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueType: "PRICE_MISMATCH", note: note.trim() || "가격/매진 확인 요청" }),
    });
    if (res.status === 401) {
      window.location.href = `/login?redirectUrl=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    if (res.ok) setDone(true);
  }

  return (
    <button
      type="button"
      onClick={reportIssue}
      disabled={done}
      className="text-xs text-muted underline hover:text-urgent disabled:no-underline"
    >
      {done ? "신고 접수됨 ✓" : "가격 · 매진 오류 신고"}
    </button>
  );
}
