import { getRuntimeDb } from "@/db/client";
import { jsonError } from "@/lib/errors";
import { getHomeData } from "@/server/modules/shows";

export async function GET() {
  try {
    const data = await getHomeData(getRuntimeDb());
    return Response.json(
      { data },
      {
        headers: {
          "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
        },
      },
    );
  } catch (err) {
    return jsonError(err);
  }
}
