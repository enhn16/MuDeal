"use client";

import Link from "next/link";
import { useState } from "react";
import type { SubRegion } from "@/db/schema";
import { formatShowPeriod } from "@/lib/kst";
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

/** Stitch mudeal_5 parity: 출연 중 / 예정 / 종료 segmented toggle + 3-col 5:7 poster cards. */
export function ActorShowsGrid({ shows }: { shows: ActorAppearanceItem[] }) {
  const ongoing = shows.filter((s) => s.status === "ONGOING");
  const upcoming = shows.filter((s) => s.status === "UPCOMING");
  const ended = shows.filter((s) => s.status === "ENDED");
  const [mode, setMode] = useState<"ongoing" | "upcoming" | "ended">(
    ongoing.length > 0 ? "ongoing" : upcoming.length > 0 ? "upcoming" : ended.length > 0 ? "ended" : "ongoing",
  );
  const visible = mode === "ongoing" ? ongoing : mode === "upcoming" ? upcoming : ended;

  return (
    <section className="flex flex-col gap-5 rounded-lg border border-outline bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-on-surface">출연작 모아보기</h2>
          <div
            role="group"
            aria-label="출연작 상태 필터"
            className="inline-flex flex-wrap gap-1 rounded-sm border border-outline bg-surface-variant p-1"
          >
            <button
              type="button"
              aria-pressed={mode === "ongoing"}
              onClick={() => setMode("ongoing")}
              className={`inline-flex h-8 min-w-24 items-center justify-center rounded-xs px-3 text-xs font-semibold tabular-nums transition-colors ${
                mode === "ongoing"
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              출연 중 ({ongoing.length})
            </button>
            <button
              type="button"
              aria-pressed={mode === "upcoming"}
              onClick={() => setMode("upcoming")}
              className={`inline-flex h-8 min-w-24 items-center justify-center rounded-xs px-3 text-xs font-semibold tabular-nums transition-colors ${
                mode === "upcoming"
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              예정 ({upcoming.length})
            </button>
            {ended.length > 0 && (
              <button
                type="button"
                aria-pressed={mode === "ended"}
                onClick={() => setMode("ended")}
                className={`inline-flex h-8 min-w-20 items-center justify-center rounded-xs px-3 text-xs font-semibold tabular-nums transition-colors ${
                  mode === "ended"
                    ? "bg-primary text-on-primary"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                종료 ({ended.length})
              </button>
            )}
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md bg-surface-variant py-8 text-center">
          <p className="text-sm text-muted">
            {mode === "ongoing"
              ? "현재 공연 중인 출연작이 없어요."
              : mode === "upcoming"
                ? "개막 예정인 출연작이 아직 없어요."
                : "종료된 출연작 이력이 없어요."}
          </p>
          <Link
            href="/search"
            className="inline-flex h-9 items-center rounded-sm border border-outline bg-surface px-4 text-xs font-semibold text-primary hover:bg-rose-mist"
          >
            진행 중인 뮤지컬 둘러보기
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((show) => {
            const isEnded = show.status === "ENDED";
            const statusText =
              show.status === "UPCOMING" ? "개막 예정" : isEnded ? "종료" : "공연 중";
            return (
              <Link key={show.id} href={`/shows/${show.id}`} className="group flex h-full flex-col bg-surface">
                <div className={`poster-frame relative w-full ${isEnded ? "opacity-60 grayscale" : ""}`}>
                  <PosterArtwork title={show.title} posterUrl={show.posterUrl} />
                  {isEnded && (
                    <span className="absolute top-2.5 left-2.5 z-10 rounded-xs bg-surface-sunken-2 px-2 py-0.5 text-[11px] font-semibold text-muted">
                      종료
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-1 flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span className="truncate">{show.venueName}</span>
                    <span className="shrink-0 tabular-nums">
                      {show.status === "UPCOMING"
                        ? `${show.startDate.replaceAll("-", ".")} 개막`
                        : formatShowPeriod(show.startDate, show.endDate)}
                    </span>
                  </div>
                  <h3 className="text-[15px] font-semibold text-on-surface group-hover:text-primary">
                    {show.title}
                  </h3>
                  <div className="mt-auto flex items-center justify-between border-t border-outline pt-2">
                    <span className="text-[13px] font-semibold text-primary">
                      {show.roleName ? `${show.roleName} 역` : "출연"}
                    </span>
                    <span className="text-xs font-semibold text-muted">{statusText}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
