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
        results.push(await runChannelAdapter(db, adapter));
      }
      result = results;
    } else if (target === "OCR") {
      if (!cfEnv.GEMINI_API_KEY) {
        throw new AppError("VALIDATION_ERROR", "GEMINI_API_KEY가 설정되지 않아 OCR을 실행할 수 없습니다.");
      }
      const dailyLimit = Math.max(1, Number(cfEnv.OCR_DAILY_LIMIT || 100));
      const ocr = await processPendingOcrJobs(db, {
        dailyLimit,
        extractor: createGeminiVisionExtractor(cfEnv.GEMINI_API_KEY),
      });
      const synopses = await populateMissingSynopses(db, {
        extractor: createGeminiSynopsisExtractor(cfEnv.GEMINI_API_KEY),
        batchSize: 4,
      });
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
