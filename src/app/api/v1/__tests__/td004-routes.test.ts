import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { signJwt } from "@/lib/jwt";
import { PENDING_COOKIE, STATE_COOKIE } from "@/server/modules/auth";

// Shared mocks for runtime DB / auth / env
const mockGetRuntimeDb = vi.fn();
const mockGetAuthEnv = vi.fn();
const mockRequireRuntimeAuth = vi.fn();
const mockRequireRuntimeAdmin = vi.fn();

vi.mock("@/db/client", () => ({
  getRuntimeDb: () => mockGetRuntimeDb(),
}));

vi.mock("@/server/modules/auth-runtime", () => ({
  getAuthEnv: () => mockGetAuthEnv(),
  requireRuntimeAuth: (req: Request) => mockRequireRuntimeAuth(req),
  requireRuntimeAdmin: (req: Request) => mockRequireRuntimeAdmin(req),
}));

const mockWithdrawUserAccount = vi.fn();
const mockGetNotificationsFeed = vi.fn();
const mockMarkNotificationsRead = vi.fn();
const mockWriteAuditLog = vi.fn();
const mockGetHomeData = vi.fn();
const mockSearchShows = vi.fn();
const mockGetShowDetail = vi.fn();
const mockRunChannelAdapter = vi.fn();
const mockProcessPendingOcrJobs = vi.fn();
const mockPopulateMissingSynopses = vi.fn();

vi.mock("@/server/modules/personal", () => ({
  withdrawUserAccount: (...args: unknown[]) => mockWithdrawUserAccount(...args),
  getNotificationsFeed: (...args: unknown[]) => mockGetNotificationsFeed(...args),
  markNotificationsRead: (...args: unknown[]) => mockMarkNotificationsRead(...args),
}));

vi.mock("@/server/modules/reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/modules/reports")>();
  return {
    ...actual,
    writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
  };
});

vi.mock("@/server/modules/shows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/modules/shows")>();
  return {
    ...actual,
    getHomeData: (...args: unknown[]) => mockGetHomeData(...args),
    searchShows: (...args: unknown[]) => mockSearchShows(...args),
    getShowDetail: (...args: unknown[]) => mockGetShowDetail(...args),
  };
});

vi.mock("@/server/sync/channels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/sync/channels")>();
  return {
    ...actual,
    DEFAULT_CHANNEL_ADAPTERS: [{ sourceName: "NOL" }],
    runChannelAdapter: (...args: unknown[]) => mockRunChannelAdapter(...args),
  };
});

vi.mock("@/server/sync/ocr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/sync/ocr")>();
  return {
    ...actual,
    processPendingOcrJobs: (...args: unknown[]) => mockProcessPendingOcrJobs(...args),
    populateMissingSynopses: (...args: unknown[]) => mockPopulateMissingSynopses(...args),
  };
});

import { GET as adminEvidenceGet } from "@/app/api/v1/admin/evidence/route";
import { POST as adminOcrRetryPost } from "@/app/api/v1/admin/ocr-jobs/[id]/retry/route";
import { POST as adminDealsPost } from "@/app/api/v1/admin/deals/route";
import { GET as adminIssuesGet } from "@/app/api/v1/admin/issues/route";
import { GET as adminReportsGet } from "@/app/api/v1/admin/reports/route";
import { GET as adminOcrJobsGet } from "@/app/api/v1/admin/ocr-jobs/route";
import { POST as adminSyncTriggerPost } from "@/app/api/v1/admin/sync/trigger/route";
import { GET as adminCurationsGet } from "@/app/api/v1/admin/curations/route";
import { POST as completeSignupPost } from "@/app/api/v1/auth/complete-signup/route";
import { GET as oauthStartGet } from "@/app/api/v1/auth/oauth/[provider]/route";
import { GET as oauthCallbackGet } from "@/app/api/v1/auth/oauth/[provider]/callback/route";
import { DELETE as meDelete } from "@/app/api/v1/me/route";
import { GET as meNotificationsGet, POST as meNotificationsPost } from "@/app/api/v1/me/notifications/route";
import { POST as uploadEvidencePost } from "@/app/api/v1/uploads/report-evidence/route";
import { GET as homeGet } from "@/app/api/v1/home/route";
import { GET as showsGet } from "@/app/api/v1/shows/route";
import { GET as showDetailGet } from "@/app/api/v1/shows/[id]/route";

describe("TD-003 & TD-004: route-level RBAC 403, withdrawal, R2 evidence, OCR retry, and Edge cache headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRuntimeDb.mockReturnValue({});
    mockGetAuthEnv.mockReturnValue({});
    mockWriteAuditLog.mockResolvedValue(undefined);
  });

  it("TC-SC-RBAC-001: returns 403 FORBIDDEN across admin endpoints when called by a regular USER session", async () => {
    mockRequireRuntimeAdmin.mockRejectedValue(new AppError("FORBIDDEN", "관리자 권한이 필요합니다."));

    const req = new Request("https://mudeal.example/api/v1/admin/reports");
    const responses = await Promise.all([
      adminReportsGet(req),
      adminDealsPost(new Request("https://mudeal.example/api/v1/admin/deals", { method: "POST", body: "{}" })),
      adminIssuesGet(req),
      adminOcrJobsGet(req),
      adminCurationsGet(req),
      adminEvidenceGet(new Request("https://mudeal.example/api/v1/admin/evidence?key=reports/1/a.png")),
      adminOcrRetryPost(req, { params: Promise.resolve({ id: "1" }) }),
      adminSyncTriggerPost(
        new Request("https://mudeal.example/api/v1/admin/sync/trigger", {
          method: "POST",
          body: JSON.stringify({ target: "EXPIRY" }),
        }),
      ),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("FORBIDDEN");
    }
  });

  it("TC-FN-MY-002: DELETE /api/v1/me withdraws account with R2 bucket cleanup and clears auth cookies", async () => {
    const fakeBucket = { delete: vi.fn() };
    mockRequireRuntimeAuth.mockResolvedValue({ id: 42, role: "USER", nickname: "테스트유저" });
    mockGetAuthEnv.mockReturnValue({ EVIDENCE_BUCKET: fakeBucket });
    mockWithdrawUserAccount.mockResolvedValue(undefined);

    const res = await meDelete(new Request("https://mudeal.example/api/v1/me", { method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { withdrawn: boolean } };
    expect(body.data.withdrawn).toBe(true);
    expect(mockWithdrawUserAccount).toHaveBeenCalledWith(expect.anything(), 42, expect.any(Date), {
      evidenceBucket: fakeBucket,
    });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("Max-Age=0");
  });

  it("TC-FN-ADM-001: serves R2 evidence image with sandbox CSP and allows FAILED OCR retry while blocking DONE retry (409)", async () => {
    mockRequireRuntimeAdmin.mockResolvedValue({ id: 1, role: "ADMIN" });

    // 1. R2 Evidence image rendering
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fakeBucket = {
      get: vi.fn(async (key: string) =>
        key === "reports/7/1700000000-abc.png"
          ? {
              body: pngBytes,
              httpMetadata: { contentType: "image/png" },
            }
          : null,
      ),
    };
    mockGetAuthEnv.mockReturnValue({ EVIDENCE_BUCKET: fakeBucket });

    const imgRes = await adminEvidenceGet(
      new Request("https://mudeal.example/api/v1/admin/evidence?key=reports/7/1700000000-abc.png"),
    );
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get("content-type")).toBe("image/png");
    expect(imgRes.headers.get("content-security-policy")).toContain("sandbox");
    expect(imgRes.headers.get("x-content-type-options")).toBe("nosniff");

    // 2. FAILED OCR retry -> 200 OK
    mockGetRuntimeDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: 88, ocrStatus: "FAILED" }],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [{ id: 88 }],
          }),
        }),
      }),
    });
    const retryOk = await adminOcrRetryPost(
      new Request("https://mudeal.example/api/v1/admin/ocr-jobs/88/retry", { method: "POST" }),
      { params: Promise.resolve({ id: "88" }) },
    );
    expect(retryOk.status).toBe(200);
    expect((await retryOk.json()) as unknown).toEqual({ data: { retriedJobId: 88 } });

    // 3. DONE OCR retry -> 409 CONFLICT
    mockGetRuntimeDb.mockReturnValue({
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [],
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: 89, ocrStatus: "DONE" }],
          }),
        }),
      }),
    });
    const retryConflict = await adminOcrRetryPost(
      new Request("https://mudeal.example/api/v1/admin/ocr-jobs/89/retry", { method: "POST" }),
      { params: Promise.resolve({ id: "89" }) },
    );
    expect(retryConflict.status).toBe(409);
    const conflictBody = (await retryConflict.json()) as { error: { code: string } };
    expect(conflictBody.error.code).toBe("CONFLICT");
  });

  it("TD-003: public read APIs (/home, /shows, /shows/[id]) emit Edge Cache-Control headers", async () => {
    mockGetHomeData.mockResolvedValue({ heroes: [], closingSoon: [] });
    mockSearchShows.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    mockGetShowDetail.mockResolvedValue({ show: { id: 1, title: "테스트" }, deals: [], events: [] });

    const r1 = await homeGet();
    const r2 = await showsGet(new Request("https://mudeal.example/api/v1/shows?q=테스트"));
    const r3 = await showDetailGet(new Request("https://mudeal.example/api/v1/shows/1"), {
      params: Promise.resolve({ id: "1" }),
    });

    for (const r of [r1, r2, r3]) {
      expect(r.status).toBe(200);
      const cc = r.headers.get("cache-control") ?? "";
      expect(cc).toContain("public");
      expect(cc).toContain("s-maxage=60");
    }
  });

  it("C-02: report-evidence rejects missing R2 bucket and oversized Content-Length BEFORE req.formData()", async () => {
    mockRequireRuntimeAuth.mockResolvedValue({ id: 2, role: "USER", nickname: "관객" });

    // 1. Missing EVIDENCE_BUCKET -> 400 VALIDATION_ERROR before formData()
    mockGetAuthEnv.mockReturnValue({});
    const reqNoBucket = new Request("https://mudeal.example/api/v1/uploads/report-evidence", {
      method: "POST",
    });
    const formDataSpy1 = vi.spyOn(reqNoBucket, "formData");
    const resNoBucket = await uploadEvidencePost(reqNoBucket);
    expect(resNoBucket.status).toBe(400);
    expect((await resNoBucket.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(formDataSpy1).not.toHaveBeenCalled();

    // 2. Oversized Content-Length -> 400 VALIDATION_ERROR before formData()
    mockGetAuthEnv.mockReturnValue({ EVIDENCE_BUCKET: { put: vi.fn() } });
    const reqTooLarge = new Request("https://mudeal.example/api/v1/uploads/report-evidence", {
      method: "POST",
      headers: { "content-length": String(5 * 1024 * 1024 + 65_537) },
    });
    const formDataSpy2 = vi.spyOn(reqTooLarge, "formData");
    const resTooLarge = await uploadEvidencePost(reqTooLarge);
    expect(resTooLarge.status).toBe(400);
    expect((await resTooLarge.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(formDataSpy2).not.toHaveBeenCalled();
  });

  it("C-03: complete-signup returns 409 CONFLICT and expires only PENDING_COOKIE without issuing session on duplicate replay", async () => {
    const jwtSecret = "prod-secret-key-with-plenty-of-entropy";
    mockGetAuthEnv.mockReturnValue({ JWT_SECRET: jwtSecret });
    mockGetRuntimeDb.mockReturnValue({
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => [],
          }),
        }),
      }),
    });

    const pendingToken = await signJwt(
      {
        provider: "KAKAO",
        subject: "dup-subject-1",
        nickname: "중복관객",
        email: "dup@mudeal.kr",
        redirectUrl: "/my",
      },
      jwtSecret,
      600,
    );

    const res = await completeSignupPost(
      new Request("https://mudeal.example/api/v1/auth/complete-signup", {
        method: "POST",
        headers: {
          cookie: `${PENDING_COOKIE}=${pendingToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ agreedTerms: true, agreedPrivacy: true }),
      }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "CONFLICT" },
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${PENDING_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).not.toContain("md_access=");
    expect(setCookie).not.toContain("md_refresh=");
  });

  it("C-05: GET /me/notifications is strictly read-only and POST /me/notifications marks validated IDs read", async () => {
    mockRequireRuntimeAuth.mockResolvedValue({ id: 7, role: "USER", nickname: "관객" });
    mockGetNotificationsFeed.mockResolvedValue({ stories: [], totalUnread: 2, items: [] });
    mockMarkNotificationsRead.mockResolvedValue({ markedCount: 2, unreadCount: 0 });

    const getRes = await meNotificationsGet(
      new Request("https://mudeal.example/api/v1/me/notifications?mode=unread&autoMarkRead=true"),
    );
    expect(getRes.status).toBe(200);
    expect(mockGetNotificationsFeed).toHaveBeenCalledWith(expect.anything(), 7, {
      mode: "unread",
      actorId: undefined,
      showId: undefined,
    });

    // Invalid POST bodies -> 400
    const badEmpty = await meNotificationsPost(
      new Request("https://mudeal.example/api/v1/me/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [] }),
      }),
    );
    expect(badEmpty.status).toBe(400);

    const badTooMany = await meNotificationsPost(
      new Request("https://mudeal.example/api/v1/me/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: Array.from({ length: 101 }, (_, i) => i + 1) }),
      }),
    );
    expect(badTooMany.status).toBe(400);

    // Valid POST body -> 200
    const okPost = await meNotificationsPost(
      new Request("https://mudeal.example/api/v1/me/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [10, 11] }),
      }),
    );
    expect(okPost.status).toBe(200);
    expect(mockMarkNotificationsRead).toHaveBeenCalledWith(expect.anything(), 7, [10, 11]);
    expect((await okPost.json()) as unknown).toEqual({ data: { markedCount: 2, unreadCount: 0 } });
  });

  it("C-06: blocks localhost dev OAuth without ALLOW_LOCAL_DEV_AUTH=true and stops auto-promoting GOOGLE to admin", async () => {
    const jwtSecret = "test-secret-for-oauth-c06-checks";

    // 1. Start route on localhost without ALLOW_LOCAL_DEV_AUTH=true -> does not redirect to code=dev
    mockGetAuthEnv.mockReturnValue({ JWT_SECRET: jwtSecret });
    const blockedStart = await oauthStartGet(
      new Request("http://localhost:5173/api/v1/auth/oauth/google"),
      { params: Promise.resolve({ provider: "google" }) },
    );
    expect(blockedStart.status).toBe(500);

    // 2. Callback on localhost without ALLOW_LOCAL_DEV_AUTH=true -> 401 UNAUTHORIZED
    const stateJwt = await signJwt({ state: "st-1", redirectUrl: "/", provider: "GOOGLE" }, jwtSecret, 600);
    const blockedCb = await oauthCallbackGet(
      new Request("http://localhost:5173/api/v1/auth/oauth/google/callback?code=dev&state=st-1", {
        headers: { cookie: `${STATE_COOKIE}=${stateJwt}` },
      }),
      { params: Promise.resolve({ provider: "google" }) },
    );
    expect(blockedCb.status).toBe(401);

    // 3. Callback on localhost WITH ALLOW_LOCAL_DEV_AUTH=true and provider=GOOGLE without as=admin -> dev-user-001 (NOT dev-admin-001)
    mockGetAuthEnv.mockReturnValue({ JWT_SECRET: jwtSecret, ALLOW_LOCAL_DEV_AUTH: "true" });
    mockGetRuntimeDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    });

    const googleDefaultCb = await oauthCallbackGet(
      new Request("http://localhost:5173/api/v1/auth/oauth/google/callback?code=dev&state=st-1", {
        headers: { cookie: `${STATE_COOKIE}=${stateJwt}` },
      }),
      { params: Promise.resolve({ provider: "google" }) },
    );
    expect(googleDefaultCb.status).toBe(302);
    const pendingCookieMatch = (googleDefaultCb.headers.get("set-cookie") ?? "").match(
      new RegExp(`${PENDING_COOKIE}=([^;]+)`),
    );
    expect(pendingCookieMatch).toBeTruthy();
    const pendingPayloadB64 = decodeURIComponent(pendingCookieMatch![1]).split(".")[1];
    const pendingPayload = JSON.parse(
      Buffer.from(pendingPayloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { subject: string };
    expect(pendingPayload.subject).toBe("dev-user-001");
  });

  it("C-10: masks query secrets and KOPIS/GEMINI API keys in sync trigger errors and audit logs", async () => {
    mockRequireRuntimeAdmin.mockResolvedValue({ id: 1, role: "ADMIN" });
    mockGetAuthEnv.mockReturnValue({
      KOPIS_API_KEY: "KOPIS_RAW_SECRET_999",
      GEMINI_API_KEY: "GEMINI_RAW_SECRET_888",
      OCR_DAILY_LIMIT: "10",
    });

    mockRunChannelAdapter.mockRejectedValue(
      new Error(
        "Fetch failed https://api.example.com?service=KOPIS_RAW_SECRET_999&key=abc123&api_key=xyz&token=tok9&secret=sec7 raw=GEMINI_RAW_SECRET_888",
      ),
    );

    const chRes = await adminSyncTriggerPost(
      new Request("https://mudeal.example/api/v1/admin/sync/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "CHANNELS" }),
      }),
    );
    expect(chRes.status).toBe(200);
    const chJson = JSON.stringify(await chRes.json());
    expect(chJson).not.toContain("KOPIS_RAW_SECRET_999");
    expect(chJson).not.toContain("GEMINI_RAW_SECRET_888");
    expect(chJson).not.toContain("abc123");
    expect(chJson).not.toContain("tok9");
    expect(chJson).not.toContain("sec7");
    expect(chJson).toContain("[REDACTED]");

    const auditPayload = JSON.stringify(mockWriteAuditLog.mock.calls[0]?.[5]);
    expect(auditPayload).not.toContain("KOPIS_RAW_SECRET_999");
    expect(auditPayload).not.toContain("GEMINI_RAW_SECRET_888");
    expect(auditPayload).not.toContain("abc123");
    expect(auditPayload).toContain("[REDACTED]");

    // Also verify OCR catch masking
    mockProcessPendingOcrJobs.mockRejectedValue(
      new Error("Gemini error https://generativelanguage.googleapis.com/v1?key=GEMINI_RAW_SECRET_888"),
    );
    mockPopulateMissingSynopses.mockRejectedValue(
      new Error("Synopsis failed with key GEMINI_RAW_SECRET_888"),
    );

    const ocrRes = await adminSyncTriggerPost(
      new Request("https://mudeal.example/api/v1/admin/sync/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "OCR" }),
      }),
    );
    expect(ocrRes.status).toBe(200);
    const ocrJson = JSON.stringify(await ocrRes.json());
    expect(ocrJson).not.toContain("GEMINI_RAW_SECRET_888");
    expect(ocrJson).toContain("[REDACTED]");
  });
});
