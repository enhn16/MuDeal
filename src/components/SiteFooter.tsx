import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-14 border-t border-outline bg-surface-variant lg:mt-[72px]">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-2 px-5 py-5 text-xs lg:px-0">
        <p className="text-muted">
          MuDeal · 외부 예매처 할인·특전·이벤트 비교 서비스 (자체 결제·발권 미제공 · KOPIS 공공데이터 활용)
        </p>
        <div className="flex items-center gap-4 text-muted">
          <Link href="/terms" className="hover:text-primary hover:underline">
            이용약관
          </Link>
          <Link href="/privacy" className="hover:text-primary hover:underline">
            개인정보처리방침
          </Link>
          <span className="text-hint">© 2026 MuDeal</span>
        </div>
      </div>
    </footer>
  );
}
