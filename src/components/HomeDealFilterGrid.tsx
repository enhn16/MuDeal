"use client";

import { useState } from "react";
import type { DealType } from "@/db/schema";
import type { ShowCardItem } from "@/server/modules/shows";
import { ShowCard } from "./ShowCard";

const CHIPS: Array<{ key: "ALL" | DealType; label: string }> = [
  { key: "ALL", label: "전체" },
  { key: "TIMESALE", label: "타임세일" },
  { key: "LOTTERY", label: "로터리" },
  { key: "DISCOUNT_SITE", label: "할인사이트" },
  { key: "SPECIAL_DAY", label: "스페셜 데이" },
  { key: "SINGALONG", label: "싱어롱·커튼콜" },
];

export function HomeDealFilterGrid({ shows }: { shows: ShowCardItem[] }) {
  const [active, setActive] = useState<"ALL" | DealType>("ALL");

  const filtered = shows.filter((s) => {
    if (active === "ALL") return true;
    if (active === "SINGALONG") {
      return s.primaryDealType === "SINGALONG" || s.primaryDealType === "CURTAIN_CALL";
    }
    return s.primaryDealType === active;
  });

  return (
    <div>
      <div role="tablist" aria-label="할인 유형 필터" className="mb-6 flex flex-wrap gap-2">
        {CHIPS.map((chip) => {
          const isActive = active === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(chip.key)}
              className={`h-8 rounded-xs border px-3 text-[13px] font-semibold transition-colors ${
                isActive
                  ? "border-primary bg-primary text-on-primary"
                  : "border-outline bg-surface text-on-surface-variant hover:bg-surface-variant"
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-outline bg-surface-variant p-8 text-center text-sm text-muted">
          선택한 유형의 진행 중인 할인 공연이 없습니다.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-5">
          {filtered.map((show) => (
            <ShowCard key={show.id} show={show} />
          ))}
        </div>
      )}
    </div>
  );
}
