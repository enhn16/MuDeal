import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { normalizeExpiresAtToUtcIso } from "@/lib/kst";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { updateAdminDeal } from "@/server/modules/admin";

const OptionalExpiresAtSchema = z
  .string()
  .nullable()
  .optional()
  .refine(
    (v) => v === undefined || v === null || v.trim() === "" || normalizeExpiresAtToUtcIso(v) !== null,
    "유효한 마감 일시 형식을 입력해 주세요.",
  );

const PatchDealSchema = z.object({
  basePrice: z.number().int().nonnegative().nullable().optional(),
  salePrice: z.number().int().nonnegative().nullable().optional(),
  status: z.enum(["ACTIVE", "EXPIRED", "HIDDEN"]).optional(),
  adminLocked: z.boolean().optional(),
  conditionSummary: z.string().trim().max(300).nullable().optional(),
  expiresAt: OptionalExpiresAtSchema,
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRuntimeAdmin(req);
    const dealId = Number((await ctx.params).id);
    if (!Number.isInteger(dealId) || dealId <= 0) {
      throw new AppError("VALIDATION_ERROR", "유효하지 않은 딜 ID입니다.");
    }
    const parsed = PatchDealSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "수정값을 확인해 주세요.");
    const updated = await updateAdminDeal(getRuntimeDb(), admin.id, dealId, parsed.data);
    return Response.json({ data: updated });
  } catch (err) {
    return jsonError(err);
  }
}
