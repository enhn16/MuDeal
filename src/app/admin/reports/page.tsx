import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRuntimeDb } from "@/db/client";
import { AdminReviewConsole } from "@/components/AdminReviewConsole";
import { AdminShell } from "@/components/AdminShell";
import { getAdminSidebarCounts, listAdminReviewQueue } from "@/server/modules/admin";
import { getServerSession } from "@/server/modules/auth-runtime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "통합 검수 — MuDeal Admin" };

export default async function AdminReportsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?redirectUrl=/admin/reports");
  if (session.user.role !== "ADMIN") {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <h1 className="text-xl font-bold text-on-surface">관리자 권한이 필요해요 (403)</h1>
        <p className="mt-2 text-sm text-muted">관리자 권한이 있는 카카오 계정으로 로그인해 주세요.</p>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
          홈으로 돌아가기
        </Link>
      </div>
    );
  }

  const db = getRuntimeDb();
  const [counts, queue] = await Promise.all([getAdminSidebarCounts(db), listAdminReviewQueue(db)]);

  return (
    <div className="bg-surface-variant pb-12">
      <AdminShell admin={session.user} active="reports" counts={counts} title="통합 검수">
        <AdminReviewConsole
          initialReports={queue.reports}
          initialDrafts={queue.drafts}
          initialFailedOcrJobs={queue.failedOcrJobs}
          showOptions={queue.showOptions}
        />
      </AdminShell>
    </div>
  );
}
