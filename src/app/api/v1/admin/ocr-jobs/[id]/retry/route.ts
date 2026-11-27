import { and, eq, inArray } from "drizzle-orm";
import { getRuntimeDb } from "@/db/client";
import { ocrImageJobs } from "@/db/schema";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { writeAuditLog } from "@/server/modules/reports";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRuntimeAdmin(req);
    const jobId = Number((await ctx.params).id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      throw new AppError("VALIDATION_ERROR", "유효하지 않은 OCR 작업 ID입니다.");
    }
    const db = getRuntimeDb();
    const [existing] = await db
      .select({ id: ocrImageJobs.id, ocrStatus: ocrImageJobs.ocrStatus })
      .from(ocrImageJobs)
      .where(eq(ocrImageJobs.id, jobId))
      .limit(1);
    if (!existing) throw new AppError("NOT_FOUND", "OCR 작업을 찾을 수 없습니다.");

    const updated = await db
      .update(ocrImageJobs)
      .set({ ocrStatus: "QUEUED", errorMessage: null, updatedAt: new Date().toISOString() })
      .where(and(eq(ocrImageJobs.id, jobId), inArray(ocrImageJobs.ocrStatus, ["FAILED", "NEEDS_REVIEW"])))
      .returning({ id: ocrImageJobs.id });

    if (updated.length === 0) {
      throw new AppError("CONFLICT", "실패(FAILED) 또는 검토 필요(NEEDS_REVIEW) 상태의 작업만 재시도할 수 있습니다.");
    }
    await writeAuditLog(db, admin.id, "OCR_JOB_RETRIED", "ocr_image_job", jobId);
    return Response.json({ data: { retriedJobId: jobId } });
  } catch (err) {
    return jsonError(err);
  }
}
