"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SEAT_GRADE_LABELS } from "@/lib/labels";
import { formatKrw } from "@/lib/pricing";
import type { DealType, SeatGrade } from "@/db/schema";

interface AdminDealRow {
  id: number;
  showId: number | null;
  showTitle: string;
  channelName: string;
  dealType: DealType;
  seatGrade: SeatGrade;
  salePrice: number | null;
  discountRate: number | null;
  status: string;
  adminLocked: number;
}

interface CurationRow {
  id: number;
  slotType: "HERO" | "SPOTLIGHT";
  title: string;
  subtitle: string | null;
  linkUrl: string;
  sortOrder: number;
  isActive: number;
}

export function AdminDealsConsole({
  initialDeals,
  showOptions,
  actors,
  latestSync,
  initialCurations,
}: {
  initialDeals: AdminDealRow[];
  showOptions: Array<{ id: number; title: string }>;
  actors: Array<{ id: number; name: string; followerCount: number }>;
  latestSync: Array<{ id: number; sourceName: string; status: string; fetchedCount: number; startedAt: string }>;
  initialCurations: CurationRow[];
}) {
  const router = useRouter();
  const [dealList, setDealList] = useState(initialDeals);
  const [curations, setCurations] = useState(initialCurations);
  const [syncBusy, setSyncBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showId, setShowId] = useState(String(showOptions[0]?.id ?? ""));
  const [channelName, setChannelName] = useState("NOL티켓");
  const [salePrice, setSalePrice] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [externalUrl, setExternalUrl] = useState("https://");
  const [conditionSummary, setConditionSummary] = useState("");
  const [sourceActorId, setSourceActorId] = useState("");
  const [targetActorId, setTargetActorId] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const lockedCount = dealList.filter((d) => d.adminLocked === 1).length;
  const lastRun = latestSync[0];

  async function triggerSync(target: "KOPIS" | "CHANNELS" | "EXPIRY") {
    setSyncBusy(target);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/admin/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const json = (await res.json()) as { data?: { result: unknown }; error?: { message: string } };
      if (!res.ok) {
        setMessage(json.error?.message ?? `${target} 실행 실패`);
        return;
      }
      setMessage(`${target} 실행 완료: ${JSON.stringify(json.data?.result)}`);
      router.refresh();
    } finally {
      setSyncBusy(null);
    }
  }

  async function toggleCuration(c: CurationRow) {
    const next = c.isActive === 0;
    const res = await fetch(`/api/v1/admin/curations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: next }),
    });
    if (res.ok) {
      setCurations((prev) => prev.map((x) => (x.id === c.id ? { ...x, isActive: next ? 1 : 0 } : x)));
      router.refresh();
    }
  }

  async function toggleLock(deal: AdminDealRow) {
    const next = deal.adminLocked === 0;
    const res = await fetch(`/api/v1/admin/deals/${deal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminLocked: next }),
    });
    if (res.ok) {
      setDealList((prev) =>
        prev.map((d) => (d.id === deal.id ? { ...d, adminLocked: next ? 1 : 0 } : d)),
      );
      setMessage(next ? "admin_locked 활성화됨 (배치 덮어쓰기 보호)" : "자동 동기화 허용으로 전환됨");
    }
  }

  async function toggleExpire(deal: AdminDealRow) {
    const nextStatus = deal.status === "ACTIVE" ? "EXPIRED" : "ACTIVE";
    const res = await fetch(`/api/v1/admin/deals/${deal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) {
      setDealList((prev) => prev.map((d) => (d.id === deal.id ? { ...d, status: nextStatus } : d)));
      router.refresh();
    }
  }

  async function createDeal(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/v1/admin/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        showId: Number(showId),
        channelName,
        dealType: "TIMESALE",
        seatGrade: "ALL",
        basePrice: basePrice ? Number(basePrice) : null,
        salePrice: salePrice ? Number(salePrice) : null,
        isUnconditional: true,
        conditionSummary: conditionSummary || null,
        externalUrl,
        adminLocked: true,
      }),
    });
    const json = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setMessage(json.error?.message ?? "딜 등록에 실패했습니다.");
      return;
    }
    setAdding(false);
    setSalePrice("");
    setBasePrice("");
    setConditionSummary("");
    setMessage("새 딜이 등록되었습니다.");
    router.refresh();
  }

  async function runActorMerge(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceActorId || !targetActorId) return;
    setMessage(null);
    const res = await fetch("/api/v1/admin/actors/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceActorId: Number(sourceActorId),
        targetActorId: Number(targetActorId),
      }),
    });
    const json = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setMessage(json.error?.message ?? "배우 병합에 실패했습니다.");
      return;
    }
    setMessage("동명이인 배우 병합이 완료되었습니다.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Batch Sync Status Banner (mudeal_8 parity) */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline bg-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-xs bg-rose-mist px-2 py-0.5 text-xs font-semibold text-primary">
            {lastRun?.status === "FAILED" ? "배치 실패 경고" : "배치 정상"}
          </span>
          <span className="text-sm text-on-surface tabular-nums">
            {lastRun
              ? `최근 ${lastRun.sourceName} 동기화: ${lastRun.startedAt.slice(0, 16).replace("T", " ")} · ${lastRun.fetchedCount}건`
              : "최근 배치 이력 없음"}
          </span>
          <span className="text-xs text-muted tabular-nums">수동 잠금 딜 {lockedCount}건 보호 중</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={syncBusy !== null}
            onClick={() => triggerSync("KOPIS")}
            className="inline-flex h-9 items-center gap-1 rounded-sm bg-secondary px-3 text-xs font-semibold text-on-secondary hover:bg-secondary-hover disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">sync</span>
            <span>{syncBusy === "KOPIS" ? "실행 중..." : "KOPIS 수동 재수집"}</span>
          </button>
          <button
            type="button"
            disabled={syncBusy !== null}
            onClick={() => triggerSync("EXPIRY")}
            className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant disabled:opacity-60"
          >
            {syncBusy === "EXPIRY" ? "처리 중..." : "마감 일괄 처리"}
          </button>
        </div>
      </section>

      {message && (
        <p className="rounded-sm border border-rose-border bg-rose-mist px-4 py-2.5 text-xs font-semibold text-primary">
          {message}
        </p>
      )}

      {/* Active Deals Table */}
      <section className="flex flex-col gap-4 rounded-lg border border-outline bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-on-surface">할인 · 이벤트 딜 목록 ({dealList.length})</h2>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant"
          >
            {adding ? "닫기" : "+ 새 딜 등록"}
          </button>
        </div>

        {adding && (
          <form onSubmit={createDeal} className="grid grid-cols-1 gap-3 rounded-md border border-outline bg-surface-variant p-4 sm:grid-cols-2">
            <select
              value={showId}
              onChange={(e) => setShowId(e.target.value)}
              className="h-9 rounded-sm border border-outline bg-surface px-2.5 text-xs"
            >
              {showOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
            <input
              type="text"
              required
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder="예매처명"
              className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs"
            />
            <input
              type="number"
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              placeholder="기준 정가 (원)"
              className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs tabular-nums"
            />
            <input
              type="number"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              placeholder="할인가 (원)"
              className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs tabular-nums"
            />
            <input
              type="url"
              required
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://..."
              className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs sm:col-span-2"
            />
            <input
              type="text"
              value={conditionSummary}
              onChange={(e) => setConditionSummary(e.target.value)}
              placeholder="할인 조건 요약"
              className="h-9 rounded-sm border border-outline bg-surface px-3 text-xs sm:col-span-2"
            />
            <div className="sm:col-span-2 flex justify-end">
              <button
                type="submit"
                className="h-9 rounded-sm bg-secondary px-4 text-xs font-semibold text-on-secondary"
              >
                딜 등록
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto rounded-lg border border-outline">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="border-b border-outline bg-surface-sunken text-xs font-semibold text-on-surface-variant">
              <tr>
                <th className="px-4 py-3">작품 · 예매처</th>
                <th className="px-4 py-3">할인율 · 가격</th>
                <th className="px-4 py-3">상태 / 잠금</th>
                <th className="px-4 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline">
              {dealList.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-on-surface">{d.showTitle}</p>
                    <p className="text-xs text-muted">
                      {d.channelName} · {SEAT_GRADE_LABELS[d.seatGrade]}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {d.salePrice !== null ? (
                      <>
                        {d.discountRate !== null && (
                          <span className="mr-1.5 font-bold text-secondary">{d.discountRate}%</span>
                        )}
                        <span>{formatKrw(d.salePrice)}</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted">이벤트/오픈</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded-xs bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">
                        {d.status}
                      </span>
                      {d.adminLocked === 1 && (
                        <span className="rounded-xs bg-rose-mist px-2 py-0.5 text-[11px] font-semibold text-primary">
                          admin_locked
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleLock(d)}
                        className="h-8 rounded-xs border border-outline bg-surface px-2.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant"
                      >
                        {d.adminLocked ? "잠금 해제" : "잠금"}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleExpire(d)}
                        className="h-8 rounded-xs border border-outline bg-surface px-2.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant"
                      >
                        {d.status === "ACTIVE" ? "마감" : "재오픈"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Actor Disambiguation Merge (mudeal_8 parity) */}
      <section className="flex flex-col gap-3 rounded-lg border border-outline bg-surface p-6">
        <h2 className="text-base font-bold text-on-surface">배우 동명이인 매핑 보정</h2>
        <form onSubmit={runActorMerge} className="flex flex-wrap items-center gap-3">
          <select
            value={sourceActorId}
            onChange={(e) => setSourceActorId(e.target.value)}
            className="h-9 rounded-sm border border-outline bg-surface-variant px-3 text-xs"
          >
            <option value="">삭제(병합 원본) 배우 선택</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                #{a.id} {a.name} (팔로워 {a.followerCount})
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">→</span>
          <select
            value={targetActorId}
            onChange={(e) => setTargetActorId(e.target.value)}
            className="h-9 rounded-sm border border-outline bg-surface-variant px-3 text-xs"
          >
            <option value="">유지(병합 대상) 배우 선택</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                #{a.id} {a.name} (팔로워 {a.followerCount})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-9 rounded-sm border border-outline bg-surface px-4 text-xs font-semibold text-primary hover:bg-rose-mist"
          >
            병합 실행
          </button>
        </form>
      </section>
      {/* Home Banner Curations (FR-012) */}
      <section className="flex flex-col gap-3 rounded-lg border border-outline bg-surface p-6">
        <h2 className="text-base font-bold text-on-surface">홈 배너 큐레이션 ({curations.length})</h2>
        <div className="divide-y divide-outline rounded-md border border-outline">
          {curations.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <span className="mr-2 rounded-xs bg-surface-sunken px-1.5 py-0.5 text-[11px] font-semibold text-on-surface-variant">
                  {c.slotType} #{c.sortOrder}
                </span>
                <span className="font-semibold text-on-surface">{c.title}</span>
                <span className="ml-2 text-xs text-muted">{c.linkUrl}</span>
              </div>
              <button
                type="button"
                onClick={() => toggleCuration(c)}
                className={`h-8 rounded-xs border px-3 text-xs font-semibold ${
                  c.isActive
                    ? "border-secondary bg-rose-mist text-primary"
                    : "border-outline bg-surface text-muted"
                }`}
              >
                {c.isActive ? "노출 중" : "비활성"}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
