"use client";

import Link from "next/link";
import { useState } from "react";
import type { DealType } from "@/db/schema";
import { DEAL_TYPE_LABELS } from "@/lib/labels";
import { formatKrw } from "@/lib/pricing";
import { HelpfulButton } from "./DealActions";

export interface CommunityDealCardData {
  dealId: number;
  showId: number;
  showTitle: string;
  channelName: string;
  dealType: DealType;
  salePrice: number | null;
  discountRate: number | null;
  conditionSummary: string | null;
  reporterNickname: string;
  clickCount: number;
  helpfulCount: number;
}

export function CommunityDealCard({ deal }: { deal: CommunityDealCardData }) {
  const [helpfulCount, setHelpfulCount] = useState(deal.helpfulCount);

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-outline bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-xs bg-rose-mist px-2 py-0.5 text-xs font-semibold text-primary">
          {deal.reporterNickname}님 제보
        </span>
        <span className="text-[13px] text-muted tabular-nums">
          {deal.clickCount}명 확인 · 도움 {helpfulCount}
        </span>
      </div>

      <div>
        <Link
          href={`/shows/${deal.showId}`}
          className="text-[15px] font-semibold text-on-surface hover:text-primary"
        >
          {deal.showTitle}
        </Link>
        <p className="mt-0.5 text-xs text-muted">
          {deal.channelName}
          {deal.conditionSummary ? ` · ${deal.conditionSummary}` : ""}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-outline pt-2.5">
        <div className="flex items-baseline gap-2 tabular-nums">
          {deal.discountRate !== null && (
            <span className="text-lg font-bold text-secondary">{deal.discountRate}%</span>
          )}
          {deal.salePrice !== null ? (
            <span className="text-lg font-bold text-on-surface">{formatKrw(deal.salePrice)}</span>
          ) : deal.discountRate === null ? (
            <span className="text-sm font-semibold text-primary">
              {DEAL_TYPE_LABELS[deal.dealType]}
            </span>
          ) : (
            <span className="text-sm font-semibold text-on-surface">할인 적용</span>
          )}
        </div>
        <HelpfulButton
          dealId={deal.dealId}
          initialCount={deal.helpfulCount}
          onCountChange={(next) => setHelpfulCount(next)}
        />
      </div>
    </article>
  );
}
