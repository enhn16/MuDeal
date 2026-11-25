import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { rejectUserReport } from "@/server/modules/reports";

const RejectSchema = z.object({
  reasonCode: z.string().trim().max(40).optional(),
  reasonNote: z.string().trim().min(1).max(300),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRuntimeAdmin(req);
    const reportId = Number((await ctx.params).id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new AppError("VALIDATION_ERROR", "유효하지 않은 제보 ID입니다.");
    }
    const parsed = RejectSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "반려 사유를 반드시 입력해 주세요.");
    const data = await rejectUserReport(
      getRuntimeDb(),
      admin.id,
      reportId,
      parsed.data.reasonNote,
      parsed.data.reasonCode,
    );
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
