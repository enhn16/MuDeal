import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { getAuthEnv } from "@/server/modules/auth-runtime";
import { hashSessionIdentity, recordOutboundClick } from "@/server/modules/deals";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const dealId = Number(id);
    if (!Number.isInteger(dealId) || dealId <= 0) {
      throw new AppError("VALIDATION_ERROR", "유효하지 않은 딜 ID입니다.");
    }
    const sessionHash = await hashSessionIdentity(req, getAuthEnv().JWT_SECRET);
    const data = await recordOutboundClick(getRuntimeDb(), dealId, sessionHash);
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
