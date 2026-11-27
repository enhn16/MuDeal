import Link from "next/link";
import { getRuntimeDb } from "@/db/client";
import { CommunityDealCard } from "@/components/CommunityDealCard";
import { HomeDealFilterGrid } from "@/components/HomeDealFilterGrid";
import { ShowCard } from "@/components/ShowCard";
import { getHomeData } from "@/server/modules/shows";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await getHomeData(getRuntimeDb());

  return (
    <div className="pb-14">
      {/* 1. 3-Column Square Hero Spotlight */}
      {data.heroes.length > 0 && (
        <section className="mx-auto max-w-[1100px] px-5 pt-7 lg:px-0">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {data.heroes.map((hero, idx) => (
              <Link
                key={hero.id}
                href={hero.linkUrl}
                className={`group relative flex aspect-[16/10] flex-col justify-end overflow-hidden rounded-lg p-5 text-on-curtain-noir md:aspect-square ${
                  idx === 1 ? "bg-mulberry" : "bg-curtain-noir"
                }`}
              >
                {hero.imageUrl && (
                  <img
                    src={hero.imageUrl}
                    alt={hero.title}
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                )}
                <div className="hero-scrim absolute inset-0" />
                <div className="relative z-10 flex flex-col gap-1 drop-shadow-[0_1px_6px_rgba(31,23,25,0.65)]">
                  {hero.eyebrow && (
                    <span className="text-xs font-semibold tracking-wider text-gold-soft uppercase">
                      {hero.eyebrow}
                    </span>
                  )}
                  <h2 className="text-xl font-bold leading-snug text-white text-balance">{hero.title}</h2>
                  {hero.subtitle && <p className="text-[13px] text-white/90">{hero.subtitle}</p>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 2. 카테고리별 뮤지컬 (할인 / 특전 / 싱어롱·스페셜 커튼콜) */}
      <section id="categories" className="mx-auto max-w-[1100px] px-5 pt-14 lg:px-0">
        <h1 className="mb-3 text-xl font-semibold text-on-surface">
          혜택별로 뮤지컬 둘러보기
        </h1>
        <HomeDealFilterGrid shows={data.shows} />
      </section>

      {/* 3. 마감임박 특가 */}
      <section className="mx-auto max-w-[1100px] px-5 pt-[72px] lg:px-0">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-on-surface">마감임박 특가</h2>
          <Link
            href="/search?sort=CLOSING_SOON"
            className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-on-surface-variant hover:text-primary"
          >
            <span>전체보기</span>
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              chevron_right
            </span>
          </Link>
        </div>

        {data.closingSoon.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-lg border border-outline bg-surface-variant px-6 py-10 text-center">
            <p className="text-[15px] font-semibold text-on-surface">
              지금 마감 임박인 특가가 없어요
            </p>
            <p className="text-[13px] text-muted">
              전체 할인·특전 검색에서 진행 중인 모든 뮤지컬 혜택을 확인해 보세요.
            </p>
            <Link
              href="/search"
              className="mt-1 inline-flex h-10 items-center rounded-sm border border-outline bg-surface px-4 text-xs font-semibold text-primary hover:bg-rose-mist"
            >
              전체 혜택 보러 가기
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 items-stretch gap-5 sm:grid-cols-3 lg:grid-cols-5">
            {data.closingSoon.slice(0, 5).map((show) => (
              <ShowCard key={show.id} show={show} />
            ))}
          </div>
        )}
      </section>

      {/* 4. 관객들이 제보해주신 딜 (항상 노출) */}
      <section id="community-deals" className="mx-auto max-w-[1100px] px-5 pt-[72px] lg:px-0">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold text-on-surface">관객들이 제보해주신 딜</h2>
          <div className="flex items-center gap-4">
            <Link
              href="/search?source=USER_REPORT"
              className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-on-surface-variant hover:text-primary"
            >
              <span>전체보기</span>
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                chevron_right
              </span>
            </Link>
            <Link
              href="/reports/new"
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:text-secondary"
            >
              <span>할인 제보하기</span>
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                add
              </span>
            </Link>
          </div>
        </div>

        {data.communityDeals.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-lg border border-outline bg-surface-variant px-6 py-10 text-center">
            <p className="text-[15px] font-semibold text-on-surface">
              아직 등록된 관객 제보 딜이 없어요
            </p>
            <p className="text-[13px] text-muted">
              알고 계신 타임세일·로터리·싱어롱·특전 소식을 제보해 주시면 검수 후 닉네임과 함께 올라가요.
            </p>
            <Link
              href="/reports/new"
              className="mt-2 inline-flex h-10 items-center gap-1 rounded-sm bg-secondary px-5 text-sm font-semibold text-on-secondary shadow-cta hover:bg-secondary-hover"
            >
              <span>첫 번째 할인 제보하기</span>
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                arrow_forward
              </span>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {data.communityDeals.slice(0, 3).map((deal) => (
              <CommunityDealCard key={deal.dealId} deal={deal} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
