"use client";

import Link from "next/link";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-surface-variant px-5 py-16">
      <section className="flex w-full max-w-md flex-col items-center gap-4 rounded-lg border border-outline bg-surface p-8 text-center">
        <span className="rounded-xs bg-urgent-wash px-2.5 py-1 text-xs font-semibold text-urgent">
          일시적인 오류
        </span>
        <h1 className="text-xl font-bold text-on-surface">화면을 불러오지 못했어요</h1>
        <p className="text-sm text-muted">
          잠시 연결이 원활하지 않았어요. 다시 시도하거나 홈으로 이동해 주세요.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2.5">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-10 items-center rounded-sm bg-secondary px-5 text-sm font-semibold text-on-secondary hover:bg-secondary-hover"
          >
            다시 시도하기
          </button>
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-sm border border-outline bg-surface px-4 text-sm font-semibold text-on-surface-variant hover:bg-surface-variant"
          >
            홈으로 가기
          </Link>
        </div>
      </section>
    </div>
  );
}
