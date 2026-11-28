import { describe, expect, it } from "vitest";
import { calcKstDDay, formatKstDate, formatKstDateTime, isExpired, resolveDatePreset, startOfKstDayUtc } from "@/lib/kst";
import { calcDiscountRate, compareDealsForDisplay, summarizeLowestDeals } from "@/lib/pricing";
import {
  isPrivateOrInternalHost,
  normalizeExternalHttpsUrl,
  parseSafeExternalUrl,
  parseSafeServerFetchUrl,
  serializeSearchParams,
} from "@/lib/url";
import { AppError, jsonError } from "@/lib/errors";

describe("kst utilities", () => {
  it("evaluates expiry strictly at the KST boundary (17:59:59 active vs 18:00:00 expired)", () => {
    const expiresAt = "2026-11-25T09:00:00.000Z"; // 2026-11-25 18:00:00 KST
    expect(isExpired(expiresAt, new Date("2026-11-25T08:59:59.000Z"))).toBe(false);
    expect(isExpired(expiresAt, new Date("2026-11-25T09:00:00.000Z"))).toBe(true);
    expect(isExpired(null, new Date("2026-11-25T09:00:00.000Z"))).toBe(false);
  });

  it("computes KST date and daily reset UTC boundary across midnight", () => {
    const kstLateNight = new Date("2026-11-25T15:30:00.000Z"); // 2026-11-26 00:30 KST
    expect(formatKstDate(kstLateNight)).toBe("2026-11-26");
    expect(formatKstDateTime("2026-11-25T15:30:00.000Z")).toBe("11.26 00:30");
    expect(startOfKstDayUtc(kstLateNight)).toBe("2026-11-25T15:00:00.000Z");
  });

  it("calculates KST D-Day and weekend preset", () => {
    const wed = new Date("2026-11-25T03:00:00.000Z"); // 2026-11-25 Wed 12:00 KST
    expect(calcKstDDay("2026-11-25", wed)).toBe(0);
    expect(calcKstDDay("2026-11-27", wed)).toBe(2);
    expect(resolveDatePreset("THIS_WEEKEND", wed)).toEqual({
      dateFrom: "2026-11-28",
      dateTo: "2026-11-29",
    });
    expect(resolveDatePreset("THIS_MONTH", wed)).toEqual({
      dateFrom: "2026-11-01",
      dateTo: "2026-11-30",
    });
  });
});

describe("pricing utilities", () => {
  it("floors discount rate and rejects invalid or non-discounted prices", () => {
    expect(calcDiscountRate(70000, 38500)).toBe(45);
    expect(calcDiscountRate(100000, 66667)).toBe(33); // 33.333% -> 33
    expect(calcDiscountRate(50000, 50000)).toBeNull();
    expect(calcDiscountRate(50000, 60000)).toBeNull();
    expect(calcDiscountRate(null, 30000)).toBeNull();
  });

  it("sorts tied prices with unconditional deals first and separates summary", () => {
    const conditional = { salePrice: 40000, isUnconditional: 0, expiresAt: null, lastVerifiedAt: "2026-11-25T05:00:00Z" };
    const unconditional = { salePrice: 40000, isUnconditional: 1, expiresAt: "2026-12-01T00:00:00Z", lastVerifiedAt: "2026-11-25T01:00:00Z" };
    const cheaperLottery = { salePrice: 30000, isUnconditional: 0, expiresAt: null, lastVerifiedAt: "2026-11-25T01:00:00Z" };

    expect([conditional, unconditional].sort(compareDealsForDisplay)[0]).toBe(unconditional);

    const summary = summarizeLowestDeals([conditional, unconditional, cheaperLottery]);
    expect(summary.generalLowest).toBe(unconditional);
    expect(summary.conditionalLowest).toBe(cheaperLottery);
  });
});

describe("url & error utilities", () => {
  it("blocks unsafe schemes and whitespace in external URLs", () => {
    expect(parseSafeExternalUrl("https://www.l-ticket.co.kr/product/1")).toBe(
      "https://www.l-ticket.co.kr/product/1",
    );
    expect(parseSafeExternalUrl("http://example.com")).toBeNull();
    expect(parseSafeExternalUrl("http://example.com", { allowHttp: true })).toBe("http://example.com/");
    expect(parseSafeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(parseSafeExternalUrl("data:text/html,hi")).toBeNull();
    expect(parseSafeExternalUrl("https://evil.com/path with space")).toBeNull();
  });

  it("serializes 4-axis search params skipping empty values", () => {
    expect(
      serializeSearchParams({
        region: "DAEHAKRO",
        priceMax: 50000,
        conditionTags: ["MATINEE", "REWATCH"],
        q: "",
        unconditionalOnly: false,
      }),
    ).toBe("region=DAEHAKRO&priceMax=50000&conditionTags=MATINEE%2CREWATCH");
  });

  it("formats AppError into standard JSON response", async () => {
    const res = jsonError(new AppError("DAILY_REPORT_LIMIT_EXCEEDED", "일일 한도 초과"), "req-1");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: {
        code: "DAILY_REPORT_LIMIT_EXCEEDED",
        message: "일일 한도 초과",
        requestId: "req-1",
      },
    });
  });

  it("C-08: blocks SSRF host obfuscations, all IPv6 literals, non-443 ports, and reserved CIDRs", () => {
    // Trailing dots & consecutive dots
    expect(isPrivateOrInternalHost("localhost..")).toBe(true);
    expect(isPrivateOrInternalHost("127.0.0.1...")).toBe(true);
    expect(isPrivateOrInternalHost("example..com")).toBe(true);
    expect(isPrivateOrInternalHost(".example.com")).toBe(true);

    // All IPv6 literals blocked
    expect(isPrivateOrInternalHost("::1")).toBe(true);
    expect(isPrivateOrInternalHost("[2001:4860:4860::8888]")).toBe(true);
    expect(isPrivateOrInternalHost("2606:4700:4700::1111")).toBe(true);

    // Shorthand / non-standard dotted IPv4 & hex/octal
    expect(isPrivateOrInternalHost("127.1")).toBe(true);
    expect(isPrivateOrInternalHost("127.0.1")).toBe(true);
    expect(isPrivateOrInternalHost("0x7f.0.0.1")).toBe(true);
    expect(isPrivateOrInternalHost("0177.0.0.1")).toBe(true);

    // Reserved documentation / IETF ranges
    expect(isPrivateOrInternalHost("192.0.0.1")).toBe(true);
    expect(isPrivateOrInternalHost("192.0.2.10")).toBe(true);
    expect(isPrivateOrInternalHost("198.51.100.5")).toBe(true);
    expect(isPrivateOrInternalHost("203.0.113.9")).toBe(true);

    // Valid public host / IPv4 allowed
    expect(isPrivateOrInternalHost("www.kopis.or.kr")).toBe(false);
    expect(isPrivateOrInternalHost("8.8.8.8")).toBe(false);

    // parseSafeServerFetchUrl: non-443 ports & IPv6 & reserved CIDRs rejected
    expect(parseSafeServerFetchUrl("https://www.kopis.or.kr/upload/poster.jpg")).toBe(
      "https://www.kopis.or.kr/upload/poster.jpg",
    );
    expect(parseSafeServerFetchUrl("https://www.kopis.or.kr:443/upload/poster.jpg")).toBe(
      "https://www.kopis.or.kr/upload/poster.jpg",
    );
    expect(parseSafeServerFetchUrl("https://www.kopis.or.kr:8443/upload/poster.jpg")).toBeNull();
    expect(parseSafeServerFetchUrl("https://www.kopis.or.kr:8080/upload/poster.jpg")).toBeNull();
    expect(parseSafeServerFetchUrl("https://[2001:4860:4860::8888]/img.png")).toBeNull();
    expect(parseSafeServerFetchUrl("https://192.0.2.1/img.png")).toBeNull();
    expect(parseSafeServerFetchUrl("https://127.1/secret")).toBeNull();
  });

  it("C-08: blocks triple-slash and backslash inputs and verifies defaultOrigin in normalizeExternalHttpsUrl", () => {
    expect(normalizeExternalHttpsUrl("///evil.com/path")).toBeNull();
    expect(normalizeExternalHttpsUrl("/\\evil.com/path", "https://www.kopis.or.kr")).toBeNull();
    expect(normalizeExternalHttpsUrl("https://example.com\\@evil.com")).toBeNull();
    expect(normalizeExternalHttpsUrl("//cdn.interpark.com/poster.jpg")).toBe(
      "https://cdn.interpark.com/poster.jpg",
    );
    expect(normalizeExternalHttpsUrl("/upload/poster.jpg", "https://www.kopis.or.kr")).toBe(
      "https://www.kopis.or.kr/upload/poster.jpg",
    );
    expect(normalizeExternalHttpsUrl("/upload/poster.jpg", "http://www.kopis.or.kr")).toBeNull();
  });
});
