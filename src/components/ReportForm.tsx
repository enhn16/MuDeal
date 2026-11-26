"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DealType, SeatGrade } from "@/db/schema";

const DRAFT_KEY = "mudeal:report-draft:v1";

type ReportCategory = "deal" | "perk" | "event";

const CATEGORY_DEFAULT_TYPE: Record<ReportCategory, DealType> = {
  deal: "TIMESALE",
  perk: "PERK_GOODS",
  event: "CURTAIN_CALL",
};

export function ReportForm({
  defaultNickname,
  shows,
}: {
  defaultNickname: string;
  shows: Array<{ id: number; title: string }>;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<ReportCategory>("deal");
  const [showId, setShowId] = useState<string>("");
  const [reportedShowTitle, setReportedShowTitle] = useState("");
  const [channelName, setChannelName] = useState("NOL티켓");
  const [dealType, setDealType] = useState<DealType>("TIMESALE");
  const [seatGrade, setSeatGrade] = useState<SeatGrade>("ALL");
  const [externalUrl, setExternalUrl] = useState("");
  const [reportedPrice, setReportedPrice] = useState("");
  const [reportedDiscountRate, setReportedDiscountRate] = useState("");
  const [isUnconditional, setIsUnconditional] = useState(true);
  const [conditionNote, setConditionNote] = useState("");
  const [eventStartDate, setEventStartDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [reporterNickname, setReporterNickname] = useState(defaultNickname);
  const [draftSaved, setDraftSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, string>;
      if (saved.reportedShowTitle) setReportedShowTitle(saved.reportedShowTitle);
      if (saved.channelName) setChannelName(saved.channelName);
      if (saved.externalUrl) setExternalUrl(saved.externalUrl);
      if (saved.reportedPrice) setReportedPrice(saved.reportedPrice);
      if (saved.conditionNote) setConditionNote(saved.conditionNote);
    } catch {
      // Ignore invalid local draft
    }
  }, []);

  function saveDraftLocally() {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ reportedShowTitle, channelName, externalUrl, reportedPrice, conditionNote }),
      );
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    } catch {
      // Ignore storage quota errors
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const selectedShow = shows.find((s) => String(s.id) === showId);
      const title = reportedShowTitle.trim() || selectedShow?.title || "";
      if (!title) {
        setError("작품을 선택하거나 작품명을 입력해 주세요.");
        return;
      }
      if (!externalUrl.trim().startsWith("https://")) {
        setError("https://로 시작하는 원문 예매처 링크를 입력해 주세요.");
        return;
      }

      const datePrefix =
        category !== "deal" && eventStartDate
          ? eventEndDate && eventEndDate > eventStartDate
            ? `${eventStartDate} ~ ${eventEndDate}`
            : eventStartDate
          : "";
      const mergedConditionNote =
        datePrefix && conditionNote.trim()
          ? `[${datePrefix}] ${conditionNote.trim()}`
          : datePrefix || conditionNote.trim() || null;
      const computedExpiresAt =
        category !== "deal" && (eventEndDate || eventStartDate)
          ? new Date(`${eventEndDate || eventStartDate}T23:59:59+09:00`).toISOString()
          : null;

      const res = await fetch("/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          showId: showId ? Number(showId) : null,
          reportedShowTitle: title,
          channelName,
          dealType,
          seatGrade,
          externalUrl,
          reportedPrice: reportedPrice ? Number(reportedPrice) : null,
          reportedDiscountRate: reportedDiscountRate ? Number(reportedDiscountRate) : null,
          isUnconditional,
          conditionNote: mergedConditionNote,
          expiresAt: computedExpiresAt,
          reporterNickname: reporterNickname || defaultNickname,
        }),
      });
      const json = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        saveDraftLocally();
        setError(json.error?.message ?? "제보를 등록하지 못했어요. 작성하던 내용은 임시 저장해 두었어요.");
        return;
      }
      localStorage.removeItem(DRAFT_KEY);
      setSuccess(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <span className="rounded-xs bg-rose-mist px-3 py-1 text-xs font-semibold text-primary">
          제보 접수 완료
        </span>
        <h2 className="text-xl font-bold text-on-surface">제보를 접수했어요</h2>
        <p className="text-sm text-muted">
          검수를 마치면 홈 &apos;제보해주신 딜&apos;에 닉네임과 확인·도움 수가 함께 올라가요.
        </p>
        <div className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={() => router.push("/my")}
            className="h-10 rounded-sm bg-secondary px-5 text-sm font-semibold text-on-secondary hover:bg-secondary-hover"
          >
            MY 제보 내역 확인
          </button>
          <button
            type="button"
            onClick={() => setSuccess(false)}
            className="h-10 rounded-sm border border-outline px-4 text-sm font-semibold text-on-surface-variant"
          >
            추가 제보하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {/* 1. 제보 유형 (mudeal_4 parity) */}
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-on-surface">제보 유형</span>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ["deal", "할인"],
              ["perk", "특전"],
              ["event", "싱어롱·스페셜 커튼콜"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setCategory(key);
                setDealType(CATEGORY_DEFAULT_TYPE[key]);
              }}
              className={`h-10 rounded-sm border text-[13px] font-semibold transition-colors ${
                category === key
                  ? "border-secondary bg-rose-mist text-primary"
                  : "border-outline bg-surface text-on-surface-variant hover:bg-surface-variant"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. 작품 & 예매처 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-show" className="text-[13px] font-semibold text-on-surface">
            작품 선택 (또는 아래 직접 입력)
          </label>
          <select
            id="report-show"
            value={showId}
            onChange={(e) => {
              setShowId(e.target.value);
              const found = shows.find((s) => String(s.id) === e.target.value);
              if (found) setReportedShowTitle(found.title);
            }}
            className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface focus:border-secondary focus:bg-surface focus:outline-none"
          >
            <option value="">직접 입력</option>
            {shows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-title" className="text-[13px] font-semibold text-on-surface">
            작품명 (필수)
          </label>
          <input
            id="report-title"
            type="text"
            required
            maxLength={120}
            value={reportedShowTitle}
            onChange={(e) => setReportedShowTitle(e.target.value)}
            placeholder="예: 뮤지컬 <빨래> 20주년"
            className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface placeholder:text-hint focus:border-secondary focus:bg-surface focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-channel" className="text-[13px] font-semibold text-on-surface">
            예매처 (필수)
          </label>
          <input
            id="report-channel"
            type="text"
            required
            maxLength={60}
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            placeholder="NOL티켓, YES24티켓, 엘티켓, 티켓링크 등"
            className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface focus:border-secondary focus:bg-surface focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-seat" className="text-[13px] font-semibold text-on-surface">
            좌석 등급
          </label>
          <select
            id="report-seat"
            value={seatGrade}
            onChange={(e) => setSeatGrade(e.target.value as SeatGrade)}
            className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface focus:border-secondary focus:bg-surface focus:outline-none"
          >
            <option value="ALL">전석</option>
            <option value="VIP">VIP석</option>
            <option value="R">R석</option>
            <option value="S">S석</option>
            <option value="A">A석</option>
          </select>
        </div>
      </div>

      {/* 3. 원문 예매처 링크 (필수) */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="source-url" className="text-[13px] font-semibold text-on-surface">
          원문 예매처 링크 (https:// 필수)
        </label>
        <input
          id="source-url"
          type="url"
          required
          value={externalUrl}
          onChange={(e) => setExternalUrl(e.target.value)}
          placeholder="https://ticket.yes24.com/Perf/..."
          className="h-10 w-full rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface placeholder:text-hint focus:border-secondary focus:bg-surface focus:outline-none"
        />
        {externalUrl.length > 0 && !externalUrl.trim().startsWith("https://") && (
          <p className="text-xs font-medium text-urgent">
            https://로 시작하는 예매처 주소를 입력해 주세요.
          </p>
        )}
      </div>

      {/* 4. 할인가 · 할인율 (할인 딜일 때) */}
      {category === "deal" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-price" className="text-[13px] font-semibold text-on-surface">
              할인가 (원)
            </label>
            <input
              id="report-price"
              type="number"
              min={0}
              value={reportedPrice}
              onChange={(e) => setReportedPrice(e.target.value)}
              placeholder="예: 38500"
              className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface tabular-nums focus:border-secondary focus:bg-surface focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-rate" className="text-[13px] font-semibold text-on-surface">
              할인율 (%)
            </label>
            <input
              id="report-rate"
              type="number"
              min={1}
              max={99}
              value={reportedDiscountRate}
              onChange={(e) => setReportedDiscountRate(e.target.value)}
              placeholder="예: 45"
              className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface tabular-nums focus:border-secondary focus:bg-surface focus:outline-none"
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-on-surface-variant">
              <input
                type="checkbox"
                checked={isUnconditional}
                onChange={(e) => setIsUnconditional(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              무조건 할인 (조건 없음)
            </label>
          </div>
        </div>
      )}

      {/* 4-2. 이벤트 · 특전 진행 날짜 (특전 / 싱어롱·커튼콜일 때) */}
      {category !== "deal" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-event-start" className="text-[13px] font-semibold text-on-surface">
              진행 날짜 · 시작일 (선택)
            </label>
            <input
              id="report-event-start"
              type="date"
              value={eventStartDate}
              onChange={(e) => setEventStartDate(e.target.value)}
              className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface tabular-nums focus:border-secondary focus:bg-surface focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-event-end" className="text-[13px] font-semibold text-on-surface">
              종료일 (기간 진행 시 선택)
            </label>
            <input
              id="report-event-end"
              type="date"
              min={eventStartDate || undefined}
              value={eventEndDate}
              onChange={(e) => setEventEndDate(e.target.value)}
              className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface tabular-nums focus:border-secondary focus:bg-surface focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* 5. 조건 / 이벤트 메모 */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="report-note" className="text-[13px] font-semibold text-on-surface">
          할인 조건 · 이벤트 내용 요약
        </label>
        <input
          id="report-note"
          type="text"
          maxLength={300}
          value={conditionNote}
          onChange={(e) => setConditionNote(e.target.value)}
          placeholder="예: 평일 낮 마티네 전석 45% 또는 11/29 커튼콜 데이 포토카드 증정"
          className="h-10 w-full rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface placeholder:text-hint focus:border-secondary focus:bg-surface focus:outline-none"
        />
      </div>

      {/* 6. 표시 닉네임 */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="nickname-input" className="text-[13px] font-semibold text-on-surface">
          표시 닉네임
        </label>
        <input
          id="nickname-input"
          type="text"
          maxLength={20}
          value={reporterNickname}
          onChange={(e) => setReporterNickname(e.target.value)}
          className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface focus:border-secondary focus:bg-surface focus:outline-none"
        />
      </div>

      {error && <p className="text-xs font-semibold text-urgent">{error}</p>}

      {/* 7. Submit Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline pt-4">
        <button
          type="button"
          onClick={saveDraftLocally}
          className={`inline-flex h-10 w-32 items-center justify-center rounded-sm border text-[13px] font-semibold transition-colors ${
            draftSaved
              ? "border-secondary bg-rose-mist text-primary"
              : "border-outline bg-surface text-on-surface-variant hover:bg-surface-variant"
          }`}
        >
          {draftSaved ? "임시 저장됨 ✓" : "임시 저장"}
        </button>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-12 w-48 items-center justify-center rounded-sm bg-secondary text-[15px] font-semibold text-on-secondary shadow-cta transition-colors hover:bg-secondary-hover disabled:opacity-60"
        >
          {busy ? "등록 중..." : "제보 등록하기"}
        </button>
      </div>
    </form>
  );
}
