import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { getShowDetail } from "@/server/modules/shows";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const showId = Number(id);
    if (!Number.isInteger(showId) || showId <= 0) {
      throw new AppError("VALIDATION_ERROR", "유효하지 않은 작품 ID입니다.");
    }
    const data = await getShowDetail(getRuntimeDb(), showId);
    if (!data) throw new AppError("NOT_FOUND", "해당 뮤지컬 작품을 찾을 수 없습니다.");
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
