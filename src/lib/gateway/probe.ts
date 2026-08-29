import { proxiedFetch } from "./proxy";

// 对单个模型发起一次极短请求做连通性探测
export interface ProbeTarget {
  type: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  proxy?: string | null;
}

export interface ProbeResult {
  ok: boolean;
  latency: number;
  error?: string;
}

export async function probeModel(target: ProbeTarget): Promise<ProbeResult> {
  const started = Date.now();
  const base = target.baseUrl.replace(/\/+$/, "");
  try {
    let url: string;
    let headers: Record<string, string>;
    let body: string;
    if (target.type === "anthropic") {
      url = `${base}/v1/messages`;
      headers = { "content-type": "application/json", "x-api-key": target.apiKey, "anthropic-version": "2023-06-01" };
      body = JSON.stringify({ model: target.model, max_tokens: 8, messages: [{ role: "user", content: "hi" }] });
    } else if (target.type === "gemini") {
      url = `${base}/v1beta/models/${encodeURIComponent(target.model)}:generateContent`;
      headers = { "content-type": "application/json", "x-goog-api-key": target.apiKey };
      body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { maxOutputTokens: 8 } });
    } else {
      url = `${base}/chat/completions`;
      headers = { "content-type": "application/json", authorization: `Bearer ${target.apiKey}` };
      body = JSON.stringify({ model: target.model, messages: [{ role: "user", content: "hi" }], max_tokens: 8, stream: false });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await proxiedFetch(url, { method: "POST", headers, body, signal: controller.signal }, target.proxy);
    clearTimeout(timeout);
    const latency = Date.now() - started;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, latency, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, latency };
  } catch (err) {
    return {
      ok: false,
      latency: Date.now() - started,
      error: err instanceof Error ? (err.name === "AbortError" ? "请求超时" : err.message) : "请求失败",
    };
  }
}
