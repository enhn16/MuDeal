import { jsonError, AppError } from "@/lib/errors";
import { randomTokenHex, signJwt } from "@/lib/jwt";
import {
  STATE_COOKIE,
  buildOAuthAuthorizeUrl,
  buildSetCookie,
  getJwtSecret,
  isLocalhostOrigin,
  normalizeProvider,
  sanitizeRedirectUrl,
} from "@/server/modules/auth";
import { getAuthEnv } from "@/server/modules/auth-runtime";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  try {
    const { provider: rawProvider } = await ctx.params;
    const provider = normalizeProvider(rawProvider);
    const url = new URL(req.url);
    const redirectUrl = sanitizeRedirectUrl(url.searchParams.get("redirectUrl"), "/");
    const devAs = url.searchParams.get("as");
    const cfEnv = getAuthEnv();
    const secret = getJwtSecret(cfEnv, { allowDevFallback: isLocalhostOrigin(url) });

    const state = randomTokenHex(16);
    const stateJwt = await signJwt({ state, redirectUrl, provider }, secret, 600);
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      buildSetCookie(STATE_COOKIE, stateJwt, { maxAge: 600, isSecure: url.protocol === "https:" }),
    );

    const clientId = provider === "KAKAO" ? cfEnv.KAKAO_CLIENT_ID : cfEnv.GOOGLE_CLIENT_ID;
    const callbackUrl = `${url.origin}/api/v1/auth/oauth/${rawProvider.toLowerCase()}/callback`;

    if (clientId) {
      headers.set("Location", buildOAuthAuthorizeUrl(provider, { clientId, redirectUri: callbackUrl, state }));
      return new Response(null, { status: 302, headers });
    }

    // shortcut: local-only dev OAuth bypass when KAKAO/GOOGLE client IDs are unset; blocked outside localhost
    if (isLocalhostOrigin(url)) {
      const qs = new URLSearchParams({ code: "dev", state });
      if (devAs) qs.set("as", devAs);
      headers.set("Location", `${callbackUrl}?${qs.toString()}`);
      return new Response(null, { status: 302, headers });
    }

    throw new AppError("INTERNAL_ERROR", "소셜 로그인 클라이언트 설정이 필요합니다.");
  } catch (err) {
    return jsonError(err);
  }
}
