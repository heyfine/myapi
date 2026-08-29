// OpenAI 兼容格式 <-> Google Gemini API 互转
import type {
  OpenAIChatRequest,
  OpenAIMessage,
  GatewayUsage,
} from "./openai-types";
import { estimateUsage } from "./openai-types";

// ---------- 请求转换 ----------

export function toGeminiRequest(req: OpenAIChatRequest): Record<string, unknown> {
  const systemParts: string[] = [];
  const contents: Array<Record<string, unknown>> = [];

  for (const m of req.messages as OpenAIMessage[]) {
    if (m.role === "system") {
      if (typeof m.content === "string") systemParts.push(m.content);
      continue;
    }
    const role = m.role === "assistant" ? "model" : "user";
    const parts: Array<Record<string, unknown>> = [];
    if (typeof m.content === "string") {
      if (m.content) parts.push({ text: m.content });
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === "text") parts.push({ text: part.text });
        else if (part.type === "image_url") {
          const dataMatch = /^data:([^;]+);base64,(.+)$/.exec(part.image_url.url);
          if (dataMatch) {
            parts.push({ inline_data: { mime_type: dataMatch[1], data: dataMatch[2] } });
          }
        }
      }
    }
    if (parts.length === 0) continue;
    const last = contents[contents.length - 1] as { role: string; parts: unknown[] } | undefined;
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  }

  const body: Record<string, unknown> = { contents };
  if (systemParts.length > 0) body.systemInstruction = { parts: [{ text: systemParts.join("\n") }] };
  const generationConfig: Record<string, unknown> = {};
  if (typeof req.temperature === "number") generationConfig.temperature = req.temperature;
  if (typeof req.top_p === "number") generationConfig.topP = req.top_p;
  if (req.max_tokens) generationConfig.maxOutputTokens = req.max_tokens;
  if (req.stop) {
    const stop = Array.isArray(req.stop) ? req.stop : [req.stop];
    if (stop.length > 0) generationConfig.stopSequences = stop;
  }
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
  return body;
}

// ---------- 非流式响应转换 ----------

export function fromGeminiResponse(
  data: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const candidates = (data.candidates as Array<Record<string, unknown>>) ?? [];
  const first = candidates[0] ?? {};
  const parts = ((first.content as Record<string, unknown> | undefined)?.parts as Array<{ text?: string }>) ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  const usage = (data.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number }) ?? {};
  const prompt = usage.promptTokenCount ?? 0;
  const completion = usage.candidatesTokenCount ?? 0;
  return {
    id: `chatcmpl-gemini-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: mapFinishReason(first.finishReason),
      },
    ],
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
  };
}

function mapFinishReason(reason: unknown): string | null {
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
      return "content_filter";
    default:
      return null;
  }
}

// ---------- 流式转换：Gemini SSE -> OpenAI chunk SSE ----------

import { convertSSE } from "./sse";

export function geminiStreamToOpenAI(
  upstream: ReadableStream<Uint8Array>,
  model: string,
  onUsage?: (u: GatewayUsage) => void,
): ReadableStream<Uint8Array> {
  const id = `chatcmpl-gemini-${Date.now()}`;
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  let thinkingTokens = 0;
  let hasDetails = false;
  let outputTextLen = 0;
  let finish: string | null = null;

  function baseChunk() {
    return {
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: null as string | null }],
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
      const candidates = (ev.candidates as Array<Record<string, unknown>>) ?? [];
      const first = candidates[0] ?? {};
      const parts =
        ((first.content as Record<string, unknown> | undefined)?.parts as Array<{ text?: string }>) ?? [];
      const text = parts.map((p) => p.text ?? "").join("");
      if (first.finishReason) finish = mapFinishReason(first.finishReason);
      const usage = ev.usageMetadata as {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
        thoughtsTokenCount?: number;
      } | undefined;
      if (usage) {
        promptTokens = usage.promptTokenCount ?? promptTokens;
        completionTokens = usage.candidatesTokenCount ?? completionTokens;
        cachedTokens = usage.cachedContentTokenCount ?? cachedTokens;
        thinkingTokens = usage.thoughtsTokenCount ?? thinkingTokens;
        hasDetails = usage.cachedContentTokenCount !== undefined || usage.thoughtsTokenCount !== undefined;
      }
      if (text) outputTextLen += text.length;
      emit({ ...baseChunk(), choices: [{ index: 0, delta: text ? { content: text } : {}, finish_reason: null }] });
    },
    onEnd({ emit }) {
      const usage: GatewayUsage =
        promptTokens + completionTokens > 0
          ? { promptTokens, completionTokens, cachedTokens, reasoningTokens: 0, thinkingTokens, estimated: false, hasDetails }
          : estimateUsage({ model, messages: [] } as OpenAIChatRequest, "x".repeat(outputTextLen));
      onUsage?.(usage);
      emit({ ...baseChunk(), usage: { prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, total_tokens: usage.promptTokens + usage.completionTokens } });
    },
  });
}
