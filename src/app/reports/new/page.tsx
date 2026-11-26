import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getRuntimeDb } from "@/db/client";
import { shows } from "@/db/schema";
import { ReportForm } from "@/components/ReportForm";
import { getServerSession } from "@/server/modules/auth-runtime";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "할인 · 이벤트 제보하기 — MuDeal",
};

export default async function ReportNewPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?redirectUrl=/reports/new");

  const showList = await getRuntimeDb()
    .select({ id: shows.id, title: shows.title })
    .from(shows)
    .orderBy(asc(shows.title));

  return (
    <div className="bg-surface-variant py-8">
      <div className="mx-auto max-w-[1100px] px-5 lg:px-0">
        <section className="mx-auto flex max-w-2xl flex-col gap-6 rounded-lg border border-outline bg-surface p-6">
          <div className="border-b border-outline pb-4">
            <h1 className="text-2xl font-bold text-on-surface">할인 · 이벤트 제보하기</h1>
            <p className="mt-1 text-xs text-muted">
              승인되면 홈 &apos;제보해주신 딜&apos;에 닉네임과 확인·도움 수가 함께 올라가요.
              https://로 시작하는 원문 예매처 링크를 입력해 주세요. (하루 최대 10건)
            </p>
          </div>
          <ReportForm defaultNickname={session.user.nickname} shows={showList} />
        </section>
      </div>
    </div>
  );
}
