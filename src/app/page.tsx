import Link from "next/link";
import { getRuntimeDb } from "@/db/client";
import { HelpfulButton } from "@/components/DealActions";
import { HomeDealFilterGrid } from "@/components/HomeDealFilterGrid";
import { ShowCard } from "@/components/ShowCard";
import { formatKrw } from "@/lib/pricing";
import { getHomeData } from "@/server/modules/shows";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await getHomeData(getRuntimeDb());

  return (
    <div className="pb-14">
      {/* 1. 3-Column Square Hero Spotlight */}
      <section className="mx-auto max-w-[1100px] px-5 pt-7 lg:px-0">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {data.heroes.map((hero, idx) => (
            <Link
              key={hero.id}
              href={hero.linkUrl}
              className={`group relative flex aspect-[16/10] flex-col justify-end overflow-hidden rounded-lg p-5 text-on-curtain-noir md:aspect-square ${
                idx === 1 ? "bg-mulberry" : "bg-curtain-noir"
              }`}
            >
              {hero.imageUrl && (
                <img
                  src={hero.imageUrl}
                  alt={hero.title}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
              )}
              <div className="hero-scrim absolute inset-0" />
              <div className="relative z-10 flex flex-col gap-1">
                {hero.eyebrow && (
                  <span className="text-xs font-semibold tracking-wider text-gold-wash uppercase">
                    {hero.eyebrow}
                  </span>
                )}
                <h2 className="text-xl font-semibold leading-snug text-balance">{hero.title}</h2>
                {hero.subtitle && <p className="text-[13px] text-white/85">{hero.subtitle}</p>}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 2. 마감임박 특가 (5-Column 5:7 Poster Grid) */}
      <section className="mx-auto max-w-[1100px] px-5 pt-[72px] lg:px-0">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-on-surface">마감임박 특가</h2>
          <Link
            href="/search?sort=CLOSING_SOON"
            className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-on-surface-variant hover:text-primary"
          >
            <span>전체보기</span>
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              chevron_right
            </span>
          </Link>
        </div>

        <div className="grid grid-cols-2 items-stretch gap-5 sm:grid-cols-3 lg:grid-cols-5">
          {data.closingSoon.slice(0, 5).map((show) => (
            <ShowCard key={show.id} show={show} />
          ))}
        </div>
      </section>

      {/* 3. 티켓오픈 임박 (mudeal_1 3-col compact card parity) */}
      {data.ticketOpens.length > 0 && (
        <section id="ticket-open" className="mx-auto max-w-[1100px] px-5 pt-[72px] lg:px-0">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="text-xl font-semibold text-on-surface">티켓오픈 임박</h2>
            <Link
              href="/search?dealType=TICKET_OPEN"
              className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-on-surface-variant hover:text-primary"
            >
              <span>전체보기</span>
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                chevron_right
              </span>
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {data.ticketOpens.slice(0, 3).map((item, idx) => (
              <Link
                key={item.dealId}
                href={`/shows/${item.showId}`}
                className="flex items-center justify-between gap-4 rounded-md border border-outline bg-surface p-4 transition-colors hover:bg-surface-variant"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-xs px-2 py-0.5 text-xs font-semibold text-on-curtain-noir tabular-nums ${
                        idx === 1 ? "bg-mulberry" : "bg-curtain-noir"
                      }`}
                    >
                      {item.dDay === 0
                        ? "오늘 오픈"
                        : item.opensAt
                          ? item.opensAt.slice(5, 16).replace("T", " ").replace("-", ".")
                          : "티켓오픈"}
                    </span>
                    <span className="text-[13px] text-muted">{item.channelName}</span>
                  </div>
                  <h3 className="truncate text-[15px] font-semibold text-on-surface">
                    {item.showTitle}
                  </h3>
                  <span className="truncate text-[13px] text-muted">
                    {item.venueName}
                    {item.conditionSummary ? ` · ${item.conditionSummary}` : ""}
                  </span>
                </div>
                <span
                  className={`material-symbols-outlined shrink-0 ${
                    idx === 0 ? "text-primary" : "text-on-surface-variant"
                  }`}
                  aria-hidden="true"
                >
                  {idx === 0 ? "notifications_active" : "calendar_add_on"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 4. 관객들이 제보해주신 딜 (mudeal_1 3-col card parity) */}
      {data.communityDeals.length > 0 && (
        <section id="community-deals" className="mx-auto max-w-[1100px] px-5 pt-[72px] lg:px-0">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold text-on-surface">관객들이 제보해주신 딜</h2>
            <Link
              href="/reports/new"
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:text-secondary"
            >
              <span>할인 제보하기</span>
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                add
              </span>
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {data.communityDeals.slice(0, 3).map((deal) => (
              <article
                key={deal.dealId}
                className="flex flex-col gap-3 rounded-lg border border-outline bg-surface p-5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-xs bg-rose-mist px-2 py-0.5 text-xs font-semibold text-primary">
                    {deal.reporterNickname}님 제보
                  </span>
                  <span className="text-[13px] text-muted tabular-nums">
                    {deal.clickCount}명 확인 · 도움 {deal.helpfulCount}
                  </span>
                </div>

                <div>
                  <Link
                    href={`/shows/${deal.showId}`}
                    className="text-[15px] font-semibold text-on-surface hover:text-primary"
                  >
                    {deal.showTitle}
                  </Link>
                  {deal.conditionSummary && (
                    <p className="mt-1 text-[13px] text-muted">{deal.conditionSummary}</p>
                  )}
                </div>

                <div className="mt-auto flex items-center justify-between border-t border-outline pt-2.5">
                  <div className="flex items-baseline gap-2 tabular-nums">
                    {deal.discountRate !== null && (
                      <span className="text-lg font-bold text-secondary">{deal.discountRate}%</span>
                    )}
                    {deal.salePrice !== null && (
                      <span className="text-lg font-bold text-on-surface">
                        {formatKrw(deal.salePrice)}
                      </span>
                    )}
                  </div>
                  <HelpfulButton dealId={deal.dealId} initialCount={deal.helpfulCount} />
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* 5. 지금 비교 가능한 할인 공연 */}
      <section id="all-deals" className="mx-auto max-w-[1100px] px-5 pt-[72px] lg:px-0">
        <div className="mb-6 flex items-baseline justify-between gap-4 border-b border-outline pb-3">
          <h2 className="text-xl font-semibold text-on-surface">지금 비교 가능한 할인 공연</h2>
          <Link
            href="/search"
            className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-on-surface-variant hover:text-primary"
          >
            <span>검색</span>
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              chevron_right
            </span>
          </Link>
        </div>

        <HomeDealFilterGrid shows={data.shows} />
      </section>
    </div>
  );
}
