import handler from "vinext/server/app-router-entry";
import { getDb } from "../src/db/client";
import type { CloudflareEnv } from "../src/env";
import { lTicketAdapter, nolAdapter, runChannelAdapter, yes24Adapter } from "../src/server/sync/channels";
import { expireEndedDeals } from "../src/server/sync/expiry";
import { syncKopisShows } from "../src/server/sync/kopis";
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

export default {
  ...handler,
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
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
        console.error("[cron:expiry] failed:", err);
      }
      return;
    }

    // 2. Daily 01:00 KST (16:00 UTC): KOPIS catalog sync + DB/R2 retention purge
    if (controller.cron === "0 16 * * *") {
      try {
        await syncKopisShows(db, env.KOPIS_API_KEY);
      } catch (err) {
        console.error("[cron:kopis] failed:", err);
      }
      try {
        await purgeExpiredRetentionData(db, new Date(), {
          evidenceBucket: env.EVIDENCE_BUCKET,
        });
      } catch (err) {
        console.error("[cron:retention] failed:", err);
      }
      return;
    }

    // 3. Every 6h (:10): NOL + L.TICKET (stays well within Workers Free 50-subrequest limit)
    if (controller.cron === "10 */6 * * *") {
      for (const adapter of [nolAdapter, lTicketAdapter]) {
        try {
          await runChannelAdapter(db, adapter);
        } catch (err) {
          console.error(`[cron:${adapter.sourceName}] failed:`, err);
        }
      }
      return;
    }

    // 4. Every 6h (:25): YES24 isolated sync
    if (controller.cron === "25 */6 * * *") {
      try {
        await runChannelAdapter(db, yes24Adapter);
      } catch (err) {
        console.error("[cron:YES24] failed:", err);
      }
      return;
    }

    // 5. Every 6h (:40): Vision OCR + missing synopsis extraction under shared daily cap
    if (controller.cron === "40 */6 * * *") {
      if (!env.GEMINI_API_KEY) return;
      const dailyLimit = parseDailyLimit(env.OCR_DAILY_LIMIT);
      let remainingLimit = dailyLimit;
      try {
        const ocrRes = await processPendingOcrJobs(db, {
          dailyLimit,
          extractor: createGeminiVisionExtractor(env.GEMINI_API_KEY),
        });
        remainingLimit = ocrRes.remainingDailyLimit;
      } catch (err) {
        console.error("[cron:ocr] failed:", err);
      }
      if (remainingLimit > 0) {
        try {
          await populateMissingSynopses(db, {
            extractor: createGeminiSynopsisExtractor(env.GEMINI_API_KEY),
            batchSize: 2,
            remainingDailyLimit: remainingLimit,
          });
        } catch (err) {
          console.error("[cron:synopsis] failed:", err);
        }
      }
      return;
    }

    console.warn(`[cron] unhandled schedule expression: ${controller.cron}`);
  },
};
