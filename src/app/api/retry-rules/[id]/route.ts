import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { retryRules } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const id = Number((await ctx.params).id);
  const existing = db.select().from(retryRules).where(eq(retryRules.id, id)).get();
  if (!existing) return Response.json({ error: "规则不存在" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const updates: Partial<typeof retryRules.$inferInsert> = {};
  if (body?.errorCode !== undefined) {
    const errorCode = Number(body.errorCode);
    if (!Number.isInteger(errorCode) || errorCode < 0 || errorCode > 599) {
      return Response.json({ error: "错误代号必须是 0-599 的整数" }, { status: 400 });
    }
    if (errorCode !== existing.errorCode) {
      const dup = db.select().from(retryRules).where(eq(retryRules.errorCode, errorCode)).get();
      if (dup) return Response.json({ error: `错误代号 ${errorCode === 0 ? "其他错误" : errorCode} 的规则已存在` }, { status: 400 });
    }
    updates.errorCode = errorCode;
  }
  if (body?.maxRetries !== undefined) updates.maxRetries = clampInt(body.maxRetries, 0, 20, 0);
  if (body?.initialDelayMs !== undefined) updates.initialDelayMs = clampInt(body.initialDelayMs, 0, 600000, 1000);
  if (body?.maxDelayMs !== undefined) updates.maxDelayMs = clampInt(body.maxDelayMs, 0, 600000, 10000);
  if (body?.jitter !== undefined) {
    const j = Number(body.jitter);
    if (!Number.isFinite(j) || j < 0 || j > 1) {
      return Response.json({ error: "抖动比例必须是 0~1 之间的数字" }, { status: 400 });
    }
    updates.jitter = j;
  }
  if (body?.enabled !== undefined) updates.enabled = Number(body.enabled) ? 1 : 0;
  if (Object.keys(updates).length === 0) return Response.json({ error: "没有可更新的字段" }, { status: 400 });

  db.update(retryRules).set(updates).where(eq(retryRules.id, id)).run();
  return Response.json({ ok: true });
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.max(min, Math.min(max, n)));
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const id = Number((await ctx.params).id);
  const rule = db.select().from(retryRules).where(eq(retryRules.id, id)).get();
  if (!rule) return Response.json({ error: "规则不存在" }, { status: 404 });
  if (rule.errorCode === 0) {
    return Response.json({ error: "全局默认规则不能删除，可编辑参数或停用" }, { status: 400 });
  }
  db.delete(retryRules).where(eq(retryRules.id, id)).run();
  return Response.json({ ok: true });
}
