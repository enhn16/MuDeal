import { eq } from "drizzle-orm";
import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { homeCurations } from "@/db/schema";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { writeAuditLog } from "@/server/modules/reports";

const PatchCurationSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  subtitle: z.string().trim().max(120).nullable().optional(),
  linkUrl: z.string().trim().min(1).max(300).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

function parseId(raw: string) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new AppError("VALIDATION_ERROR", "유효하지 않은 큐레이션 ID입니다.");
  return n;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRuntimeAdmin(req);
    const id = parseId((await ctx.params).id);
    const parsed = PatchCurationSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "수정값을 확인해 주세요.");
    const db = getRuntimeDb();
    const updated = await db
      .update(homeCurations)
      .set({
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.subtitle !== undefined ? { subtitle: parsed.data.subtitle } : {}),
        ...(parsed.data.linkUrl !== undefined ? { linkUrl: parsed.data.linkUrl } : {}),
        ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive ? 1 : 0 } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(homeCurations.id, id))
      .returning();

    if (updated.length === 0) throw new AppError("NOT_FOUND", "큐레이션을 찾을 수 없습니다.");
    await writeAuditLog(db, admin.id, "CURATION_UPDATED", "home_curation", id, parsed.data);
    return Response.json({ data: updated[0] });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRuntimeAdmin(req);
    const id = parseId((await ctx.params).id);
    const db = getRuntimeDb();
    const deleted = await db
      .delete(homeCurations)
      .where(eq(homeCurations.id, id))
      .returning({ id: homeCurations.id });
    if (deleted.length === 0) throw new AppError("NOT_FOUND", "큐레이션을 찾을 수 없습니다.");
    await writeAuditLog(db, admin.id, "CURATION_DELETED", "home_curation", id);
    return Response.json({ data: { deletedId: id } });
  } catch (err) {
    return jsonError(err);
  }
}
