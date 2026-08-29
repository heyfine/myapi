import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { probeModel } from "@/lib/gateway/probe";

/** 对指定模型做连通性测试（渠道未保存时也可用表单里的 key） */
export async function POST(req: Request) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const body = await req.json().catch(() => null);
  const type = String(body?.type ?? "");
  const baseUrl = String(body?.baseUrl ?? "").replace(/\/+$/, "");
  const model = String(body?.model ?? "").trim();
  const channelId = Number(body?.channelId) || 0;
  if (!type || !baseUrl || !model) {
    return Response.json({ error: "缺少 type / baseUrl / model" }, { status: 400 });
  }

  let apiKey = String(body?.apiKey ?? "");
  let modelMapping: Record<string, string> = {};
  let proxy = String(body?.proxy ?? "").trim();
  if (channelId) {
    const ch = db.select().from(channels).where(eq(channels.id, channelId)).get();
    if (ch) {
      if (!apiKey) apiKey = decryptSecret(ch.apiKeyEnc);
      if (!proxy) proxy = ch.proxy;
      try {
        const m = JSON.parse(ch.modelMapping);
        if (m && typeof m === "object" && !Array.isArray(m)) modelMapping = m;
      } catch {
        /* ignore */
      }
    }
  }
  if (!apiKey) {
    return Response.json({ error: "缺少 API Key" }, { status: 400 });
  }

  // 测试对外模型名时，先按渠道的模型映射改写为上游真实模型名再探测
  const upstreamModel = modelMapping[model] ?? model;
  const result = await probeModel({ type, baseUrl, apiKey, model: upstreamModel, proxy });
  return Response.json(result);
}
