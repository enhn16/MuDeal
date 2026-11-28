import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAuth } from "@/server/modules/auth-runtime";
import { getNotificationsFeed, markNotificationsRead } from "@/server/modules/personal";

const MarkReadSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
});

export async function GET(req: Request) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const sp = new URL(req.url).searchParams;
    const rawMode = sp.get("mode");
    const mode = rawMode === "recent" || rawMode === "saved" ? rawMode : "unread";
    const actorId = Number(sp.get("actorId")) || undefined;
    const showId = Number(sp.get("showId")) || undefined;

    const data = await getNotificationsFeed(db, user.id, { mode, actorId, showId });
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const parsed = MarkReadSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION_ERROR",
        "읽음 처리할 알림 ID 목록이 올바르지 않습니다.",
        parsed.error.flatten(),
      );
    }

    const data = await markNotificationsRead(db, user.id, parsed.data.ids);
    return Response.json({ data }, { status: 200 });
  } catch (err) {
    return jsonError(err);
  }
}
