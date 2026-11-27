import { getRuntimeDb } from "@/db/client";
import { jsonError } from "@/lib/errors";
import { parseShowSearchParams, searchShows } from "@/server/modules/shows";

export async function GET(req: Request) {
  try {
    const query = parseShowSearchParams(new URL(req.url).searchParams);
    const data = await searchShows(getRuntimeDb(), query);
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
