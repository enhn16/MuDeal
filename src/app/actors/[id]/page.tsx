import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRuntimeDb } from "@/db/client";
import { ActorAvatar } from "@/components/ActorAvatar";
import { ActorShowsGrid } from "@/components/ActorShowsGrid";
import { FollowActorButton } from "@/components/PersonalButtons";
import { TargetNewsFeed } from "@/components/TargetNewsFeed";
import { formatKstDate } from "@/lib/kst";
import { getServerSession } from "@/server/modules/auth-runtime";
import { isActorFollowed } from "@/server/modules/personal";
import { getActorDetail } from "@/server/modules/shows";

export const dynamic = "force-dynamic";

type ActorRouteParams = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: ActorRouteParams }): Promise<Metadata> {
  const { id } = await params;
  const actorId = Number(id);
  if (!Number.isInteger(actorId) || actorId <= 0) return { title: "배우 상세 — MuDeal" };
  const data = await getActorDetail(getRuntimeDb(), actorId);
  if (!data) return { title: "배우를 찾을 수 없어요 — MuDeal" };
  return {
    title: `${data.actor.name} 배우 출연작 — MuDeal`,
    description: `${data.actor.name} 배우의 현재·예정 출연 뮤지컬과 할인·특전 소식을 한눈에 확인해요.`,
  };
}

export default async function ActorDetailPage({ params }: { params: ActorRouteParams }) {
  const { id } = await params;
  const actorId = Number(id);
  if (!Number.isInteger(actorId) || actorId <= 0) notFound();

  const db = getRuntimeDb();
  const [data, session] = await Promise.all([getActorDetail(db, actorId), getServerSession()]);
  if (!data) notFound();
  const followed = session ? await isActorFollowed(db, session.user.id, actorId) : false;

  return (
    <div className="bg-surface-variant pb-10">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-5 py-7 lg:px-0">
        {/* 1. Actor Profile Header (mudeal_5 parity) */}
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-outline bg-surface p-6">
          <div className="flex items-center gap-4">
            <ActorAvatar
              name={data.actor.name}
              profileImageUrl={data.actor.profileImageUrl}
              isFollowed={followed}
              size="lg"
            />
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-on-surface">{data.actor.name}</h1>
                <span className="rounded-xs bg-rose-mist px-2 py-0.5 text-xs font-semibold text-primary">
                  뮤지컬 배우
                </span>
              </div>
              <span className="text-[13px] text-muted tabular-nums">
                팔로워 {data.actor.followerCount.toLocaleString("ko-KR")}명
              </span>
            </div>
          </div>

          <FollowActorButton
            actorId={data.actor.id}
            initialFollowed={followed}
            isLoggedIn={Boolean(session)}
            size="md"
          />
        </section>

        {/* 2. 배우 새소식 피드 (#news-feed) */}
        <TargetNewsFeed
          targetType="ACTOR"
          targetId={data.actor.id}
          heading="새소식 피드"
          isLoggedIn={Boolean(session)}
          todayKst={formatKstDate()}
        />

        {/* 3. 출연 중 / 예정 뮤지컬 (mudeal_5 3-col 5:7 poster grid) */}
        <ActorShowsGrid shows={data.shows} />
      </div>
    </div>
  );
}
