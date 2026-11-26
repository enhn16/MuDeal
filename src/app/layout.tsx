import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { getServerSession } from "@/server/modules/auth-runtime";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mudeal.kr"),
  title: "MuDeal — 전국 뮤지컬 할인·특전·싱어롱 비교",
  description:
    "전국 뮤지컬 티켓 할인, 로터리, 특전, 싱어롱·스페셜 커튼콜을 날짜·작품/배우·가격대·지역으로 한눈에 비교해요.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  return (
    <html lang="ko">
      <head>
        {/* shortcut: fonts & icons loaded via CDN; self-host subset WOFF2 before production launch */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@600;700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=block"
        />
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        <SiteHeader session={session} />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
