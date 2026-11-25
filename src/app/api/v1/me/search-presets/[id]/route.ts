import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAuth } from "@/server/modules/auth-runtime";
import { deleteSearchPreset } from "@/server/modules/personal";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) throw new AppError("VALIDATION_ERROR", "유효하지 않은 프리셋 ID입니다.");
    const data = await deleteSearchPreset(db, user.id, id);
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
