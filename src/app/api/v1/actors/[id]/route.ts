import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { getActorDetail } from "@/server/modules/shows";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const actorId = Number(id);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      throw new AppError("VALIDATION_ERROR", "유효하지 않은 배우 ID입니다.");
    }
    const data = await getActorDetail(getRuntimeDb(), actorId);
    if (!data) throw new AppError("NOT_FOUND", "해당 배우를 찾을 수 없습니다.");
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
