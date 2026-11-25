import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRuntimeDb } from "@/db/client";
import { AdminDealsConsole } from "@/components/AdminDealsConsole";
import { AdminShell } from "@/components/AdminShell";
import { getAdminSidebarCounts, listAdminDealsWorkspace } from "@/server/modules/admin";
import { getServerSession } from "@/server/modules/auth-runtime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "공연·배우·딜 관리 — MuDeal Admin" };

export default async function AdminDealsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?redirectUrl=/admin/deals");
  if (session.user.role !== "ADMIN") {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <h1 className="text-xl font-bold text-on-surface">관리자 권한이 필요합니다 (403)</h1>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
          홈으로 돌아가기
        </Link>
      </div>
    );
  }

  const db = getRuntimeDb();
  const [counts, workspace] = await Promise.all([
    getAdminSidebarCounts(db),
    listAdminDealsWorkspace(db),
  ]);

  return (
    <div className="bg-surface-variant pb-12">
      <AdminShell admin={session.user} active="deals" counts={counts} title="공연 · 배우 · 딜 · 연동 관리">
        <AdminDealsConsole
          initialDeals={workspace.deals}
          showOptions={workspace.showOptions}
          actors={workspace.actors}
          latestSync={workspace.latestSync}
          initialCurations={workspace.curations}
        />
      </AdminShell>
    </div>
  );
}
