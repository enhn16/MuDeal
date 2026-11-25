import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { DEAL_TYPES, SEAT_GRADES } from "@/db/schema";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAuth } from "@/server/modules/auth-runtime";
import { submitDealReport } from "@/server/modules/reports";

const ReportSchema = z.object({
  showId: z.number().int().positive().nullable().optional(),
  reportedShowTitle: z.string().trim().min(1).max(120),
  channelName: z.string().trim().min(1).max(60),
  dealType: z.enum(DEAL_TYPES),
  seatGrade: z.enum(SEAT_GRADES).optional(),
  externalUrl: z.string().trim().min(8).max(1000),
  reportedPrice: z.number().int().nonnegative().nullable().optional(),
  reportedDiscountRate: z.number().int().min(1).max(99).nullable().optional(),
  isUnconditional: z.boolean().optional(),
  conditionNote: z.string().trim().max(300).nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  reporterNickname: z.string().trim().max(20).nullable().optional(),
  evidenceR2Key: z.string().trim().max(200).nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const parsed = ReportSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "필수 제보 항목을 확인해 주세요.", parsed.error.flatten());
    }
    const created = await submitDealReport(db, user, parsed.data);
    return Response.json({ data: created }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
