import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";

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
const mockWriteAuditLog = vi.fn();
const mockGetHomeData = vi.fn();
const mockSearchShows = vi.fn();
const mockGetShowDetail = vi.fn();

vi.mock("@/server/modules/personal", () => ({
  withdrawUserAccount: (...args: unknown[]) => mockWithdrawUserAccount(...args),
}));

vi.mock("@/server/modules/reports", () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}));

vi.mock("@/server/modules/shows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/modules/shows")>();
  return {
    ...actual,
    getHomeData: (...args: unknown[]) => mockGetHomeData(...args),
    searchShows: (...args: unknown[]) => mockSearchShows(...args),
    getShowDetail: (...args: unknown[]) => mockGetShowDetail(...args),
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
import { DELETE as meDelete } from "@/app/api/v1/me/route";
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
});
