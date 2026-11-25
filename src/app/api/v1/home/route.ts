import { getRuntimeDb } from "@/db/client";
import { jsonError } from "@/lib/errors";
import { getHomeData } from "@/server/modules/shows";

export async function GET() {
  try {
    const data = await getHomeData(getRuntimeDb());
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
