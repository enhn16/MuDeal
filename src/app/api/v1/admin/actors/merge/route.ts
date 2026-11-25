import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { mergeActors } from "@/server/modules/admin";

const MergeSchema = z.object({
  sourceActorId: z.number().int().positive(),
  targetActorId: z.number().int().positive(),
});

export async function POST(req: Request) {
  try {
    const admin = await requireRuntimeAdmin(req);
    const parsed = MergeSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "병합할 배우 ID를 선택해 주세요.");
    const data = await mergeActors(
      getRuntimeDb(),
      admin.id,
      parsed.data.sourceActorId,
      parsed.data.targetActorId,
    );
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
