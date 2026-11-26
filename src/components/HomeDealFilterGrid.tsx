"use client";

import Link from "next/link";
import { useState } from "react";
import type { HomeCategory, ShowCardItem } from "@/server/modules/shows";
import { ShowCard } from "./ShowCard";

const CATEGORY_TABS: Array<{
  key: HomeCategory;
  label: string;
  description: string;
}> = [
  {
    key: "DISCOUNT",
    label: "할인",
    description: "타임세일 · 로터리 · 마티네 등 예매처별 최저가를 비교해요.",
  },
  {
    key: "PERK",
    label: "특전",
    description: "포토카드 · OST 엽서 · 스페셜 티켓 등 현장 증정 혜택을 모았어요.",
  },
  {
    key: "EVENT",
    label: "싱어롱 · 특별 커튼콜",
    description: "커튼콜 촬영 가능 회차와 싱어롱 데이 일정을 확인해요.",
  },
];

export function HomeDealFilterGrid({ shows }: { shows: ShowCardItem[] }) {
  const [active, setActive] = useState<HomeCategory>("DISCOUNT");

  const counts: Record<HomeCategory, number> = {
    DISCOUNT: shows.filter((s) => s.categories.includes("DISCOUNT")).length,
    PERK: shows.filter((s) => s.categories.includes("PERK")).length,
    EVENT: shows.filter((s) => s.categories.includes("EVENT")).length,
  };

  const filtered = shows.filter((s) => s.categories.includes(active));
  const currentTab = CATEGORY_TABS.find((t) => t.key === active)!;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-outline">
        <div role="tablist" aria-label="뮤지컬 카테고리" className="flex items-center gap-6 overflow-x-auto">
          {CATEGORY_TABS.map((tab) => {
            const isActive = active === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(tab.key)}
                className={`inline-flex h-12 items-center gap-1.5 border-b-4 text-[15px] font-semibold whitespace-nowrap transition-colors ${
                  isActive
                    ? "border-primary text-on-surface"
                    : "border-transparent text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-xs tabular-nums ${
                    isActive ? "text-primary" : "text-muted"
                  }`}
                >
                  {counts[tab.key]}
                </span>
              </button>
            );
          })}
        </div>

        <Link
          href={`/search?category=${active}`}
          className="inline-flex h-9 items-center gap-0.5 text-[13px] font-semibold text-on-surface-variant hover:text-primary"
        >
          <span>{currentTab.label} 조건 검색</span>
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            chevron_right
          </span>
        </Link>
      </div>

      <p className="mb-5 text-[13px] text-muted">{currentTab.description}</p>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-outline bg-surface-variant p-10 text-center">
          <p className="text-sm font-semibold text-on-surface">
            진행 중인 {currentTab.label} 공연이 아직 없어요
          </p>
          <p className="text-xs text-muted">
            알고 계신 혜택이 있다면 제보해 주세요. 검수 후 바로 올라가요.
          </p>
          <Link
            href="/reports/new"
            className="mt-1 inline-flex h-9 items-center rounded-sm bg-secondary px-4 text-xs font-semibold text-on-secondary hover:bg-secondary-hover"
          >
            혜택 제보하기
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 items-stretch gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-5">
          {filtered.map((show) => (
            <ShowCard key={`${active}-${show.id}`} show={show} viewCategory={active} />
          ))}
        </div>
      )}
    </div>
  );
}
