import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "이용약관 — MuDeal",
};

export default function TermsPage() {
  return (
    <div className="bg-surface-variant py-10">
      <article className="mx-auto flex max-w-3xl flex-col gap-6 rounded-lg border border-outline bg-surface p-8 text-sm leading-relaxed text-body">
        <header className="border-b border-outline pb-4">
          <h1 className="text-2xl font-bold text-on-surface">서비스 이용약관</h1>
          <p className="mt-1 text-xs text-muted">시행일: 2026년 11월 26일</p>
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold text-on-surface">제1조 (서비스 성격 및 면책)</h2>
          <p>
            MuDeal은 전국 뮤지컬 티켓의 할인, 특전, 싱어롱·스페셜 커튼콜 정보를 비교해 보여주는 정보
            안내 서비스예요. MuDeal은 자체 결제·예매·발권·환불을 제공하지 않으며, 실제 가격과
            잔여 좌석, 할인 적용 조건은 이동한 외부 예매처 기준으로 최종 적용돼요.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold text-on-surface">제2조 (회원가입 및 개인화 기능)</h2>
          <p>
            비로그인 상태에서도 공연 할인 비교와 검색을 이용할 수 있어요. 카카오 로그인을 통해
            가입하면 작품 찜, 뮤지컬 배우 팔로우, 내 캘린더, 검색 프리셋, 할인·이벤트 제보와 오류
            신고 기능을 이용할 수 있어요.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold text-on-surface">제3조 (제보 및 커뮤니티 운영)</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>할인·특전·이벤트 제보는 확인 가능한 공식 예매처 주소(https://)를 함께 제출해야 해요.</li>
            <li>허위·스팸·악성 링크 제보는 사전 통보 없이 반려되거나 이용이 제한될 수 있어요.</li>
            <li>제보 승인에 따른 금전적 보상은 제공하지 않으며, 제보 닉네임과 도움 수로 기여를 표시해요.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold text-on-surface">제4조 (회원 탈퇴)</h2>
          <p>
            회원은 언제든지 마이페이지 최하단의 &apos;회원 탈퇴&apos;에서 직접 탈퇴할 수 있어요.
            탈퇴 시 개인화 데이터는 즉시 삭제되며, 이미 공개된 제보 딜의 닉네임은 &apos;익명의
            관객&apos;으로 비식별화돼요.
          </p>
        </section>

        <footer className="flex items-center justify-between border-t border-outline pt-4 text-xs text-muted">
          <Link href="/privacy" className="font-semibold text-primary hover:underline">
            개인정보처리방침 보기
          </Link>
          <Link href="/" className="hover:underline">
            홈으로 돌아가기
          </Link>
        </footer>
      </article>
    </div>
  );
}
