import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { parseProxyUrl } from "@/lib/gateway/proxy";

type Ctx = { params: Promise<{ id: string }> };

function normalizeMapping(input: unknown): { ok: true; json: string } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, json: "{}" };
  let obj: unknown;
  if (typeof input === "string") {
    if (input.trim() === "") return { ok: true, json: "{}" };
    try {
      obj = JSON.parse(input);
    } catch {
      return { ok: false, error: "模型映射必须是合法 JSON" };
    }
  } else {
    obj = input;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: "模型映射必须是 JSON 对象" };
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v !== "string") return { ok: false, error: `模型映射的值必须是字符串（${k}）` };
  }
  return { ok: true, json: JSON.stringify(obj) };
}

export async function PUT(req: Request, ctx: Ctx) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const id = Number((await ctx.params).id);
  const existing = db.select().from(channels).where(eq(channels.id, id)).get();
  if (!existing) return Response.json({ error: "渠道不存在" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "请求体无效" }, { status: 400 });

  const updates: Partial<typeof channels.$inferInsert> = {};
  if (body.name) updates.name = body.name;
  if (body.type) updates.type = body.type;
  if (body.baseUrl) updates.baseUrl = body.baseUrl.replace(/\/+$/, "");
  if (body.apiKey) updates.apiKeyEnc = encryptSecret(body.apiKey); // 留空表示不修改
  if (body.models !== undefined) {
    const models: string[] = Array.isArray(body.models)
      ? body.models
      : String(body.models)
          .split(/[\n,]/)
          .map((s: string) => s.trim())
          .filter(Boolean);
    if (models.length === 0) return Response.json({ error: "至少填写一个支持的模型" }, { status: 400 });
    updates.models = JSON.stringify(models);
  }
  if (body.priority !== undefined) updates.priority = Number(body.priority) || 0;
  if (body.weight !== undefined) updates.weight = Math.max(1, Number(body.weight) || 1);
  if (body.status !== undefined) updates.status = Number(body.status) ? 1 : 0;
  if (body.modelMapping !== undefined) {
    const mapping = normalizeMapping(body.modelMapping);
    if (!mapping.ok) return Response.json({ error: mapping.error }, { status: 400 });
    updates.modelMapping = mapping.json;
  }
  if (body.proxy !== undefined) {
    try {
      updates.proxy = parseProxyUrl(body.proxy) ?? "";
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  db.update(channels).set(updates).where(eq(channels.id, id)).run();
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const id = Number((await ctx.params).id);
  db.delete(channels).where(eq(channels.id, id)).run();
  return Response.json({ ok: true });
}
