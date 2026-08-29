import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { parseProxyUrl } from "@/lib/gateway/proxy";

function normalizeMapping(input: unknown): { ok: true; json: string } | { ok: false; error: string } {
  if (input === undefined || input === null || input === "") return { ok: true, json: "{}" };
  let obj: unknown;
  if (typeof input === "string") {
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

export async function GET() {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const list = db.select().from(channels).orderBy(desc(channels.priority), desc(channels.id)).all();
  return Response.json({
    data: list.map((c) => ({ ...c, apiKeyEnc: undefined, hasKey: true })),
  });
}

export async function POST(req: Request) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const body = await req.json().catch(() => null);
  if (!body?.name || !body?.type || !body?.baseUrl || !body?.apiKey) {
    return Response.json({ error: "名称、类型、Base URL、API Key 均为必填" }, { status: 400 });
  }
  const models: string[] = Array.isArray(body.models)
    ? body.models
    : String(body.models ?? "")
        .split(/[\n,]/)
        .map((s: string) => s.trim())
        .filter(Boolean);
  if (models.length === 0) {
    return Response.json({ error: "至少填写一个支持的模型" }, { status: 400 });
  }
  const mapping = normalizeMapping(body.modelMapping);
  if (!mapping.ok) return Response.json({ error: mapping.error }, { status: 400 });
  let proxy = "";
  try {
    proxy = parseProxyUrl(body.proxy) ?? "";
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const id = db
    .insert(channels)
    .values({
      name: body.name,
      type: body.type,
      baseUrl: body.baseUrl.replace(/\/+$/, ""),
      apiKeyEnc: encryptSecret(body.apiKey),
      models: JSON.stringify(models),
      modelMapping: mapping.json,
      proxy,
      priority: Number(body.priority) || 0,
      weight: Math.max(1, Number(body.weight) || 1),
      status: body.status === 0 ? 0 : 1,
    })
    .returning({ id: channels.id })
    .get();
  return Response.json({ id });
}
