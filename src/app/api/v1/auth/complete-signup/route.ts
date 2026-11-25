import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { users } from "@/db/schema";
import { AppError, jsonError } from "@/lib/errors";
import { verifyJwt } from "@/lib/jwt";
import {
  PENDING_COOKIE,
  buildSetCookie,
  getJwtSecret,
  issueSessionCookies,
  parseCookieHeader,
  sanitizeRedirectUrl,
  shouldBootstrapAdmin,
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
    const cfEnv = getAuthEnv();
    const secret = getJwtSecret(cfEnv);
    const isSecure = new URL(req.url).protocol === "https:";
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
    const role = shouldBootstrapAdmin(pending.email, cfEnv.ADMIN_OAUTH_EMAILS) ? "ADMIN" : "USER";
    const nowIso = new Date().toISOString();

    await db
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
      .onConflictDoNothing();

    const [created] = await db
      .select()
      .from(users)
      .where(and(eq(users.oauthProvider, pending.provider), eq(users.oauthSubject, pending.subject)))
      .limit(1);

    if (!created) throw new AppError("INTERNAL_ERROR", "계정 생성에 실패했습니다.");

    const authUser = {
      id: created.id,
      nickname: created.nickname,
      email: created.email,
      role: created.role,
      oauthProvider: created.oauthProvider,
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
