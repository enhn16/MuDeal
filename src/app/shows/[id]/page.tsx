import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRuntimeDb } from "@/db/client";
import { ShareLinkButton } from "@/components/DealActions";
import { FollowActorButton, WishButton } from "@/components/PersonalButtons";
import { PosterArtwork } from "@/components/ShowCard";
import { ShowComparePanel } from "@/components/ShowComparePanel";
import { TargetNewsFeed } from "@/components/TargetNewsFeed";
import { formatKstDate } from "@/lib/kst";
import { DEAL_TYPE_LABELS, SUB_REGION_LABELS } from "@/lib/labels";
import { formatKrw } from "@/lib/pricing";
import { getServerSession } from "@/server/modules/auth-runtime";
import { isShowBookmarked, listFollowedActors } from "@/server/modules/personal";
import { getShowDetail } from "@/server/modules/shows";

export const dynamic = "force-dynamic";

type ShowRouteParams = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: ShowRouteParams }): Promise<Metadata> {
  const { id } = await params;
  const showId = Number(id);
  if (!Number.isInteger(showId) || showId <= 0) return { title: "작품 상세 — MuDeal" };

  const data = await getShowDetail(getRuntimeDb(), showId);
  if (!data) return { title: "작품을 찾을 수 없습니다 — MuDeal" };

  const lowest = data.summary.generalLowest ?? data.summary.conditionalLowest;
  const priceText = lowest
    ? `${lowest.discountRate ? `최대 ${lowest.discountRate}% ` : ""}${formatKrw(lowest.salePrice)}~`
    : "할인·이벤트 비교";

  return {
    title: `${data.show.title} (${priceText}) — MuDeal`,
    description: `${data.show.venueName} · ${priceText} 예매처별 가격 비교, 싱어롱·커튼콜·특전 및 출연 배우 정보`,
    openGraph: {
      title: `${data.show.title} · ${priceText}`,
      description: `${data.show.venueName} | 예매처별 할인 비교 · MuDeal`,
    },
  };
}

export default async function ShowDetailPage({ params }: { params: ShowRouteParams }) {
  const { id } = await params;
  const showId = Number(id);
  if (!Number.isInteger(showId) || showId <= 0) notFound();

  const db = getRuntimeDb();
  const [data, session] = await Promise.all([getShowDetail(db, showId), getServerSession()]);
  if (!data) notFound();

  const [bookmarked, followedList] = session
    ? await Promise.all([
        isShowBookmarked(db, session.user.id, showId),
        listFollowedActors(db, session.user.id),
      ])
    : [false, []];
  const followedIds = new Set(followedList.map((a) => a.id));

  const basePriceEntries = Object.entries(data.show.basePrices);
  const todayKst = formatKstDate();
  const hasLottery = data.deals.some((d) => d.dealType === "LOTTERY");

  const headerSlot = (
    <section className="rounded-lg border border-outline bg-surface p-6">
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="mx-auto w-40 shrink-0 sm:mx-0">
          <div className="poster-frame">
            <PosterArtwork
              title={data.show.title}
              posterUrl={data.show.posterUrl}
              venueName={data.show.venueName}
              subLabel={SUB_REGION_LABELS[data.show.subRegion]}
            />
          </div>
        </div>

        <div className="flex flex-1 flex-col justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-xs bg-rose-mist px-2 py-0.5 text-xs font-semibold text-primary">
                  {SUB_REGION_LABELS[data.show.subRegion]}
                </span>
                {hasLottery && (
                  <span className="rounded-xs border border-champagne-gold bg-gold-wash px-2 py-0.5 text-xs font-semibold text-on-surface">
                    로터리 진행중
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <WishButton showId={data.show.id} initialBookmarked={bookmarked} />
                <ShareLinkButton iconOnly />
              </div>
            </div>

            <h1 className="text-2xl font-bold text-on-surface">{data.show.title}</h1>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
              <Link
                href={`/search?q=${encodeURIComponent(data.show.venueName)}`}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <span className="material-symbols-outlined text-base" aria-hidden="true">
                  location_on
                </span>
                <span>{data.show.venueName}</span>
              </Link>
              <span className="tabular-nums">
                {data.show.startDate.replaceAll("-", ".")} ~ {data.show.endDate.replaceAll("-", ".")}
              </span>
            </div>
          </div>

          {basePriceEntries.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-outline bg-surface-variant p-3">
              <span className="text-xs font-semibold text-muted">KOPIS 공식 정가</span>
              <span className="text-[13px] text-on-surface-variant tabular-nums">
                {basePriceEntries.map(([g, p]) => `${g}석 ${formatKrw(p)}`).join(" · ")}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );

  const belowCompareSlot = (
    <>
      {/* 2-3. 현장 이벤트 · 특전 안내 (mudeal_3 2-col card parity) */}
      <section className="flex flex-col gap-4 rounded-lg border border-outline bg-surface p-6">
        <h2 className="text-xl font-semibold text-on-surface">현장 이벤트 · 특전 안내</h2>
        {data.events.length === 0 ? (
          <p className="text-sm text-muted">현재 등록된 싱어롱·커튼콜·특전 이벤트가 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {data.events.map((ev) => {
              const isPerk = ev.dealType === "PERK_GOODS";
              return (
                <div
                  key={ev.id}
                  className={`flex flex-col gap-2 rounded-md border border-outline p-4 ${
                    isPerk ? "bg-gold-wash" : "bg-surface-variant"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded-xs px-2 py-0.5 text-xs font-semibold ${
                        isPerk
                          ? "border border-champagne-gold bg-surface text-on-surface"
                          : ev.dealType === "TICKET_OPEN"
                            ? "bg-curtain-noir text-on-curtain-noir"
                            : "bg-rose-mist text-primary"
                      }`}
                    >
                      {DEAL_TYPE_LABELS[ev.dealType]}
                    </span>
                    <span className="text-xs text-muted tabular-nums">
                      {ev.eventDates[0] ?? (ev.opensAt ? ev.opensAt.slice(5, 16).replace("T", " ") : ev.channelName)}
                    </span>
                  </div>
                  <h3 className="text-[15px] font-semibold text-on-surface">
                    {ev.conditionSummary ?? DEAL_TYPE_LABELS[ev.dealType]}
                  </h3>
                  {ev.perkSummary && <p className="text-[13px] text-muted">{ev.perkSummary}</p>}
                  <a
                    href={ev.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-auto pt-1 text-xs font-semibold text-primary hover:underline"
                  >
                    예매처 공지 원문 보기 ↗
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2-4. 출연 배우 (mudeal_3 2-col card + FollowActorButton parity) */}
      <section className="flex flex-col gap-4 rounded-lg border border-outline bg-surface p-6">
        <h2 className="text-xl font-semibold text-on-surface">출연 배우</h2>
        {data.actors.length === 0 ? (
          <p className="text-sm text-muted">등록된 출연진 정보가 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.actors.map((actor) => {
              const isFollowed = followedIds.has(actor.id);
              return (
                <div
                  key={actor.id}
                  className="flex items-center justify-between gap-3 rounded-sm border border-outline bg-surface p-3"
                >
                  <Link href={`/actors/${actor.id}`} className="group flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-sm text-sm font-bold ${
                        isFollowed
                          ? "bg-curtain-noir text-gold-soft"
                          : "bg-surface-sunken text-primary"
                      }`}
                    >
                      {actor.name.slice(0, 1)}
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[15px] font-semibold text-on-surface group-hover:text-primary">
                        {actor.name}
                      </span>
                      <span className="truncate text-[13px] text-muted">
                        {actor.roleName ? `${actor.roleName} 역` : "출연"}
                      </span>
                    </div>
                  </Link>
                  <FollowActorButton
                    actorId={actor.id}
                    initialFollowed={isFollowed}
                    size="sm"
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2-5. 작품 새소식 피드 (#news-feed) */}
      <TargetNewsFeed
        targetType="SHOW"
        targetId={data.show.id}
        heading="작품 새소식 피드"
        isLoggedIn={Boolean(session)}
        todayKst={todayKst}
      />
    </>
  );

  return (
    <div className="bg-surface-variant pb-10">
      <div className="mx-auto max-w-[1100px] px-5 py-7 lg:px-0">
        <ShowComparePanel
          showId={data.show.id}
          showTitle={data.show.title}
          todayKst={todayKst}
          deals={data.deals}
          seatGrades={data.seatGrades}
          lastVerifiedAt={data.lastVerifiedAt}
          disclaimer={data.disclaimer}
          headerSlot={headerSlot}
          belowCompareSlot={belowCompareSlot}
        />
      </div>
    </div>
  );
}
