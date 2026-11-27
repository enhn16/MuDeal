"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEAL_TYPES, SEAT_GRADES, type DealType, type SeatGrade } from "@/db/schema";
import { formatKstDate, formatKstDateTime } from "@/lib/kst";
import { DEAL_TYPE_LABELS, SEAT_GRADE_LABELS } from "@/lib/labels";

interface PendingReport {
  id: number;
  reporterNickname: string;
  showId: number | null;
  reportedShowTitle: string;
  channelName: string;
  externalUrl: string;
  dealType: DealType;
  reportedPrice: number | null;
  reportedDiscountRate: number | null;
  conditionNote: string | null;
  evidenceR2Key: string | null;
  createdAt: string;
}

interface DraftRow {
  deal: {
    id: number;
    showId: number | null;
    channelName: string;
    dealType: DealType;
    seatGrade: SeatGrade;
    salePrice: number | null;
    discountRate: number | null;
    conditionSummary: string | null;
    perkSummary: string | null;
    expiresAt: string | null;
    externalUrl: string;
  };
  showTitle: string | null;
  ocrConfidence: number | null;
  ocrExtractedJson: string | null;
  ocrSourceChannel: string | null;
  ocrImageUrl: string | null;
  ocrSourcePageUrl: string | null;
}

interface FailedOcrJob {
  id: number;
  sourceChannel: string;
  sourcePageUrl: string;
  ocrStatus?: string;
  errorMessage: string | null;
  updatedAt: string;
}

interface DraftEditState {
  showId: string;
  dealType: DealType;
  seatGrade: SeatGrade;
  salePrice: string;
  discountRate: string;
  conditionSummary: string;
  expiresDate: string;
  perkSummary: string;
}

function toKstDateInput(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return formatKstDate(dt);
}

function makeInitialDraftEdit(deal: DraftRow["deal"]): DraftEditState {
  return {
    showId: deal.showId ? String(deal.showId) : "",
    dealType: deal.dealType,
    seatGrade: deal.seatGrade,
    salePrice: deal.salePrice != null ? String(deal.salePrice) : "",
    discountRate: deal.discountRate != null ? String(deal.discountRate) : "",
    conditionSummary: deal.conditionSummary ?? "",
    expiresDate: toKstDateInput(deal.expiresAt),
    perkSummary: deal.perkSummary ?? "",
  };
}

function formatPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function confidenceBadgeStyle(confidence: number): { cls: string; label: string } {
  const pct = Math.round(confidence * 100);
  if (confidence < 0.7) {
    return { cls: "bg-urgent-wash text-urgent", label: `OCR 신뢰도 낮음 ${pct}%` };
  }
  if (confidence < 0.9) {
    return { cls: "bg-surface-sunken text-on-surface-variant", label: `OCR 신뢰도 ${pct}%` };
  }
  return { cls: "bg-rose-mist text-primary", label: `OCR 신뢰도 ${pct}%` };
}

function OcrImagePreview({ imageUrl }: { imageUrl: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-outline bg-surface-variant p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-on-surface">원본 공지 이미지</span>
        <a
          href={imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-primary hover:underline"
        >
          원본 이미지 새 탭 보기 ↗
        </a>
      </div>
      {failed ? (
        <p className="rounded-xs border border-outline bg-surface px-3 py-4 text-center text-xs text-muted">
          이미지를 바로 불러오지 못했어요. 오른쪽 &apos;원본 이미지 새 탭 보기 ↗&apos;에서 직접 확인해 주세요.
        </p>
      ) : (
        <img
          src={imageUrl}
          alt="OCR 분석 원본 공지 이미지"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-72 w-full rounded-xs border border-outline bg-surface object-contain"
        />
      )}
    </div>
  );
}

export function AdminReviewConsole({
  initialReports,
  initialDrafts,
  initialFailedOcrJobs = [],
  showOptions,
}: {
  initialReports: PendingReport[];
  initialDrafts: DraftRow[];
  initialFailedOcrJobs?: FailedOcrJob[];
  showOptions: Array<{ id: number; title: string; kopisId: string | null }>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"user" | "ocr">("user");
  const [reports, setReports] = useState(initialReports);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [draftEdits, setDraftEdits] = useState<Record<number, DraftEditState>>(() =>
    Object.fromEntries(initialDrafts.map((row) => [row.deal.id, makeInitialDraftEdit(row.deal)])),
  );
  const [failedJobs, setFailedJobs] = useState(initialFailedOcrJobs);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(initialReports[0]?.id ?? null);
  const currentReport = reports.find((r) => r.id === selectedReportId) ?? reports[0] ?? null;

  const [showId, setShowId] = useState<string>(currentReport?.showId ? String(currentReport.showId) : "");
  const [salePrice, setSalePrice] = useState<string>(
    currentReport?.reportedPrice != null ? String(currentReport.reportedPrice) : "",
  );
  const [discountRate, setDiscountRate] = useState<string>(
    currentReport?.reportedDiscountRate != null ? String(currentReport.reportedDiscountRate) : "",
  );
  const [maskNickname, setMaskNickname] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; isError?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  function selectReport(r: PendingReport) {
    setSelectedReportId(r.id);
    setShowId(r.showId ? String(r.showId) : "");
    setSalePrice(r.reportedPrice != null ? String(r.reportedPrice) : "");
    setDiscountRate(r.reportedDiscountRate != null ? String(r.reportedDiscountRate) : "");
    setMaskNickname(false);
    setRejectReason("");
    setFeedback(null);
  }

  function updateDraftEdit(dealId: number, deal: DraftRow["deal"], patch: Partial<DraftEditState>) {
    setDraftEdits((prev) => ({
      ...prev,
      [dealId]: { ...(prev[dealId] ?? makeInitialDraftEdit(deal)), ...patch },
    }));
  }

  async function handleApproveReport() {
    if (!currentReport || busy) return;
    if (!showId) {
      setFeedback({ text: "KOPIS 작품을 먼저 선택해 주세요.", isError: true });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/v1/admin/reports/${currentReport.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          showId: Number(showId),
          salePrice: salePrice !== "" ? Number(salePrice) : null,
          discountRate: discountRate !== "" ? Number(discountRate) : null,
          maskNickname,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
      if (!res.ok) {
        setFeedback({
          text: json.error?.message ?? "승인하지 못했어요. 다시 시도해 주세요.",
          isError: true,
        });
        return;
      }
      const rest = reports.filter((r) => r.id !== currentReport.id);
      setReports(rest);
      if (rest[0]) {
        selectReport(rest[0]);
      } else {
        setSelectedReportId(null);
      }
      setFeedback({ text: "승인하고 게시했어요." });
      router.refresh();
    } catch {
      setFeedback({ text: "네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.", isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function handleRejectReport() {
    if (!currentReport || busy) return;
    if (!rejectReason.trim()) {
      setFeedback({ text: "반려 사유를 입력해 주세요.", isError: true });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/v1/admin/reports/${currentReport.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonNote: rejectReason.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
      if (!res.ok) {
        setFeedback({
          text: json.error?.message ?? "반려 처리하지 못했어요. 다시 시도해 주세요.",
          isError: true,
        });
        return;
      }
      const rest = reports.filter((r) => r.id !== currentReport.id);
      setReports(rest);
      if (rest[0]) {
        selectReport(rest[0]);
      } else {
        setSelectedReportId(null);
      }
      setFeedback({ text: "반려 처리했어요." });
      router.refresh();
    } catch {
      setFeedback({ text: "네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.", isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function handleDraftAction(row: DraftRow, action: "approve" | "discard") {
    if (busy) return;
    const edit = draftEdits[row.deal.id] ?? makeInitialDraftEdit(row.deal);
    const mappedShowId = edit.showId ? Number(edit.showId) : null;
    if (action === "approve" && !mappedShowId) {
      setFeedback({ text: "매핑할 작품을 먼저 선택해 주세요.", isError: true });
      return;
    }

    const payload =
      action === "approve"
        ? {
            showId: mappedShowId ?? undefined,
            dealType: edit.dealType,
            seatGrade: edit.seatGrade,
            salePrice: edit.salePrice !== "" ? Number(edit.salePrice) : null,
            discountRate: edit.discountRate !== "" ? Number(edit.discountRate) : null,
            conditionSummary: edit.conditionSummary.trim() || null,
            expiresAt: edit.expiresDate ? new Date(`${edit.expiresDate}T23:59:59+09:00`).toISOString() : null,
            perkSummary: edit.perkSummary.trim() || null,
          }
        : {};

    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/v1/admin/drafts/${row.deal.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
      if (!res.ok) {
        setFeedback({
          text: json.error?.message ?? "초안을 처리하지 못했어요. 다시 시도해 주세요.",
          isError: true,
        });
        return;
      }
      setDrafts((prev) => prev.filter((d) => d.deal.id !== row.deal.id));
      setFeedback({ text: action === "approve" ? "초안을 보정하고 게시했어요." : "초안을 폐기했어요." });
      router.refresh();
    } catch {
      setFeedback({ text: "네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.", isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function retryOcrJob(jobId: number) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/v1/admin/ocr-jobs/${jobId}/retry`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
      if (!res.ok) {
        setFeedback({
          text:
            res.status === 409
              ? (json.error?.message ?? "이미 재시도 대기 중이거나 처리 완료된 작업이에요.")
              : (json.error?.message ?? "OCR 작업 재시도를 요청하지 못했어요."),
          isError: true,
        });
        return;
      }
      setFailedJobs((prev) => prev.filter((j) => j.id !== jobId));
      setFeedback({ text: `OCR 작업 #${jobId}을 대기열로 되돌렸어요.` });
      router.refresh();
    } catch {
      setFeedback({ text: "네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.", isError: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 2 Underline Tabs (mudeal_7 parity) */}
      <div role="tablist" aria-label="검수 대기열 유형" className="flex items-center gap-6 border-b border-outline">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "user"}
          onClick={() => {
            setTab("user");
            setFeedback(null);
          }}
          className={`h-11 border-b-2 px-2 text-[15px] font-semibold tabular-nums ${
            tab === "user" ? "border-primary text-primary" : "border-transparent text-on-surface-variant"
          }`}
        >
          사용자 제보 ({reports.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "ocr"}
          onClick={() => {
            setTab("ocr");
            setFeedback(null);
          }}
          className={`h-11 border-b-2 px-2 text-[15px] font-semibold tabular-nums ${
            tab === "ocr" ? "border-primary text-primary" : "border-transparent text-on-surface-variant"
          }`}
        >
          자동 수집 · OCR 초안 ({drafts.length})
        </button>
      </div>

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

      {/* Tab 1: 사용자 제보 */}
      {tab === "user" && (
        <>
          {!currentReport ? (
            <div className="rounded-lg border border-outline bg-surface p-10 text-center text-sm text-muted">
              검수 대기 중인 사용자 제보가 없어요.
            </div>
          ) : (
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
              <div className="flex flex-col gap-4 lg:col-span-5">
                <div className="flex flex-col gap-3 rounded-lg border border-outline bg-surface p-5">
                  <div className="flex items-center justify-between">
                    <span className="rounded-xs bg-rose-mist px-2 py-0.5 text-xs font-semibold text-primary">
                      {DEAL_TYPE_LABELS[currentReport.dealType]}
                    </span>
                    <span className="text-xs text-muted tabular-nums">
                      {formatKstDateTime(currentReport.createdAt)}
                    </span>
                  </div>
                  <h2 className="text-base font-bold text-on-surface">
                    제보자: {currentReport.reporterNickname}
                  </h2>
                  <p className="text-sm font-medium text-body">
                    {currentReport.reportedShowTitle} · {currentReport.channelName}
                  </p>
                  {currentReport.conditionNote && (
                    <p className="text-xs text-muted">{currentReport.conditionNote}</p>
                  )}
                  <div className="rounded-sm border border-outline bg-surface-variant p-3">
                    <span className="block text-[11px] font-semibold text-muted">원문 예매처 링크</span>
                    <a
                      href={currentReport.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block break-all text-xs text-primary hover:underline"
                    >
                      {currentReport.externalUrl} ↗
                    </a>
                  </div>
                  {currentReport.evidenceR2Key && (
                    <div className="flex flex-col gap-2 rounded-sm border border-outline bg-surface-variant p-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-on-surface">첨부 증빙 이미지</span>
                        <a
                          href={`/api/v1/admin/evidence?key=${encodeURIComponent(currentReport.evidenceR2Key)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-primary hover:underline"
                        >
                          원본 보기 ↗
                        </a>
                      </div>
                      <img
                        src={`/api/v1/admin/evidence?key=${encodeURIComponent(currentReport.evidenceR2Key)}`}
                        alt="제보 증빙 이미지"
                        className="max-h-56 w-full rounded-xs border border-outline bg-surface object-contain"
                      />
                    </div>
                  )}
                </div>

                {reports.length > 1 && (
                  <div className="flex flex-col gap-2 rounded-lg border border-outline bg-surface p-4">
                    <span className="text-xs font-semibold text-muted tabular-nums">
                      대기 중인 다른 제보 ({reports.length - 1})
                    </span>
                    {reports
                      .filter((r) => r.id !== currentReport.id)
                      .map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => selectReport(r)}
                          className="flex items-center justify-between rounded-sm border border-outline bg-surface-variant px-3 py-2 text-left text-xs hover:border-secondary"
                        >
                          <span className="truncate font-semibold text-on-surface">
                            {r.reporterNickname} · {r.reportedShowTitle}
                          </span>
                          <span className="shrink-0 text-muted tabular-nums">
                            {formatKstDate(new Date(r.createdAt)).slice(5)}
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </div>

              {/* Right: Mapping & Publish Form */}
              <div className="flex flex-col gap-4 rounded-lg border border-outline bg-surface p-6 lg:col-span-7">
                <h2 className="border-b border-outline pb-3 text-lg font-bold text-on-surface">
                  매핑 및 게시 보정
                </h2>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="admin-show" className="text-xs font-semibold text-on-surface">
                      KOPIS 작품 매핑 (필수)
                    </label>
                    <select
                      id="admin-show"
                      value={showId}
                      onChange={(e) => setShowId(e.target.value)}
                      className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface"
                    >
                      <option value="">작품을 선택해 주세요</option>
                      {showOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title} {s.kopisId ? `(${s.kopisId})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor="admin-price" className="text-xs font-semibold text-on-surface">
                      할인가 (원)
                    </label>
                    <input
                      id="admin-price"
                      type="number"
                      min={0}
                      value={salePrice}
                      onChange={(e) => setSalePrice(e.target.value)}
                      className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm tabular-nums"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor="admin-rate" className="text-xs font-semibold text-on-surface">
                      할인율 (%)
                    </label>
                    <input
                      id="admin-rate"
                      type="number"
                      min={1}
                      max={99}
                      value={discountRate}
                      onChange={(e) => setDiscountRate(e.target.value)}
                      className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm tabular-nums"
                    />
                  </div>

                  <label className="flex cursor-pointer items-end gap-2 pb-2 text-xs font-semibold text-on-surface-variant">
                    <input
                      type="checkbox"
                      checked={maskNickname}
                      onChange={(e) => setMaskNickname(e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    닉네임 마스킹 (&apos;익명의 관객&apos;으로 표시)
                  </label>
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="reject-reason" className="text-xs font-semibold text-on-surface">
                    반려 사유 (반려 시 필수)
                  </label>
                  <input
                    id="reject-reason"
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="예: 공식 예매처 링크 확인 불가 또는 기존 딜과 중복"
                    className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm"
                  />
                </div>

                <div className="flex flex-wrap justify-end gap-3 border-t border-outline pt-4">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRejectReport}
                    className="h-10 rounded-sm border border-urgent bg-surface px-4 text-sm font-semibold text-urgent hover:bg-urgent-wash disabled:opacity-60"
                  >
                    {busy ? "처리 중..." : "반려"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !showId}
                    onClick={handleApproveReport}
                    className="h-10 rounded-sm bg-secondary px-5 text-sm font-semibold text-on-secondary hover:bg-secondary-hover disabled:opacity-60"
                  >
                    {busy ? "처리 중..." : "승인 및 게시"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Tab 2: 자동 수집 · OCR 초안 */}
      {tab === "ocr" && (
        <div className="flex flex-col gap-4">
          {drafts.length === 0 ? (
            <div className="rounded-lg border border-outline bg-surface p-10 text-center text-sm text-muted">
              검수 대기 중인 자동 수집·OCR 초안이 없어요.
            </div>
          ) : (
            drafts.map((row) => {
              const edit = draftEdits[row.deal.id] ?? makeInitialDraftEdit(row.deal);
              const confBadge = row.ocrConfidence !== null ? confidenceBadgeStyle(row.ocrConfidence) : null;
              return (
                <article
                  key={row.deal.id}
                  className="flex flex-col gap-4 rounded-lg border border-outline bg-surface p-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {confBadge && (
                        <span className={`rounded-xs px-2 py-0.5 text-xs font-semibold tabular-nums ${confBadge.cls}`}>
                          {confBadge.label}
                        </span>
                      )}
                      <span className="rounded-xs bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-on-surface-variant">
                        {row.ocrSourceChannel ?? row.deal.channelName}
                      </span>
                      <span className="text-xs text-muted tabular-nums">초안 #{row.deal.id}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {row.ocrSourcePageUrl && row.ocrSourcePageUrl !== row.deal.externalUrl && (
                        <a
                          href={row.ocrSourcePageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-on-surface-variant hover:text-primary hover:underline"
                        >
                          공지 원문 ↗
                        </a>
                      )}
                      <a
                        href={row.deal.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        예매처 링크 확인 ↗
                      </a>
                    </div>
                  </div>

                  <h3 className="text-base font-bold text-on-surface">
                    {row.showTitle ?? "(미매핑 작품)"} ·{" "}
                    {row.deal.conditionSummary ?? DEAL_TYPE_LABELS[row.deal.dealType]}
                  </h3>

                  {row.ocrImageUrl && <OcrImagePreview imageUrl={row.ocrImageUrl} />}

                  {/* Structured inline override form */}
                  <div className="grid grid-cols-1 gap-3 rounded-md border border-outline bg-surface-variant p-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
                      <label
                        htmlFor={`draft-show-${row.deal.id}`}
                        className="text-xs font-semibold text-on-surface"
                      >
                        KOPIS 작품 매핑 {row.deal.showId === null ? "(승인 전 필수)" : "(변경 가능)"}
                      </label>
                      <select
                        id={`draft-show-${row.deal.id}`}
                        value={edit.showId}
                        onChange={(e) => updateDraftEdit(row.deal.id, row.deal, { showId: e.target.value })}
                        className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs text-on-surface"
                      >
                        <option value="">작품을 선택해 주세요</option>
                        {showOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title} {s.kopisId ? `(${s.kopisId})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={`draft-type-${row.deal.id}`}
                        className="text-xs font-semibold text-on-surface"
                      >
                        혜택 유형
                      </label>
                      <select
                        id={`draft-type-${row.deal.id}`}
                        value={edit.dealType}
                        onChange={(e) =>
                          updateDraftEdit(row.deal.id, row.deal, { dealType: e.target.value as DealType })
                        }
                        className="h-9 rounded-sm border border-outline bg-surface px-2.5 text-xs text-on-surface"
                      >
                        {DEAL_TYPES.map((dt) => (
                          <option key={dt} value={dt}>
                            {DEAL_TYPE_LABELS[dt]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={`draft-seat-${row.deal.id}`}
                        className="text-xs font-semibold text-on-surface"
                      >
                        좌석 등급
                      </label>
                      <select
                        id={`draft-seat-${row.deal.id}`}
                        value={edit.seatGrade}
                        onChange={(e) =>
                          updateDraftEdit(row.deal.id, row.deal, { seatGrade: e.target.value as SeatGrade })
                        }
                        className="h-9 rounded-sm border border-outline bg-surface px-2.5 text-xs text-on-surface"
                      >
                        {SEAT_GRADES.map((sg) => (
                          <option key={sg} value={sg}>
                            {SEAT_GRADE_LABELS[sg]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={`draft-expires-${row.deal.id}`}
                        className="text-xs font-semibold text-on-surface"
                      >
                        마감일 (KST)
                      </label>
                      <input
                        id={`draft-expires-${row.deal.id}`}
                        type="date"
                        value={edit.expiresDate}
                        onChange={(e) => updateDraftEdit(row.deal.id, row.deal, { expiresDate: e.target.value })}
                        className="h-9 rounded-sm border border-outline bg-surface px-2.5 text-xs text-on-surface tabular-nums"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={`draft-price-${row.deal.id}`}
                        className="text-xs font-semibold text-on-surface"
                      >
                        할인가 (원)
                      </label>
                      <input
                        id={`draft-price-${row.deal.id}`}
                        type="number"
                        min={0}
                        value={edit.salePrice}
                        onChange={(e) => updateDraftEdit(row.deal.id, row.deal, { salePrice: e.target.value })}
                        placeholder="미입력 시 정률/이벤트"
                        className="h-9 rounded-sm border border-outline bg-surface px-2.5 text-xs text-on-surface tabular-nums"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={`draft-rate-${row.deal.id}`}
                        className="text-xs font-semibold text-on-surface"
                      >
                        할인율 (%)
                      </label>
                      <input
                        id={`draft-rate-${row.deal.id}`}
                        type="number"
                        min={1}
                        max={99}
                        value={edit.discountRate}
                        onChange={(e) => updateDraftEdit(row.deal.id, row.deal, { discountRate: e.target.value })}
                        placeholder="예: 30"
                        className="h-9 rounded-sm border border-outline bg-surface px-2.5 text-xs text-on-surface tabular-nums"
                      />
                    </div>

                    <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
                      <label
                        htmlFor={`draft-cond-${row.deal.id}`}
                        className="text-xs font-semibold text-on-surface"
                      >
                        할인 조건 · 이벤트 요약
                      </label>
                      <input
                        id={`draft-cond-${row.deal.id}`}
                        type="text"
                        maxLength={300}
                        value={edit.conditionSummary}
                        onChange={(e) =>
                          updateDraftEdit(row.deal.id, row.deal, { conditionSummary: e.target.value })
                        }
                        className="h-9 rounded-sm border border-outline bg-surface px-2.5 text-xs text-on-surface"
                      />
                    </div>

                    <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
                      <label
                        htmlFor={`draft-perk-${row.deal.id}`}
                        className="text-xs font-semibold text-on-surface"
                      >
                        특전 내용 (선택)
                      </label>
                      <input
                        id={`draft-perk-${row.deal.id}`}
                        type="text"
                        maxLength={300}
                        value={edit.perkSummary}
                        onChange={(e) => updateDraftEdit(row.deal.id, row.deal, { perkSummary: e.target.value })}
                        placeholder="특전이 있는 경우 입력해 주세요"
                        className="h-9 rounded-sm border border-outline bg-surface px-2.5 text-xs text-on-surface"
                      />
                    </div>
                  </div>

                  {row.ocrExtractedJson && (
                    <details className="rounded-sm border border-outline bg-surface-sunken px-3 py-2">
                      <summary className="cursor-pointer text-xs font-semibold text-on-surface-variant">
                        OCR 추출 원문 JSON 펼쳐보기
                      </summary>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-on-surface-variant tabular-nums">
                        {formatPrettyJson(row.ocrExtractedJson)}
                      </pre>
                    </details>
                  )}

                  <div className="flex flex-wrap justify-end gap-3 border-t border-outline pt-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDraftAction(row, "discard")}
                      className="h-9 rounded-sm border border-outline bg-surface px-4 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant disabled:opacity-60"
                    >
                      초안 폐기
                    </button>
                    <button
                      type="button"
                      disabled={busy || !edit.showId}
                      onClick={() => handleDraftAction(row, "approve")}
                      className="h-9 rounded-sm bg-secondary px-5 text-xs font-semibold text-on-secondary hover:bg-secondary-hover disabled:opacity-60"
                    >
                      {busy ? "처리 중..." : "검수 완료 및 게시"}
                    </button>
                  </div>
                </article>
              );
            })
          )}

          {failedJobs.length > 0 && (
            <div className="flex flex-col gap-3 rounded-lg border border-outline bg-surface p-5">
              <h3 className="text-sm font-bold text-on-surface tabular-nums">
                실패 · 재검토 필요 OCR 작업 ({failedJobs.length})
              </h3>
              <div className="divide-y divide-outline rounded-md border border-outline">
                {failedJobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-xs px-1.5 py-0.5 text-[11px] font-semibold ${
                            job.ocrStatus === "NEEDS_REVIEW"
                              ? "bg-surface-sunken text-on-surface-variant"
                              : "bg-urgent-wash text-urgent"
                          }`}
                        >
                          {job.ocrStatus === "NEEDS_REVIEW" ? "검토 필요" : "실패"}
                        </span>
                        <p className="font-semibold text-on-surface tabular-nums">
                          #{job.id} · {job.sourceChannel} ({formatKstDateTime(job.updatedAt)})
                        </p>
                      </div>
                      <p className="mt-0.5 truncate text-muted">
                        {job.errorMessage ?? job.sourcePageUrl}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => retryOcrJob(job.id)}
                      className="h-8 shrink-0 rounded-xs border border-outline bg-surface px-3 font-semibold text-primary hover:bg-rose-mist disabled:opacity-60"
                    >
                      재시도
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
