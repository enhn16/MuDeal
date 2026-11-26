import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "개인정보처리방침 — MuDeal",
};

export default function PrivacyPage() {
  return (
    <div className="bg-surface-variant py-10">
      <article className="mx-auto flex max-w-3xl flex-col gap-6 rounded-lg border border-outline bg-surface p-8 text-sm leading-relaxed text-body">
        <header className="border-b border-outline pb-4">
          <h1 className="text-2xl font-bold text-on-surface">개인정보처리방침</h1>
          <p className="mt-1 text-xs text-muted">시행일: 2026년 11월 26일</p>
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold text-on-surface">1. 수집하는 개인정보 항목</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>카카오 소셜 로그인 연동 시: 카카오 회원 고유 식별자(ID)만 전달받아요. (프로필·이메일·전화번호 등 별도 항목을 요구하지 않아요.)</li>
            <li>회원가입 시 직접 입력 항목: 서비스 내 표시 닉네임</li>
            <li>서비스 이용 중 생성 정보: 작품 찜, 배우 팔로우, 내 캘린더 일정, 검색 프리셋, 제보 내용</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold text-on-surface">2. 이용 목적 및 보유 기간</h2>
          <p>
            수집한 정보는 회원 식별, 개인화 기능(찜·팔로우·캘린더·알림) 제공, 제보 검수 및 스팸
            방지 목적으로만 이용해요. 회원 탈퇴 시 개인화 데이터와 세션은 즉시 파기해요.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold text-on-surface">3. 이용자의 권리</h2>
          <p>
            회원은 마이페이지에서 닉네임을 직접 수정하거나, 마이페이지 최하단 &apos;회원 탈퇴&apos;를
            통해 언제든지 개인정보 삭제 및 이용계약 해지를 요청할 수 있어요.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold text-on-surface">4. 보안 조치 및 위탁 인프라</h2>
          <p>
            서비스 데이터는 Cloudflare Workers · D1 · R2 인프라에 안전하게 저장되며, 로그인 세션은
            HttpOnly 보안 쿠키로 보호해요.
          </p>
        </section>

        <footer className="flex items-center justify-between border-t border-outline pt-4 text-xs text-muted">
          <Link href="/terms" className="font-semibold text-primary hover:underline">
            서비스 이용약관 보기
          </Link>
          <Link href="/" className="hover:underline">
            홈으로 돌아가기
          </Link>
        </footer>
      </article>
    </div>
  );
}
