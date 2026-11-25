import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAuth } from "@/server/modules/auth-runtime";
import { addActorFollow, removeActorFollow } from "@/server/modules/personal";

function parseId(raw: string) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new AppError("VALIDATION_ERROR", "유효하지 않은 배우 ID입니다.");
  return n;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const data = await addActorFollow(db, user.id, parseId((await ctx.params).id));
    return Response.json({ data }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const data = await removeActorFollow(db, user.id, parseId((await ctx.params).id));
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
