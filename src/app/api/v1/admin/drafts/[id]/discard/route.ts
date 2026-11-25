import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { discardDraftDeal } from "@/server/modules/reports";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRuntimeAdmin(req);
    const dealId = Number((await ctx.params).id);
    if (!Number.isInteger(dealId) || dealId <= 0) {
      throw new AppError("VALIDATION_ERROR", "유효하지 않은 초안 ID입니다.");
    }
    const data = await discardDraftDeal(getRuntimeDb(), admin.id, dealId);
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
