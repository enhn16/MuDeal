import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAuth } from "@/server/modules/auth-runtime";
import { toggleSaveNotification } from "@/server/modules/personal";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) throw new AppError("VALIDATION_ERROR", "유효하지 않은 소식 ID입니다.");
    const body = (await req.json().catch(() => ({}))) as { isSaved?: boolean };
    const data = await toggleSaveNotification(db, user.id, id, body.isSaved);
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
