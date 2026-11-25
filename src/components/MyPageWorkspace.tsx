"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { AuthUser } from "@/server/modules/auth";
import type { CalendarAutoEvent, CalendarSavedEvent } from "@/server/modules/personal";

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

  async function saveNickname() {
    const trimmed = nickDraft.trim();
    if (!trimmed) return;
    const res = await fetch("/api/v1/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: trimmed }),
    });
    if (res.ok) {
      setNickname(trimmed);
      setEditingNick(false);
      router.refresh();
    }
  }

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  async function unsaveNoti(id: number) {
    const res = await fetch(`/api/v1/me/notifications/${id}/save`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isSaved: false }),
    });
    if (res.ok) setSavedNotis((prev) => prev.filter((n) => n.id !== id));
  }

  async function changeMonth(delta: number) {
    const d = new Date(Date.UTC(calYear, calMonth + delta, 1));
    const nextY = d.getUTCFullYear();
    const nextM = d.getUTCMonth();
    setCalYear(nextY);
    setCalMonth(nextM);
    const mm = String(nextM + 1).padStart(2, "0");
    const lastDay = String(new Date(Date.UTC(nextY, nextM + 1, 0)).getUTCDate()).padStart(2, "0");
    const res = await fetch(`/api/v1/me/calendar?from=${nextY}-${mm}-01&to=${nextY}-${mm}-${lastDay}`);
    if (res.ok) {
      const json = (await res.json()) as {
        data: { autoEvents: CalendarAutoEvent[]; savedEvents: CalendarSavedEvent[] };
      };
      setAutoEvents(json.data.autoEvents);
      setSavedEvents(json.data.savedEvents);
    }
  }

  async function submitCalendarEvent(e: React.FormEvent) {
    e.preventDefault();
    setEvError(null);
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
    const json = (await res.json()) as { data?: CalendarSavedEvent; error?: { message: string } };
    if (!res.ok || !json.data) {
      setEvError(json.error?.message ?? "일정 저장에 실패했습니다.");
      return;
    }
    setSavedEvents((prev) => [...prev, { ...json.data!, readOnly: false }]);
    setEvTitle("");
    setEvTime("");
    setEvMemo("");
    setAddingEvent(false);
  }

  async function removeCalendarEvent(id: number) {
    const res = await fetch(`/api/v1/me/calendar/${id}`, { method: "DELETE" });
    if (res.ok) setSavedEvents((prev) => prev.filter((e) => e.id !== id));
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
                  maxLength={20}
                  value={nickDraft}
                  onChange={(e) => setNickDraft(e.target.value)}
                  className="h-9 w-40 rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface focus:border-secondary focus:bg-surface focus:outline-none"
                />
                <button
                  type="button"
                  onClick={saveNickname}
                  className="h-9 rounded-sm bg-secondary px-3 text-xs font-semibold text-on-secondary hover:bg-secondary-hover"
                >
                  저장
                </button>
                <button
                  type="button"
                  onClick={() => setEditingNick(false)}
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
              onClick={logout}
              className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs font-semibold text-muted hover:bg-surface-variant hover:text-urgent"
            >
              로그아웃
            </button>
          </div>
        </div>

        {/* Story Bar -> clicking goes directly to /shows/[id]#news-feed or /actors/[id]#news-feed */}
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-on-surface">내 뮤배 · 찜 작품 새 소식</span>

          {initialStories.length === 0 ? (
            <p className="text-xs text-muted">
              작품을 찜하거나 뮤지컬 배우를 팔로우하면 프로필이 이곳에 표시됩니다.
            </p>
          ) : (
            <div className="flex items-center gap-5 overflow-x-auto pb-1">
              {initialStories.map((story) => {
                const isUnread = story.unreadCount > 0;
                const ring = isUnread
                  ? story.targetType === "ACTOR"
                    ? "border-2 border-champagne-gold"
                    : "border-2 border-secondary"
                  : "border border-outline";
                const href =
                  story.targetType === "ACTOR"
                    ? `/actors/${story.targetId}#news-feed`
                    : `/shows/${story.targetId}#news-feed`;

                return (
                  <Link
                    key={`${story.targetType}-${story.targetId}`}
                    href={href}
                    className="group flex shrink-0 flex-col items-center gap-1.5"
                  >
                    <span className={`rounded-md bg-surface p-1 ${ring}`}>
                      {story.posterUrl ? (
                        <img
                          src={story.posterUrl}
                          alt={story.name}
                          className="h-14 w-14 rounded-sm object-cover"
                        />
                      ) : (
                        <span
                          className={`flex h-14 w-14 items-center justify-center rounded-sm text-lg font-bold ${
                            isUnread
                              ? "bg-curtain-noir text-gold-soft"
                              : "bg-surface-sunken text-primary"
                          }`}
                        >
                          {story.name.slice(0, 1)}
                        </span>
                      )}
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
                <h2 className="text-lg font-bold text-on-surface tabular-nums">
                  {calYear}년 {calMonth + 1}월
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="이전 달"
                    onClick={() => changeMonth(-1)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xs border border-outline text-on-surface-variant hover:bg-surface-variant"
                  >
                    <span className="material-symbols-outlined text-base">chevron_left</span>
                  </button>
                  <button
                    type="button"
                    aria-label="다음 달"
                    onClick={() => changeMonth(1)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xs border border-outline text-on-surface-variant hover:bg-surface-variant"
                  >
                    <span className="material-symbols-outlined text-base">chevron_right</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 border-b border-outline pb-2 text-center text-xs font-semibold">
                <span className="text-primary">일</span>
                <span className="text-muted">월</span>
                <span className="text-muted">화</span>
                <span className="text-muted">수</span>
                <span className="text-muted">목</span>
                <span className="text-muted">금</span>
                <span className="text-on-surface-variant">토</span>
              </div>

              <div className="grid grid-cols-7 gap-y-2 text-center tabular-nums">
                {cells.map((cell, idx) => {
                  if (!cell) return <div key={`empty-${idx}`} />;
                  const isSelected = cell.iso === selectedDate;
                  const dots = eventDotsByDate.get(cell.iso);
                  const dow = idx % 7;
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      onClick={() => setSelectedDate(cell.iso)}
                      className="flex flex-col items-center py-1"
                    >
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-xs text-[13px] ${
                          isSelected
                            ? "bg-primary font-semibold text-on-primary"
                            : dow === 0
                              ? "text-primary hover:bg-rose-mist"
                              : "text-on-surface hover:bg-surface-sunken"
                        }`}
                      >
                        {cell.day}
                      </span>
                      <span className="mt-1 flex h-1.5 gap-1">
                        {dots?.has("LOTTERY") && <span className="h-1.5 w-1.5 rounded-xs bg-champagne-gold" />}
                        {dots?.has("TICKET_OPEN") && <span className="h-1.5 w-1.5 rounded-xs bg-curtain-noir" />}
                        {(dots?.has("STAGE_EVENT") || dots?.has("SAVED")) && (
                          <span className="h-1.5 w-1.5 rounded-xs bg-secondary" />
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
                      value={evTime}
                      onChange={(e) => setEvTime(e.target.value)}
                      className="h-9 rounded-sm border border-outline bg-surface px-2 text-xs text-on-surface"
                    />
                  </div>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    placeholder="일정 제목 (예: 뮤지컬 <빨래> 관극)"
                    value={evTitle}
                    onChange={(e) => setEvTitle(e.target.value)}
                    className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs text-on-surface"
                  />
                  <input
                    type="text"
                    maxLength={200}
                    placeholder="메모 (선택)"
                    value={evMemo}
                    onChange={(e) => setEvMemo(e.target.value)}
                    className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs text-on-surface"
                  />
                  {evError && <p className="text-xs font-semibold text-urgent">{evError}</p>}
                  <button
                    type="submit"
                    className="h-9 rounded-sm bg-secondary text-xs font-semibold text-on-secondary hover:bg-secondary-hover"
                  >
                    저장하기
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
                          ev.category === "TICKET_OPEN"
                            ? "bg-curtain-noir text-on-curtain-noir"
                            : ev.category === "LOTTERY"
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
                        <button
                          type="button"
                          onClick={() => removeCalendarEvent(ev.id)}
                          className="text-xs text-hint hover:text-urgent"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-on-surface">{ev.title}</span>
                    {ev.memo && <span className="text-xs text-muted">{ev.memo}</span>}
                  </div>
                ))}

                {dayAutoEvents.length === 0 && daySavedEvents.length === 0 && (
                  <p className="rounded-md border border-outline bg-surface-variant p-6 text-center text-xs text-muted">
                    선택한 날짜에 등록된 일정이 없습니다.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Panel 2: 저장한 소식 */}
        {tab === "saved" && (
          <div className="flex flex-col gap-3">
            {savedNotis.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">저장한 소식이 없습니다.</p>
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
                        작품 보기 ↗
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => unsaveNoti(n.id)}
                      className="text-muted hover:text-urgent"
                    >
                      저장 해제
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
            새 할인 제보하기 ↗
          </Link>
        </div>

        {initialReports.items.length === 0 ? (
          <p className="text-xs text-muted">아직 제출한 할인·이벤트 제보가 없습니다.</p>
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
                    {rep.createdAt.slice(0, 10)} 제보 · {rep.channelName}
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
                  {rep.status === "APPROVED" ? "승인됨" : rep.status === "REJECTED" ? "반려됨" : "검수중"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
