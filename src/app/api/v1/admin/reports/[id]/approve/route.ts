import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { DEAL_TYPES, SEAT_GRADES } from "@/db/schema";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { approveUserReport } from "@/server/modules/reports";

const ApproveSchema = z.object({
  showId: z.number().int().positive(),
  channelName: z.string().trim().min(1).max(60).optional(),
  dealType: z.enum(DEAL_TYPES).optional(),
  seatGrade: z.enum(SEAT_GRADES).optional(),
  basePrice: z.number().int().nonnegative().nullable().optional(),
  salePrice: z.number().int().nonnegative().nullable().optional(),
  discountRate: z.number().int().min(1).max(99).nullable().optional(),
  isUnconditional: z.boolean().optional(),
  conditionSummary: z.string().trim().max(300).nullable().optional(),
  maskNickname: z.boolean().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRuntimeAdmin(req);
    const reportId = Number((await ctx.params).id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new AppError("VALIDATION_ERROR", "유효하지 않은 제보 ID입니다.");
    }
    const parsed = ApproveSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "매핑 작품 및 보정값을 확인해 주세요.", parsed.error.flatten());
    }
    const data = await approveUserReport(getRuntimeDb(), admin.id, reportId, parsed.data);
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
