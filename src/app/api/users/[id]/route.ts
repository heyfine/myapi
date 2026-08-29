import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const id = Number((await ctx.params).id);
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return Response.json({ error: "用户不存在" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const updates: Partial<typeof users.$inferInsert> = {};
  if (body?.password) updates.passwordHash = hashPassword(String(body.password));
  if (body?.status !== undefined) updates.status = Number(body.status) ? 1 : 0;
  if (body?.role !== undefined && target.id !== r.user.id) updates.role = body.role === "admin" ? "admin" : "user";
  if (body?.quotaUsd !== undefined) updates.quota = Math.round((Number(body.quotaUsd) || 0) * 100000);
  if (body?.addUsd !== undefined) {
    updates.quota = Math.max(0, target.quota + Math.round((Number(body.addUsd) || 0) * 100000));
  }
  if (Object.keys(updates).length === 0) return Response.json({ error: "没有可更新的字段" }, { status: 400 });
  db.update(users).set(updates).where(eq(users.id, id)).run();
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const id = Number((await ctx.params).id);
  if (id === r.user.id) return Response.json({ error: "不能删除自己" }, { status: 400 });
  db.delete(users).where(eq(users.id, id)).run();
  return Response.json({ ok: true });
}
