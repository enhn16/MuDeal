import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAuth } from "@/server/modules/auth-runtime";
import { submitDealIssue } from "@/server/modules/admin";

const IssueSchema = z.object({
  issueType: z.enum(["SOLD_OUT", "PRICE_MISMATCH", "BROKEN_LINK", "ENDED", "OTHER"]),
  note: z.string().trim().max(300).nullable().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const db = getRuntimeDb();
    const user = await requireRuntimeAuth(req);
    const dealId = Number((await ctx.params).id);
    if (!Number.isInteger(dealId) || dealId <= 0) {
      throw new AppError("VALIDATION_ERROR", "유효하지 않은 딜 ID입니다.");
    }
    const parsed = IssueSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "신고 유형을 선택해 주세요.");
    const created = await submitDealIssue(db, user.id, dealId, parsed.data.issueType, parsed.data.note);
    return Response.json({ data: created }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
