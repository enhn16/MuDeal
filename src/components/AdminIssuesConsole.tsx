"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const ISSUE_LABELS: Record<string, string> = {
  SOLD_OUT: "매진 안내",
  PRICE_MISMATCH: "가격 불일치",
  BROKEN_LINK: "링크 오류",
  ENDED: "조기 종료",
  OTHER: "기타 오류",
};

interface IssueItem {
  issue: {
    id: number;
    dealId: number;
    issueType: string;
    note: string | null;
    createdAt: string;
  };
  channelName: string;
  dealStatus: string;
  showId: number | null;
  showTitle: string | null;
}

export function AdminIssuesConsole({ initialIssues }: { initialIssues: IssueItem[] }) {
  const router = useRouter();
  const [issues, setIssues] = useState(initialIssues);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function resolve(issueId: number, action: "EXPIRE_DEAL" | "RESOLVE" | "DISMISS") {
    setBusyId(issueId);
    try {
      const res = await fetch(`/api/v1/admin/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setIssues((prev) => prev.filter((i) => i.issue.id !== issueId));
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  if (issues.length === 0) {
    return (
      <div className="rounded-lg border border-outline bg-surface p-10 text-center text-sm text-muted">
        미처리 오류 신고가 없습니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {issues.map(({ issue, channelName, showId, showTitle }) => (
        <article
          key={issue.id}
          className="flex flex-col gap-4 rounded-lg border border-outline bg-surface p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-xs px-2 py-0.5 text-xs font-semibold ${
                  issue.issueType === "PRICE_MISMATCH"
                    ? "bg-urgent text-white"
                    : "bg-surface-sunken text-on-surface-variant"
                }`}
              >
                {ISSUE_LABELS[issue.issueType] ?? issue.issueType}
              </span>
              <h2 className="text-base font-bold text-on-surface">
                {showTitle ?? `딜 #${issue.dealId}`} · {channelName}
              </h2>
            </div>
            <span className="text-xs text-muted tabular-nums">
              신고 시각 {issue.createdAt.slice(0, 16).replace("T", " ")}
            </span>
          </div>

          {issue.note && <p className="text-sm text-on-surface-variant">{issue.note}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline pt-3">
            {showId ? (
              <Link href={`/shows/${showId}`} className="text-xs font-semibold text-primary hover:underline">
                작품 상세 페이지 확인 ↗
              </Link>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busyId === issue.id}
                onClick={() => resolve(issue.id, "EXPIRE_DEAL")}
                className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant"
              >
                딜 마감 처리
              </button>
              <button
                type="button"
                disabled={busyId === issue.id}
                onClick={() => resolve(issue.id, "RESOLVE")}
                className="h-9 rounded-sm bg-secondary px-4 text-xs font-semibold text-on-secondary hover:bg-secondary-hover"
              >
                확인 완료
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
