import { getRuntimeDb } from "@/db/client";
import { jsonError } from "@/lib/errors";
import { requireRuntimeAuth } from "@/server/modules/auth-runtime";
import { listFollowedActors } from "@/server/modules/personal";

export async function GET(req: Request) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const items = await listFollowedActors(db, user.id);
    return Response.json({ data: { items } });
  } catch (err) {
    return jsonError(err);
  }
}
