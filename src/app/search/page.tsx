import type { Metadata } from "next";
import Link from "next/link";
import { getRuntimeDb } from "@/db/client";
import { CONDITION_TAGS, SUB_REGIONS, type ConditionTag, type DealType, type SubRegion } from "@/db/schema";
import { ShareLinkButton } from "@/components/DealActions";
import { SearchPresetsBar } from "@/components/PersonalButtons";
import { ShowCard } from "@/components/ShowCard";
import { CONDITION_TAG_LABELS, DEAL_TYPE_LABELS, SUB_REGION_LABELS, SUB_REGION_SHORT } from "@/lib/labels";
import { serializeSearchParams } from "@/lib/url";
import { getServerSession } from "@/server/modules/auth-runtime";
import { listSearchPresets } from "@/server/modules/personal";
import { parseShowSearchParams, searchShows, type ShowSearchQuery, type ShowSort } from "@/server/modules/shows";

export const dynamic = "force-dynamic";

type RawSearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: RawSearchParams }): Promise<Metadata> {
  const sp = await searchParams;
  const q = parseShowSearchParams(sp);
  const parts: string[] = [];
  if (q.q) parts.push(`"${q.q}"`);
  if (q.regions?.length) parts.push(q.regions.map((r) => SUB_REGION_SHORT[r]).join("·"));
  if (q.priceMax) parts.push(`${(q.priceMax / 10000).toLocaleString("ko-KR")}만원 이하`);
  if (q.dealType) parts.push(DEAL_TYPE_LABELS[q.dealType]);
  const summary = parts.length > 0 ? parts.join(" · ") : "전국 뮤지컬 할인·이벤트";

  return {
    title: `${summary} 검색 — MuDeal`,
    description: `${summary} 조건의 진행 중인 뮤지컬 할인·로터리·싱어롱·특전 비교 결과입니다.`,
    openGraph: {
      title: `${summary} — MuDeal 뮤지컬 할인 비교`,
      description: `날짜·작품/배우·가격대·지역 4축 필터로 찾는 뮤지컬 최저가`,
    },
  };
}

function buildHref(base: ShowSearchQuery, patch: Partial<ShowSearchQuery>): string {
  const next: ShowSearchQuery = { ...base, ...patch, page: 1 };
  const qs = serializeSearchParams({
    q: next.q,
    datePreset: next.datePreset,
    dateFrom: next.dateFrom,
    dateTo: next.dateTo,
    priceMin: next.priceMin,
    priceMax: next.priceMax,
    region: next.regions,
    dealType: next.dealType,
    seatGrade: next.seatGrade,
    unconditionalOnly: next.unconditionalOnly ? "1" : undefined,
    conditionTags: next.conditionTags,
    source: next.source,
    sort: next.sort,
  });
  return qs ? `/search?${qs}` : "/search";
}

function chipClass(active: boolean) {
  return `inline-flex h-8 items-center rounded-xs border px-3 text-[13px] font-semibold transition-colors ${
    active
      ? "border-secondary bg-rose-mist text-primary"
      : "border-outline bg-surface text-on-surface-variant hover:bg-surface-sunken"
  }`;
}

export default async function SearchPage({ searchParams }: { searchParams: RawSearchParams }) {
  const sp = await searchParams;
  const query = parseShowSearchParams(sp);
  const db = getRuntimeDb();
  const [result, session] = await Promise.all([searchShows(db, query), getServerSession()]);
  const presets = session ? await listSearchPresets(db, session.user.id) : [];

  const toggleRegion = (r: SubRegion) => {
    const cur = query.regions ?? [];
    const next = cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r];
    return buildHref(query, { regions: next.length ? next : undefined });
  };

  const toggleTag = (t: ConditionTag) => {
    const cur = query.conditionTags ?? [];
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
    return buildHref(query, { conditionTags: next.length ? next : undefined });
  };

  const quickDealTypes: Array<{ key: DealType; label: string }> = [
    { key: "LOTTERY", label: "로터리" },
    { key: "TIMESALE", label: "타임세일" },
    { key: "TICKET_OPEN", label: "티켓오픈" },
    { key: "SINGALONG", label: "싱어롱" },
    { key: "CURTAIN_CALL", label: "커튼콜" },
    { key: "PERK_GOODS", label: "굿즈·특전" },
  ];

  const pricePresets = [30000, 50000, 70000, 100000];
  const sortOptions: Array<{ key: ShowSort; label: string }> = [
    { key: "LOWEST_PRICE", label: "최저가순" },
    { key: "HIGHEST_DISCOUNT", label: "할인율순" },
    { key: "CLOSING_SOON", label: "마감임박순" },
    { key: "POPULAR", label: "인기순" },
  ];

  const hasFilters = Boolean(
    query.q ||
      query.datePreset ||
      query.dateFrom ||
      query.dateTo ||
      query.priceMin ||
      query.priceMax ||
      query.regions?.length ||
      query.dealType ||
      query.unconditionalOnly ||
      query.conditionTags?.length ||
      query.source,
  );

  return (
    <div className="pb-14">
      {/* 4-Axis Filter Panel */}
      <section className="border-b border-outline bg-surface-variant">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-6 lg:px-0">
          {/* Axis 1: 날짜 · 기간 */}
          <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-12">
            <span className="text-xs font-semibold text-on-surface md:col-span-2">날짜 · 기간</span>
            <div className="flex flex-wrap items-center gap-2 md:col-span-10">
              {(
                [
                  ["TODAY", "오늘"],
                  ["THIS_WEEKEND", "이번 주말"],
                  ["THIS_MONTH", "이번 달"],
                ] as const
              ).map(([preset, label]) => (
                <Link
                  key={preset}
                  href={buildHref(query, {
                    datePreset: query.datePreset === preset ? undefined : preset,
                    dateFrom: undefined,
                    dateTo: undefined,
                  })}
                  className={chipClass(query.datePreset === preset)}
                >
                  {label}
                </Link>
              ))}
              <form action="/search" method="get" className="inline-flex flex-wrap items-center gap-1.5">
                {query.q && <input type="hidden" name="q" value={query.q} />}
                {query.regions && <input type="hidden" name="region" value={query.regions.join(",")} />}
                {query.priceMax && <input type="hidden" name="priceMax" value={query.priceMax} />}
                <input
                  type="date"
                  name="dateFrom"
                  aria-label="관람 시작일"
                  defaultValue={query.dateFrom ?? ""}
                  className="h-8 rounded-md border border-outline bg-surface px-2 text-xs text-on-surface"
                />
                <span className="text-xs text-muted">~</span>
                <input
                  type="date"
                  name="dateTo"
                  aria-label="관람 종료일"
                  defaultValue={query.dateTo ?? ""}
                  className="h-8 rounded-md border border-outline bg-surface px-2 text-xs text-on-surface"
                />
                <button
                  type="submit"
                  className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-on-primary hover:bg-secondary"
                >
                  적용
                </button>
              </form>
            </div>
          </div>

          {/* Axis 2: 지역 (서울 · 대학로 별도 분리) */}
          <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-12">
            <span className="text-xs font-semibold text-on-surface md:col-span-2">지역</span>
            <div className="flex flex-wrap items-center gap-2 md:col-span-10">
              <Link
                href={buildHref(query, { regions: undefined })}
                className={chipClass(!query.regions?.length)}
              >
                전체
              </Link>
              {SUB_REGIONS.map((region) => (
                <Link
                  key={region}
                  href={toggleRegion(region)}
                  className={chipClass(Boolean(query.regions?.includes(region)))}
                >
                  {SUB_REGION_LABELS[region]}
                </Link>
              ))}
            </div>
          </div>

          {/* Axis 3: 가격대 */}
          <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-12">
            <span className="text-xs font-semibold text-on-surface md:col-span-2">가격대</span>
            <div className="flex flex-wrap items-center gap-2 md:col-span-10">
              <Link
                href={buildHref(query, { priceMin: undefined, priceMax: undefined })}
                className={chipClass(!query.priceMin && !query.priceMax)}
              >
                전체
              </Link>
              {pricePresets.map((max) => (
                <Link
                  key={max}
                  href={buildHref(query, {
                    priceMin: undefined,
                    priceMax: query.priceMax === max ? undefined : max,
                  })}
                  className={`${chipClass(query.priceMax === max)} tabular-nums`}
                >
                  {max / 10000}만원 이하
                </Link>
              ))}
            </div>
          </div>

          {/* Axis 4: 할인 · 조건부 세부 칩 */}
          <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-12">
            <span className="text-xs font-semibold text-on-surface md:col-span-2">할인 · 조건</span>
            <div className="flex flex-wrap items-center gap-2 md:col-span-10">
              <Link
                href={buildHref(query, { unconditionalOnly: !query.unconditionalOnly })}
                className={chipClass(Boolean(query.unconditionalOnly))}
              >
                무조건 할인만
              </Link>
              <Link
                href={buildHref(query, {
                  source: query.source === "USER_REPORT" ? undefined : "USER_REPORT",
                })}
                className={chipClass(query.source === "USER_REPORT")}
              >
                제보해주신 딜
              </Link>
              {quickDealTypes.map((dt) => (
                <Link
                  key={dt.key}
                  href={buildHref(query, {
                    dealType: query.dealType === dt.key ? undefined : dt.key,
                  })}
                  className={chipClass(query.dealType === dt.key)}
                >
                  {dt.label}
                </Link>
              ))}
              {CONDITION_TAGS.map((tag) => (
                <Link
                  key={tag}
                  href={toggleTag(tag)}
                  className={chipClass(Boolean(query.conditionTags?.includes(tag)))}
                >
                  {CONDITION_TAG_LABELS[tag]}
                </Link>
              ))}
            </div>
          </div>

          {/* Bottom Utility Row: Presets & Share */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-outline pt-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <SearchPresetsBar
                initialPresets={presets}
                currentParams={query as unknown as Record<string, unknown>}
                isLoggedIn={Boolean(session)}
              />
              {query.q && (
                <span className="rounded-md bg-rose-mist px-2.5 py-1 font-semibold text-primary">
                  검색어: {query.q}
                </span>
              )}
              {hasFilters && (
                <Link href="/search" className="underline hover:text-primary">
                  전체 초기화
                </Link>
              )}
            </div>
            <ShareLinkButton label="조건 링크 공유" />
          </div>
        </div>
      </section>

      {/* Results Header & Sort */}
      <section className="mx-auto max-w-[1100px] px-4 pt-7 lg:px-0">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-outline pb-4">
          <h1 className="text-lg font-bold text-on-surface tabular-nums lg:text-xl">
            검색 결과 {result.total}건
          </h1>

          <div className="flex flex-wrap items-center gap-1.5">
            {sortOptions.map((opt) => {
              const active = (query.sort ?? "LOWEST_PRICE") === opt.key;
              return (
                <Link
                  key={opt.key}
                  href={buildHref(query, { sort: opt.key })}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    active ? "bg-rose-mist text-primary" : "text-muted hover:text-on-surface"
                  }`}
                >
                  {opt.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Result Grid or Empty State */}
        {result.items.length === 0 ? (
          <div className="rounded-xl border border-outline bg-surface-variant px-6 py-14 text-center">
            <p className="text-base font-bold text-on-surface">
              현재 진행 중인 할인/이벤트가 없어요
            </p>
            <p className="mt-1.5 text-sm text-muted">
              조건을 조금 넓혀보거나, 알고 계신 할인·이벤트가 있다면 직접 제보해 주세요.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/search"
                className="inline-flex h-10 items-center rounded-lg border border-outline bg-surface px-4 text-sm font-semibold text-on-surface hover:bg-surface-sunken"
              >
                필터 초기화
              </Link>
              <Link
                href="/reports/new"
                className="inline-flex h-10 items-center rounded-lg bg-secondary px-4 text-sm font-semibold text-on-secondary shadow-cta hover:bg-secondary-hover"
              >
                없는 할인 제보하기
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-5">
            {result.items.map((show) => (
              <ShowCard key={show.id} show={show} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
