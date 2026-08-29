import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tokens } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

async function loadOwned(ctx: Ctx) {
  const r = await requireUser();
  if (r.error) return r;
  const id = Number((await ctx.params).id);
  const token = db.select().from(tokens).where(eq(tokens.id, id)).get();
  if (!token) return { user: null, error: Response.json({ error: "令牌不存在" }, { status: 404 }) };
  if (r.user.role !== "admin" && token.userId !== r.user.id) {
    return { user: null, error: Response.json({ error: "无权操作他人令牌" }, { status: 403 }) };
  }
  return { user: r.user, error: null, token, id };
}

export async function PATCH(req: Request, ctx: Ctx) {
  const r = await loadOwned(ctx);
  if (r.error) return r.error;
  const body = await req.json().catch(() => ({}));
  const updates: Partial<typeof tokens.$inferInsert> = {};
  if (body?.name) updates.name = String(body.name).trim();
  if (body?.status !== undefined) updates.status = Number(body.status) ? 1 : 0;
  if (body?.quotaLimitUsd !== undefined) {
    const usd = Number(body.quotaLimitUsd) || 0;
    updates.quotaLimit = usd > 0 ? Math.round(usd * 100000) : 0;
  }
  db.update(tokens).set(updates).where(eq(tokens.id, r.id!)).run();
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const r = await loadOwned(ctx);
  if (r.error) return r.error;
  db.delete(tokens).where(eq(tokens.id, r.id!)).run();
  return Response.json({ ok: true });
}
