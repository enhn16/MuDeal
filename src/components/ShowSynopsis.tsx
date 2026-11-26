"use client";

import { useEffect, useRef, useState } from "react";

/** Renders full musical synopsis clamped to 3 lines by default, with an expand/collapse toggle when longer. */
export function ShowSynopsis({ synopsis }: { synopsis: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const textRef = useRef<HTMLParagraphElement | null>(null);

  const trimmed = synopsis?.trim() ?? "";

  useEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return;
    const check = () => {
      setIsOverflowing(el.scrollHeight > el.clientHeight + 2);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [trimmed, expanded]);

  if (!trimmed) return null;

  return (
    <div className="mt-4 border-t border-outline pt-4">
      <h2 className="mb-1.5 text-xs font-semibold text-muted">줄거리</h2>
      <p
        ref={textRef}
        className={`whitespace-pre-line text-[14px] leading-relaxed text-on-surface-variant ${
          expanded ? "" : "line-clamp-3"
        }`}
      >
        {trimmed}
      </p>
      {(isOverflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="mt-1.5 inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline"
        >
          {expanded ? "접기" : "더보기"}
        </button>
      )}
    </div>
  );
}
