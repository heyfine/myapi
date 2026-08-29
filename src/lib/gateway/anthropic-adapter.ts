// OpenAI 兼容格式 <-> Anthropic Messages API 互转
import type {
  OpenAIChatRequest,
  OpenAIMessage,
  GatewayUsage,
} from "./openai-types";
import { estimateUsage } from "./openai-types";

// ---------- 请求转换 ----------

export function toAnthropicRequest(req: OpenAIChatRequest): Record<string, unknown> {
  const systemParts: string[] = [];
  const messages: Array<Record<string, unknown>> = [];

  for (const m of req.messages as OpenAIMessage[]) {
    if (m.role === "system") {
      if (typeof m.content === "string") systemParts.push(m.content);
      continue;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    const content: Array<Record<string, unknown>> = [];
    if (typeof m.content === "string") {
      if (m.content) content.push({ type: "text", text: m.content });
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === "text") {
          content.push({ type: "text", text: part.text });
        } else if (part.type === "image_url") {
          const img = parseDataImageUrl(part.image_url.url);
          if (img) {
            content.push({
              type: "image",
              source: { type: "base64", media_type: img.mimeType, data: img.base64 },
            });
          }
        }
      }
    }
    // Anthropic 要求 user/assistant 交替且首条必须是 user；空 content 跳过
    if (content.length === 0) continue;
    const last = messages[messages.length - 1] as { role: string; content: unknown[] } | undefined;
    if (last && last.role === role) {
      last.content.push(...content);
    } else {
      messages.push({ role, content });
    }
  }
  if (messages.length > 0 && messages[0].role !== "user") {
    messages.unshift({ role: "user", content: [{ type: "text", text: "(go on)" }] });
  }

  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    max_tokens: (req.max_tokens as number) ?? 4096,
  };
  if (systemParts.length > 0) body.system = systemParts.join("\n");
  if (typeof req.temperature === "number") body.temperature = req.temperature;
  if (typeof req.top_p === "number") body.top_p = req.top_p;
  if (req.stop) {
    const stop = Array.isArray(req.stop) ? req.stop : [req.stop];
    if (stop.length > 0) body.stop_sequences = stop;
  }
  return body;
}

function parseDataImageUrl(url: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (match) return { mimeType: match[1], base64: match[2] };
  return null; // 外链图片由网关不下载，暂不支持
}

// ---------- 非流式响应转换 ----------

export function fromAnthropicResponse(data: Record<string, unknown>, model: string): Record<string, unknown> {
  const contentBlocks = (data.content as Array<{ type: string; text?: string }>) ?? [];
  const text = contentBlocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  const usage = (data.usage as { input_tokens?: number; output_tokens?: number }) ?? {};
  const prompt = usage.input_tokens ?? 0;
  const completion = usage.output_tokens ?? 0;
  return {
    id: (data.id as string) ?? `chatcmpl-anthropic-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: mapStopReason(data.stop_reason),
      },
    ],
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
  };
}

function mapStopReason(reason: unknown): string | null {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return null;
  }
}

// ---------- 流式转换：Anthropic SSE -> OpenAI chunk SSE ----------

import { convertSSE } from "./sse";

export function anthropicStreamToOpenAI(
  upstream: ReadableStream<Uint8Array>,
  model: string,
  onUsage?: (u: GatewayUsage) => void,
): ReadableStream<Uint8Array> {
  const id = `chatcmpl-anthropic-${Date.now()}`;
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  let hasDetails = false;
  let outputTextLen = 0;

  function baseChunk() {
    return {
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: null }],
    };
  }

  return convertSSE(upstream, {
    onEvent(payload, { emit }) {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(payload);
      } catch {
        return;
      }
      const type = ev.type as string;

      if (type === "message_start") {
        const msg = ev.message as { usage?: { input_tokens?: number; cache_read_input_tokens?: number } } | undefined;
        promptTokens = msg?.usage?.input_tokens ?? 0;
        cachedTokens = msg?.usage?.cache_read_input_tokens ?? 0;
        hasDetails = msg?.usage?.cache_read_input_tokens !== undefined;
        emit({ ...baseChunk(), choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
      } else if (type === "content_block_delta") {
        const delta = ev.delta as { type?: string; text?: string };
        if (delta?.type === "text_delta" && delta.text) {
          outputTextLen += delta.text.length;
          emit({ ...baseChunk(), choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }] });
        }
      } else if (type === "message_delta") {
        const delta = ev.delta as { stop_reason?: string } | undefined;
        const usage = ev.usage as { output_tokens?: number } | undefined;
        completionTokens = usage?.output_tokens ?? completionTokens;
        emit({ ...baseChunk(), choices: [{ index: 0, delta: {}, finish_reason: mapStopReason(delta?.stop_reason) }] });
      } else if (type === "error") {
        const err = ev.error as { message?: string };
        emit({ ...baseChunk(), error: { message: err?.message ?? "upstream error" } });
      }
    },
    onEnd({ emit }) {
      const usage: GatewayUsage =
        promptTokens + completionTokens > 0
          ? { promptTokens, completionTokens, cachedTokens, reasoningTokens: 0, thinkingTokens: 0, estimated: false, hasDetails }
          : estimateUsage({ model, messages: [] } as OpenAIChatRequest, "x".repeat(outputTextLen));
      onUsage?.(usage);
      emit({ ...baseChunk(), usage: { prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, total_tokens: usage.promptTokens + usage.completionTokens } });
    },
  });
}
