"use client";

import { useMemo, useState } from "react";
import type { ConditionTag, DealType, SeatGrade } from "@/db/schema";
import { formatBookingDeadline, formatEventDates, formatKstDateTime } from "@/lib/kst";
import { CONDITION_TAG_LABELS, DEAL_TYPE_LABELS, SEAT_GRADE_LABELS } from "@/lib/labels";
import { compareDealsForDisplay, formatKrw, summarizeLowestDeals } from "@/lib/pricing";
import { FlagDealIssueButton, HelpfulButton, OutboundButton } from "./DealActions";
import { AddShowToCalendarButton } from "./PersonalButtons";

const INITIAL_VISIBLE_DEALS = 5;

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
  opensAt: string | null;
  expiresAt: string | null;
  eventDates: string[];
  dDay: number | null;
  sourceType: string;
  reporterNickname: string | null;
  clickCount: number;
  helpfulCount: number;
  lastVerifiedAt: string;
}

function formatDealScheduleText(deal: Pick<PricedDealRow, "eventDates" | "expiresAt">): string | null {
  const parts: string[] = [];
  const perfText = formatEventDates(deal.eventDates, "full");
  if (perfText) parts.push(`관람 ${perfText}`);
  const bookingText = formatBookingDeadline(deal.expiresAt);
  if (bookingText) parts.push(`예매 ${bookingText}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Sort unconditional discounts first (largest discount rate -> lowest price), then conditional/lottery discounts. */
function sortAllDealsUnconditionalFirst(a: PricedDealRow, b: PricedDealRow): number {
  const uncA = a.isUnconditional ? 1 : 0;
  const uncB = b.isUnconditional ? 1 : 0;
  if (uncA !== uncB) return uncB - uncA;
  const rateA = a.discountRate ?? -1;
  const rateB = b.discountRate ?? -1;
  if (rateA !== rateB) return rateB - rateA;
  return compareDealsForDisplay(a, b);
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
  const [selectedTag, setSelectedTag] = useState<ConditionTag | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [helpfulCounts, setHelpfulCounts] = useState<Record<number, number>>({});

  const seatFiltered = useMemo(() => {
    return deals.filter((d) => {
      if (selectedSeat !== "ALL_TAB" && d.seatGrade !== selectedSeat && d.seatGrade !== "ALL") {
        return false;
      }
      return true;
    });
  }, [deals, selectedSeat]);

  const availableTags = useMemo(() => {
    const tagSet = new Set<ConditionTag>();
    for (const d of seatFiltered) {
      for (const t of d.conditionTags) tagSet.add(t);
    }
    return Array.from(tagSet);
  }, [seatFiltered]);

  const unconditionalCount = useMemo(
    () => seatFiltered.filter((d) => d.isUnconditional).length,
    [seatFiltered],
  );

  const visible = useMemo(() => {
    return seatFiltered
      .filter((d) => {
        if (unconditionalOnly && !d.isUnconditional) return false;
        if (selectedTag && !d.conditionTags.includes(selectedTag)) return false;
        return true;
      })
      .sort(sortAllDealsUnconditionalFirst);
  }, [seatFiltered, unconditionalOnly, selectedTag]);

  const displayedDeals = expanded ? visible : visible.slice(0, INITIAL_VISIBLE_DEALS);
  const hiddenCount = Math.max(0, visible.length - INITIAL_VISIBLE_DEALS);

  const { generalLowest, conditionalLowest } = useMemo(
    () => summarizeLowestDeals(seatFiltered),
    [seatFiltered],
  );
  const topUnconditional = useMemo(
    () => seatFiltered.filter((d) => d.isUnconditional).sort(sortAllDealsUnconditionalFirst)[0] ?? null,
    [seatFiltered],
  );
  const hasConditionFilter = unconditionalOnly || selectedTag !== null;
  const headlineDeal = hasConditionFilter
    ? (visible[0] ?? null)
    : (topUnconditional ?? generalLowest ?? visible[0] ?? null);
  const seatLabel = selectedSeat === "ALL_TAB" ? "전체 좌석" : SEAT_GRADE_LABELS[selectedSeat];
  const sidebarHeading = selectedTag
    ? `${CONDITION_TAG_LABELS[selectedTag]} 최대 할인 (${seatLabel})`
    : unconditionalOnly
      ? `무조건 최대 할인 (${seatLabel})`
      : topUnconditional
        ? `무조건 최대 할인 (${seatLabel})`
        : `선택 좌석 최대 할인 (${seatLabel})`;

  const flagDealOptions = useMemo(
    () =>
      (visible.length > 0 ? visible : seatFiltered).map((d) => ({
        id: d.id,
        label: `${d.channelName} · ${SEAT_GRADE_LABELS[d.seatGrade]}${
          d.salePrice !== null
            ? ` (${formatKrw(d.salePrice)})`
            : d.discountRate !== null
              ? ` (${d.discountRate}% 할인)`
              : ""
        }`,
      })),
    [visible, seatFiltered],
  );

  return (
    <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-12">
      {/* Left Main Column (8/12) */}
      <div className="flex flex-col gap-6 lg:col-span-8">
        {headerSlot}

        {/* Multi-Channel Full Discount Comparison Section */}
        <section
          id="price-compare"
          className="flex flex-col gap-5 rounded-lg border border-outline bg-surface p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-on-surface">
              예매처별 전체 할인 비교
              <span className="ml-2 text-sm font-medium text-muted tabular-nums">
                ({visible.length}건)
              </span>
            </h2>
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
              onClick={() => {
                setSelectedSeat("ALL_TAB");
                setExpanded(false);
              }}
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
                onClick={() => {
                  setSelectedSeat(grade);
                  setExpanded(false);
                }}
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

          {/* General Biggest/Lowest vs Conditional/Lottery Lowest Summary */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 rounded-md bg-surface-sunken p-4">
              <span className="text-xs font-semibold text-primary">무조건 최대 할인</span>
              {topUnconditional ? (
                <>
                  <div className="flex items-baseline gap-2 tabular-nums">
                    {topUnconditional.discountRate !== null && (
                      <span className="text-xl font-semibold text-secondary">
                        {topUnconditional.discountRate}%
                      </span>
                    )}
                    <span className="text-xl font-semibold text-on-surface">
                      {topUnconditional.salePrice !== null ? formatKrw(topUnconditional.salePrice) : "할인 적용"}
                    </span>
                    {topUnconditional.basePrice !== null &&
                      topUnconditional.salePrice !== null &&
                      topUnconditional.basePrice > topUnconditional.salePrice && (
                        <span className="text-[13px] text-hint line-through">
                          {formatKrw(topUnconditional.basePrice)}
                        </span>
                      )}
                  </div>
                  <span className="text-[13px] text-muted">
                    {topUnconditional.channelName} · {topUnconditional.conditionSummary ?? "조건 없음"}
                  </span>
                  {formatDealScheduleText(topUnconditional) && (
                    <span className="text-xs font-semibold text-primary tabular-nums">
                      {formatDealScheduleText(topUnconditional)}
                    </span>
                  )}
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
                    {conditionalLowest.basePrice !== null &&
                      conditionalLowest.salePrice !== null &&
                      conditionalLowest.basePrice > conditionalLowest.salePrice && (
                        <span className="text-[13px] text-hint line-through">
                          {formatKrw(conditionalLowest.basePrice)}
                        </span>
                      )}
                  </div>
                  <span className="text-[13px] text-muted">
                    {conditionalLowest.channelName} · {conditionalLowest.conditionSummary ?? "조건 확인"}
                  </span>
                  {formatDealScheduleText(conditionalLowest) && (
                    <span className="text-xs font-semibold text-primary tabular-nums">
                      {formatDealScheduleText(conditionalLowest)}
                    </span>
                  )}
                </>
              ) : (
                <span className="mt-1 text-[13px] text-muted">지금 진행 중인 추첨·조건부 할인이 없어요.</span>
              )}
            </div>
          </div>

          {/* Interactive Discount Condition Filter Chips (all discounts shown by default) */}
          {seatFiltered.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="할인 조건 필터">
              <button
                type="button"
                aria-pressed={!unconditionalOnly && !selectedTag}
                onClick={() => {
                  setUnconditionalOnly(false);
                  setSelectedTag(null);
                  setExpanded(false);
                }}
                className={`h-8 rounded-xs border px-3 text-xs font-semibold tabular-nums transition-colors ${
                  !unconditionalOnly && !selectedTag
                    ? "border-secondary bg-rose-mist text-primary"
                    : "border-outline bg-surface text-on-surface-variant hover:bg-surface-sunken"
                }`}
              >
                전체 할인 ({seatFiltered.length})
              </button>
              <button
                type="button"
                aria-pressed={unconditionalOnly}
                onClick={() => {
                  setUnconditionalOnly((prev) => !prev);
                  setSelectedTag(null);
                  setExpanded(false);
                }}
                className={`h-8 rounded-xs border px-3 text-xs font-semibold tabular-nums transition-colors ${
                  unconditionalOnly
                    ? "border-secondary bg-rose-mist text-primary"
                    : "border-outline bg-surface text-on-surface-variant hover:bg-surface-sunken"
                }`}
              >
                무조건 할인 ({unconditionalCount})
              </button>
              {availableTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={selectedTag === tag}
                  onClick={() => {
                    setUnconditionalOnly(false);
                    setSelectedTag((prev) => (prev === tag ? null : tag));
                    setExpanded(false);
                  }}
                  className={`h-8 rounded-xs border px-3 text-xs font-semibold transition-colors ${
                    selectedTag === tag
                      ? "border-secondary bg-rose-mist text-primary"
                      : "border-outline bg-surface text-on-surface-variant hover:bg-surface-sunken"
                  }`}
                >
                  {CONDITION_TAG_LABELS[tag]}
                </button>
              ))}
            </div>
          )}

          {/* Comparison Table (top 5 by default, rest collapsible) */}
          {visible.length === 0 ? (
            <p className="rounded-md bg-surface-variant p-6 text-center text-sm text-muted">
              선택한 좌석·조건에 진행 중인 할인이 없어요. 다른 좌석이나 전체 할인을 확인해 보세요.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="w-full overflow-x-auto rounded-lg border border-outline">
                <table className="w-full min-w-[560px] border-collapse text-left">
                  <thead className="border-b border-outline bg-surface-sunken text-[13px] font-semibold text-on-surface-variant">
                    <tr>
                      <th scope="col" className="px-4 py-3">예매처 · 좌석</th>
                      <th scope="col" className="px-4 py-3">할인 종류 · 조건</th>
                      <th scope="col" className="px-4 py-3 text-right">할인율 · 최종가</th>
                      <th scope="col" className="px-4 py-3 text-right">예매</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline">
                    {displayedDeals.map((deal, idx) => {
                      const isBest = idx === 0 && (deal.salePrice !== null || deal.discountRate !== null);
                      const liveHelpfulCount = helpfulCounts[deal.id] ?? deal.helpfulCount;
                      const bestBadgeLabel = deal.isUnconditional
                        ? "무조건 최대 할인"
                        : deal.discountRate !== null
                          ? "조건부 최대 할인"
                          : "조건부 최저가";
                      const tierLabel =
                        deal.dealType === "LOTTERY"
                          ? "로터리 추첨"
                          : deal.isUnconditional
                            ? "무조건"
                            : "조건부";
                      const scheduleText = formatDealScheduleText(deal);
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
                                    {bestBadgeLabel}
                                  </span>
                                )}
                                {deal.sourceType === "USER_REPORT" && (
                                  <span className="rounded-xs bg-rose-mist px-2 py-0 text-xs font-semibold text-primary">
                                    {deal.reporterNickname || "익명의 관객"}님 제보
                                  </span>
                                )}
                              </div>
                              <span className="text-[13px] text-muted tabular-nums">
                                {SEAT_GRADE_LABELS[deal.seatGrade]}
                                {deal.sourceType === "USER_REPORT"
                                  ? ` · ${deal.clickCount}명 확인 · 도움 ${liveHelpfulCount}`
                                  : deal.feeInfo
                                    ? ` · ${deal.feeInfo}`
                                    : ""}
                              </span>
                              {deal.sourceType === "USER_REPORT" && (
                                <div className="pt-0.5">
                                  <HelpfulButton
                                    dealId={deal.id}
                                    initialCount={deal.helpfulCount}
                                    onCountChange={(next) =>
                                      setHelpfulCounts((prev) => ({ ...prev, [deal.id]: next }))
                                    }
                                  />
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
                                      : deal.dealType === "LOTTERY"
                                        ? "border border-champagne-gold bg-gold-wash text-on-surface"
                                        : "bg-surface-sunken text-on-surface-variant"
                                  }`}
                                >
                                  {tierLabel}
                                </span>
                                {(deal.dealType === "SPECIAL_DAY" || deal.dealType === "TIMESALE") &&
                                  deal.isUnconditional && (
                                    <span className="rounded-xs bg-surface-sunken px-2 py-0 text-xs font-semibold text-on-surface-variant">
                                      {DEAL_TYPE_LABELS[deal.dealType]}
                                    </span>
                                  )}
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
                              {scheduleText && (
                                <span className="text-xs font-semibold text-primary tabular-nums">
                                  {scheduleText}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right tabular-nums">
                            <div className="flex flex-col items-end gap-0.5">
                              <div className="flex items-baseline justify-end gap-2">
                                {deal.discountRate !== null && (
                                  <span className="text-lg font-bold text-secondary">
                                    {deal.discountRate}%
                                  </span>
                                )}
                                <span className="text-lg font-bold text-on-surface">
                                  {deal.salePrice !== null
                                    ? formatKrw(deal.salePrice)
                                    : deal.dealType === "LOTTERY"
                                      ? "로터리 응모"
                                      : "할인"}
                                </span>
                              </div>
                              {deal.basePrice !== null &&
                                deal.salePrice !== null &&
                                deal.basePrice > deal.salePrice && (
                                  <span className="text-xs text-hint line-through">
                                    {formatKrw(deal.basePrice)}
                                  </span>
                                )}
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <OutboundButton
                              dealId={deal.id}
                              externalUrl={deal.externalUrl}
                              label={`${deal.channelName} 예매 ↗`}
                              variant={isBest ? "primary" : "secondary"}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => !prev)}
                  aria-expanded={expanded}
                  className="flex h-11 w-full items-center justify-center rounded-sm border border-outline bg-surface-variant text-[13px] font-semibold text-on-surface-variant transition-colors hover:border-outline-strong hover:text-on-surface"
                >
                  {expanded
                    ? "상위 5개만 보기 (접기)"
                    : `나머지 할인 ${hiddenCount}건 펼쳐보기`}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">{disclaimer}</p>
            {(headlineDeal || flagDealOptions.length > 0) && (
              <FlagDealIssueButton
                dealId={headlineDeal?.id ?? flagDealOptions[0].id}
                dealOptions={flagDealOptions}
              />
            )}
          </div>
        </section>

        {belowCompareSlot}
      </div>

      {/* Right Sticky Price & CTA Sidebar (4/12, synced with active filters) */}
      <aside className="flex flex-col gap-5 rounded-lg border border-outline bg-surface p-6 lg:sticky lg:top-28 lg:col-span-4">
        <div className="flex flex-col gap-1 border-b border-outline pb-4">
          <span className="text-xs font-semibold text-muted">{sidebarHeading}</span>
          {headlineDeal ? (
            <>
              <div className="flex items-baseline gap-2 tabular-nums">
                {headlineDeal.discountRate !== null && (
                  <span className="text-2xl font-bold text-secondary">{headlineDeal.discountRate}%</span>
                )}
                <span className="text-2xl font-bold text-on-surface">
                  {headlineDeal.salePrice !== null
                    ? formatKrw(headlineDeal.salePrice)
                    : headlineDeal.dealType === "LOTTERY"
                      ? "로터리 응모"
                      : "할인"}
                </span>
              </div>
              {headlineDeal.basePrice !== null &&
                headlineDeal.salePrice !== null &&
                headlineDeal.basePrice > headlineDeal.salePrice && (
                  <span className="text-[13px] text-hint line-through tabular-nums">
                    정가 {formatKrw(headlineDeal.basePrice)}
                  </span>
                )}
              {formatDealScheduleText(headlineDeal) && (
                <span className="pt-0.5 text-xs font-semibold text-primary tabular-nums">
                  {formatDealScheduleText(headlineDeal)}
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
            onChange={(e) => {
              setUnconditionalOnly(e.target.checked);
              if (e.target.checked) setSelectedTag(null);
            }}
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
                    {d.isUnconditional ? "무조건 할인" : d.dealType === "LOTTERY" ? "로터리 추첨" : "조건부 할인"}
                  </span>
                </div>
                <span className="text-[15px] font-semibold text-on-surface tabular-nums">
                  {d.salePrice !== null
                    ? formatKrw(d.salePrice)
                    : d.discountRate !== null
                      ? `${d.discountRate}% 할인`
                      : d.dealType === "LOTTERY"
                        ? "추첨"
                        : "할인"}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {headlineDeal && (
            <OutboundButton
              dealId={headlineDeal.id}
              externalUrl={headlineDeal.externalUrl}
              label={`${headlineDeal.channelName}에서 예매하기 ↗`}
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
