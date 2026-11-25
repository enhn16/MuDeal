"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEAL_TYPE_LABELS } from "@/lib/labels";
import type { DealType } from "@/db/schema";

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
    salePrice: number | null;
    discountRate: number | null;
    conditionSummary: string | null;
    externalUrl: string;
  };
  showTitle: string | null;
  ocrConfidence: number | null;
  ocrExtractedJson: string | null;
  ocrSourceChannel: string | null;
}

export function AdminReviewConsole({
  initialReports,
  initialDrafts,
  showOptions,
}: {
  initialReports: PendingReport[];
  initialDrafts: DraftRow[];
  showOptions: Array<{ id: number; title: string; kopisId: string | null }>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"user" | "ocr">("user");
  const [reports, setReports] = useState(initialReports);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(initialReports[0]?.id ?? null);
  const currentReport = reports.find((r) => r.id === selectedReportId) ?? reports[0] ?? null;

  const [showId, setShowId] = useState<string>(
    currentReport?.showId ? String(currentReport.showId) : String(showOptions[0]?.id ?? ""),
  );
  const [salePrice, setSalePrice] = useState<string>(
    currentReport?.reportedPrice != null ? String(currentReport.reportedPrice) : "",
  );
  const [discountRate, setDiscountRate] = useState<string>(
    currentReport?.reportedDiscountRate != null ? String(currentReport.reportedDiscountRate) : "",
  );
  const [maskNickname, setMaskNickname] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function selectReport(r: PendingReport) {
    setSelectedReportId(r.id);
    setShowId(r.showId ? String(r.showId) : String(showOptions[0]?.id ?? ""));
    setSalePrice(r.reportedPrice != null ? String(r.reportedPrice) : "");
    setDiscountRate(r.reportedDiscountRate != null ? String(r.reportedDiscountRate) : "");
    setMaskNickname(false);
    setRejectReason("");
    setFeedback(null);
  }

  async function handleApproveReport() {
    if (!currentReport || !showId) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/v1/admin/reports/${currentReport.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          showId: Number(showId),
          salePrice: salePrice ? Number(salePrice) : null,
          discountRate: discountRate ? Number(discountRate) : null,
          maskNickname,
        }),
      });
      const json = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        setFeedback(json.error?.message ?? "승인 처리에 실패했습니다.");
        return;
      }
      const rest = reports.filter((r) => r.id !== currentReport.id);
      setReports(rest);
      if (rest[0]) selectReport(rest[0]);
      setFeedback("승인 및 게시 완료되었습니다.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRejectReport() {
    if (!currentReport) return;
    if (!rejectReason.trim()) {
      setFeedback("반려 시 사유를 반드시 입력해 주세요.");
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
      const json = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        setFeedback(json.error?.message ?? "반려 처리에 실패했습니다.");
        return;
      }
      const rest = reports.filter((r) => r.id !== currentReport.id);
      setReports(rest);
      if (rest[0]) selectReport(rest[0]);
      setFeedback("반려 처리 완료되었습니다.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDraftAction(dealId: number, action: "approve" | "discard") {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/v1/admin/drafts/${dealId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message: string } };
        setFeedback(json.error?.message ?? "초안 처리에 실패했습니다.");
        return;
      }
      setDrafts((prev) => prev.filter((d) => d.deal.id !== dealId));
      setFeedback(action === "approve" ? "초안이 게시되었습니다." : "초안이 폐기되었습니다.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 2 Underline Tabs (mudeal_7 parity) */}
      <div className="flex items-center gap-6 border-b border-outline">
        <button
          type="button"
          onClick={() => setTab("user")}
          className={`h-11 border-b-2 px-2 text-[15px] font-semibold ${
            tab === "user" ? "border-primary text-primary" : "border-transparent text-on-surface-variant"
          }`}
        >
          사용자 제보 ({reports.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("ocr")}
          className={`h-11 border-b-2 px-2 text-[15px] font-semibold ${
            tab === "ocr" ? "border-primary text-primary" : "border-transparent text-on-surface-variant"
          }`}
        >
          자동 수집 · OCR 초안 ({drafts.length})
        </button>
      </div>

      {feedback && (
        <p className="rounded-sm border border-rose-border bg-rose-mist px-4 py-2.5 text-xs font-semibold text-primary">
          {feedback}
        </p>
      )}

      {/* Tab 1: 사용자 제보 */}
      {tab === "user" && (
        <>
          {!currentReport ? (
            <div className="rounded-lg border border-outline bg-surface p-10 text-center text-sm text-muted">
              검수 대기 중인 사용자 제보가 없습니다.
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
                      {currentReport.createdAt.slice(0, 16).replace("T", " ")}
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
                    <div className="rounded-sm bg-surface-sunken px-3 py-2 text-xs text-on-surface-variant">
                      증빙 이미지 첨부됨 ({currentReport.evidenceR2Key})
                    </div>
                  )}
                </div>

                {reports.length > 1 && (
                  <div className="flex flex-col gap-2 rounded-lg border border-outline bg-surface p-4">
                    <span className="text-xs font-semibold text-muted">
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
                            {r.createdAt.slice(5, 10)}
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
                      KOPIS 작품 매핑
                    </label>
                    <select
                      id="admin-show"
                      value={showId}
                      onChange={(e) => setShowId(e.target.value)}
                      className="h-10 rounded-sm border border-outline bg-surface-variant px-3 text-sm text-on-surface"
                    >
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
                    className="h-10 rounded-sm border border-urgent bg-surface px-4 text-sm font-semibold text-urgent hover:bg-urgent-wash"
                  >
                    반려
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleApproveReport}
                    className="h-10 rounded-sm bg-secondary px-5 text-sm font-semibold text-on-secondary hover:bg-secondary-hover"
                  >
                    승인 및 게시
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
              검수 대기 중인 자동 수집·OCR 초안이 없습니다.
            </div>
          ) : (
            drafts.map((row) => (
              <div
                key={row.deal.id}
                className="flex flex-col gap-4 rounded-lg border border-outline bg-surface p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {row.ocrConfidence !== null && (
                      <span className="rounded-xs border border-champagne-gold bg-gold-wash px-2 py-0.5 text-xs font-semibold text-on-surface tabular-nums">
                        OCR 신뢰도 {Math.round(row.ocrConfidence * 100)}%
                      </span>
                    )}
                    <span className="text-xs text-muted">
                      {row.ocrSourceChannel ?? row.deal.channelName}
                    </span>
                  </div>
                  <a
                    href={row.deal.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    원문 링크 확인 ↗
                  </a>
                </div>

                <h3 className="text-base font-bold text-on-surface">
                  {row.showTitle ?? "(미매핑 작품)"} · {row.deal.conditionSummary ?? DEAL_TYPE_LABELS[row.deal.dealType]}
                </h3>

                {row.ocrExtractedJson && (
                  <pre className="overflow-x-auto rounded-sm bg-surface-sunken p-3 text-xs text-on-surface-variant tabular-nums">
                    {row.ocrExtractedJson}
                  </pre>
                )}

                <div className="flex justify-end gap-3 border-t border-outline pt-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDraftAction(row.deal.id, "discard")}
                    className="h-9 rounded-sm border border-outline bg-surface px-4 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant"
                  >
                    초안 폐기
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDraftAction(row.deal.id, "approve")}
                    className="h-9 rounded-sm bg-secondary px-5 text-xs font-semibold text-on-secondary hover:bg-secondary-hover"
                  >
                    검수 완료 및 게시
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
