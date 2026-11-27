import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRuntimeDb } from "@/db/client";
import { WishButton } from "@/components/PersonalButtons";
import { PosterArtwork } from "@/components/ShowCard";
import { ShowSynopsis } from "@/components/ShowSynopsis";
import { TargetNewsFeed } from "@/components/TargetNewsFeed";
import { formatKstDate, formatShowPeriod } from "@/lib/kst";
import { SUB_REGION_LABELS } from "@/lib/labels";
import { formatKrw } from "@/lib/pricing";
import { getServerSession } from "@/server/modules/auth-runtime";
import { isShowBookmarked } from "@/server/modules/personal";
import { getShowDetail } from "@/server/modules/shows";

export const dynamic = "force-dynamic";

type ShowFeedRouteParams = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: ShowFeedRouteParams }): Promise<Metadata> {
  const { id } = await params;
  const showId = Number(id);
  if (!Number.isInteger(showId) || showId <= 0) return { title: "작품 새소식 — MuDeal" };
  const data = await getShowDetail(getRuntimeDb(), showId);
  if (!data) return { title: "작품을 찾을 수 없습니다 — MuDeal" };
  return {
    title: `${data.show.title} 새소식 피드 — MuDeal`,
    description: `${data.show.title}의 새로운 할인·특전·현장 이벤트 소식을 확인하세요.`,
  };
}

export default async function ShowFeedPage({ params }: { params: ShowFeedRouteParams }) {
  const { id } = await params;
  const showId = Number(id);
  if (!Number.isInteger(showId) || showId <= 0) notFound();

  const db = getRuntimeDb();
  const [data, session] = await Promise.all([getShowDetail(db, showId), getServerSession()]);
  if (!data) notFound();

  const bookmarked = session ? await isShowBookmarked(db, session.user.id, showId) : false;
  const todayKst = formatKstDate();
  const topDeal = data.deals.find((d) => d.isUnconditional) ?? data.deals[0] ?? null;

  return (
    <div className="bg-surface-variant pb-10">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-5 py-7 lg:px-0">
        {/* 1. 찜한 작품 기본정보 헤더 (actors/[id]와 통일된 구조 + 예매/가격비교 CTA) */}
        <section className="flex flex-col gap-4 rounded-lg border border-outline bg-surface p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="poster-frame w-20 shrink-0 sm:w-24">
                <PosterArtwork title={data.show.title} posterUrl={data.show.posterUrl} />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-xs bg-rose-mist px-2 py-0.5 text-xs font-semibold text-primary">
                    {SUB_REGION_LABELS[data.show.subRegion]}
                  </span>
                  <span className="text-xs text-muted">{data.show.venueName}</span>
                </div>
                <h1 className="text-xl font-bold leading-snug text-on-surface sm:text-2xl">
                  {data.show.title}
                </h1>
                <p className="text-[13px] text-muted tabular-nums">
                  {formatShowPeriod(data.show.startDate, data.show.endDate)}
                </p>
                {(topDeal || data.events.length > 0) && (
                  <p className="pt-0.5 text-xs font-semibold text-primary tabular-nums">
                    {topDeal
                      ? `${topDeal.isUnconditional ? "무조건 최대" : "현재 최저"} ${
                          topDeal.discountRate !== null ? `${topDeal.discountRate}% · ` : ""
                        }${topDeal.salePrice !== null ? `${formatKrw(topDeal.salePrice)}~` : "할인 진행 중"}`
                      : `진행 중인 특전·이벤트 ${data.events.length}건`}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link
                href={`/shows/${data.show.id}`}
                className="inline-flex h-10 items-center justify-center rounded-sm bg-secondary px-4 text-xs font-semibold text-on-secondary shadow-cta transition-colors hover:bg-secondary-hover"
              >
                가격 비교 · 예매하러 가기
              </Link>
              <WishButton
                showId={data.show.id}
                initialBookmarked={bookmarked}
                isLoggedIn={Boolean(session)}
              />
            </div>
          </div>

          <ShowSynopsis synopsis={data.show.synopsis} />
        </section>

        {/* 2. 작품 새소식 피드 (#news-feed) */}
        <TargetNewsFeed
          targetType="SHOW"
          targetId={data.show.id}
          heading="작품 새소식 피드"
          isLoggedIn={Boolean(session)}
          todayKst={todayKst}
        />
      </div>
    </div>
  );
}
