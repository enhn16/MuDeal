import Link from "next/link";
import type { AuthUser } from "@/server/modules/auth";

export function SiteHeader({
  session,
}: {
  session: { user: AuthUser; unreadCount: number } | null;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-outline bg-surface shadow-e1">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3 px-5 py-3.5 lg:gap-4 lg:px-0">
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
              placeholder="작품명 · 배우 · 공연장 검색"
              className="h-10 w-full rounded-sm border border-outline bg-surface-variant pr-4 pl-10 text-sm text-on-surface placeholder:text-hint transition-colors focus:border-secondary focus:bg-surface focus:outline-none"
            />
          </div>
        </form>

        <div className="flex shrink-0 items-center gap-2">
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
    </header>
  );
}
