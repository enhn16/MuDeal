import Link from "next/link";
import { Suspense } from "react";
import type { AuthUser } from "@/server/modules/auth";
import { HeaderNavTabs } from "./HeaderNavTabs";

function formatKstHeaderDate(now = new Date()): string {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${mm}.${dd} (${days[shifted.getUTCDay()]}) KST 기준`;
}

export function SiteHeader({
  session,
}: {
  session: { user: AuthUser; unreadCount: number } | null;
}) {
  const kstDateLabel = formatKstHeaderDate();

  return (
    <header className="sticky top-0 z-30 border-b border-outline bg-surface shadow-e1">
      <div className="mx-auto max-w-[1100px] px-5 lg:px-0">
        {/* Tier 1: Brand + Inline Search + Utilities */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 pb-3 lg:gap-4 lg:pt-5">
          <Link href="/" className="text-2xl font-bold tracking-tight text-primary">
            MuDeal
          </Link>

            <form action="/search" method="get" className="min-w-0 flex-1 sm:max-w-md sm:min-w-60">
              <label htmlFor="global-search" className="sr-only">
                작품명, 뮤지컬 배우, 공연장 검색
              </label>
              <div className="relative flex items-center">
                <span
                  className="material-symbols-outlined pointer-events-none absolute left-3 text-lg text-muted"
                  aria-hidden="true"
                >
                  search
                </span>
                <input
                  id="global-search"
                  name="q"
                  type="search"
                  placeholder="작품명 · 뮤지컬 배우 · 공연장 검색"
                  className="h-10 w-full rounded-sm border border-outline bg-surface-variant pr-4 pl-10 text-sm text-on-surface placeholder:text-hint transition-colors focus:border-secondary focus:bg-surface focus:outline-none"
                />
              </div>
            </form>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <Link
                href="/reports/new"
                className="inline-flex h-10 items-center gap-1 rounded-sm border border-outline bg-surface px-3 text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
              >
                <span className="material-symbols-outlined text-lg" aria-hidden="true">
                  edit_note
                </span>
                <span className="hidden sm:inline">할인 제보</span>
              </Link>

              {session ? (
                <>
                  {session.user.role === "ADMIN" && (
                    <Link
                      href="/admin/reports"
                      className="hidden h-10 items-center rounded-sm bg-curtain-noir px-3 text-[13px] font-semibold text-on-curtain-noir transition-colors hover:bg-mulberry md:inline-flex"
                    >
                      ADMIN
                    </Link>
                  )}
                  <Link
                    href="/my"
                    className="inline-flex h-10 items-center gap-2 rounded-sm bg-rose-mist px-3 text-[13px] font-semibold text-primary transition-colors hover:bg-surface-sunken"
                  >
                    <span className="material-symbols-outlined text-lg" aria-hidden="true">
                      person
                    </span>
                    <span>MY</span>
                    {session.unreadCount > 0 && (
                      <span className="rounded-xs bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-on-primary tabular-nums">
                        {session.unreadCount}
                      </span>
                    )}
                  </Link>
                </>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex h-10 items-center gap-1.5 rounded-sm bg-rose-mist px-3 text-[13px] font-semibold text-primary transition-colors hover:bg-surface-sunken"
                >
                  <span className="material-symbols-outlined text-lg" aria-hidden="true">
                    person
                  </span>
                  <span>로그인</span>
                </Link>
              )}
            </div>
          </div>

          {/* Tier 2: Category Navigation Tabs (Stitch underline parity) */}
          <Suspense
            fallback={
              <div className="flex h-12 items-center gap-6 text-[15px] font-semibold text-on-surface-variant">
                <span>홈</span>
              </div>
            }
          >
            <HeaderNavTabs kstDateLabel={kstDateLabel} />
          </Suspense>
        </div>
      </header>
  );
}
