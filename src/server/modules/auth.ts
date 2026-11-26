import { and, eq, gt, isNull } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { users, userSessions } from "@/db/schema";
import type { CloudflareEnv } from "@/env";
import { AppError } from "@/lib/errors";
import { randomTokenHex, sha256Hex, signJwt, verifyJwt } from "@/lib/jwt";

export const ACCESS_COOKIE = "md_access";
export const REFRESH_COOKIE = "md_refresh";
export const STATE_COOKIE = "md_oauth_state";
export const PENDING_COOKIE = "md_pending_signup";

export const ACCESS_TTL_SEC = 30 * 60; // 30m (BP-AUTH-002-1)
export const REFRESH_TTL_SEC = 14 * 24 * 60 * 60; // 14d

export type OAuthProvider = "KAKAO" | "GOOGLE";

export interface AuthUser {
  id: number;
  nickname: string;
  email: string | null;
  role: "USER" | "ADMIN";
  oauthProvider: OAuthProvider;
}

export interface PendingSignupPayload extends Record<string, unknown> {
  provider: OAuthProvider;
  subject: string;
  nickname: string;
  email: string | null;
  redirectUrl: string;
}

interface AccessPayload extends Record<string, unknown> {
  sub: number;
  role: "USER" | "ADMIN";
  nickname: string;
}

export function getJwtSecret(
  cfEnv?: Partial<CloudflareEnv>,
  opts: { allowDevFallback?: boolean } = {},
): string {
  if (cfEnv?.JWT_SECRET && cfEnv.JWT_SECRET.length >= 16) return cfEnv.JWT_SECRET;
  if (opts.allowDevFallback !== true) {
    throw new AppError("INTERNAL_ERROR", "서버 인증 시크릿(JWT_SECRET)이 설정되지 않았습니다.");
  }
  return "mudeal-local-dev-jwt-secret-change-in-prod";
}

export function isLocalhostOrigin(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

export function isLocalhostHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.trim().toLowerCase().replace(/:\d+$/, "");
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/** Prevent open redirects: allow only single-slash internal paths. */
export function sanitizeRedirectUrl(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return fallback;
  }
  return trimmed;
}

/** DD-001: auto-assign ADMIN if email is listed in ADMIN_OAUTH_EMAILS. */
export function shouldBootstrapAdmin(email: string | null | undefined, adminEmailsEnv?: string): boolean {
  if (!email || !adminEmailsEnv) return false;
  const target = email.trim().toLowerCase();
  return adminEmailsEnv
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(target);
}

/** Auto-assign ADMIN if Kakao user id (oauth_subject) is listed in ADMIN_KAKAO_IDS. */
export function isAdminKakaoId(subject: string | null | undefined, adminKakaoIdsEnv?: string): boolean {
  if (!subject || !adminKakaoIdsEnv) return false;
  const target = subject.trim();
  return adminKakaoIdsEnv
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(target);
}

export function parseCookieHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

export function buildSetCookie(
  name: string,
  value: string,
  opts: { maxAge: number; isSecure: boolean },
): string {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${opts.maxAge}`,
  ];
  if (opts.isSecure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearAuthCookies(headers: Headers, isSecure: boolean) {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, PENDING_COOKIE, STATE_COOKIE]) {
    headers.append("Set-Cookie", buildSetCookie(name, "", { maxAge: 0, isSecure }));
  }
}

export async function issueSessionCookies(
  db: AppDb,
  user: AuthUser,
  headers: Headers,
  opts: { secret: string; isSecure: boolean },
) {
  const accessToken = await signJwt<AccessPayload>(
    { sub: user.id, role: user.role, nickname: user.nickname },
    opts.secret,
    ACCESS_TTL_SEC,
  );
  const rawRefresh = randomTokenHex(32);
  const refreshHash = await sha256Hex(rawRefresh);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000).toISOString();

  await db.insert(userSessions).values({
    userId: user.id,
    refreshTokenHash: refreshHash,
    expiresAt,
  });

  headers.append(
    "Set-Cookie",
    buildSetCookie(ACCESS_COOKIE, accessToken, { maxAge: ACCESS_TTL_SEC, isSecure: opts.isSecure }),
  );
  headers.append(
    "Set-Cookie",
    buildSetCookie(REFRESH_COOKIE, rawRefresh, { maxAge: REFRESH_TTL_SEC, isSecure: opts.isSecure }),
  );
}

export async function rotateRefreshSession(
  db: AppDb,
  rawRefresh: string | undefined,
  headers: Headers,
  opts: { secret: string; isSecure: boolean },
): Promise<AuthUser> {
  if (!rawRefresh) throw new AppError("UNAUTHORIZED", "다시 로그인해 주세요.");
  const hash = await sha256Hex(rawRefresh);
  const nowIso = new Date().toISOString();

  const [session] = await db
    .select()
    .from(userSessions)
    .where(
      and(
        eq(userSessions.refreshTokenHash, hash),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, nowIso),
      ),
    )
    .limit(1);

  if (!session) throw new AppError("UNAUTHORIZED", "세션이 만료되었습니다. 다시 로그인해 주세요.");

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, session.userId), eq(users.status, "ACTIVE")))
    .limit(1);

  if (!user) throw new AppError("UNAUTHORIZED", "유효하지 않은 계정입니다.");

  await db
    .update(userSessions)
    .set({ revokedAt: nowIso })
    .where(eq(userSessions.id, session.id));

  const authUser: AuthUser = {
    id: user.id,
    nickname: user.nickname,
    email: user.email,
    role: user.role,
    oauthProvider: user.oauthProvider,
  };
  await issueSessionCookies(db, authUser, headers, opts);
  return authUser;
}

export async function revokeRefreshSession(db: AppDb, rawRefresh: string | undefined) {
  if (!rawRefresh) return;
  const hash = await sha256Hex(rawRefresh);
  await db
    .update(userSessions)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(userSessions.refreshTokenHash, hash), isNull(userSessions.revokedAt)));
}

export async function getOptionalAuthUser(
  db: AppDb,
  accessToken: string | undefined,
  secret: string,
): Promise<AuthUser | null> {
  if (!accessToken) return null;
  const payload = await verifyJwt<AccessPayload>(accessToken, secret);
  if (!payload || typeof payload.sub !== "number") return null;

  const [user] = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      email: users.email,
      role: users.role,
      oauthProvider: users.oauthProvider,
    })
    .from(users)
    .where(and(eq(users.id, payload.sub), eq(users.status, "ACTIVE")))
    .limit(1);

  return user ?? null;
}

export async function requireAuth(
  db: AppDb,
  req: Request,
  secret: string,
): Promise<AuthUser> {
  const bag = parseCookieHeader(req.headers.get("cookie"));
  const user = await getOptionalAuthUser(db, bag[ACCESS_COOKIE], secret);
  if (!user) throw new AppError("UNAUTHORIZED", "로그인이 필요합니다.");
  return user;
}

export async function requireAdmin(
  db: AppDb,
  req: Request,
  secret: string,
): Promise<AuthUser> {
  const user = await requireAuth(db, req, secret);
  if (user.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "관리자 권한이 필요합니다.");
  }
  return user;
}

export function normalizeProvider(raw: string): OAuthProvider {
  const upper = raw.toUpperCase();
  if (upper === "KAKAO" || upper === "GOOGLE") return upper;
  throw new AppError("VALIDATION_ERROR", "지원하지 않는 로그인 공급자입니다.");
}

export function buildOAuthAuthorizeUrl(
  provider: OAuthProvider,
  opts: { clientId: string; redirectUri: string; state: string },
): string {
  if (provider === "KAKAO") {
    const qs = new URLSearchParams({
      response_type: "code",
      client_id: opts.clientId,
      redirect_uri: opts.redirectUri,
      state: opts.state,
    });
    return `https://kauth.kakao.com/oauth/authorize?${qs.toString()}`;
  }
  const qs = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: "openid email profile",
    state: opts.state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs.toString()}`;
}

export async function exchangeOAuthProfile(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
  cfEnv: Partial<CloudflareEnv>,
): Promise<{ subject: string; nickname: string; email: string | null }> {
  if (provider === "KAKAO") {
    const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: cfEnv.KAKAO_CLIENT_ID ?? "",
        ...(cfEnv.KAKAO_CLIENT_SECRET ? { client_secret: cfEnv.KAKAO_CLIENT_SECRET } : {}),
        redirect_uri: redirectUri,
        code,
      }),
    });
    if (!tokenRes.ok) throw new AppError("UNAUTHORIZED", "카카오 인증 토큰 교환에 실패했습니다.");
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) throw new AppError("UNAUTHORIZED", "카카오 토큰이 누락되었습니다.");

    const meRes = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!meRes.ok) throw new AppError("UNAUTHORIZED", "카카오 프로필 조회에 실패했습니다.");
    const me = (await meRes.json()) as {
      id: number | string;
      kakao_account?: { email?: string; profile?: { nickname?: string } };
    };
    return {
      subject: String(me.id),
      nickname: me.kakao_account?.profile?.nickname?.trim() || "",
      email: me.kakao_account?.email ?? null,
    };
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cfEnv.GOOGLE_CLIENT_ID ?? "",
      client_secret: cfEnv.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      code,
    }),
  });
  if (!tokenRes.ok) throw new AppError("UNAUTHORIZED", "구글 인증 토큰 교환에 실패했습니다.");
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new AppError("UNAUTHORIZED", "구글 토큰이 누락되었습니다.");

  const meRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!meRes.ok) throw new AppError("UNAUTHORIZED", "구글 프로필 조회에 실패했습니다.");
  const me = (await meRes.json()) as { sub: string; name?: string; email?: string };
  return {
    subject: me.sub,
    nickname: me.name?.trim() || me.email?.split("@")[0] || "뮤지컬관객",
    email: me.email ?? null,
  };
}
