"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { formatKstDate } from "@/lib/kst";
import type { AuthUser } from "@/server/modules/auth";
import type { CalendarAutoEvent, CalendarSavedEvent } from "@/server/modules/personal";

function StoryThumbnail({
  name,
  posterUrl,
  isUnread,
}: {
  name: string;
  posterUrl: string | null;
  isUnread: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (posterUrl && !failed) {
    return (
      <img
        src={posterUrl}
        alt={name}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-14 w-14 rounded-sm object-cover"
      />
    );
  }

  return (
    <span
      className={`flex h-14 w-14 items-center justify-center rounded-sm text-lg font-bold ${
        isUnread ? "bg-curtain-noir text-gold-soft" : "bg-surface-sunken text-primary"
      }`}
    >
      {name.slice(0, 1)}
    </span>
  );
}

interface StoryTarget {
  targetType: "SHOW" | "ACTOR";
  targetId: number;
  name: string;
  posterUrl: string | null;
  unreadCount: number;
}

interface NotificationItem {
  id: number;
  showId: number | null;
  title: string;
  body: string;
  isSaved: number;
}

interface MyReportItem {
  id: number;
  reportedShowTitle: string;
  channelName: string;
  conditionNote: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectReasonNote: string | null;
  createdAt: string;
}

type MyTab = "calendar" | "saved";

function getMonthGrid(year: number, monthIndex: number) {
  const firstDow = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: Array<{ day: number; iso: string } | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  const mm = String(monthIndex + 1).padStart(2, "0");
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, iso: `${year}-${mm}-${String(d).padStart(2, "0")}` });
  }
  return cells;
}

export function MyPageWorkspace({
  user,
  todayKst,
  bookmarkCount,
  followedCount,
  initialStories,
  initialSavedNotifications,
  initialAutoEvents,
  initialSavedEvents,
  initialReports,
}: {
  user: AuthUser;
  todayKst: string;
  bookmarkCount: number;
  followedCount: number;
  initialStories: StoryTarget[];
  initialSavedNotifications: NotificationItem[];
  initialAutoEvents: CalendarAutoEvent[];
  initialSavedEvents: CalendarSavedEvent[];
  initialReports: { totalClicks: number; totalHelpful: number; items: MyReportItem[] };
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState(user.nickname);
  const [editingNick, setEditingNick] = useState(false);
  const [nickDraft, setNickDraft] = useState(user.nickname);
  const [savedNotis, setSavedNotis] = useState(initialSavedNotifications);

  // Only 2 tabs: 내 캘린더 & 저장한 소식
  const [tab, setTab] = useState<MyTab>("calendar");

  // Calendar state
  const [calYear, setCalYear] = useState(() => Number(todayKst.slice(0, 4)));
  const [calMonth, setCalMonth] = useState(() => Number(todayKst.slice(5, 7)) - 1);
  const [selectedDate, setSelectedDate] = useState(todayKst);
  const [autoEvents, setAutoEvents] = useState(initialAutoEvents);
  const [savedEvents, setSavedEvents] = useState(initialSavedEvents);
  const [addingEvent, setAddingEvent] = useState(false);
  const [evTitle, setEvTitle] = useState("");
  const [evTime, setEvTime] = useState("");
  const [evMemo, setEvMemo] = useState("");
  const [evCategory, setEvCategory] = useState<"WATCH" | "TICKETING" | "EVENT" | "CUSTOM">("WATCH");
  const [evError, setEvError] = useState<string | null>(null);
  const [evBusy, setEvBusy] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null);
  const [calLoading, setCalLoading] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);
  const monthReqSeqRef = useRef(0);
  const monthAbortRef = useRef<AbortController | null>(null);

  const [nickBusy, setNickBusy] = useState(false);
  const [nickError, setNickError] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [unsavingId, setUnsavingId] = useState<number | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [withdrawConfirm, setWithdrawConfirm] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  async function saveNickname() {
    if (nickBusy) return;
    const trimmed = nickDraft.trim();
    if (!trimmed) {
      setNickError("닉네임을 입력해 주세요.");
      return;
    }
    setNickBusy(true);
    setNickError(null);
    try {
      const res = await fetch("/api/v1/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: trimmed }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setNickError(json.error?.message ?? "닉네임을 바꾸지 못했어요. 다시 시도해 주세요.");
        return;
      }
      setNickname(trimmed);
      setEditingNick(false);
      router.refresh();
    } catch {
      setNickError("연결이 원활하지 않아요. 다시 시도해 주세요.");
    } finally {
      setNickBusy(false);
    }
  }

  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setNickError(null);
    try {
      const res = await fetch("/api/v1/auth/logout", { method: "POST" });
      if (!res.ok) {
        setNickError("로그아웃을 처리하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setNickError("연결이 원활하지 않아요. 다시 시도해 주세요.");
    } finally {
      setLogoutBusy(false);
    }
  }

  async function withdrawAccount() {
    if (withdrawBusy) return;
    setWithdrawBusy(true);
    setWithdrawError(null);
    try {
      const res = await fetch("/api/v1/me", { method: "DELETE" });
      if (!res.ok) {
        setWithdrawError("탈퇴를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setWithdrawError("연결이 원활하지 않아요. 다시 시도해 주세요.");
    } finally {
      setWithdrawBusy(false);
    }
  }

  async function unsaveNoti(id: number) {
    if (unsavingId === id) return;
    setUnsavingId(id);
    setSavedError(null);
    try {
      const res = await fetch(`/api/v1/me/notifications/${id}/save`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSaved: false }),
      });
      if (!res.ok) {
        setSavedError("소식 저장을 해제하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      setSavedNotis((prev) => prev.filter((n) => n.id !== id));
    } catch {
      setSavedError("연결이 원활하지 않아요. 다시 시도해 주세요.");
    } finally {
      setUnsavingId(null);
    }
  }

  async function changeMonth(delta: number) {
    const d = new Date(Date.UTC(calYear, calMonth + delta, 1));
    const nextY = d.getUTCFullYear();
    const nextM = d.getUTCMonth();
    setCalYear(nextY);
    setCalMonth(nextM);
    const mm = String(nextM + 1).padStart(2, "0");
    const nextPrefix = `${nextY}-${mm}`;
    setSelectedDate(todayKst.startsWith(nextPrefix) ? todayKst : `${nextPrefix}-01`);
    const lastDay = String(new Date(Date.UTC(nextY, nextM + 1, 0)).getUTCDate()).padStart(2, "0");

    monthAbortRef.current?.abort();
    const controller = new AbortController();
    monthAbortRef.current = controller;
    const seq = ++monthReqSeqRef.current;

    setCalLoading(true);
    setCalError(null);
    try {
      const res = await fetch(`/api/v1/me/calendar?from=${nextY}-${mm}-01&to=${nextY}-${mm}-${lastDay}`, {
        signal: controller.signal,
      });
      if (seq !== monthReqSeqRef.current) return;
      if (!res.ok) {
        setCalError("해당 월의 일정을 불러오지 못했어요. 다시 시도해 주세요.");
        return;
      }
      const json = (await res.json()) as {
        data: { autoEvents: CalendarAutoEvent[]; savedEvents: CalendarSavedEvent[] };
      };
      if (seq !== monthReqSeqRef.current) return;
      setAutoEvents(json.data.autoEvents);
      setSavedEvents(json.data.savedEvents);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (seq === monthReqSeqRef.current) {
        setCalError("연결이 원활하지 않아 일정을 불러오지 못했어요.");
      }
    } finally {
      if (seq === monthReqSeqRef.current) {
        setCalLoading(false);
      }
    }
  }

  async function submitCalendarEvent(e: React.FormEvent) {
    e.preventDefault();
    if (evBusy) return;
    setEvBusy(true);
    setEvError(null);
    try {
      const res = await fetch("/api/v1/me/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventDate: selectedDate,
          eventTime: evTime || null,
          category: evCategory,
          title: evTitle,
          memo: evMemo || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: CalendarSavedEvent;
        error?: { message: string };
      };
      if (!res.ok || !json.data) {
        setEvError(json.error?.message ?? "일정을 저장하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      setSavedEvents((prev) => [...prev, { ...json.data!, readOnly: false }]);
      setEvTitle("");
      setEvTime("");
      setEvMemo("");
      setAddingEvent(false);
    } catch {
      setEvError("연결이 원활하지 않아요. 다시 시도해 주세요.");
    } finally {
      setEvBusy(false);
    }
  }

  async function removeCalendarEvent(id: number) {
    if (deletingEventId === id) return;
    setDeletingEventId(id);
    setEvError(null);
    try {
      const res = await fetch(`/api/v1/me/calendar/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setEvError("일정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setSavedEvents((prev) => prev.filter((e) => e.id !== id));
      setConfirmDeleteId(null);
    } catch {
      setEvError("연결이 원활하지 않아요. 다시 시도해 주세요.");
    } finally {
      setDeletingEventId(null);
    }
  }

  const cells = useMemo(() => getMonthGrid(calYear, calMonth), [calYear, calMonth]);
  const eventDotsByDate = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of autoEvents) {
      const set = map.get(e.eventDate) ?? new Set();
      set.add(e.category);
      map.set(e.eventDate, set);
    }
    for (const e of savedEvents) {
      const set = map.get(e.eventDate) ?? new Set();
      set.add("SAVED");
      map.set(e.eventDate, set);
    }
    return map;
  }, [autoEvents, savedEvents]);

  const dayAutoEvents = autoEvents.filter((e) => e.eventDate === selectedDate);
  const daySavedEvents = savedEvents.filter((e) => e.eventDate === selectedDate);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-5 py-7 lg:px-0">
      {/* 1. Profile Summary & Story Bar (links directly to Show/Actor detail #news-feed) */}
      <section className="flex flex-col gap-5 rounded-lg border border-outline bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-outline pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-sm bg-curtain-noir text-lg font-bold text-gold-soft">
              {nickname.slice(0, 1)}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-on-surface">{nickname}</h1>
                <span className="rounded-xs bg-rose-mist px-2 py-0.5 text-xs font-semibold text-primary">
                  {user.oauthProvider === "KAKAO" ? "카카오 연동" : "Google 연동"}
                </span>
              </div>
              <p className="mt-0.5 text-[13px] text-muted tabular-nums">
                찜한 작품 {bookmarkCount} · 팔로우 배우 {followedCount} · 내 제보 도움{" "}
                {initialReports.totalHelpful}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {editingNick ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  aria-label="새 닉네임"
                  maxLength={20}
                  value={nickDraft}
                  onChange={(e) => setNickDraft(e.target.value)}
                  className="h-9 w-40 rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface focus:border-secondary focus:bg-surface focus:outline-none"
                />
                <button
                  type="button"
                  disabled={nickBusy}
                  onClick={saveNickname}
                  className="h-9 rounded-sm bg-secondary px-3 text-xs font-semibold text-on-secondary hover:bg-secondary-hover disabled:opacity-60"
                >
                  {nickBusy ? "저장 중..." : "저장"}
                </button>
                <button
                  type="button"
                  disabled={nickBusy}
                  onClick={() => {
                    setEditingNick(false);
                    setNickError(null);
                  }}
                  className="h-9 rounded-sm border border-outline px-2.5 text-xs font-semibold text-muted"
                >
                  취소
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNickDraft(nickname);
                  setNickError(null);
                  setEditingNick(true);
                }}
                className="inline-flex h-9 items-center gap-1 rounded-sm border border-outline bg-surface px-3 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant"
              >
                <span className="material-symbols-outlined text-base" aria-hidden="true">
                  edit
                </span>
                <span>닉네임 수정</span>
              </button>
            )}
            <button
              type="button"
              disabled={logoutBusy}
              onClick={logout}
              className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs font-semibold text-muted hover:bg-surface-variant hover:text-urgent disabled:opacity-60"
            >
              {logoutBusy ? "로그아웃 중..." : "로그아웃"}
            </button>
          </div>
          {nickError && (
            <p role="alert" className="w-full text-xs font-semibold text-urgent">
              {nickError}
            </p>
          )}
        </div>

        {/* Story Bar -> clicking goes directly to /shows/[id]/feed or /actors/[id]#news-feed */}
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-on-surface">내 뮤배 · 찜 작품 새 소식</span>

          {initialStories.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-variant px-4 py-3 text-xs text-muted">
              <span>작품을 찜하거나 배우를 팔로우하면 프로필이 이곳에 모여요.</span>
              <Link href="/" className="font-semibold text-primary hover:underline">
                공연 둘러보기 →
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-5 overflow-x-auto pb-1">
              {initialStories.map((story) => {
                const isUnread = story.unreadCount > 0;
                const ring = isUnread
                  ? story.targetType === "ACTOR"
                    ? "border-2 border-primary"
                    : "border-2 border-secondary"
                  : "border border-outline";
                const href =
                  story.targetType === "ACTOR"
                    ? `/actors/${story.targetId}#news-feed`
                    : `/shows/${story.targetId}/feed`;

                return (
                  <Link
                    key={`${story.targetType}-${story.targetId}`}
                    href={href}
                    className="group flex shrink-0 flex-col items-center gap-1.5"
                  >
                    <span className={`rounded-md bg-surface p-1 ${ring}`}>
                      <StoryThumbnail
                        name={story.name}
                        posterUrl={story.posterUrl}
                        isUnread={isUnread}
                      />
                    </span>
                    <span
                      className={`max-w-16 truncate text-xs font-semibold ${
                        isUnread ? "text-primary" : "text-muted"
                      } group-hover:underline`}
                    >
                      {story.name.replace(/^뮤지컬\s*<|>.*$/g, "")}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 2. MY 2-Tab Workspace: 내 캘린더 & 저장한 소식 */}
      <section className="flex flex-col gap-6 rounded-lg border border-outline bg-surface p-6">
        <div role="tablist" aria-label="MY 메뉴" className="flex items-center gap-6 border-b border-outline">
          {(
            [
              ["calendar", "내 캘린더"],
              ["saved", "저장한 소식"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`h-11 border-b-2 px-2 text-[15px] font-semibold whitespace-nowrap transition-colors ${
                tab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Panel 1: 내 캘린더 */}
        {tab === "calendar" && (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
            <div className="flex flex-col gap-4 rounded-md border border-outline p-5 lg:col-span-7">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-on-surface tabular-nums">
                    {calYear}년 {calMonth + 1}월
                  </h2>
                  {calLoading && <span className="text-xs text-muted">불러오는 중...</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="이전 달"
                    onClick={() => changeMonth(-1)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xs border border-outline text-on-surface-variant hover:bg-surface-variant"
                  >
                    <span className="material-symbols-outlined text-base" aria-hidden="true">
                      chevron_left
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="다음 달"
                    onClick={() => changeMonth(1)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xs border border-outline text-on-surface-variant hover:bg-surface-variant"
                  >
                    <span className="material-symbols-outlined text-base" aria-hidden="true">
                      chevron_right
                    </span>
                  </button>
                </div>
              </div>

              {calError && (
                <p role="alert" className="rounded-xs border border-urgent bg-urgent-wash px-3 py-2 text-xs font-semibold text-urgent">
                  {calError}
                </p>
              )}

              <div className="grid grid-cols-7 border-b border-outline pb-2 text-center text-xs font-semibold">
                <span className="text-secondary">일</span>
                <span className="text-muted">월</span>
                <span className="text-muted">화</span>
                <span className="text-muted">수</span>
                <span className="text-muted">목</span>
                <span className="text-muted">금</span>
                <span className="text-on-surface-variant">토</span>
              </div>

              <div className="grid grid-cols-7 gap-y-1.5 text-center tabular-nums">
                {cells.map((cell, idx) => {
                  if (!cell) return <div key={`empty-${idx}`} />;
                  const isSelected = cell.iso === selectedDate;
                  const dots = eventDotsByDate.get(cell.iso);
                  const dow = idx % 7;
                  const hasEvents = Boolean(dots && dots.size > 0);
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      aria-label={`${calYear}년 ${calMonth + 1}월 ${cell.day}일${hasEvents ? " (일정 있음)" : ""}`}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedDate(cell.iso)}
                      className="flex min-h-11 flex-col items-center justify-center py-1"
                    >
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] ${
                          isSelected
                            ? "bg-primary font-semibold text-on-primary"
                            : dow === 0
                              ? "text-secondary hover:bg-rose-mist"
                              : dow === 6
                                ? "font-semibold text-on-surface-variant hover:bg-surface-sunken"
                                : "text-on-surface hover:bg-surface-sunken"
                        }`}
                      >
                        {cell.day}
                      </span>
                      <span className="mt-1 flex h-1.5 gap-1">
                        {dots?.has("LOTTERY") && <span className="h-1.5 w-1.5 rounded-full bg-champagne-gold" />}
                        {(dots?.has("STAGE_EVENT") || dots?.has("SAVED")) && (
                          <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-4 lg:col-span-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-on-surface tabular-nums">
                  {selectedDate} 일정
                </h3>
                <button
                  type="button"
                  onClick={() => setAddingEvent((v) => !v)}
                  className="inline-flex h-9 items-center gap-1 rounded-sm border border-outline bg-surface px-3 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant hover:text-primary"
                >
                  <span className="material-symbols-outlined text-base" aria-hidden="true">
                    add
                  </span>
                  <span>일정 직접 추가</span>
                </button>
              </div>

              {addingEvent && (
                <form
                  onSubmit={submitCalendarEvent}
                  className="flex flex-col gap-2.5 rounded-md border border-outline bg-surface-variant p-4"
                >
                  <div className="flex gap-2">
                    <select
                      aria-label="일정 유형"
                      value={evCategory}
                      onChange={(e) => setEvCategory(e.target.value as typeof evCategory)}
                      className="h-9 rounded-sm border border-outline bg-surface px-2 text-xs text-on-surface"
                    >
                      <option value="WATCH">관극</option>
                      <option value="TICKETING">티켓팅</option>
                      <option value="CUSTOM">직접 입력</option>
                    </select>
                    <input
                      type="time"
                      aria-label="일정 시각 (선택)"
                      value={evTime}
                      onChange={(e) => setEvTime(e.target.value)}
                      className="h-9 rounded-sm border border-outline bg-surface px-2 text-xs text-on-surface"
                    />
                  </div>
                  <input
                    type="text"
                    aria-label="일정 제목"
                    required
                    maxLength={80}
                    placeholder="일정 제목 (예: 뮤지컬 <빨래> 관극)"
                    value={evTitle}
                    onChange={(e) => setEvTitle(e.target.value)}
                    className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs text-on-surface"
                  />
                  <input
                    type="text"
                    aria-label="일정 메모 (선택)"
                    maxLength={200}
                    placeholder="메모 (선택)"
                    value={evMemo}
                    onChange={(e) => setEvMemo(e.target.value)}
                    className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs text-on-surface"
                  />
                  {evError && (
                    <p role="alert" className="text-xs font-semibold text-urgent">
                      {evError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={evBusy}
                    className="h-9 rounded-sm bg-secondary text-xs font-semibold text-on-secondary hover:bg-secondary-hover disabled:opacity-60"
                  >
                    {evBusy ? "저장 중..." : "저장하기"}
                  </button>
                </form>
              )}

              <div className="flex flex-col gap-3">
                {dayAutoEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className={`flex flex-col gap-1 rounded-md border p-4 ${
                      ev.category === "LOTTERY"
                        ? "border-champagne-gold bg-gold-wash"
                        : "border-outline bg-surface-variant"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`rounded-xs px-2 py-0.5 text-[11px] font-semibold ${
                          ev.category === "LOTTERY"
                            ? "border border-champagne-gold bg-surface text-on-surface"
                            : "bg-rose-mist text-primary"
                        }`}
                      >
                        {ev.badgeLabel}
                      </span>
                      {ev.eventTime && (
                        <span className="text-xs text-muted tabular-nums">{ev.eventTime}</span>
                      )}
                    </div>
                    <Link
                      href={`/shows/${ev.showId}`}
                      className="text-sm font-semibold text-on-surface hover:text-primary"
                    >
                      {ev.title}
                    </Link>
                    <span className="text-xs text-muted">{ev.detail}</span>
                  </div>
                ))}

                {daySavedEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex flex-col gap-1 rounded-md border border-outline bg-surface p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="rounded-xs bg-rose-mist px-2 py-0.5 text-[11px] font-semibold text-primary">
                        내 일정
                      </span>
                      <div className="flex items-center gap-2">
                        {ev.eventTime && (
                          <span className="text-xs text-muted tabular-nums">{ev.eventTime}</span>
                        )}
                        {confirmDeleteId === ev.id ? (
                          <span className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={deletingEventId === ev.id}
                              onClick={() => removeCalendarEvent(ev.id)}
                              className="rounded-xs bg-urgent px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-60"
                            >
                              {deletingEventId === ev.id ? "삭제 중..." : "삭제 확인"}
                            </button>
                            <button
                              type="button"
                              disabled={deletingEventId === ev.id}
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-[11px] font-semibold text-muted hover:text-on-surface"
                            >
                              취소
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(ev.id)}
                            className="text-xs text-hint hover:text-urgent"
                          >
                            삭제
                          </button>
                        )}
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-on-surface">{ev.title}</span>
                    {ev.memo && <span className="text-xs text-muted">{ev.memo}</span>}
                  </div>
                ))}

                {dayAutoEvents.length === 0 && daySavedEvents.length === 0 && (
                  <div className="flex flex-col items-center gap-2 rounded-md border border-outline bg-surface-variant p-6 text-center">
                    <p className="text-xs text-muted">선택한 날짜에 등록된 일정이 없어요.</p>
                    {!addingEvent && (
                      <button
                        type="button"
                        onClick={() => setAddingEvent(true)}
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        이 날에 관극 일정 추가하기
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Panel 2: 저장한 소식 */}
        {tab === "saved" && (
          <div className="flex flex-col gap-3">
            {savedError && (
              <p role="alert" className="rounded-xs border border-urgent bg-urgent-wash px-3 py-2 text-xs font-semibold text-urgent">
                {savedError}
              </p>
            )}
            {savedNotis.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <p className="text-sm font-medium text-on-surface">저장한 소식이 아직 없어요.</p>
                <p className="text-xs text-muted">
                  찜한 작품이나 팔로우한 배우의 새소식에서 저장하기를 누르면 이곳에 모여요.
                </p>
                <Link
                  href="/"
                  className="mt-1 inline-flex h-9 items-center rounded-sm border border-outline bg-surface px-4 text-xs font-semibold text-primary hover:bg-rose-mist"
                >
                  공연 둘러보기
                </Link>
              </div>
            ) : (
              savedNotis.map((n) => (
                <div
                  key={n.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-outline bg-surface-variant p-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-on-surface">{n.title}</p>
                    <p className="mt-0.5 text-xs text-muted">{n.body}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-semibold">
                    {n.showId && (
                      <Link href={`/shows/${n.showId}`} className="text-primary hover:underline">
                        작품 보기 →
                      </Link>
                    )}
                    <button
                      type="button"
                      disabled={unsavingId === n.id}
                      onClick={() => unsaveNoti(n.id)}
                      className="text-muted hover:text-urgent disabled:opacity-60"
                    >
                      {unsavingId === n.id ? "해제 중..." : "저장 해제"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* 3. 내가 제보한 내역 (별도 박스) */}
      <section className="flex flex-col gap-4 rounded-lg border border-outline bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-lg font-bold text-on-surface">내가 제보한 내역</h2>
            <span className="text-[13px] font-semibold text-primary tabular-nums">
              총 {initialReports.totalClicks}명 확인 · {initialReports.totalHelpful}명 도움
            </span>
          </div>
          <Link href="/reports/new" className="text-xs font-semibold text-primary hover:underline">
            새 할인 제보하기 →
          </Link>
        </div>

        {initialReports.items.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-variant px-4 py-3 text-xs text-muted">
            <span>아직 제보한 할인·이벤트가 없어요.</span>
            <Link href="/reports/new" className="font-semibold text-primary hover:underline">
              첫 혜택 제보하기 →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {initialReports.items.map((rep) => (
              <div
                key={rep.id}
                className="flex items-center justify-between gap-4 rounded-md border border-outline bg-surface-variant p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-on-surface">
                    {rep.reportedShowTitle} {rep.conditionNote ? `· ${rep.conditionNote}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted tabular-nums">
                    {formatKstDate(new Date(rep.createdAt))} 제보 · {rep.channelName}
                  </p>
                  {rep.status === "REJECTED" && rep.rejectReasonNote && (
                    <p className="mt-1 text-xs text-urgent">반려 사유: {rep.rejectReasonNote}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-xs px-2 py-0.5 text-xs font-semibold ${
                    rep.status === "APPROVED"
                      ? "bg-rose-mist text-primary"
                      : rep.status === "REJECTED"
                        ? "bg-urgent-wash text-urgent"
                        : "bg-surface-sunken text-on-surface-variant"
                  }`}
                >
                  {rep.status === "APPROVED" ? "승인 완료" : rep.status === "REJECTED" ? "반려" : "검수 중"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. 회원 탈퇴 (마이페이지 최하단) */}
      <section className="flex flex-col gap-3 rounded-lg border border-outline bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-on-surface">회원 탈퇴</h2>
            <p className="mt-0.5 text-xs text-muted">
              탈퇴하면 찜한 작품, 팔로우 배우, 저장한 소식, 내 캘린더 일정이 모두 삭제돼요.
            </p>
          </div>
          {!withdrawConfirm && (
            <button
              type="button"
              onClick={() => {
                setWithdrawError(null);
                setWithdrawConfirm(true);
              }}
              className="h-9 shrink-0 rounded-sm border border-outline bg-surface px-3.5 text-xs font-semibold text-muted hover:border-urgent hover:text-urgent"
            >
              회원 탈퇴
            </button>
          )}
        </div>

        {withdrawConfirm && (
          <div className="flex flex-col gap-3 rounded-md border border-urgent bg-urgent-wash p-4">
            <p className="text-xs font-semibold text-urgent">
              정말 탈퇴할까요? 삭제된 찜·팔로우·캘린더 기록은 되돌릴 수 없어요. 이미 게시된 제보
              딜은 &apos;익명의 관객&apos;으로 남아 있어요.
            </p>
            {withdrawError && <p className="text-xs font-semibold text-urgent">{withdrawError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={withdrawBusy}
                onClick={() => setWithdrawConfirm(false)}
                className="h-9 rounded-sm border border-outline bg-surface px-4 text-xs font-semibold text-on-surface-variant"
              >
                취소
              </button>
              <button
                type="button"
                disabled={withdrawBusy}
                onClick={withdrawAccount}
                className="h-9 rounded-sm bg-urgent px-4 text-xs font-semibold text-white disabled:opacity-60"
              >
                {withdrawBusy ? "탈퇴 처리 중..." : "탈퇴하기"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
