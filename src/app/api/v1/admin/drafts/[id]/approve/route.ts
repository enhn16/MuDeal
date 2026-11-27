import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { DEAL_TYPES, SEAT_GRADES } from "@/db/schema";
import { AppError, jsonError } from "@/lib/errors";
import { normalizeExpiresAtToUtcIso } from "@/lib/kst";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { approveDraftDeal } from "@/server/modules/reports";

const OptionalExpiresAtSchema = z
  .string()
  .nullable()
  .optional()
  .refine(
    (v) => v === undefined || v === null || v.trim() === "" || normalizeExpiresAtToUtcIso(v) !== null,
    "유효한 마감 일시 형식을 입력해 주세요.",
  );

const ApproveDraftSchema = z.object({
  showId: z.number().int().positive().optional(),
  dealType: z.enum(DEAL_TYPES).optional(),
  seatGrade: z.enum(SEAT_GRADES).optional(),
  salePrice: z.number().int().nonnegative().nullable().optional(),
  discountRate: z.number().int().min(1).max(99).nullable().optional(),
  conditionSummary: z.string().trim().max(300).nullable().optional(),
  expiresAt: OptionalExpiresAtSchema,
  perkSummary: z.string().trim().max(300).nullable().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRuntimeAdmin(req);
    const dealId = Number((await ctx.params).id);
    if (!Number.isInteger(dealId) || dealId <= 0) {
      throw new AppError("VALIDATION_ERROR", "유효하지 않은 초안 ID입니다.");
    }
    const parsed = ApproveDraftSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "입력값을 확인해 주세요.");
    const data = await approveDraftDeal(getRuntimeDb(), admin.id, dealId, parsed.data);
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
