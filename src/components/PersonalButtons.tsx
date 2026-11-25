"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { serializeSearchParams } from "@/lib/url";

/** Square 44x44 icon wish button (Stitch mudeal_3 parity). */
export function WishButton({
  showId,
  initialBookmarked,
}: {
  showId: number;
  initialBookmarked: boolean;
}) {
  const router = useRouter();
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/me/bookmarks/shows/${showId}`, {
        method: bookmarked ? "DELETE" : "POST",
      });
      if (res.status === 401) {
        router.push(`/login?redirectUrl=${encodeURIComponent(`/shows/${showId}`)}`);
        return;
      }
      if (res.ok) setBookmarked(!bookmarked);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-label={bookmarked ? "작품 찜 해제" : "작품 찜하기"}
      aria-pressed={bookmarked}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-sm border transition-colors ${
        bookmarked
          ? "border-secondary bg-rose-mist text-secondary"
          : "border-outline bg-surface text-on-surface-variant hover:bg-surface-variant"
      }`}
    >
      <span className="material-symbols-outlined text-xl" aria-hidden="true">
        favorite
      </span>
    </button>
  );
}

/** Unified actor follow toggle across Actor Detail (md) and Show Detail cast list (sm). */
export function FollowActorButton({
  actorId,
  initialFollowed,
  size = "md",
}: {
  actorId: number;
  initialFollowed: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [followed, setFollowed] = useState(initialFollowed);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/me/follows/actors/${actorId}`, {
        method: followed ? "DELETE" : "POST",
      });
      if (res.status === 401) {
        router.push(`/login?redirectUrl=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (res.ok) {
        setFollowed(!followed);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const dims =
    size === "sm" ? "h-8 w-24 rounded-xs text-xs" : "h-10 w-28 rounded-sm text-[13px]";
  const tone = followed
    ? "border-secondary bg-rose-mist text-primary"
    : "border-outline bg-surface text-on-surface-variant hover:bg-surface-variant";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={followed}
      className={`inline-flex shrink-0 items-center justify-center border font-semibold transition-colors ${dims} ${tone}`}
    >
      {followed ? "팔로우 중 ✓" : "+ 팔로우"}
    </button>
  );
}

export function AddShowToCalendarButton({
  showId,
  showTitle,
  todayKst,
}: {
  showId: number;
  showTitle: string;
  todayKst: string;
}) {
  const router = useRouter();
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (busy || added) return;
    setBusy(true);
    try {
      const res = await fetch("/api/v1/me/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventDate: todayKst,
          category: "WATCH",
          title: showTitle.slice(0, 80),
          sourceShowId: showId,
        }),
      });
      if (res.status === 401) {
        router.push(`/login?redirectUrl=${encodeURIComponent(`/shows/${showId}`)}`);
        return;
      }
      if (res.ok) setAdded(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={busy || added}
      className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border text-[13px] font-semibold transition-colors ${
        added
          ? "border-secondary bg-rose-mist text-primary"
          : "border-outline bg-surface text-on-surface hover:bg-surface-variant"
      }`}
    >
      <span className="material-symbols-outlined text-lg text-primary" aria-hidden="true">
        calendar_add_on
      </span>
      <span>{added ? "내 캘린더에 담김 ✓" : "내 캘린더에 담기"}</span>
    </button>
  );
}

export interface PresetItem {
  id: number;
  name: string;
  queryParamsJson: string;
}

export function presetToHref(queryParamsJson: string): string {
  try {
    const obj = JSON.parse(queryParamsJson) as Record<string, string | number | boolean | string[]>;
    const qs = serializeSearchParams(obj);
    return qs ? `/search?${qs}` : "/search";
  } catch {
    return "/search";
  }
}

export function SearchPresetsBar({
  initialPresets,
  currentParams,
  isLoggedIn,
}: {
  initialPresets: PresetItem[];
  currentParams: Record<string, unknown>;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [presets, setPresets] = useState<PresetItem[]>(initialPresets);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function savePreset(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    const res = await fetch("/api/v1/me/search-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), queryParamsJson: JSON.stringify(currentParams) }),
    });
    const json = (await res.json()) as { data?: PresetItem; error?: { message: string } };
    if (!res.ok || !json.data) {
      setError(json.error?.message ?? "프리셋 저장에 실패했습니다.");
      return;
    }
    setPresets((prev) => [json.data!, ...prev]);
    setName("");
    setAdding(false);
  }

  async function removePreset(id: number) {
    const res = await fetch(`/api/v1/me/search-presets/${id}`, { method: "DELETE" });
    if (res.ok) setPresets((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-muted">내 프리셋</span>
      {presets.map((p) => (
        <span
          key={p.id}
          className="inline-flex h-8 items-center gap-1 rounded-xs border border-outline bg-surface px-3 text-xs font-semibold text-on-surface-variant"
        >
          <Link href={presetToHref(p.queryParamsJson)} className="hover:text-primary">
            {p.name}
          </Link>
          <button
            type="button"
            onClick={() => removePreset(p.id)}
            aria-label={`${p.name} 삭제`}
            className="text-hint hover:text-urgent"
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        <form onSubmit={savePreset} className="inline-flex items-center gap-1.5">
          <input
            type="text"
            maxLength={30}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 대학로 5만원 이하"
            className="h-8 w-40 rounded-xs border border-outline bg-surface px-2.5 text-xs text-on-surface focus:border-secondary focus:outline-none"
          />
          <button
            type="submit"
            className="h-8 rounded-xs bg-primary px-2.5 text-xs font-semibold text-on-primary"
          >
            저장
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="text-xs text-muted hover:text-on-surface"
          >
            취소
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            if (!isLoggedIn) {
              router.push(`/login?redirectUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`);
              return;
            }
            setAdding(true);
          }}
          className="inline-flex h-8 items-center gap-1 rounded-xs border border-outline bg-surface px-3 text-xs font-semibold text-primary hover:bg-rose-mist"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            bookmark_add
          </span>
          <span>현재 조건 저장</span>
        </button>
      )}
      {error && <span className="text-xs font-medium text-urgent">{error}</span>}
    </div>
  );
}
