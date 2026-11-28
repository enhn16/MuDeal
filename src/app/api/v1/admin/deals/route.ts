import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { DEAL_TYPES, SEAT_GRADES } from "@/db/schema";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { createAdminDeal } from "@/server/modules/admin";
import { OptionalExpiresAtSchema } from "@/server/modules/reports";

const CreateDealSchema = z.object({
  showId: z.number().int().positive(),
  channelName: z.string().trim().min(1).max(60),
  dealType: z.enum(DEAL_TYPES),
  seatGrade: z.enum(SEAT_GRADES).default("ALL"),
  basePrice: z.number().int().nonnegative().nullable().optional(),
  salePrice: z.number().int().nonnegative().nullable().optional(),
  isUnconditional: z.boolean().default(true),
  conditionSummary: z.string().trim().max(300).nullable().optional(),
  perkSummary: z.string().trim().max(300).nullable().optional(),
  eventDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(31).nullable().optional(),
  externalUrl: z.string().trim().min(8).max(1000),
  expiresAt: OptionalExpiresAtSchema,
  adminLocked: z.boolean().default(true),
});

export async function POST(req: Request) {
  try {
    const admin = await requireRuntimeAdmin(req);
    const parsed = CreateDealSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "딜 등록 입력값을 확인해 주세요.", parsed.error.flatten());
    }
    const created = await createAdminDeal(getRuntimeDb(), admin.id, parsed.data);
    return Response.json({ data: created }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
