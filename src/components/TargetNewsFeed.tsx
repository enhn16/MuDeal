"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatKstDateTime } from "@/lib/kst";

interface FeedItem {
  id: number;
  title: string;
  body: string;
  showId: number | null;
  dealId: number | null;
  isSaved: number;
  createdAt: string;
}

/** Shared news feed card (Stitch mudeal_3 & mudeal_5 parity). */
export function TargetNewsFeed({
  targetType,
  targetId,
  heading,
  isLoggedIn,
  todayKst,
}: {
  targetType: "SHOW" | "ACTOR";
  targetId: number;
  heading: string;
  isLoggedIn: boolean;
  todayKst: string;
}) {
  const router = useRouter();
  const [showPast, setShowPast] = useState(false);
  const [unreadItems, setUnreadItems] = useState<FeedItem[]>([]);
  const [recentItems, setRecentItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(isLoggedIn);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [calBusyId, setCalBusyId] = useState<number | null>(null);
  const [calAdded, setCalAdded] = useState<Record<number, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  async function fetchFeed(mode: "unread" | "recent") {
    const qs = new URLSearchParams({
      mode,
      ...(targetType === "ACTOR" ? { actorId: String(targetId) } : { showId: String(targetId) }),
      ...(mode === "unread" ? { autoMarkRead: "true" } : {}),
    });
    const res = await fetch(`/api/v1/me/notifications?${qs.toString()}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { items: FeedItem[] } };
    return json.data?.items ?? [];
  }

  useEffect(() => {
    if (!isLoggedIn) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const unread = await fetchFeed("unread");
        if (!active) return;
        setUnreadItems(unread);
        if (unread.length > 0) router.refresh();
      } catch {
        if (active) setActionError("소식을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, targetType, targetId]);

  async function toggleHistory() {
    if (historyLoading) return;
    setActionError(null);
    if (!showPast && recentItems.length === 0) {
      setHistoryLoading(true);
      try {
        const past = await fetchFeed("recent");
        setRecentItems(past);
      } catch {
        setActionError("지난 소식을 불러오지 못했어요. 다시 시도해 주세요.");
        return;
      } finally {
        setHistoryLoading(false);
      }
    }
    setShowPast((v) => !v);
  }

  async function toggleSave(item: FeedItem) {
    if (savingId === item.id) return;
    setSavingId(item.id);
    setActionError(null);
    const next = !item.isSaved;
    try {
      const res = await fetch(`/api/v1/me/notifications/${item.id}/save`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSaved: next }),
      });
      if (!res.ok) {
        setActionError("소식 저장 상태를 바꾸지 못했어요. 다시 시도해 주세요.");
        return;
      }
      const update = (list: FeedItem[]) =>
        list.map((n) => (n.id === item.id ? { ...n, isSaved: next ? 1 : 0 } : n));
      setUnreadItems(update);
      setRecentItems(update);
    } catch {
      setActionError("연결이 원활하지 않아요. 다시 시도해 주세요.");
    } finally {
      setSavingId(null);
    }
  }

  async function addToCalendar(item: FeedItem) {
    if (calBusyId === item.id || calAdded[item.id]) return;
    setCalBusyId(item.id);
    setActionError(null);
    try {
      const res = await fetch("/api/v1/me/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventDate: todayKst,
          category: "EVENT",
          title: item.title.slice(0, 80),
          memo: item.body.slice(0, 200),
          sourceShowId: item.showId,
          sourceDealId: item.dealId,
        }),
      });
      if (!res.ok) {
        setActionError("캘린더에 담지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setCalAdded((prev) => ({ ...prev, [item.id]: true }));
    } catch {
      setActionError("연결이 원활하지 않아요. 다시 시도해 주세요.");
    } finally {
      setCalBusyId(null);
    }
  }

  const displayed = showPast ? recentItems : unreadItems;

  return (
    <section
      id="news-feed"
      className="flex flex-col gap-4 rounded-lg border border-outline bg-surface p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-on-surface">{heading}</h2>
        {isLoggedIn && (
          <button
            type="button"
            disabled={historyLoading}
            onClick={toggleHistory}
            aria-pressed={showPast}
            className={`inline-flex h-9 items-center justify-center gap-1 rounded-xs border px-3 text-xs font-semibold transition-colors disabled:opacity-60 ${
              showPast
                ? "border-secondary bg-rose-mist text-primary"
                : "border-outline bg-surface text-on-surface-variant hover:bg-surface-variant"
            }`}
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              history
            </span>
            <span>{historyLoading ? "불러오는 중..." : "최근 소식 다시 보기"}</span>
          </button>
        )}
      </div>

      {actionError && (
        <p role="alert" className="rounded-sm border border-urgent bg-urgent-wash px-3 py-2 text-xs font-semibold text-urgent">
          {actionError}
        </p>
      )}

      {!isLoggedIn ? (
        <p className="text-sm text-muted">
          <Link
            href={`/login?redirectUrl=${encodeURIComponent(
              targetType === "ACTOR" ? `/actors/${targetId}#news-feed` : `/shows/${targetId}/feed#news-feed`,
            )}`}
            className="font-semibold text-primary hover:underline"
          >
            로그인
          </Link>
          하면 새 소식 피드·저장하기·캘린더에 담기를 이용할 수 있어요.
        </p>
      ) : loading ? (
        <p className="text-xs text-muted">소식을 불러오는 중이에요...</p>
      ) : displayed.length === 0 ? (
        <p className="text-sm text-muted">
          {showPast
            ? "최근 30일 내 등록된 소식이 없어요."
            : "아직 확인하지 않은 새 소식이 없어요. 오른쪽 '최근 소식 다시 보기'에서 30일 내 소식을 볼 수 있어요."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {displayed.map((item) => (
            <article
              key={item.id}
              className="flex flex-col gap-3 rounded-md border border-outline bg-surface-variant p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-xs px-2 py-0.5 text-xs font-semibold ${
                      showPast
                        ? "bg-surface-sunken text-on-surface-variant"
                        : "bg-rose-mist text-primary"
                    }`}
                  >
                    {showPast ? "지난 소식 (30일)" : targetType === "ACTOR" ? "배우 새 소식" : "작품 새 소식"}
                  </span>
                  <span className="text-[15px] font-semibold text-on-surface">{item.title}</span>
                </div>
                <span className="text-xs text-muted tabular-nums">
                  {formatKstDateTime(item.createdAt)} 업데이트
                </span>
              </div>

              <p className="text-sm text-on-surface-variant">{item.body}</p>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline pt-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={savingId === item.id}
                    onClick={() => toggleSave(item)}
                    aria-pressed={Boolean(item.isSaved)}
                    className={`inline-flex h-8 w-28 items-center justify-center gap-1 rounded-xs border text-xs font-semibold transition-colors disabled:opacity-60 ${
                      item.isSaved
                        ? "border-secondary bg-rose-mist text-primary"
                        : "border-outline bg-surface text-on-surface-variant hover:bg-rose-mist hover:text-primary"
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm" aria-hidden="true">
                      bookmark
                    </span>
                    <span>{item.isSaved ? "저장됨 ✓" : "저장하기"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => addToCalendar(item)}
                    disabled={calBusyId === item.id || Boolean(calAdded[item.id])}
                    aria-pressed={Boolean(calAdded[item.id])}
                    className={`inline-flex h-8 w-32 items-center justify-center gap-1 rounded-xs border text-xs font-semibold transition-colors disabled:opacity-60 ${
                      calAdded[item.id]
                        ? "border-secondary bg-rose-mist text-primary"
                        : "border-outline bg-surface text-on-surface-variant hover:bg-rose-mist hover:text-primary"
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm" aria-hidden="true">
                      calendar_add_on
                    </span>
                    <span>
                      {calBusyId === item.id
                        ? "담는 중..."
                        : calAdded[item.id]
                          ? "캘린더 담김 ✓"
                          : "캘린더에 담기"}
                    </span>
                  </button>
                </div>

                {targetType === "ACTOR" && item.showId && (
                  <Link
                    href={`/shows/${item.showId}`}
                    className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <span>작품 가격 비교 보기</span>
                    <span className="material-symbols-outlined text-base" aria-hidden="true">
                      chevron_right
                    </span>
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
