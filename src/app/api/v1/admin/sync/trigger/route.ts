import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { getAuthEnv, requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { writeAuditLog } from "@/server/modules/reports";
import { DEFAULT_CHANNEL_ADAPTERS, runChannelAdapter } from "@/server/sync/channels";
import { expireEndedDeals } from "@/server/sync/expiry";
import { syncKopisShows } from "@/server/sync/kopis";
import {
  createGeminiSynopsisExtractor,
  createGeminiVisionExtractor,
  parseDailyLimit,
  populateMissingSynopses,
  processPendingOcrJobs,
} from "@/server/sync/ocr";

const TriggerSchema = z.object({
  target: z.enum(["KOPIS", "CHANNELS", "OCR", "EXPIRY"]).default("KOPIS"),
});

export async function POST(req: Request) {
  try {
    const admin = await requireRuntimeAdmin(req);
    const parsed = TriggerSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "유효하지 않은 동기화 대상입니다.");

    const db = getRuntimeDb();
    const cfEnv = getAuthEnv();
    const { target } = parsed.data;
    let result: unknown;

    if (target === "KOPIS") {
      result = await syncKopisShows(db, cfEnv.KOPIS_API_KEY);
    } else if (target === "CHANNELS") {
      const results = [];
      for (const adapter of DEFAULT_CHANNEL_ADAPTERS) {
        try {
          results.push(await runChannelAdapter(db, adapter));
        } catch (err) {
          results.push({
            sourceName: adapter.sourceName,
            status: "FAILED",
            fetchedCount: 0,
            publishedCount: 0,
            draftCount: 0,
            alert: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      result = results;
    } else if (target === "OCR") {
      if (!cfEnv.GEMINI_API_KEY) {
        throw new AppError("VALIDATION_ERROR", "GEMINI_API_KEY가 설정되지 않아 OCR을 실행할 수 없습니다.");
      }
      const dailyLimit = parseDailyLimit(cfEnv.OCR_DAILY_LIMIT);
      let ocr:
        | { processed: number; draftsCreated: number; skippedByLimit: boolean; remainingDailyLimit: number }
        | { error: string; remainingDailyLimit: number };
      try {
        ocr = await processPendingOcrJobs(db, {
          dailyLimit,
          extractor: createGeminiVisionExtractor(cfEnv.GEMINI_API_KEY),
        });
      } catch (err) {
        ocr = {
          error: err instanceof Error ? err.message : String(err),
          remainingDailyLimit: 0,
        };
      }

      let synopses: { checked: number; populated: number } | { error: string };
      try {
        synopses = await populateMissingSynopses(db, {
          extractor: createGeminiSynopsisExtractor(cfEnv.GEMINI_API_KEY),
          batchSize: 2,
          remainingDailyLimit: ocr.remainingDailyLimit,
        });
      } catch (err) {
        synopses = { error: err instanceof Error ? err.message : String(err) };
      }

      result = { ocr, synopses };
    } else {
      result = await expireEndedDeals(db);
    }

    await writeAuditLog(db, admin.id, `SYNC_TRIGGER_${target}`, "sync", target, result);
    return Response.json({ data: { target, result } });
  } catch (err) {
    return jsonError(err);
  }
}
