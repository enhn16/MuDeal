import Link from "next/link";
import { formatEventDates } from "@/lib/kst";
import { DEAL_TYPE_LABELS, SUB_REGION_SHORT, dealBadgeClass } from "@/lib/labels";
import { formatKrw } from "@/lib/pricing";
import type { HomeCategory, ShowCardItem } from "@/server/modules/shows";
import { PosterImage } from "./PosterImage";

export function PosterArtwork({
  title,
  posterUrl,
}: {
  title: string;
  posterUrl: string | null;
}) {
  return <PosterImage title={title} posterUrl={posterUrl} />;
}

export function ShowCard({
  show,
  viewCategory = "DISCOUNT",
}: {
  show: ShowCardItem;
  viewCategory?: HomeCategory;
}) {
  const regionShort = SUB_REGION_SHORT[show.subRegion];
  const isPerkView = viewCategory === "PERK";
  const isEventView = viewCategory === "EVENT";

  const badgeDealType = isPerkView
    ? "PERK_GOODS"
    : isEventView && show.eventHighlight
      ? show.eventHighlight.dealType
      : show.primaryDealType;

  const badgeText = isPerkView
    ? "현장 특전"
    : isEventView && show.eventHighlight
      ? show.eventHighlight.dealType === "SINGALONG"
        ? "싱어롱"
        : show.eventHighlight.dealType === "SPECIAL_DAY"
          ? "스페셜 데이"
          : "스페셜 커튼콜"
      : show.primaryDealType === "TIMESALE" && show.isUnconditional
        ? "무조건 할인"
        : DEAL_TYPE_LABELS[show.primaryDealType];

  const perkDateLabel = isPerkView ? formatEventDates(show.perkDates, "compact") : null;
  const eventDateLabel =
    isEventView && show.eventHighlight
      ? formatEventDates(
          show.eventHighlight.dates.length > 0
            ? show.eventHighlight.dates
            : show.eventHighlight.date
              ? [show.eventHighlight.date]
              : [],
          "compact",
        )
      : null;

  const footerMeta =
    !isPerkView && !isEventView && show.communityCredit
      ? `${show.communityCredit.reporterNickname}님 제보 · 도움 ${show.communityCredit.helpfulCount}`
      : `예매처 ${show.channelCount}곳 비교`;

  return (
    <Link href={`/shows/${show.id}`} className="group flex h-full flex-col bg-surface">
      <div className="poster-frame relative w-full">
        <PosterArtwork title={show.title} posterUrl={show.posterUrl} />
        <span
          className={`absolute top-2.5 left-2.5 z-10 rounded-xs px-2 py-0.5 text-[11px] font-semibold shadow-e1 ${dealBadgeClass(
            badgeDealType,
            show.isUnconditional,
          )}`}
        >
          {badgeText}
        </span>
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-1">
        <p className="truncate text-xs text-muted">
          {regionShort} · {show.venueName}
        </p>

        <h3 className="min-h-[42px] text-[15px] font-semibold leading-snug text-on-surface line-clamp-2 group-hover:text-primary">
          {show.title}
        </h3>

        {isPerkView && show.perkHighlight ? (
          <div className="flex flex-col gap-1 pt-0.5">
            <p className="min-h-[38px] text-[13px] font-medium leading-snug text-on-surface line-clamp-2">
              {show.perkHighlight}
            </p>
            {perkDateLabel && (
              <p className="truncate text-xs font-semibold text-primary tabular-nums">
                {perkDateLabel}
              </p>
            )}
          </div>
        ) : isEventView && show.eventHighlight ? (
          <div className="flex flex-col gap-1 pt-0.5">
            <p className="min-h-[38px] text-[13px] font-medium leading-snug text-on-surface line-clamp-2">
              {show.eventHighlight.summary}
            </p>
            {eventDateLabel && (
              <p className="truncate text-xs font-semibold text-primary tabular-nums">
                {eventDateLabel}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-1.5 pt-0.5 tabular-nums">
            {show.maxDiscountRate !== null && (
              <span className="text-[16px] font-bold text-secondary">{show.maxDiscountRate}%</span>
            )}
            {show.lowestPrice !== null ? (
              <span className="text-[16px] font-bold text-on-surface">
                {formatKrw(show.lowestPrice)}~
              </span>
            ) : show.maxDiscountRate !== null ? (
              <span className="text-sm font-semibold text-on-surface">특별 할인</span>
            ) : (
              <span className="text-sm font-semibold text-primary">특전 · 이벤트 진행 중</span>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-outline pt-2">
          <span className="truncate text-[11px] text-muted tabular-nums">{footerMeta}</span>
          {!isPerkView && !isEventView && show.discountDDay !== null && show.discountDDay >= 0 && (
            <span className="shrink-0 text-xs font-semibold text-primary tabular-nums">
              {show.discountDDay === 0 ? "오늘 마감" : `D-${show.discountDDay}`}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
