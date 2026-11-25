import Link from "next/link";
import type { AuthUser } from "@/server/modules/auth";

export function AdminShell({
  admin,
  active,
  counts,
  title,
  children,
}: {
  admin: AuthUser;
  active: "reports" | "deals" | "issues";
  counts: { pendingReviewCount: number; openIssuesCount: number };
  title: string;
  children: React.ReactNode;
}) {
  const nav = [
    { key: "reports", href: "/admin/reports", icon: "fact_check", label: "통합 검수", badge: counts.pendingReviewCount },
    { key: "deals", href: "/admin/deals", icon: "theater_comedy", label: "공연·배우·딜 관리", badge: 0 },
    { key: "issues", href: "/admin/issues", icon: "report_problem", label: "오류 신고", badge: counts.openIssuesCount },
  ] as const;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-5 py-6 lg:flex-row lg:px-0">
      {/* Curtain Noir Sidebar (mudeal_7/8/9 parity) */}
      <aside className="flex w-full shrink-0 flex-col justify-between gap-5 rounded-lg bg-curtain-noir p-5 text-on-curtain-noir lg:w-60">
        <div className="flex flex-col gap-5">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold">MuDeal</span>
            <span className="text-xs font-semibold text-gold-soft">ADMIN</span>
          </div>

          <nav aria-label="어드민 메뉴" className="flex flex-row gap-2 overflow-x-auto lg:flex-col">
            {nav.map((item) => {
              const isActive = active === item.key;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex h-10 shrink-0 items-center justify-between gap-2 rounded-sm px-3 text-[13px] font-semibold transition-colors ${
                    isActive
                      ? "bg-mulberry text-on-curtain-noir"
                      : "text-white/80 hover:bg-mulberry/60 hover:text-white"
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`material-symbols-outlined text-lg ${isActive ? "text-gold-soft" : ""}`}
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>
                    <span className="whitespace-nowrap">{item.label}</span>
                  </span>
                  {item.badge > 0 && (
                    <span className="rounded-xs bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-on-secondary tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="hidden border-t border-mulberry pt-4 text-xs text-white/75 lg:block">
          운영자: {admin.nickname}
        </div>
      </aside>

      {/* Main Admin Workspace */}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline bg-surface px-6 py-4">
          <h1 className="text-xl font-bold text-on-surface">{title}</h1>
          <span className="text-xs text-muted">감사 로그(audit_logs) 자동 기록</span>
        </div>
        {children}
      </div>
    </div>
  );
}
