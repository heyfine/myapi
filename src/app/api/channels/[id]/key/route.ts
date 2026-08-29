import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";

type Ctx = { params: Promise<{ id: string }> };

/** 查看渠道已保存的 API Key（管理员） */
export async function GET(_req: Request, ctx: Ctx) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const id = Number((await ctx.params).id);
  const ch = db.select({ apiKeyEnc: channels.apiKeyEnc }).from(channels).where(eq(channels.id, id)).get();
  if (!ch) return Response.json({ error: "渠道不存在" }, { status: 404 });
  return Response.json({ apiKey: decryptSecret(ch.apiKeyEnc) });
}
