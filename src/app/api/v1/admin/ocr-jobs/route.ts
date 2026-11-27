import { and, desc, gte, sql } from "drizzle-orm";
import { getRuntimeDb } from "@/db/client";
import { ocrImageJobs } from "@/db/schema";
import { jsonError } from "@/lib/errors";
import { startOfKstDayUtc } from "@/lib/kst";
import { getAuthEnv, requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { parseDailyLimit } from "@/server/sync/ocr";

export async function GET(req: Request) {
  try {
    await requireRuntimeAdmin(req);
    const db = getRuntimeDb();
    const kstStart = startOfKstDayUtc();
    const [items, [doneToday]] = await Promise.all([
      db.select().from(ocrImageJobs).orderBy(desc(ocrImageJobs.updatedAt)).limit(40),
      db
        .select({ count: sql<number>`count(*)` })
        .from(ocrImageJobs)
        .where(
          and(
            gte(ocrImageJobs.updatedAt, kstStart),
            sql`${ocrImageJobs.ocrStatus} IN ('DONE', 'NEEDS_REVIEW', 'FAILED')`,
            sql`(${ocrImageJobs.extractedJson} IS NULL OR ${ocrImageJobs.extractedJson} NOT LIKE '%"skippedDuplicate":true%')`,
          ),
        ),
    ]);

    return Response.json({
      data: {
        items,
        todayProcessed: Number(doneToday?.count ?? 0),
        dailyLimit: parseDailyLimit(getAuthEnv().OCR_DAILY_LIMIT),
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
