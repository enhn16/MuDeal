import { getRuntimeDb } from "@/db/client";
import { jsonError } from "@/lib/errors";
import { requireRuntimeAuth } from "@/server/modules/auth-runtime";
import { getNotificationsFeed } from "@/server/modules/personal";

export async function GET(req: Request) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const sp = new URL(req.url).searchParams;
    const rawMode = sp.get("mode");
    const mode = rawMode === "recent" || rawMode === "saved" ? rawMode : "unread";
    const actorId = Number(sp.get("actorId")) || undefined;
    const showId = Number(sp.get("showId")) || undefined;
    const autoMarkRead = sp.get("autoMarkRead") === "true" || sp.get("autoMarkRead") === "1";

    const data = await getNotificationsFeed(db, user.id, { mode, actorId, showId, autoMarkRead });
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
