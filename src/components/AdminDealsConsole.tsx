"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEAL_TYPES, SEAT_GRADES, type DealType, type SeatGrade } from "@/db/schema";
import { expandDateRange, formatKstDateTime } from "@/lib/kst";
import { DEAL_TYPE_LABELS, SEAT_GRADE_LABELS } from "@/lib/labels";
import { formatKrw } from "@/lib/pricing";

const DEAL_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "진행 중",
  EXPIRED: "마감",
  DRAFT: "검수 대기",
  HIDDEN: "숨김",
  DISCARDED: "폐기",
};

const SLOT_TYPE_LABELS: Record<"HERO" | "SPOTLIGHT", string> = {
  HERO: "히어로 배너",
  SPOTLIGHT: "스포트라이트",
};

interface AdminDealRow {
  id: number;
  showId: number | null;
  showTitle: string;
  channelName: string;
  dealType: DealType;
  seatGrade: SeatGrade;
  salePrice: number | null;
  discountRate: number | null;
  status: string;
  adminLocked: number;
}

interface CurationRow {
  id: number;
  slotType: "HERO" | "SPOTLIGHT";
  title: string;
  subtitle: string | null;
  linkUrl: string;
  sortOrder: number;
  isActive: number;
}

export function AdminDealsConsole({
  initialDeals,
  showOptions,
  actors,
  latestSync,
  initialCurations,
}: {
  initialDeals: AdminDealRow[];
  showOptions: Array<{ id: number; title: string }>;
  actors: Array<{ id: number; name: string; followerCount: number }>;
  latestSync: Array<{ id: number; sourceName: string; status: string; fetchedCount: number; startedAt: string }>;
  initialCurations: CurationRow[];
}) {
  const router = useRouter();
  const [dealList, setDealList] = useState(initialDeals);
  const [curations, setCurations] = useState(initialCurations);
  const [syncBusy, setSyncBusy] = useState<string | null>(null);
  const [rowBusyKey, setRowBusyKey] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState(false);

  const [adding, setAdding] = useState(false);
  const [showId, setShowId] = useState(String(showOptions[0]?.id ?? ""));
  const [channelName, setChannelName] = useState("NOL티켓");
  const [dealType, setDealType] = useState<DealType>("TIMESALE");
  const [seatGrade, setSeatGrade] = useState<SeatGrade>("ALL");
  const [isUnconditional, setIsUnconditional] = useState(true);
  const [salePrice, setSalePrice] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [externalUrl, setExternalUrl] = useState("https://");
  const [conditionSummary, setConditionSummary] = useState("");
  const [perkSummary, setPerkSummary] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [expiresDate, setExpiresDate] = useState("");
  const [sourceActorId, setSourceActorId] = useState("");
  const [targetActorId, setTargetActorId] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; isError?: boolean } | null>(null);

  const lockedCount = dealList.filter((d) => d.adminLocked === 1).length;
  const lastRun = latestSync[0];
  const sourceActor = actors.find((a) => String(a.id) === sourceActorId) ?? null;
  const targetActor = actors.find((a) => String(a.id) === targetActorId) ?? null;

  async function triggerSync(target: "KOPIS" | "CHANNELS" | "OCR" | "EXPIRY") {
    if (syncBusy !== null) return;
    setSyncBusy(target);
    setFeedback(null);
    try {
      const res = await fetch("/api/v1/admin/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { result?: unknown };
        error?: { message: string };
      };
      if (!res.ok) {
        setFeedback({
          text: json.error?.message ?? "동기화를 실행하지 못했어요. 잠시 후 다시 시도해 주세요.",
          isError: true,
        });
        return;
      }
      const raw = json.data?.result;
      const label =
        target === "KOPIS"
          ? "KOPIS 수집을"
          : target === "EXPIRY"
            ? "마감 일괄 처리를"
            : target === "OCR"
              ? "NOL 공지 OCR을"
              : "채널 수집을";
      let summary: string;
      let isError = false;
      if (target === "EXPIRY") {
        const r = (raw ?? {}) as { expiredDeals?: number; endedShows?: number };
        summary = `딜 ${Number(r.expiredDeals ?? 0)}건 · 공연 ${Number(r.endedShows ?? 0)}건 마감 처리했어요.`;
      } else if (target === "OCR") {
        const envelope = (raw ?? {}) as {
          ocr?: { processed?: number; draftsCreated?: number; skippedByLimit?: boolean; error?: string };
          synopses?: { checked?: number; populated?: number; error?: string };
          processed?: number;
          draftsCreated?: number;
          skippedByLimit?: boolean;
          error?: string;
        };
        const o = envelope.ocr ?? envelope;
        const s = envelope.synopses;
        if (o.error) {
          isError = true;
          summary = `OCR 오류: ${o.error}`;
        } else if (o.skippedByLimit) {
          summary = "오늘 일일 OCR 상한에 도달했어요.";
        } else {
          const synText =
            s && !s.error && Number(s.populated ?? 0) > 0 ? ` · 줄거리 ${Number(s.populated)}건 보강` : "";
          summary = `이미지 ${Number(o.processed ?? 0)}장 분석 · 혜택 ${Number(o.draftsCreated ?? 0)}건 추출${synText}했어요.`;
        }
      } else if (target === "CHANNELS" && Array.isArray(raw)) {
        const rows = raw as Array<{ fetchedCount?: number; publishedCount?: number; draftCount?: number; status?: string }>;
        const fetched = rows.reduce((acc, x) => acc + Number(x.fetchedCount ?? 0), 0);
        const published = rows.reduce((acc, x) => acc + Number(x.publishedCount ?? 0), 0);
        const drafts = rows.reduce((acc, x) => acc + Number(x.draftCount ?? 0), 0);
        summary = `${fetched}건 확인 · 자동 게시 ${published}건 · 검수 대기 ${drafts}건`;
      } else {
        const r = (raw ?? {}) as { fetchedCount?: number; status?: string; error?: string };
        if (r.status === "FAILED") {
          isError = true;
          summary = r.error ?? "외부 API 키가 없어 건너뛰었어요.";
        } else {
          summary = `${Number(r.fetchedCount ?? 0)}건 확인했어요.`;
        }
      }
      setFeedback({ text: isError ? `${label} 완료하지 못했어요. (${summary})` : `${label} 마쳤어요. (${summary})`, isError });
      router.refresh();
    } catch {
      setFeedback({ text: "동기화 요청 중 네트워크 오류가 발생했어요.", isError: true });
    } finally {
      setSyncBusy(null);
    }
  }

  async function toggleCuration(c: CurationRow) {
    const key = `cur-${c.id}`;
    if (rowBusyKey === key) return;
    setRowBusyKey(key);
    setFeedback(null);
    const next = c.isActive === 0;
    try {
      const res = await fetch(`/api/v1/admin/curations/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
      if (!res.ok) {
        setFeedback({
          text: json.error?.message ?? "배너 노출 상태를 바꾸지 못했어요.",
          isError: true,
        });
        return;
      }
      setCurations((prev) => prev.map((x) => (x.id === c.id ? { ...x, isActive: next ? 1 : 0 } : x)));
      setFeedback({ text: next ? "배너 노출을 켰어요." : "배너를 비활성화했어요." });
      router.refresh();
    } catch {
      setFeedback({ text: "네트워크 오류로 배너 상태를 바꾸지 못했어요.", isError: true });
    } finally {
      setRowBusyKey(null);
    }
  }

  async function toggleLock(deal: AdminDealRow) {
    const key = `lock-${deal.id}`;
    if (rowBusyKey === key) return;
    setRowBusyKey(key);
    setFeedback(null);
    const next = deal.adminLocked === 0;
    try {
      const res = await fetch(`/api/v1/admin/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminLocked: next }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
      if (!res.ok) {
        setFeedback({
          text: json.error?.message ?? "잠금 상태를 바꾸지 못했어요.",
          isError: true,
        });
        return;
      }
      setDealList((prev) =>
        prev.map((d) => (d.id === deal.id ? { ...d, adminLocked: next ? 1 : 0 } : d)),
      );
      setFeedback({ text: next ? "자동 덮어쓰기 잠금을 켰어요." : "자동 동기화를 허용했어요." });
    } catch {
      setFeedback({ text: "네트워크 오류로 잠금 상태를 바꾸지 못했어요.", isError: true });
    } finally {
      setRowBusyKey(null);
    }
  }

  async function toggleExpire(deal: AdminDealRow) {
    const key = `exp-${deal.id}`;
    if (rowBusyKey === key) return;
    setRowBusyKey(key);
    setFeedback(null);
    const nextStatus = deal.status === "ACTIVE" ? "EXPIRED" : "ACTIVE";
    try {
      const res = await fetch(`/api/v1/admin/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
      if (!res.ok) {
        setFeedback({
          text: json.error?.message ?? "딜 상태를 바꾸지 못했어요.",
          isError: true,
        });
        return;
      }
      setDealList((prev) => prev.map((d) => (d.id === deal.id ? { ...d, status: nextStatus, adminLocked: 1 } : d)));
      setFeedback({ text: nextStatus === "EXPIRED" ? "딜을 마감 처리했어요." : "딜을 다시 진행 중으로 열었어요." });
      router.refresh();
    } catch {
      setFeedback({ text: "네트워크 오류로 딜 상태를 바꾸지 못했어요.", isError: true });
    } finally {
      setRowBusyKey(null);
    }
  }

  async function createDeal(e: React.FormEvent) {
    e.preventDefault();
    if (createBusy) return;
    if (!showId) {
      setFeedback({ text: "대상 작품을 선택해 주세요.", isError: true });
      return;
    }
    setCreateBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/v1/admin/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          showId: Number(showId),
          channelName,
          dealType,
          seatGrade,
          basePrice: basePrice !== "" ? Number(basePrice) : null,
          salePrice: salePrice !== "" ? Number(salePrice) : null,
          isUnconditional,
          conditionSummary: conditionSummary || null,
          perkSummary: perkSummary || null,
          eventDates: eventDate ? expandDateRange(eventDate, eventEndDate || eventDate) : null,
          expiresAt: expiresDate ? new Date(`${expiresDate}T23:59:59+09:00`).toISOString() : null,
          externalUrl,
          adminLocked: true,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: Omit<AdminDealRow, "showTitle">;
        error?: { message: string };
      };
      if (!res.ok) {
        setFeedback({
          text: json.error?.message ?? "딜을 등록하지 못했어요. 입력값을 확인해 주세요.",
          isError: true,
        });
        return;
      }
      if (json.data) {
        const created = json.data;
        const showTitle = showOptions.find((s) => s.id === created.showId)?.title ?? "(미매핑)";
        setDealList((prev) => [{ ...created, showTitle }, ...prev]);
      }
      setAdding(false);
      setSeatGrade("ALL");
      setIsUnconditional(true);
      setSalePrice("");
      setBasePrice("");
      setConditionSummary("");
      setPerkSummary("");
      setEventDate("");
      setEventEndDate("");
      setExpiresDate("");
      setExternalUrl("https://");
      setFeedback({ text: "새 딜을 등록했어요." });
      router.refresh();
    } catch {
      setFeedback({ text: "네트워크 오류로 딜을 등록하지 못했어요.", isError: true });
    } finally {
      setCreateBusy(false);
    }
  }

  function requestActorMerge(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!sourceActorId || !targetActorId) {
      setFeedback({ text: "병합할 원본 배우와 유지할 대상 배우를 모두 선택해 주세요.", isError: true });
      return;
    }
    if (sourceActorId === targetActorId) {
      setFeedback({ text: "서로 다른 두 배우를 선택해 주세요.", isError: true });
      return;
    }
    setConfirmMerge(true);
  }

  async function executeActorMerge() {
    if (mergeBusy || !sourceActorId || !targetActorId) return;
    setMergeBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/v1/admin/actors/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceActorId: Number(sourceActorId),
          targetActorId: Number(targetActorId),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
      if (!res.ok) {
        setFeedback({
          text: json.error?.message ?? "배우를 병합하지 못했어요. 서로 다른 배우를 선택해 주세요.",
          isError: true,
        });
        return;
      }
      setConfirmMerge(false);
      setSourceActorId("");
      setTargetActorId("");
      setFeedback({ text: "동명이인 배우를 병합했어요." });
      router.refresh();
    } catch {
      setFeedback({ text: "네트워크 오류로 배우 병합을 처리하지 못했어요.", isError: true });
    } finally {
      setMergeBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Batch Sync Status Banner (mudeal_8 parity) */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline bg-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-xs px-2 py-0.5 text-xs font-semibold ${
              lastRun?.status === "FAILED"
                ? "bg-urgent-wash text-urgent"
                : "bg-rose-mist text-primary"
            }`}
          >
            {lastRun?.status === "FAILED" ? "배치 실패 경고" : "배치 정상"}
          </span>
          <span className="text-sm text-on-surface tabular-nums">
            {lastRun
              ? `최근 ${lastRun.sourceName} 동기화: ${formatKstDateTime(lastRun.startedAt)} · ${lastRun.fetchedCount}건`
              : "최근 배치 이력이 없어요"}
          </span>
          <span className="text-xs text-muted tabular-nums">
            수집 공연 {showOptions.length}건 · 수동 잠금 딜 {lockedCount}건 보호 중
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={syncBusy !== null}
            onClick={() => triggerSync("KOPIS")}
            className="inline-flex h-9 items-center gap-1 rounded-sm bg-secondary px-3 text-xs font-semibold text-on-secondary hover:bg-secondary-hover disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">sync</span>
            <span>{syncBusy === "KOPIS" ? "실행 중..." : "KOPIS 수동 재수집"}</span>
          </button>
          <button
            type="button"
            disabled={syncBusy !== null}
            onClick={() => triggerSync("CHANNELS")}
            className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant disabled:opacity-60"
          >
            {syncBusy === "CHANNELS" ? "수집 중..." : "채널 수동 수집"}
          </button>
          <button
            type="button"
            disabled={syncBusy !== null}
            onClick={() => triggerSync("OCR")}
            className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant disabled:opacity-60"
          >
            {syncBusy === "OCR" ? "OCR 중..." : "NOL OCR 실행"}
          </button>
          <button
            type="button"
            disabled={syncBusy !== null}
            onClick={() => triggerSync("EXPIRY")}
            className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant disabled:opacity-60"
          >
            {syncBusy === "EXPIRY" ? "처리 중..." : "마감 일괄 처리"}
          </button>
        </div>
      </section>

      {feedback && (
        <p
          role={feedback.isError ? "alert" : "status"}
          className={`rounded-sm border px-4 py-2.5 text-xs font-semibold ${
            feedback.isError
              ? "border-urgent bg-urgent-wash text-urgent"
              : "border-rose-border bg-rose-mist text-primary"
          }`}
        >
          {feedback.text}
        </p>
      )}

      {/* Active Deals Table */}
      <section className="flex flex-col gap-4 rounded-lg border border-outline bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-on-surface tabular-nums">
            할인 · 이벤트 딜 목록 ({dealList.length})
          </h2>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant"
          >
            {adding ? "닫기" : "+ 새 딜 등록"}
          </button>
        </div>

        {adding && (
          <form onSubmit={createDeal} className="grid grid-cols-1 gap-3 rounded-md border border-outline bg-surface-variant p-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="deal-show" className="text-xs font-semibold text-on-surface">
                대상 작품
              </label>
              <select
                id="deal-show"
                value={showId}
                onChange={(e) => setShowId(e.target.value)}
                className="h-9 rounded-sm border border-outline bg-surface px-2.5 text-xs"
              >
                {showOptions.length === 0 && <option value="">등록된 작품이 없어요</option>}
                {showOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="deal-type" className="text-xs font-semibold text-on-surface">
                혜택 유형
              </label>
              <select
                id="deal-type"
                value={dealType}
                onChange={(e) => setDealType(e.target.value as DealType)}
                className="h-9 rounded-sm border border-outline bg-surface px-2.5 text-xs"
              >
                {DEAL_TYPES.map((dt) => (
                  <option key={dt} value={dt}>{DEAL_TYPE_LABELS[dt]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="deal-channel" className="text-xs font-semibold text-on-surface">
                예매처명 (필수)
              </label>
              <input
                id="deal-channel"
                type="text"
                required
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="NOL티켓, YES24티켓 등"
                className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="deal-seat" className="text-xs font-semibold text-on-surface">
                좌석 등급
              </label>
              <select
                id="deal-seat"
                value={seatGrade}
                onChange={(e) => setSeatGrade(e.target.value as SeatGrade)}
                className="h-9 rounded-sm border border-outline bg-surface px-2.5 text-xs"
              >
                {SEAT_GRADES.map((sg) => (
                  <option key={sg} value={sg}>{SEAT_GRADE_LABELS[sg]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="deal-base-price" className="text-xs font-semibold text-on-surface">
                기준 정가 (원 · 선택)
              </label>
              <input
                id="deal-base-price"
                type="number"
                min={0}
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                placeholder="예: 120000"
                className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs tabular-nums"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="deal-sale-price" className="text-xs font-semibold text-on-surface">
                할인가 (원 · 선택)
              </label>
              <input
                id="deal-sale-price"
                type="number"
                min={0}
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="예: 72000"
                className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs tabular-nums"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="deal-expires" className="text-xs font-semibold text-on-surface">
                예매 마감일 (KST · 선택)
              </label>
              <input
                id="deal-expires"
                type="date"
                value={expiresDate}
                onChange={(e) => setExpiresDate(e.target.value)}
                className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs tabular-nums"
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

            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor="deal-url" className="text-xs font-semibold text-on-surface">
                외부 예매처 링크 (필수)
              </label>
              <input
                id="deal-url"
                type="url"
                required
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://..."
                className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs"
              />
            </div>

            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor="deal-cond" className="text-xs font-semibold text-on-surface">
                할인 조건 · 이벤트 요약
              </label>
              <input
                id="deal-cond"
                type="text"
                value={conditionSummary}
                onChange={(e) => setConditionSummary(e.target.value)}
                placeholder="예: 평일 낮 마티네 전석 40%"
                className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs"
              />
            </div>

            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor="deal-perk" className="text-xs font-semibold text-on-surface">
                특전 내용 (선택)
              </label>
              <input
                id="deal-perk"
                type="text"
                value={perkSummary}
                onChange={(e) => setPerkSummary(e.target.value)}
                placeholder="예: 스페셜 포토카드 1종 증정"
                className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="deal-event-start" className="text-xs font-semibold text-on-surface">
                이벤트 · 관람 시작일 (선택)
              </label>
              <input
                id="deal-event-start"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs tabular-nums"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="deal-event-end" className="text-xs font-semibold text-on-surface">
                이벤트 · 관람 종료일 (선택)
              </label>
              <input
                id="deal-event-end"
                type="date"
                min={eventDate || undefined}
                value={eventEndDate}
                onChange={(e) => setEventEndDate(e.target.value)}
                className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs tabular-nums"
              />
            </div>

            <div className="flex justify-end sm:col-span-2">
              <button
                type="submit"
                disabled={createBusy || !showId}
                className="h-9 rounded-sm bg-secondary px-4 text-xs font-semibold text-on-secondary hover:bg-secondary-hover disabled:opacity-60"
              >
                {createBusy ? "등록 중..." : "딜 등록"}
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto rounded-lg border border-outline">
          <table className="w-full min-w-[600px] border-collapse text-left text-sm">
            <thead className="border-b border-outline bg-surface-sunken text-xs font-semibold text-on-surface-variant">
              <tr>
                <th scope="col" className="px-4 py-3">작품 · 예매처</th>
                <th scope="col" className="px-4 py-3">할인율 · 가격</th>
                <th scope="col" className="px-4 py-3">상태 / 잠금</th>
                <th scope="col" className="px-4 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline">
              {dealList.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-xs text-muted">
                    등록된 딜이 아직 없어요. KOPIS는 공연 목록({showOptions.length}건)만 수집하며,
                    딜은 &apos;채널 수동 수집&apos; 후 검수 승인하거나 &apos;+ 새 딜 등록&apos;으로 추가할 수 있어요.
                  </td>
                </tr>
              )}
              {dealList.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-on-surface">{d.showTitle}</p>
                    <p className="text-xs text-muted">
                      {d.channelName} · {SEAT_GRADE_LABELS[d.seatGrade]}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {d.salePrice !== null ? (
                      <>
                        {d.discountRate !== null && (
                          <span className="mr-1.5 font-bold text-secondary">{d.discountRate}%</span>
                        )}
                        <span>{formatKrw(d.salePrice)}</span>
                      </>
                    ) : d.discountRate !== null ? (
                      <span className="font-bold text-secondary">{d.discountRate}% 할인</span>
                    ) : (
                      <span className="text-xs text-muted">특전/이벤트</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded-xs bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">
                        {DEAL_STATUS_LABELS[d.status] ?? d.status}
                      </span>
                      {d.adminLocked === 1 && (
                        <span className="rounded-xs bg-rose-mist px-2 py-0.5 text-[11px] font-semibold text-primary">
                          자동 잠금
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1.5">
                      <button
                        type="button"
                        disabled={rowBusyKey === `lock-${d.id}`}
                        onClick={() => toggleLock(d)}
                        className="h-8 rounded-xs border border-outline bg-surface px-2.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant disabled:opacity-60"
                      >
                        {d.adminLocked ? "잠금 해제" : "잠금"}
                      </button>
                      <button
                        type="button"
                        disabled={rowBusyKey === `exp-${d.id}`}
                        onClick={() => toggleExpire(d)}
                        className="h-8 rounded-xs border border-outline bg-surface px-2.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant disabled:opacity-60"
                      >
                        {d.status === "ACTIVE" ? "마감" : "재오픈"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Actor Disambiguation Merge (mudeal_8 parity) */}
      <section className="flex flex-col gap-3 rounded-lg border border-outline bg-surface p-6">
        <h2 className="text-base font-bold text-on-surface">배우 동명이인 매핑 보정</h2>
        <form onSubmit={requestActorMerge} className="flex flex-wrap items-center gap-3">
          <select
            aria-label="삭제(병합 원본) 배우 선택"
            value={sourceActorId}
            onChange={(e) => {
              setSourceActorId(e.target.value);
              setConfirmMerge(false);
            }}
            className="h-9 rounded-sm border border-outline bg-surface-variant px-3 text-xs"
          >
            <option value="">삭제(병합 원본) 배우 선택</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                #{a.id} {a.name} (팔로워 {a.followerCount})
              </option>
            ))}
          </select>
          <span className="text-xs text-muted" aria-hidden="true">→</span>
          <select
            aria-label="유지(병합 대상) 배우 선택"
            value={targetActorId}
            onChange={(e) => {
              setTargetActorId(e.target.value);
              setConfirmMerge(false);
            }}
            className="h-9 rounded-sm border border-outline bg-surface-variant px-3 text-xs"
          >
            <option value="">유지(병합 대상) 배우 선택</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                #{a.id} {a.name} (팔로워 {a.followerCount})
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={mergeBusy}
            className="h-9 rounded-sm border border-outline bg-surface px-4 text-xs font-semibold text-primary hover:bg-rose-mist disabled:opacity-60"
          >
            병합 검토
          </button>
        </form>

        {confirmMerge && sourceActor && targetActor && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-urgent bg-urgent-wash p-3.5">
            <p className="text-xs font-semibold text-urgent">
              #{sourceActor.id} {sourceActor.name} 기록을 #{targetActor.id} {targetActor.name}으로 병합하고
              원본 배우를 삭제할까요? 이 작업은 되돌릴 수 없어요.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={mergeBusy}
                onClick={() => setConfirmMerge(false)}
                className="h-8 rounded-xs border border-outline bg-surface px-3 text-xs font-semibold text-on-surface-variant"
              >
                취소
              </button>
              <button
                type="button"
                disabled={mergeBusy}
                onClick={executeActorMerge}
                className="h-8 rounded-xs bg-urgent px-3 text-xs font-semibold text-white disabled:opacity-60"
              >
                {mergeBusy ? "병합 중..." : "병합 확정"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Home Banner Curations (FR-012) */}
      <section className="flex flex-col gap-3 rounded-lg border border-outline bg-surface p-6">
        <h2 className="text-base font-bold text-on-surface tabular-nums">
          홈 배너 큐레이션 ({curations.length})
        </h2>
        <div className="divide-y divide-outline rounded-md border border-outline">
          {curations.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <span className="mr-2 rounded-xs bg-surface-sunken px-1.5 py-0.5 text-[11px] font-semibold text-on-surface-variant tabular-nums">
                  {SLOT_TYPE_LABELS[c.slotType]} #{c.sortOrder}
                </span>
                <span className="font-semibold text-on-surface">{c.title}</span>
                <span className="ml-2 text-xs text-muted">{c.linkUrl}</span>
              </div>
              <button
                type="button"
                disabled={rowBusyKey === `cur-${c.id}`}
                onClick={() => toggleCuration(c)}
                className={`h-8 rounded-xs border px-3 text-xs font-semibold disabled:opacity-60 ${
                  c.isActive
                    ? "border-secondary bg-rose-mist text-primary"
                    : "border-outline bg-surface text-muted"
                }`}
              >
                {c.isActive ? "노출 중" : "비활성"}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
