import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { proxiedFetch } from "@/lib/gateway/proxy";

/** 从上游供应商拉取可用模型列表（支持走渠道代理） */
export async function POST(req: Request) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const body = await req.json().catch(() => null);
  const type = String(body?.type ?? "");
  const baseUrl = String(body?.baseUrl ?? "").replace(/\/+$/, "");
  const channelId = Number(body?.channelId) || 0;
  if (!type || !baseUrl) {
    return Response.json({ error: "请先填写类型和 Base URL" }, { status: 400 });
  }

  // 优先用表单里填的 key；编辑已有渠道且未重新填写时，用已保存的 key
  let apiKey = String(body?.apiKey ?? "");
  let proxy = String(body?.proxy ?? "").trim();
  if ((!apiKey || !proxy) && channelId) {
    const ch = db.select().from(channels).where(eq(channels.id, channelId)).get();
    if (ch) {
      if (!apiKey) apiKey = decryptSecret(ch.apiKeyEnc);
      if (!proxy) proxy = ch.proxy;
    }
  }
  if (!apiKey) {
    return Response.json({ error: "请先填写 API Key（或保存过该渠道后可直接获取）" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let url: string;
    let headers: Record<string, string>;
    if (type === "anthropic") {
      url = `${baseUrl}/v1/models?limit=1000`;
      headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    } else if (type === "gemini") {
      url = `${baseUrl}/v1beta/models?pageSize=1000`;
      headers = { "x-goog-api-key": apiKey };
    } else {
      url = `${baseUrl}/models`;
      headers = { authorization: `Bearer ${apiKey}` };
    }
    const res = await proxiedFetch(url, { headers, signal: controller.signal }, proxy);
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return Response.json(
        { error: `上游返回 HTTP ${res.status}: ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    let models: string[] = [];
    if (type === "gemini") {
      const list = (data.models as Array<{ name?: string; supportedGenerationMethods?: string[] }>) ?? [];
      models = list
        .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
        .map((m) => (m.name ?? "").replace(/^models\//, ""))
        .filter(Boolean);
    } else {
      const list = (data.data as Array<{ id?: string }>) ?? [];
      models = list.map((m) => m.id ?? "").filter(Boolean);
    }
    models = [...new Set(models)].sort();
    return Response.json({ models });
  } catch (err) {
    return Response.json({
      error: err instanceof Error ? (err.name === "AbortError" ? "请求超时" : err.message) : "请求失败",
    }, { status: 502 });
  }
}
