import { afterEach, describe, expect, it, vi } from "vitest";
import { signJwt, verifyJwt } from "@/lib/jwt";
import { AppError } from "@/lib/errors";
import {
  ACCESS_COOKIE,
  exchangeOAuthProfile,
  getJwtSecret,
  isAdminKakaoId,
  isLocalhostHost,
  parseCookieHeader,
  requireAdmin,
  requireAuth,
  rotateRefreshSession,
  sanitizeRedirectUrl,
  shouldBootstrapAdmin,
} from "@/server/modules/auth";

const SECRET = "test-secret-with-enough-entropy-12345";

function makeMockDb(user: { id: number; nickname: string; email: string | null; role: "USER" | "ADMIN"; oauthProvider: "KAKAO" | "GOOGLE" } | null) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (user ? [user] : []),
        }),
      }),
    }),
  } as unknown as Parameters<typeof requireAuth>[0];
}

describe("JWT Web Crypto helper", () => {
  it("signs and verifies HS256 token and rejects tampered or expired tokens", async () => {
    const now = 1_700_000_000;
    const token = await signJwt({ sub: 7, role: "USER" }, SECRET, 1800, now);
    const verified = await verifyJwt<{ sub: number; role: string }>(token, SECRET, now + 10);
    expect(verified?.sub).toBe(7);

    // Tampered signature
    expect(await verifyJwt(`${token.slice(0, -2)}aa`, SECRET, now + 10)).toBeNull();
    // Expired
    expect(await verifyJwt(token, SECRET, now + 1800)).toBeNull();
    // alg: none attack
    const fakeNone = `${btoa(JSON.stringify({ alg: "none" }))}.${token.split(".")[1]}.`;
    expect(await verifyJwt(fakeNone, SECRET, now + 10)).toBeNull();
  });
});

describe("Auth & RBAC guards", () => {
  it("sanitizes redirect URLs against open redirects", () => {
    expect(sanitizeRedirectUrl("/shows/1?tab=vip")).toBe("/shows/1?tab=vip");
    expect(sanitizeRedirectUrl("https://evil.com")).toBe("/");
    expect(sanitizeRedirectUrl("//evil.com/phish")).toBe("/");
    expect(sanitizeRedirectUrl("javascript:alert(1)")).toBe("/");
  });

  it("matches ADMIN_OAUTH_EMAILS and ADMIN_KAKAO_IDS", () => {
    expect(shouldBootstrapAdmin("Admin@MuDeal.kr", "boss@a.com, admin@mudeal.kr")).toBe(true);
    expect(shouldBootstrapAdmin("user@mudeal.kr", "admin@mudeal.kr")).toBe(false);
    expect(isAdminKakaoId("3847291042", "111, 3847291042")).toBe(true);
    expect(isAdminKakaoId("999", "111, 3847291042")).toBe(false);
  });

  it("fails fast by default when JWT_SECRET is missing outside localhost", () => {
    expect(() => getJwtSecret({})).toThrowError(AppError);
    expect(() => getJwtSecret({}, { allowDevFallback: false })).toThrowError(AppError);
    expect(() => getJwtSecret({ JWT_SECRET: "short" }, { allowDevFallback: false })).toThrowError(AppError);
    expect(getJwtSecret({ JWT_SECRET: SECRET }, { allowDevFallback: false })).toBe(SECRET);
    expect(getJwtSecret({}, { allowDevFallback: true })).toBeTruthy();

    expect(isLocalhostHost("localhost:5173")).toBe(true);
    expect(isLocalhostHost("127.0.0.1:8787")).toBe(true);
    expect(isLocalhostHost("mudeal.kr")).toBe(false);
    expect(isLocalhostHost("localhost.evil.com")).toBe(false);
    expect(isLocalhostHost(null)).toBe(false);
  });

  it("blocks unauthenticated with 401 and non-admin with 403", async () => {
    const reqNoCookie = new Request("http://localhost/api/v1/admin/reports");
    await expect(requireAuth(makeMockDb(null), reqNoCookie, SECRET)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    } satisfies Partial<AppError>);

    const userToken = await signJwt({ sub: 2, role: "USER", nickname: "관객" }, SECRET, 1800);
    const reqUser = new Request("http://localhost/api/v1/admin/reports", {
      headers: { cookie: `${ACCESS_COOKIE}=${userToken}` },
    });
    const normalDb = makeMockDb({ id: 2, nickname: "관객", email: "u@a.com", role: "USER", oauthProvider: "KAKAO" });
    expect((await requireAuth(normalDb, reqUser, SECRET)).id).toBe(2);
    await expect(requireAdmin(normalDb, reqUser, SECRET)).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    } satisfies Partial<AppError>);

    const adminToken = await signJwt({ sub: 1, role: "ADMIN", nickname: "운영자" }, SECRET, 1800);
    const reqAdmin = new Request("http://localhost/api/v1/admin/reports", {
      headers: { cookie: `${ACCESS_COOKIE}=${adminToken}` },
    });
    const adminDb = makeMockDb({ id: 1, nickname: "운영자", email: "a@a.com", role: "ADMIN", oauthProvider: "GOOGLE" });
    expect((await requireAdmin(adminDb, reqAdmin, SECRET)).role).toBe("ADMIN");
  });

  it("parses malformed percent-encoded cookies without throwing URIError", () => {
    const parsed = parseCookieHeader("broken=%E0%A4%A; md_access=valid-token; empty=");
    expect(parsed.broken).toBe("%E0%A4%A");
    expect(parsed.md_access).toBe("valid-token");
  });

  it("detects refresh token reuse or concurrent rotation race and revokes all user sessions", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    let selectStep = 0;
    const raceDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              selectStep += 1;
              if (selectStep === 1) {
                return [
                  {
                    id: 10,
                    userId: 7,
                    refreshTokenHash: "h",
                    expiresAt: "2099-01-01T00:00:00.000Z",
                    revokedAt: null,
                  },
                ];
              }
              return [{ id: 7, nickname: "관객", email: "u@a.com", role: "USER", status: "ACTIVE", oauthProvider: "KAKAO" }];
            },
          }),
        }),
      }),
      update: () => ({
        set: (vals: Record<string, unknown>) => {
          updateCalls.push(vals);
          return {
            where: () => ({
              // First update (atomic claim) returns [] -> lost race!
              returning: async () => [],
              then: (resolve: (v: unknown) => void) => resolve(undefined),
            }),
          };
        },
      }),
    } as unknown as Parameters<typeof rotateRefreshSession>[0];

    await expect(
      rotateRefreshSession(raceDb, "raw-refresh", new Headers(), { secret: SECRET, isSecure: true }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    // 1st update attempted claim, 2nd update revoked all active sessions for userId=7
    expect(updateCalls.length).toBe(2);
  });
});

describe("OAuth verified email enforcement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores unverified Kakao and Google emails so they cannot bootstrap ADMIN", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: "tk" }))
        .mockResolvedValueOnce(
          Response.json({
            id: 12345,
            kakao_account: {
              email: "admin@mudeal.kr",
              is_email_verified: false,
              is_email_valid: true,
              profile: { nickname: "테스터" },
            },
          }),
        )
        .mockResolvedValueOnce(Response.json({ access_token: "gt" }))
        .mockResolvedValueOnce(
          Response.json({
            sub: "g-1",
            name: "구글유저",
            email: "admin@mudeal.kr",
            email_verified: false,
          }),
        )
        .mockResolvedValueOnce(Response.json({ access_token: "gt2" }))
        .mockResolvedValueOnce(
          Response.json({
            sub: "g-2",
            name: "검증관리자",
            email: "admin@mudeal.kr",
            email_verified: true,
          }),
        ),
    );

    const kakaoUnverified = await exchangeOAuthProfile("KAKAO", "c", "https://mudeal.kr/cb", {
      KAKAO_CLIENT_ID: "id",
    });
    expect(kakaoUnverified.email).toBeNull();

    const googleUnverified = await exchangeOAuthProfile("GOOGLE", "c", "https://mudeal.kr/cb", {
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "sec",
    });
    expect(googleUnverified.email).toBeNull();

    const googleVerified = await exchangeOAuthProfile("GOOGLE", "c", "https://mudeal.kr/cb", {
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "sec",
    });
    expect(googleVerified.email).toBe("admin@mudeal.kr");
  });
});
