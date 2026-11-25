import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAuth } from "@/server/modules/auth-runtime";
import { createSearchPreset, listSearchPresets } from "@/server/modules/personal";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(30),
  queryParamsJson: z.string().min(2).max(1000),
});

export async function GET(req: Request) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const items = await listSearchPresets(db, user.id);
    return Response.json({ data: { items } });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "프리셋 이름을 입력해 주세요.");
    const created = await createSearchPreset(db, user.id, parsed.data.name, parsed.data.queryParamsJson);
    return Response.json({ data: created }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
