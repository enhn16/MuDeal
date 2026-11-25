import { z } from "zod";
import { getRuntimeDb } from "@/db/client";
import { AppError, jsonError } from "@/lib/errors";
import { requireRuntimeAdmin } from "@/server/modules/auth-runtime";
import { resolveAdminIssue } from "@/server/modules/admin";

const PatchIssueSchema = z.object({
  action: z.enum(["EXPIRE_DEAL", "RESOLVE", "DISMISS"]),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRuntimeAdmin(req);
    const issueId = Number((await ctx.params).id);
    if (!Number.isInteger(issueId) || issueId <= 0) {
      throw new AppError("VALIDATION_ERROR", "유효하지 않은 신고 ID입니다.");
    }
    const parsed = PatchIssueSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "처리 액션을 선택해 주세요.");
    const data = await resolveAdminIssue(getRuntimeDb(), admin.id, issueId, parsed.data.action);
    return Response.json({ data });
  } catch (err) {
    return jsonError(err);
  }
}
