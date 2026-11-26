import { describe, expect, it } from "vitest";
import { signJwt, verifyJwt } from "@/lib/jwt";
import { AppError } from "@/lib/errors";
import {
  ACCESS_COOKIE,
  getJwtSecret,
  isAdminKakaoId,
  isLocalhostHost,
  requireAdmin,
  requireAuth,
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
});
