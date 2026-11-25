import { eq } from "drizzle-orm";
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
    const updated = await db
      .update(ocrImageJobs)
      .set({ ocrStatus: "QUEUED", errorMessage: null, updatedAt: new Date().toISOString() })
      .where(eq(ocrImageJobs.id, jobId))
      .returning({ id: ocrImageJobs.id });

    if (updated.length === 0) throw new AppError("NOT_FOUND", "OCR 작업을 찾을 수 없습니다.");
    await writeAuditLog(db, admin.id, "OCR_JOB_RETRIED", "ocr_image_job", jobId);
    return Response.json({ data: { retriedJobId: jobId } });
  } catch (err) {
    return jsonError(err);
  }
}
