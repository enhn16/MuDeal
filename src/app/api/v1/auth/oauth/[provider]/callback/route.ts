import { and, eq } from "drizzle-orm";
import { getRuntimeDb } from "@/db/client";
import { users } from "@/db/schema";
import { AppError, jsonError } from "@/lib/errors";
import { signJwt, verifyJwt } from "@/lib/jwt";
import {
  PENDING_COOKIE,
  STATE_COOKIE,
  buildSetCookie,
  exchangeOAuthProfile,
  getJwtSecret,
  isAdminKakaoId,
  isLocalhostOrigin,
  issueSessionCookies,
  normalizeProvider,
  parseCookieHeader,
  sanitizeRedirectUrl,
  type OAuthProvider,
  type PendingSignupPayload,
} from "@/server/modules/auth";
import { getAuthEnv } from "@/server/modules/auth-runtime";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  try {
    const { provider: rawProvider } = await ctx.params;
    const provider = normalizeProvider(rawProvider);
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      throw new AppError("VALIDATION_ERROR", "OAuth 인증 파라미터가 누락되었습니다.");
    }

    const cfEnv = getAuthEnv();
    const secret = getJwtSecret(cfEnv, { allowDevFallback: isLocalhostOrigin(url) });
    const isSecure = url.protocol === "https:";
    const bag = parseCookieHeader(req.headers.get("cookie"));
    const statePayload = bag[STATE_COOKIE]
      ? await verifyJwt<{ state: string; redirectUrl: string; provider: OAuthProvider }>(
          bag[STATE_COOKIE],
          secret,
        )
      : null;

    if (!statePayload || statePayload.state !== state || statePayload.provider !== provider) {
      throw new AppError("UNAUTHORIZED", "인증 상태(state) 검증에 실패했습니다.");
    }

    const redirectUrl = sanitizeRedirectUrl(statePayload.redirectUrl, "/");
    const clientId = provider === "KAKAO" ? cfEnv.KAKAO_CLIENT_ID : cfEnv.GOOGLE_CLIENT_ID;

    let profile: { subject: string; nickname: string; email: string | null };
    if (clientId) {
      const callbackUrl = `${url.origin}/api/v1/auth/oauth/${rawProvider.toLowerCase()}/callback`;
      profile = await exchangeOAuthProfile(provider, code, callbackUrl, cfEnv);
    } else if (isLocalhostOrigin(url) && code === "dev") {
      const devAs = url.searchParams.get("as");
      if (devAs === "admin" || (provider === "GOOGLE" && devAs !== "new")) {
        profile = { subject: "dev-admin-001", nickname: "MuDeal운영", email: "admin@mudeal.local" };
      } else if (devAs === "new") {
        profile = { subject: `dev-new-${Date.now()}`, nickname: "신규관객", email: "new@mudeal.local" };
      } else {
        profile = { subject: "dev-user-001", nickname: "대학로산책", email: "walker@mudeal.local" };
      }
    } else {
      throw new AppError("UNAUTHORIZED", "유효하지 않은 OAuth 콜백 요청입니다.");
    }

    const db = getRuntimeDb();
    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.oauthProvider, provider), eq(users.oauthSubject, profile.subject)))
      .limit(1);

    const headers = new Headers();
    headers.append("Set-Cookie", buildSetCookie(STATE_COOKIE, "", { maxAge: 0, isSecure }));

    if (existing) {
      if (existing.status !== "ACTIVE") {
        throw new AppError("FORBIDDEN", "이용이 제한되거나 탈퇴한 계정입니다.");
      }
      let role = existing.role;
      if (
        role !== "ADMIN" &&
        provider === "KAKAO" &&
        isAdminKakaoId(profile.subject, cfEnv.ADMIN_KAKAO_IDS)
      ) {
        role = "ADMIN";
        await db
          .update(users)
          .set({ role: "ADMIN", updatedAt: new Date().toISOString() })
          .where(eq(users.id, existing.id));
      }
      await issueSessionCookies(
        db,
        {
          id: existing.id,
          nickname: existing.nickname,
          email: existing.email,
          role,
          oauthProvider: existing.oauthProvider,
        },
        headers,
        { secret, isSecure },
      );
      headers.set("Location", `${url.origin}${redirectUrl}`);
      return new Response(null, { status: 302, headers });
    }

    const pendingJwt = await signJwt<PendingSignupPayload>(
      {
        provider,
        subject: profile.subject,
        nickname: profile.nickname,
        email: profile.email,
        redirectUrl,
      },
      secret,
      600,
    );
    headers.append("Set-Cookie", buildSetCookie(PENDING_COOKIE, pendingJwt, { maxAge: 600, isSecure }));
    headers.set("Location", `${url.origin}/login?step=terms`);
    return new Response(null, { status: 302, headers });
  } catch (err) {
    return jsonError(err);
  }
}
