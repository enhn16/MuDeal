import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getRuntimeDb } from "@/db/client";
import { MyPageWorkspace } from "@/components/MyPageWorkspace";
import { formatKstDate } from "@/lib/kst";
import { getServerSession } from "@/server/modules/auth-runtime";
import {
  getMyCalendar,
  getMyReportsSummary,
  getNotificationsFeed,
  listBookmarkedShows,
  listFollowedActors,
} from "@/server/modules/personal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MY — MuDeal",
};

export default async function MyPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?redirectUrl=/my");

  const db = getRuntimeDb();
  const todayKst = formatKstDate();
  const ym = todayKst.slice(0, 7);

  const [notiFeed, savedFeed, calendar, bookmarks, followedActors, reports] = await Promise.all([
    getNotificationsFeed(db, session.user.id, { mode: "unread" }),
    getNotificationsFeed(db, session.user.id, { mode: "saved" }),
    getMyCalendar(db, session.user.id, `${ym}-01`, `${ym}-31`),
    listBookmarkedShows(db, session.user.id),
    listFollowedActors(db, session.user.id),
    getMyReportsSummary(db, session.user.id),
  ]);

  return (
    <div className="bg-surface-variant pb-10">
      <MyPageWorkspace
        user={session.user}
        todayKst={todayKst}
        bookmarkCount={bookmarks.length}
        followedCount={followedActors.length}
        initialStories={notiFeed.stories}
        initialSavedNotifications={savedFeed.items}
        initialAutoEvents={calendar.autoEvents}
        initialSavedEvents={calendar.savedEvents}
        initialReports={reports}
      />
    </div>
  );
}
