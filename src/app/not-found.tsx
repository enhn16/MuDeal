import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center bg-surface-variant px-5 py-16">
      <section className="flex w-full max-w-md flex-col items-center gap-4 rounded-lg border border-outline bg-surface p-8 text-center">
        <span className="rounded-xs bg-rose-mist px-2.5 py-1 text-xs font-semibold text-primary">
          페이지를 찾을 수 없어요
        </span>
        <h1 className="text-xl font-bold text-on-surface">
          요청하신 공연이나 페이지가 없어요
        </h1>
        <p className="text-sm text-muted">
          주소가 바뀌었거나 공연 정보가 종료되었을 수 있어요. 홈이나 검색에서 다른 뮤지컬을
          찾아보세요.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2.5">
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-sm bg-secondary px-5 text-sm font-semibold text-on-secondary hover:bg-secondary-hover"
          >
            홈으로 가기
          </Link>
          <Link
            href="/search"
            className="inline-flex h-10 items-center rounded-sm border border-outline bg-surface px-4 text-sm font-semibold text-on-surface-variant hover:bg-surface-variant"
          >
            공연 검색하기
          </Link>
        </div>
      </section>
    </div>
  );
}
