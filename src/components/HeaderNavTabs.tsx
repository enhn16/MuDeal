"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [
  { href: "/", label: "홈", match: (p: string, sp: URLSearchParams) => p === "/" && !sp.toString() },
  {
    href: "/search?dealType=TICKET_OPEN",
    label: "티켓오픈 임박",
    match: (p: string, sp: URLSearchParams) => p === "/search" && sp.get("dealType") === "TICKET_OPEN",
  },
  {
    href: "/search?source=USER_REPORT",
    label: "제보해주신 딜",
    match: (p: string, sp: URLSearchParams) => p === "/search" && sp.get("source") === "USER_REPORT",
  },
  {
    href: "/search?dealType=LOTTERY",
    label: "로터리·특가",
    match: (p: string, sp: URLSearchParams) => p === "/search" && sp.get("dealType") === "LOTTERY",
  },
  {
    href: "/search?dealType=SINGALONG",
    label: "싱어롱·특전",
    match: (p: string, sp: URLSearchParams) =>
      p === "/search" && (sp.get("dealType") === "SINGALONG" || sp.get("dealType") === "CURTAIN_CALL"),
  },
] as const;

export function HeaderNavTabs({ kstDateLabel }: { kstDateLabel: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <nav aria-label="메인 내비게이션" className="flex items-center justify-between gap-4 overflow-x-auto">
      <div className="flex items-center gap-6">
        {TABS.map((tab) => {
          const active = tab.match(pathname, searchParams);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex h-12 items-center border-b-4 text-[15px] font-semibold whitespace-nowrap transition-colors ${
                active
                  ? "border-primary text-on-surface"
                  : "border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <span className="hidden text-[13px] whitespace-nowrap text-muted tabular-nums md:inline">
        {kstDateLabel}
      </span>
    </nav>
  );
}
