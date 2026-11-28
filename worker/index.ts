import handler from "vinext/server/app-router-entry";
import { getDb } from "../src/db/client";
import type { CloudflareEnv } from "../src/env";
import { lTicketAdapter, nolAdapter, runChannelAdapter, yes24Adapter } from "../src/server/sync/channels";
import { expireEndedDeals } from "../src/server/sync/expiry";
import { redactSecrets, syncKopisShows } from "../src/server/sync/kopis";
import {
  createGeminiSynopsisExtractor,
  createGeminiVisionExtractor,
  parseDailyLimit,
  populateMissingSynopses,
  processPendingOcrJobs,
} from "../src/server/sync/ocr";
import { purgeExpiredRetentionData } from "../src/server/sync/retention";

const SECURITY_HEADERS: ReadonlyArray<[string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["X-Frame-Options", "DENY"],
];

const STATE_CHANGING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const DISALLOWED_CSRF_CONTENT_TYPES = [
  "text/plain",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

function jsonErrorResponse(
  status: number,
  code: "FORBIDDEN" | "VALIDATION_ERROR",
  message: string,
): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  for (const [k, v] of SECURITY_HEADERS) {
    headers.set(k, v);
  }
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers });
}

export function checkCsrfOrigin(request: Request): Response | null {
  if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) return null;
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/v1/")) return null;

  const secFetchSite = request.headers.get("Sec-Fetch-Site")?.trim().toLowerCase();
  if (secFetchSite === "cross-site") {
    return jsonErrorResponse(403, "FORBIDDEN", "허용되지 않은 교차 출처 요청입니다.");
  }

  const origin = request.headers.get("Origin")?.trim();
  if (origin && origin !== url.origin) {
    return jsonErrorResponse(403, "FORBIDDEN", "허용되지 않은 교차 출처 요청입니다.");
  }

  if (url.pathname !== "/api/v1/uploads/report-evidence") {
    const contentType = request.headers.get("Content-Type")?.trim().toLowerCase();
    if (contentType && DISALLOWED_CSRF_CONTENT_TYPES.some((ct) => contentType.startsWith(ct))) {
      return jsonErrorResponse(415, "VALIDATION_ERROR", "지원하지 않는 Content-Type입니다.");
    }
  }

  return null;
}

function formatCronError(err: unknown, env: CloudflareEnv): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactSecrets(raw, [
    env.KOPIS_API_KEY,
    env.GEMINI_API_KEY,
    env.JWT_SECRET,
    env.KAKAO_CLIENT_SECRET,
    env.GOOGLE_CLIENT_SECRET,
  ]);
}

export default {
  ...handler,
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const csrfBlocked = checkCsrfOrigin(request);
    if (csrfBlocked) return csrfBlocked;

    const response = await handler.fetch(
      request,
      env as Parameters<typeof handler.fetch>[1],
      ctx,
    );
    const headers = new Headers(response.headers);
    for (const [k, v] of SECURITY_HEADERS) {
      if (!headers.has(k)) headers.set(k, v);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
  async scheduled(controller: ScheduledController, env: CloudflareEnv) {
    const db = getDb(env.DB);

    // 1. Every 15m: expire ended deals & shows
    if (controller.cron === "*/15 * * * *") {
      try {
        await expireEndedDeals(db);
      } catch (err) {
        console.error("[cron:expiry] failed:", formatCronError(err, env));
      }
      return;
    }

    // 2. Daily 01:00 KST (16:00 UTC): KOPIS catalog sync + DB/R2 retention purge
    if (controller.cron === "0 16 * * *") {
      try {
        await syncKopisShows(db, env.KOPIS_API_KEY);
      } catch (err) {
        console.error("[cron:kopis] failed:", formatCronError(err, env));
      }
      try {
        await purgeExpiredRetentionData(db, new Date(), {
          evidenceBucket: env.EVIDENCE_BUCKET,
        });
      } catch (err) {
        console.error("[cron:retention] failed:", formatCronError(err, env));
      }
      return;
    }

    // 3. Every 6h (:10): NOL + L.TICKET (stays well within Workers Free 50-subrequest limit)
    if (controller.cron === "10 */6 * * *") {
      for (const adapter of [nolAdapter, lTicketAdapter]) {
        try {
          await runChannelAdapter(db, adapter);
        } catch (err) {
          console.error(`[cron:${adapter.sourceName}] failed:`, formatCronError(err, env));
        }
      }
      return;
    }

    // 4. Every 6h (:25): YES24 isolated sync
    if (controller.cron === "25 */6 * * *") {
      try {
        await runChannelAdapter(db, yes24Adapter);
      } catch (err) {
        console.error("[cron:YES24] failed:", formatCronError(err, env));
      }
      return;
    }

    // 5. Every 6h (:40): Vision OCR + missing synopsis extraction under shared daily cap
    if (controller.cron === "40 */6 * * *") {
      if (!env.GEMINI_API_KEY) return;
      const dailyLimit = parseDailyLimit(env.OCR_DAILY_LIMIT);
      let remainingLimit = 0;
      try {
        const ocrRes = await processPendingOcrJobs(db, {
          dailyLimit,
          extractor: createGeminiVisionExtractor(env.GEMINI_API_KEY),
        });
        remainingLimit = ocrRes.remainingDailyLimit;
      } catch (err) {
        console.error("[cron:ocr] failed:", formatCronError(err, env));
      }
      if (remainingLimit > 0) {
        try {
          await populateMissingSynopses(db, {
            extractor: createGeminiSynopsisExtractor(env.GEMINI_API_KEY),
            batchSize: 2,
            remainingDailyLimit: remainingLimit,
          });
        } catch (err) {
          console.error("[cron:synopsis] failed:", formatCronError(err, env));
        }
      }
      return;
    }

    console.warn(`[cron] unhandled schedule expression: ${controller.cron}`);
  },
};
