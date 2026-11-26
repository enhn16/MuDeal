import handler from "vinext/server/app-router-entry";
import { getDb } from "../src/db/client";
import type { CloudflareEnv } from "../src/env";
import { DEFAULT_CHANNEL_ADAPTERS, runChannelAdapter } from "../src/server/sync/channels";
import { expireEndedDeals } from "../src/server/sync/expiry";
import { syncKopisShows } from "../src/server/sync/kopis";
import { createGeminiVisionExtractor, processPendingOcrJobs } from "../src/server/sync/ocr";

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

    if (controller.cron === "*/15 * * * *") {
      await expireEndedDeals(db);
      return;
    }

    if (controller.cron === "0 16 * * *") {
      // 01:00 KST daily KOPIS sync (incremental & subrequest-bounded)
      await syncKopisShows(db, env.KOPIS_API_KEY);
      return;
    }

    // 0 */6 * * * low-frequency channel sync + Vision/OCR under daily cap
    for (const adapter of DEFAULT_CHANNEL_ADAPTERS) {
      await runChannelAdapter(db, adapter);
    }
    if (env.GEMINI_API_KEY) {
      await processPendingOcrJobs(db, {
        dailyLimit: Math.max(1, Number(env.OCR_DAILY_LIMIT || 100)),
        extractor: createGeminiVisionExtractor(env.GEMINI_API_KEY),
      });
    }
  },
};
