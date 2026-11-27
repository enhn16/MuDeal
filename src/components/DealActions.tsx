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

  function handleClick() {
    if (busy) return;
    setBusy(true);
    setNotice(null);

    void fetch(`/api/v1/deals/${dealId}/clicks`, {
      method: "POST",
      keepalive: true,
    })
      .then((res) => {
        if (res.status === 410) {
          setNotice("이미 마감된 할인이에요. 다른 예매처를 확인해 보세요.");
        }
      })
      .catch(() => {
        // Native <a> navigation already opened the ticketing page synchronously.
      })
      .finally(() => {
        setBusy(false);
      });
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
      {notice && (
        <span role="alert" className="text-[11px] font-medium text-urgent">
          {notice}
        </span>
      )}
    </span>
  );
}

/** Stitch mudeal_1 parity helpful vote button with thumb_up icon. */
export function HelpfulButton({
  dealId,
  initialCount,
  showCount = false,
  onCountChange,
}: {
  dealId: number;
  initialCount: number;
  showCount?: boolean;
  onCountChange?: (nextCount: number, voted: boolean) => void;
}) {
  const [count, setCount] = useState(initialCount);
  const [voted, setVoted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/v1/deals/${dealId}/helpful`, { method: "POST" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const body = (await res.json()) as { data?: { voted: boolean; helpfulCount: number } };
      if (body.data) {
        setVoted(body.data.voted);
        setCount(body.data.helpfulCount);
        onCountChange?.(body.data.helpfulCount, body.data.voted);
      }
    } catch {
      setFailed(true);
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
      <span>{failed ? "다시 시도해 주세요" : voted ? "도움 완료 ✓" : "도움이 됐어요"}</span>
      {showCount && !failed && <span>{count}</span>}
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
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 1800);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2200);
    }
  }

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={copy}
        aria-label={status === "copied" ? "링크를 복사했어요" : "링크 공유하기"}
        title={status === "copied" ? "링크를 복사했어요 ✓" : "링크 공유하기"}
        className={`inline-flex h-11 w-11 items-center justify-center rounded-sm border transition-colors ${
          status === "copied"
            ? "border-secondary bg-rose-mist text-primary"
            : "border-outline bg-surface text-on-surface-variant hover:bg-surface-variant"
        }`}
      >
        <span className="material-symbols-outlined text-xl" aria-hidden="true">
          {status === "copied" ? "check" : "share"}
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
        {status === "copied" ? "check" : "share"}
      </span>
      <span>
        {status === "copied"
          ? "링크를 복사했어요 ✓"
          : status === "error"
            ? "주소를 직접 복사해 주세요"
            : label}
      </span>
    </button>
  );
}

const ISSUE_OPTIONS = [
  { key: "SOLD_OUT", label: "매진됐어요" },
  { key: "PRICE_MISMATCH", label: "가격이 달라요" },
  { key: "BROKEN_LINK", label: "링크가 안 열려요" },
] as const;

export function FlagDealIssueButton({
  dealId,
  dealOptions,
}: {
  dealId: number;
  dealOptions?: Array<{ id: number; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [targetDealId, setTargetDealId] = useState<number>(dealId);
  const [issueType, setIssueType] = useState<(typeof ISSUE_OPTIONS)[number]["key"]>("PRICE_MISMATCH");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveDealId =
    dealOptions && dealOptions.length > 0
      ? dealOptions.some((o) => o.id === targetDealId)
        ? targetDealId
        : dealOptions[0].id
      : dealId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/deals/${effectiveDealId}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueType,
          note: note.trim() || ISSUE_OPTIONS.find((o) => o.key === issueType)?.label,
        }),
      });
      if (res.status === 401) {
        const currentUrl = window.location.pathname + window.location.search;
        window.location.href = `/login?redirectUrl=${encodeURIComponent(currentUrl)}`;
        return;
      }
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(body.error?.message ?? "이미 같은 내용으로 오류를 신고해 주셨어요.");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(body.error?.message ?? "신고를 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setDone(true);
      setOpen(false);
    } catch {
      setError("연결이 원활하지 않아요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <span role="status" className="text-xs font-semibold text-primary">
        오류 신고를 접수했어요 ✓
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => {
          setTargetDealId(dealId);
          setError(null);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="inline-flex min-h-8 items-center text-xs text-muted underline hover:text-urgent"
      >
        {open ? "닫기" : "가격 · 매진 오류 신고"}
      </button>

      {open && (
        <form
          onSubmit={submit}
          className="flex w-full max-w-sm flex-col gap-2.5 rounded-md border border-outline bg-surface-variant p-3.5 text-left"
        >
          {dealOptions && dealOptions.length > 1 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="flag-deal-target" className="text-xs font-semibold text-on-surface">
                신고할 예매처 · 할인
              </label>
              <select
                id="flag-deal-target"
                value={effectiveDealId}
                onChange={(e) => setTargetDealId(Number(e.target.value))}
                className="h-9 rounded-xs border border-outline bg-surface px-2.5 text-xs text-on-surface focus:border-secondary focus:outline-none"
              >
                {dealOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <span className="text-xs font-semibold text-on-surface">어떤 문제가 있나요?</span>
          <div className="flex flex-wrap gap-1.5">
            {ISSUE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                aria-pressed={issueType === opt.key}
                onClick={() => setIssueType(opt.key)}
                className={`h-8 rounded-xs border px-2.5 text-xs font-semibold transition-colors ${
                  issueType === opt.key
                    ? "border-secondary bg-rose-mist text-primary"
                    : "border-outline bg-surface text-on-surface-variant"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            aria-label="오류 상세 내용"
            maxLength={120}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="자세한 내용을 적어주시면 더 빨리 확인해요 (선택)"
            className="h-9 rounded-xs border border-outline bg-surface px-2.5 text-xs text-on-surface focus:border-secondary focus:outline-none"
          />
          {error && (
            <p role="alert" className="text-xs font-medium text-urgent">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-8 rounded-xs border border-outline bg-surface px-3 text-xs font-semibold text-muted"
            >
              닫기
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-8 rounded-xs bg-secondary px-3 text-xs font-semibold text-on-secondary hover:bg-secondary-hover disabled:opacity-60"
            >
              {busy ? "접수 중..." : "신고하기"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
