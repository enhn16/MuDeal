import { getRuntimeDb } from "@/db/client";
import { jsonError } from "@/lib/errors";
import { suggestShows } from "@/server/modules/shows";

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const items = await suggestShows(getRuntimeDb(), q);
    return Response.json({ data: { items } });
  } catch (err) {
    return jsonError(err);
  }
}
