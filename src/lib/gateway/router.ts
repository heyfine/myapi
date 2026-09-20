import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels } from "@/lib/schema";
import { decryptSecret } from "@/lib/crypto";
import type { OpenAIChatRequest } from "./openai-types";
import { estimateUsage, type GatewayUsage } from "./openai-types";
import { toAnthropicRequest, fromAnthropicResponse, anthropicStreamToOpenAI } from "./anthropic-adapter";
import { toGeminiRequest, fromGeminiResponse, geminiStreamToOpenAI } from "./gemini-adapter";

import { proxiedFetch } from "./proxy";

export type Channel = typeof channels.$inferSelect;

export interface UpstreamSuccess {
  ok: true;
  response: Response;
  channelId: number;
  channelName: string;
}
export interface UpstreamFailure {
  ok: false;
  status: number;
  error: string;
  channelId: number;
  channelName: string;
}
export type UpstreamResult = UpstreamSuccess | UpstreamFailure;

function parseModelMapping(raw: string | null | undefined): Record<string, string> {
  try {
    const m = JSON.parse(raw ?? "{}");
    return m && typeof m === "object" && !Array.isArray(m) ? m : {};
  } catch {
    return {};
  }
}

/** 上游状态码：网络层/限流/服务端错误都触发切换下一渠道 */
const FAILOVER_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

/** 按模型选出候选渠道：优先级降序，同优先级按权重随机（归档渠道不参与路由） */
export function selectChannels(model: string): Channel[] {
  const list = db
    .select()
    .from(channels)
    .where(
      and(
        eq(channels.status, 1),
        eq(channels.archived, 0),
        sql`EXISTS (SELECT 1 FROM json_each(${channels.models}) WHERE json_each.value = ${model})`,
      ),
    )
    .all();
  list.sort((a, b) => b.priority - a.priority);
  const result: Channel[] = [];
  let i = 0;
  while (i < list.length) {
    let j = i;
    while (j < list.length && list[j].priority === list[i].priority) j++;
    const pool = [...list.slice(i, j)];
    while (pool.length > 0) {
      const total = pool.reduce((s, c) => s + Math.max(1, c.weight), 0);
      let r = Math.random() * total;
      let pick = 0;
      for (let k = 0; k < pool.length; k++) {
        r -= Math.max(1, pool[k].weight);
        if (r <= 0) {
          pick = k;
          break;
        }
      }
      result.push(pool.splice(pick, 1)[0]);
    }
    i = j;
  }
  return result;
}

/** 从 OpenAI 格式 payload 提取用量（含缓存命中/推理明细） */
function extractOpenAIUsage(payload: Record<string, unknown>, req: OpenAIChatRequest): GatewayUsage {
  const u = payload.usage as Record<string, unknown> | undefined;
  if (u && typeof u.prompt_tokens === "number") {
    const pDetails = u.prompt_tokens_details as { cached_tokens?: number } | undefined;
    const cDetails = u.completion_tokens_details as { reasoning_tokens?: number } | undefined;
    return {
      promptTokens: u.prompt_tokens,
      completionTokens: (u.completion_tokens as number) ?? 0,
      cachedTokens: pDetails?.cached_tokens ?? 0,
      reasoningTokens: cDetails?.reasoning_tokens ?? 0,
      thinkingTokens: 0,
      estimated: false,
      hasDetails: !!pDetails || !!cDetails,
    };
  }
  const content =
    ((payload.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content) ?? "";
  return estimateUsage(req, content);
}

/**
 * 透传 OpenAI 格式流。rewriteModel 传入时（模型映射生效），按行重写 chunk 的 model 字段；
 * 否则原样转发所有字节，仅在流结束时回调 usage。
 */
function tapOpenAIStream(
  upstream: ReadableStream<Uint8Array>,
  req: OpenAIChatRequest,
  onUsage?: (u: GatewayUsage) => void,
  rewriteModel?: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = "";
  let usage: GatewayUsage | null = null;
  let outputTextLen = 0;

  function observeEvent(ev: {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
    };
    choices?: Array<{ delta?: { content?: string } }>;
  }) {
    if (ev.usage && typeof ev.usage.prompt_tokens === "number") {
      usage = {
        promptTokens: ev.usage.prompt_tokens,
        completionTokens: ev.usage.completion_tokens ?? 0,
        cachedTokens: ev.usage.prompt_tokens_details?.cached_tokens ?? 0,
        reasoningTokens: ev.usage.completion_tokens_details?.reasoning_tokens ?? 0,
        thinkingTokens: 0,
        estimated: false,
        hasDetails: !!ev.usage.prompt_tokens_details || !!ev.usage.completion_tokens_details,
      };
    }
    const deltaText = ev.choices?.[0]?.delta?.content;
    if (typeof deltaText === "string") outputTextLen += deltaText.length;
  }

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (!rewriteModel) {
          // 纯透传模式：先原样转发字节，再旁路解析观察
          controller.enqueue(chunk);
        }
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (rewriteModel) {
            // 重写模式：按行重新序列化，替换 chunk 的 model 字段
            if (!t.startsWith("data:")) {
              if (line.length > 0) controller.enqueue(encoder.encode(line + "\n"));
              continue;
            }
            const payload = t.slice(5).trim();
            if (!payload) continue;
            if (payload === "[DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }
            try {
              const ev = JSON.parse(payload) as Record<string, unknown>;
              ev.model = rewriteModel;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
              observeEvent(ev);
            } catch {
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            }
            continue;
          }
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            observeEvent(JSON.parse(payload));
          } catch {
            /* 忽略无法解析的行 */
          }
        }
      },
      flush() {
        onUsage?.(usage ?? estimateUsage(req, "x".repeat(outputTextLen)));
      },
    }),
  );
}

/** 单渠道调用上游，非 OpenAI 类型做协议转换；onUsage 在响应体（或流）完成时回调 */
export async function callUpstream(
  channel: Channel,
  req: OpenAIChatRequest,
  onUsage?: (u: GatewayUsage) => void,
  signal?: AbortSignal,
): Promise<UpstreamResult> {
  const apiKey = decryptSecret(channel.apiKeyEnc);
  const stream = !!req.stream;
  // 模型映射：对外模型名 -> 上游真实模型名
  const mapping = parseModelMapping(channel.modelMapping);
  const upstreamModel = mapping[req.model] ?? req.model;
  const mapped = upstreamModel !== req.model;
  try {
    let url: string;
    let headers: Record<string, string>;
    let body: string;

    if (channel.type === "anthropic") {
      url = `${channel.baseUrl.replace(/\/+$/, "")}/v1/messages`;
      headers = {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
      body = JSON.stringify({ ...toAnthropicRequest({ ...req, model: upstreamModel }), stream });
    } else if (channel.type === "gemini") {
      url = `${channel.baseUrl.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(upstreamModel)}:${
        stream ? "streamGenerateContent?alt=sse" : "generateContent"
      }`;
      headers = { "content-type": "application/json", "x-goog-api-key": apiKey };
      body = JSON.stringify(toGeminiRequest(req));
    } else {
      url = `${channel.baseUrl.replace(/\/+$/, "")}/chat/completions`;
      headers = { "content-type": "application/json", authorization: `Bearer ${apiKey}` };
      const upstreamBody: Record<string, unknown> = { ...req, model: upstreamModel };
      if (stream && channel.type === "openai") {
        // 官方 OpenAI 需要 include_usage 才会在流里返回 usage
        upstreamBody.stream_options = { include_usage: true };
      }
      body = JSON.stringify(upstreamBody);
    }

    const res = await proxiedFetch(url, { method: "POST", headers, body, signal }, channel.proxy);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error: errText.slice(0, 500) || `HTTP ${res.status}`,
        channelId: channel.id,
        channelName: channel.name,
      };
    }

    if (!stream) {
      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        return { ok: false, status: 502, error: "上游返回非 JSON 响应", channelId: channel.id, channelName: channel.name };
      }
      let payload: Record<string, unknown>;
      if (channel.type === "anthropic") {
        payload = fromAnthropicResponse(data, req.model);
        const u = (data.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }) ?? {};
        onUsage?.({
          promptTokens: u.input_tokens ?? 0,
          completionTokens: u.output_tokens ?? 0,
          cachedTokens: u.cache_read_input_tokens ?? 0,
          reasoningTokens: 0,
          thinkingTokens: 0,
          estimated: u.input_tokens === undefined,
          hasDetails: u.cache_read_input_tokens !== undefined,
        });
      } else if (channel.type === "gemini") {
        payload = fromGeminiResponse(data, req.model);
        const u = (data.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number }) ?? {};
        onUsage?.({
          promptTokens: u.promptTokenCount ?? 0,
          completionTokens: u.candidatesTokenCount ?? 0,
          cachedTokens: u.cachedContentTokenCount ?? 0,
          reasoningTokens: 0,
          thinkingTokens: u.thoughtsTokenCount ?? 0,
          estimated: u.promptTokenCount === undefined,
          hasDetails: u.cachedContentTokenCount !== undefined || u.thoughtsTokenCount !== undefined,
        });
      } else {
        payload = data;
        onUsage?.(extractOpenAIUsage(payload, req));
      }
      if (mapped) payload.model = req.model; // 映射生效时把响应中的模型名还原为对外名称
      return { ok: true, response: Response.json(payload), channelId: channel.id, channelName: channel.name };
    }

    if (!res.body) {
      return { ok: false, status: 502, error: "上游未返回响应体", channelId: channel.id, channelName: channel.name };
    }
    let outStream: ReadableStream<Uint8Array>;
    if (channel.type === "anthropic") {
      outStream = anthropicStreamToOpenAI(res.body, req.model, onUsage);
    } else if (channel.type === "gemini") {
      outStream = geminiStreamToOpenAI(res.body, req.model, onUsage);
    } else {
      outStream = tapOpenAIStream(res.body, req, onUsage, mapped ? req.model : undefined);
    }
    const response = new Response(outStream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
    return { ok: true, response, channelId: channel.id, channelName: channel.name };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "上游请求失败",
      channelId: channel.id,
      channelName: channel.name,
    };
  }
}

export function shouldFailover(failure: UpstreamFailure): boolean {
  return FAILOVER_STATUSES.has(failure.status);
}
