import Link from "next/link";
import { DEAL_TYPE_LABELS, SUB_REGION_SHORT, dealBadgeClass } from "@/lib/labels";
import { formatKrw } from "@/lib/pricing";
import type { ShowCardItem } from "@/server/modules/shows";

export function PosterArtwork({
  title,
  posterUrl,
  venueName,
  subLabel,
}: {
  title: string;
  posterUrl: string | null;
  venueName: string;
  subLabel?: string;
}) {
  if (posterUrl) {
    return (
      <img
        src={posterUrl}
        alt={`${title} 포스터`}
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
      />
    );
  }
  return (
    <div className="flex h-full w-full flex-col justify-between bg-curtain-noir p-4 text-on-curtain-noir transition-transform duration-200 group-hover:scale-[1.02]">
      <span className="text-[11px] font-semibold tracking-wider text-gold-soft uppercase">
        {subLabel ?? "MUSICAL"}
      </span>
      <div>
        <p className="font-serif text-base font-bold leading-snug line-clamp-3">{title}</p>
        <p className="mt-1.5 truncate text-[11px] text-white/70">{venueName}</p>
      </div>
    </div>
  );
}

export function ShowCard({ show }: { show: ShowCardItem }) {
  const regionShort = SUB_REGION_SHORT[show.subRegion];
  const badgeText =
    show.primaryDealType === "TIMESALE" && show.isUnconditional
      ? "무조건 할인"
      : DEAL_TYPE_LABELS[show.primaryDealType];

  return (
    <Link href={`/shows/${show.id}`} className="group flex h-full flex-col bg-surface">
      <div className="poster-frame relative w-full">
        <PosterArtwork
          title={show.title}
          posterUrl={show.posterUrl}
          venueName={show.venueName}
          subLabel={regionShort}
        />
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <span className="shrink-0">
            {regionShort} · {show.channelCount}곳 비교
          </span>
          <span className="truncate">{show.venueName}</span>
        </div>

        <h3 className="text-[15px] font-semibold leading-snug text-on-surface line-clamp-2 group-hover:text-primary">
          {show.title}
        </h3>

        <div className="flex flex-wrap items-baseline gap-1.5 pt-1 tabular-nums">
          {show.maxDiscountRate !== null && (
            <span className="text-[16px] font-bold text-secondary">{show.maxDiscountRate}%</span>
          )}
          {show.lowestPrice !== null ? (
            <span className="text-[16px] font-bold text-on-surface">
              {formatKrw(show.lowestPrice)}~
            </span>
          ) : (
            <span className="text-sm font-semibold text-primary">이벤트 · 오픈 진행중</span>
          )}
          {show.basePrice !== null && show.lowestPrice !== null && show.basePrice > show.lowestPrice && (
            <span className="text-xs text-hint line-through">{formatKrw(show.basePrice)}</span>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-outline pt-2">
          <span
            className={`rounded-xs px-2 py-0.5 text-[11px] font-semibold ${dealBadgeClass(
              show.primaryDealType,
              show.isUnconditional,
            )}`}
          >
            {badgeText}
          </span>
          {show.dDay !== null && show.dDay >= 0 && (
            <span className="text-xs font-semibold text-primary tabular-nums">
              {show.dDay === 0 ? "D-Day" : `D-${show.dDay}`}
            </span>
          )}
        </div>

        {show.communityCredit && (
          <p className="pt-0.5 text-[11px] text-muted tabular-nums">
            {show.communityCredit.reporterNickname}님 제보 · {show.communityCredit.clickCount}명 확인 · 도움{" "}
            {show.communityCredit.helpfulCount}
          </p>
        )}
      </div>
    </Link>
  );
}
