import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRuntimeDb } from "@/db/client";
import { AdminIssuesConsole } from "@/components/AdminIssuesConsole";
import { AdminShell } from "@/components/AdminShell";
import { getAdminSidebarCounts, listAdminIssues } from "@/server/modules/admin";
import { getServerSession } from "@/server/modules/auth-runtime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "오류 신고 처리 — MuDeal Admin" };

export default async function AdminIssuesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?redirectUrl=/admin/issues");
  if (session.user.role !== "ADMIN") {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <h1 className="text-xl font-bold text-on-surface">관리자 권한이 필요해요 (403)</h1>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
          홈으로 돌아가기
        </Link>
      </div>
    );
  }

  const db = getRuntimeDb();
  const [counts, issues] = await Promise.all([getAdminSidebarCounts(db), listAdminIssues(db)]);

  return (
    <div className="bg-surface-variant pb-12">
      <AdminShell admin={session.user} active="issues" counts={counts} title="오류 신고 처리">
        <AdminIssuesConsole initialIssues={issues} />
      </AdminShell>
    </div>
  );
}
