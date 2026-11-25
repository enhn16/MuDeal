"use client";

import Link from "next/link";
import { useState } from "react";
import type { SubRegion } from "@/db/schema";
import { SUB_REGION_SHORT } from "@/lib/labels";
import { PosterArtwork } from "./ShowCard";

export interface ActorAppearanceItem {
  id: number;
  title: string;
  posterUrl: string | null;
  venueName: string;
  subRegion: SubRegion;
  startDate: string;
  endDate: string;
  status: "UPCOMING" | "ONGOING" | "ENDED";
  roleName: string | null;
}

/** Stitch mudeal_5 parity: 출연 중 / 예정 segmented toggle + 3-col 5:7 poster cards. */
export function ActorShowsGrid({ shows }: { shows: ActorAppearanceItem[] }) {
  const current = shows.filter((s) => s.status !== "UPCOMING");
  const upcoming = shows.filter((s) => s.status === "UPCOMING");
  const [mode, setMode] = useState<"current" | "upcoming">(
    current.length > 0 ? "current" : "upcoming",
  );
  const visible = mode === "current" ? current : upcoming;

  return (
    <section className="flex flex-col gap-5 rounded-lg border border-outline bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-on-surface">출연작 모아보기</h2>
          <div className="inline-flex gap-1 rounded-sm border border-outline bg-surface-variant p-1">
            <button
              type="button"
              onClick={() => setMode("current")}
              className={`inline-flex h-8 w-24 items-center justify-center rounded-xs text-xs font-semibold transition-colors ${
                mode === "current"
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              출연 중 ({current.length})
            </button>
            <button
              type="button"
              onClick={() => setMode("upcoming")}
              className={`inline-flex h-8 w-24 items-center justify-center rounded-xs text-xs font-semibold transition-colors ${
                mode === "upcoming"
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              예정 ({upcoming.length})
            </button>
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          {mode === "current" ? "현재 공연 중인 출연작이 없습니다." : "개막 예정인 출연작이 없습니다."}
        </p>
      ) : (
        <div className="grid grid-cols-1 items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((show) => (
            <Link key={show.id} href={`/shows/${show.id}`} className="group flex h-full flex-col bg-surface">
              <div className="poster-frame relative w-full">
                <PosterArtwork
                  title={show.title}
                  posterUrl={show.posterUrl}
                  venueName={show.venueName}
                  subLabel={SUB_REGION_SHORT[show.subRegion]}
                />
              </div>
              <div className="mt-3 flex flex-1 flex-col gap-1">
                <div className="flex items-center justify-between gap-2 text-xs text-muted">
                  <span className="truncate">{show.venueName}</span>
                  <span className="shrink-0 tabular-nums">
                    {show.status === "UPCOMING"
                      ? `${show.startDate.replaceAll("-", ".")} 개막`
                      : `${show.startDate.replaceAll("-", ".")} ~ ${show.endDate.replaceAll("-", ".")}`}
                  </span>
                </div>
                <h3 className="text-[15px] font-semibold text-on-surface group-hover:text-primary">
                  {show.title}
                </h3>
                <div className="mt-auto flex items-center justify-between border-t border-outline pt-2">
                  <span className="text-[13px] font-semibold text-primary">
                    {show.roleName ? `${show.roleName} 역` : "출연"}
                  </span>
                  <span className="text-xs font-semibold text-muted">
                    {show.status === "UPCOMING" ? "개막 예정" : "공연 중"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
