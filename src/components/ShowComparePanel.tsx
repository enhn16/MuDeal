"use client";

import { useMemo, useState } from "react";
import type { ConditionTag, DealType, SeatGrade } from "@/db/schema";
import { formatKstDateTime } from "@/lib/kst";
import { CONDITION_TAG_LABELS, SEAT_GRADE_LABELS } from "@/lib/labels";
import { compareDealsForDisplay, formatKrw, summarizeLowestDeals } from "@/lib/pricing";
import { FlagDealIssueButton, HelpfulButton, OutboundButton } from "./DealActions";
import { AddShowToCalendarButton } from "./PersonalButtons";

export interface PricedDealRow {
  id: number;
  channelName: string;
  dealType: DealType;
  seatGrade: SeatGrade;
  basePrice: number | null;
  salePrice: number | null;
  discountRate: number | null;
  isUnconditional: boolean;
  conditionTags: ConditionTag[];
  conditionSummary: string | null;
  feeInfo: string | null;
  externalUrl: string;
  expiresAt: string | null;
  dDay: number | null;
  sourceType: string;
  reporterNickname: string | null;
  clickCount: number;
  helpfulCount: number;
  lastVerifiedAt: string;
}

/** Stitch mudeal_3 full 12-col split: Left 8-col stack + Right 4-col sticky summary sidebar. */
export function ShowComparePanel({
  showId,
  showTitle,
  todayKst,
  isLoggedIn,
  deals,
  seatGrades,
  lastVerifiedAt,
  disclaimer,
  headerSlot,
  belowCompareSlot,
}: {
  showId: number;
  showTitle: string;
  todayKst: string;
  isLoggedIn: boolean;
  deals: PricedDealRow[];
  seatGrades: SeatGrade[];
  lastVerifiedAt: string;
  disclaimer: string;
  headerSlot: React.ReactNode;
  belowCompareSlot: React.ReactNode;
}) {
  const [selectedSeat, setSelectedSeat] = useState<"ALL_TAB" | SeatGrade>("ALL_TAB");
  const [unconditionalOnly, setUnconditionalOnly] = useState(false);

  const visible = useMemo(() => {
    return deals
      .filter((d) => {
        if (selectedSeat !== "ALL_TAB" && d.seatGrade !== selectedSeat && d.seatGrade !== "ALL") {
          return false;
        }
        if (unconditionalOnly && !d.isUnconditional) return false;
        return true;
      })
      .sort(compareDealsForDisplay);
  }, [deals, selectedSeat, unconditionalOnly]);

  const { generalLowest, conditionalLowest } = useMemo(
    () => summarizeLowestDeals(visible),
    [visible],
  );
  const topDeal = visible[0] ?? null;
  const seatLabel = selectedSeat === "ALL_TAB" ? "전체 좌석" : SEAT_GRADE_LABELS[selectedSeat];

  return (
    <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-12">
      {/* Left Main Column (8/12) */}
      <div className="flex flex-col gap-6 lg:col-span-8">
        {headerSlot}

        {/* Multi-Channel Price Comparison Section (mudeal_3 parity) */}
        <section
          id="price-compare"
          className="flex flex-col gap-5 rounded-lg border border-outline bg-surface p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-on-surface">예매처별 실시간 가격 비교</h2>
            <span className="text-[13px] text-muted tabular-nums">
              {formatKstDateTime(lastVerifiedAt)} 확인 (KST)
            </span>
          </div>

          {/* Seat Grade Underline Tabs */}
          <div role="tablist" aria-label="좌석 등급 선택" className="flex items-center gap-6 overflow-x-auto border-b border-outline">
            <button
              type="button"
              role="tab"
              aria-selected={selectedSeat === "ALL_TAB"}
              onClick={() => setSelectedSeat("ALL_TAB")}
              className={`h-11 border-b-2 px-2 text-[15px] font-semibold whitespace-nowrap transition-colors ${
                selectedSeat === "ALL_TAB"
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              전체 좌석
            </button>
            {seatGrades.map((grade) => (
              <button
                key={grade}
                type="button"
                role="tab"
                aria-selected={selectedSeat === grade}
                onClick={() => setSelectedSeat(grade)}
                className={`h-11 border-b-2 px-2 text-[15px] font-semibold whitespace-nowrap transition-colors ${
                  selectedSeat === grade
                    ? "border-primary text-primary"
                    : "border-transparent text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {SEAT_GRADE_LABELS[grade]}
              </button>
            ))}
          </div>

          {/* General Lowest vs Conditional/Lottery Lowest Summary */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 rounded-md bg-surface-sunken p-4">
              <span className="text-xs font-semibold text-primary">일반(무조건) 최저가</span>
              {generalLowest ? (
                <>
                  <div className="flex items-baseline gap-2 tabular-nums">
                    {generalLowest.discountRate !== null && (
                      <span className="text-xl font-semibold text-secondary">
                        {generalLowest.discountRate}%
                      </span>
                    )}
                    <span className="text-xl font-semibold text-on-surface">
                      {generalLowest.salePrice !== null ? formatKrw(generalLowest.salePrice) : "할인 적용"}
                    </span>
                    {generalLowest.basePrice && (
                      <span className="text-[13px] text-muted line-through">
                        {formatKrw(generalLowest.basePrice)}
                      </span>
                    )}
                  </div>
                  <span className="text-[13px] text-muted">
                    {generalLowest.channelName} · {generalLowest.conditionSummary ?? "조건 없음"}
                  </span>
                </>
              ) : (
                <span className="mt-1 text-[13px] text-muted">지금 진행 중인 무조건 할인이 없어요.</span>
              )}
            </div>

            <div className="flex flex-col gap-1 rounded-md border border-champagne-gold bg-gold-wash p-4">
              <span className="text-xs font-semibold text-on-surface">추첨 · 조건부 최저가</span>
              {conditionalLowest ? (
                <>
                  <div className="flex items-baseline gap-2 tabular-nums">
                    {conditionalLowest.discountRate !== null && (
                      <span className="text-xl font-semibold text-secondary">
                        {conditionalLowest.discountRate}%
                      </span>
                    )}
                    <span className="text-xl font-semibold text-on-surface">
                      {conditionalLowest.salePrice !== null ? formatKrw(conditionalLowest.salePrice) : "할인 적용"}
                    </span>
                    {conditionalLowest.basePrice && (
                      <span className="text-[13px] text-muted line-through">
                        {formatKrw(conditionalLowest.basePrice)}
                      </span>
                    )}
                  </div>
                  <span className="text-[13px] text-muted">
                    {conditionalLowest.channelName} · {conditionalLowest.conditionSummary ?? "조건 확인"}
                  </span>
                </>
              ) : (
                <span className="mt-1 text-[13px] text-muted">지금 진행 중인 추첨·조건부 할인이 없어요.</span>
              )}
            </div>
          </div>

          {/* Comparison Table (mudeal_3 table parity) */}
          {visible.length === 0 ? (
            <p className="rounded-md bg-surface-variant p-6 text-center text-sm text-muted">
              선택한 좌석에 진행 중인 할인이 없어요. 다른 좌석이나 조건을 확인해 보세요.
            </p>
          ) : (
            <div className="w-full overflow-x-auto rounded-lg border border-outline">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead className="border-b border-outline bg-surface-sunken text-[13px] font-semibold text-on-surface-variant">
                  <tr>
                    <th scope="col" className="px-4 py-3">예매처 · 출처</th>
                    <th scope="col" className="px-4 py-3">할인 조건</th>
                    <th scope="col" className="px-4 py-3 text-right">할인율 · 최종가</th>
                    <th scope="col" className="px-4 py-3 text-right">이동</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline">
                  {visible.map((deal, idx) => {
                    const isBest = idx === 0;
                    return (
                      <tr
                        key={deal.id}
                        className={
                          isBest
                            ? "border-l-4 border-l-champagne-gold bg-gold-wash"
                            : "transition-colors hover:bg-surface-variant"
                        }
                      >
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[15px] font-semibold text-on-surface whitespace-nowrap">
                                {deal.channelName}
                              </span>
                              {isBest && (
                                <span className="rounded-xs border border-champagne-gold bg-surface px-2 py-0 text-xs font-semibold text-on-surface">
                                  {deal.isUnconditional ? "최저가" : "조건부 최저가"}
                                </span>
                              )}
                              {deal.sourceType === "USER_REPORT" && (
                                <span className="rounded-xs bg-rose-mist px-2 py-0 text-xs font-semibold text-primary">
                                  {deal.reporterNickname || "익명의 관객"}님 제보
                                </span>
                              )}
                            </div>
                            <span className="text-[13px] text-muted tabular-nums">
                              {deal.sourceType === "USER_REPORT"
                                ? `${deal.clickCount}명 확인 · 도움 ${deal.helpfulCount}`
                                : deal.feeInfo ?? SEAT_GRADE_LABELS[deal.seatGrade]}
                            </span>
                            {deal.sourceType === "USER_REPORT" && (
                              <div className="pt-0.5">
                                <HelpfulButton dealId={deal.id} initialCount={deal.helpfulCount} />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col items-start gap-1">
                            <div className="flex flex-wrap gap-1">
                              <span
                                className={`rounded-xs px-2 py-0 text-xs font-semibold ${
                                  deal.isUnconditional
                                    ? "bg-rose-mist text-primary"
                                    : "bg-surface-sunken text-on-surface-variant"
                                }`}
                              >
                                {deal.isUnconditional ? "무조건" : "추첨/조건부"}
                              </span>
                              {deal.conditionTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-xs bg-surface-sunken px-2 py-0 text-xs font-semibold text-on-surface-variant"
                                >
                                  {CONDITION_TAG_LABELS[tag]}
                                </span>
                              ))}
                            </div>
                            {deal.conditionSummary && (
                              <span className="text-[13px] text-muted">{deal.conditionSummary}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right tabular-nums">
                          <div className="flex items-baseline justify-end gap-2">
                            {deal.discountRate !== null && (
                              <span className="text-lg font-bold text-secondary">
                                {deal.discountRate}%
                              </span>
                            )}
                            <span className="text-lg font-bold text-on-surface">
                              {deal.salePrice !== null ? formatKrw(deal.salePrice) : "할인"}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <OutboundButton
                            dealId={deal.id}
                            externalUrl={deal.externalUrl}
                            label={`${deal.channelName} 이동 ↗`}
                            variant={isBest ? "primary" : "secondary"}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">{disclaimer}</p>
            {topDeal && <FlagDealIssueButton dealId={topDeal.id} />}
          </div>
        </section>

        {belowCompareSlot}
      </div>

      {/* Right Sticky Price & CTA Sidebar (4/12, mudeal_3 parity) */}
      <aside className="flex flex-col gap-5 rounded-lg border border-outline bg-surface p-6 lg:sticky lg:top-28 lg:col-span-4">
        <div className="flex flex-col gap-1 border-b border-outline pb-4">
          <span className="text-xs font-semibold text-muted">선택 좌석 최저가 ({seatLabel})</span>
          {topDeal ? (
            <>
              <div className="flex items-baseline gap-2 tabular-nums">
                {topDeal.discountRate !== null && (
                  <span className="text-2xl font-bold text-secondary">{topDeal.discountRate}%</span>
                )}
                <span className="text-2xl font-bold text-on-surface">
                  {topDeal.salePrice !== null ? formatKrw(topDeal.salePrice) : "할인"}
                </span>
              </div>
              {topDeal.basePrice && (
                <span className="text-[13px] text-muted line-through tabular-nums">
                  정가 {formatKrw(topDeal.basePrice)}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-muted">지금 비교할 수 있는 할인이 없어요.</span>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
          <input
            type="checkbox"
            checked={unconditionalOnly}
            onChange={(e) => setUnconditionalOnly(e.target.checked)}
            className="h-4 w-4 rounded-xs border-outline-strong accent-primary"
          />
          <span>무조건 할인만 보기</span>
        </label>

        {visible.length > 0 && (
          <div className="flex flex-col gap-2">
            {visible.slice(0, 2).map((d, idx) => (
              <div
                key={d.id}
                className={`flex items-center justify-between rounded-sm border p-3 ${
                  idx === 0
                    ? "border-champagne-gold bg-gold-wash"
                    : "border-outline bg-surface-variant"
                }`}
              >
                <div className="flex flex-col">
                  <span className="text-[13px] font-semibold text-on-surface">{d.channelName}</span>
                  <span
                    className={`text-xs ${d.isUnconditional ? "text-primary" : "text-muted"}`}
                  >
                    {d.isUnconditional ? "무조건 할인" : "추첨 · 조건부"}
                  </span>
                </div>
                <span className="text-[15px] font-semibold text-on-surface tabular-nums">
                  {d.salePrice !== null
                    ? formatKrw(d.salePrice)
                    : d.discountRate !== null
                      ? `${d.discountRate}% 할인`
                      : "할인"}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {topDeal && (
            <OutboundButton
              dealId={topDeal.id}
              externalUrl={topDeal.externalUrl}
              label={`${topDeal.channelName}에서 최저가 보기 ↗`}
              variant="primary"
              className="h-12 w-full text-[15px]"
            />
          )}
          <AddShowToCalendarButton
            showId={showId}
            showTitle={showTitle}
            todayKst={todayKst}
            isLoggedIn={isLoggedIn}
          />
        </div>
      </aside>
    </div>
  );
}
