import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { users } from "@/db/schema";
import { AppError, jsonError } from "@/lib/errors";
import { verifyJwt } from "@/lib/jwt";
import {
  PENDING_COOKIE,
  buildSetCookie,
  canUseLocalDevAuth,
  getJwtSecret,
  isAdminKakaoId,
  isLocalhostOrigin,
  issueSessionCookies,
  parseCookieHeader,
  sanitizeRedirectUrl,
  shouldBootstrapAdmin,
  type AuthUser,
  type PendingSignupPayload,
} from "@/server/modules/auth";
import { getAuthEnv } from "@/server/modules/auth-runtime";

const BodySchema = z.object({
  agreedTerms: z.literal(true),
  agreedPrivacy: z.literal(true),
  nickname: z.string().trim().min(1).max(20).optional(),
});

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const cfEnv = getAuthEnv();
    const secret = getJwtSecret(cfEnv, {
      allowDevFallback: canUseLocalDevAuth(cfEnv, isLocalhostOrigin(url)),
    });
    const isSecure = url.protocol === "https:";
    const bag = parseCookieHeader(req.headers.get("cookie"));
    const pending = bag[PENDING_COOKIE]
      ? await verifyJwt<PendingSignupPayload>(bag[PENDING_COOKIE], secret)
      : null;

    if (!pending) {
      throw new AppError("UNAUTHORIZED", "가입 대기 세션이 만료되었습니다. 다시 로그인해 주세요.");
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "필수 약관에 모두 동의해 주세요.", parsed.error.flatten());
    }

    const db = getRuntimeDb();
    const nickname = parsed.data.nickname || pending.nickname || "뮤지컬관객";
    const isAdmin =
      shouldBootstrapAdmin(pending.email, cfEnv.ADMIN_OAUTH_EMAILS) ||
      (pending.provider === "KAKAO" && isAdminKakaoId(pending.subject, cfEnv.ADMIN_KAKAO_IDS));
    const role: "USER" | "ADMIN" = isAdmin ? "ADMIN" : "USER";
    const nowIso = new Date().toISOString();

    const inserted = await db
      .insert(users)
      .values({
        oauthProvider: pending.provider,
        oauthSubject: pending.subject,
        nickname,
        email: pending.email,
        role,
        status: "ACTIVE",
        termsAgreedAt: nowIso,
      })
      .onConflictDoNothing()
      .returning({ id: users.id });

    const created = inserted[0];
    if (!created) {
      const res = jsonError(
        new AppError("CONFLICT", "이미 가입이 완료된 계정입니다. 다시 로그인해 주세요."),
      );
      res.headers.append("Set-Cookie", buildSetCookie(PENDING_COOKIE, "", { maxAge: 0, isSecure }));
      return res;
    }

    const authUser: AuthUser = {
      id: created.id,
      nickname,
      email: pending.email,
      role,
      oauthProvider: pending.provider,
    };

    const headers = new Headers();
    headers.append("Set-Cookie", buildSetCookie(PENDING_COOKIE, "", { maxAge: 0, isSecure }));
    await issueSessionCookies(db, authUser, headers, { secret, isSecure });

    return Response.json(
      { data: { user: authUser, redirectUrl: sanitizeRedirectUrl(pending.redirectUrl, "/") } },
      { status: 201, headers },
    );
  } catch (err) {
    return jsonError(err);
  }
}
