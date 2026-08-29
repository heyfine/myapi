import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { probeModel } from "@/lib/gateway/probe";

type Ctx = { params: Promise<{ id: string }> };

/** 连通性测试：用渠道第一个模型发一条极短请求（自动应用模型映射与代理） */
export async function POST(_req: Request, ctx: Ctx) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const id = Number((await ctx.params).id);
  const channel = db.select().from(channels).where(eq(channels.id, id)).get();
  if (!channel) return Response.json({ error: "渠道不存在" }, { status: 404 });

  let models: string[] = [];
  try {
    models = JSON.parse(channel.models);
  } catch {
    /* ignore */
  }
  const model = models[0];
  if (!model) return Response.json({ ok: false, error: "渠道未配置任何模型" });

  let mapping: Record<string, string> = {};
  try {
    const m = JSON.parse(channel.modelMapping);
    if (m && typeof m === "object" && !Array.isArray(m)) mapping = m;
  } catch {
    /* ignore */
  }
  const probeModelName = mapping[model] ?? model;

  const result = await probeModel({
    type: channel.type,
    baseUrl: channel.baseUrl,
    apiKey: decryptSecret(channel.apiKeyEnc),
    model: probeModelName,
    proxy: channel.proxy,
  });
  return Response.json({ ...result, model: probeModelName });
}
