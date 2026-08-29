import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tokens } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";

type Ctx = { params: Promise<{ id: string }> };

/** 查看令牌完整 Key（仅本人或管理员） */
export async function GET(_req: Request, ctx: Ctx) {
  const r = await requireUser();
  if (r.error) return r.error;
  const id = Number((await ctx.params).id);
  const token = db.select().from(tokens).where(eq(tokens.id, id)).get();
  if (!token) return Response.json({ error: "令牌不存在" }, { status: 404 });
  if (r.user.role !== "admin" && token.userId !== r.user.id) {
    return Response.json({ error: "无权查看他人令牌" }, { status: 403 });
  }
  if (!token.keyEnc) {
    return Response.json({ error: "该令牌创建于旧版本，未存储明文，无法取回；请删除后重新创建" }, { status: 409 });
  }
  return Response.json({ key: decryptSecret(token.keyEnc) });
}
