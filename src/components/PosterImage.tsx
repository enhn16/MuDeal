"use client";

import { useState } from "react";

export function PosterImage({ title, posterUrl }: { title: string; posterUrl: string | null }) {
  const [failed, setFailed] = useState(false);

  if (posterUrl && !failed) {
    return (
      <img
        src={posterUrl}
        alt={`${title} 포스터`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      />
    );
  }

  return (
    <div
      aria-label={`${title} 포스터 준비 중`}
      className="flex h-full w-full items-center justify-center bg-curtain-noir transition-transform duration-200 group-hover:scale-[1.02]"
    >
      <span className="material-symbols-outlined text-4xl text-white/15" aria-hidden="true">
        theater_comedy
      </span>
    </div>
  );
}
