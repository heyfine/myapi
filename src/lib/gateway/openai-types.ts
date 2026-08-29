// OpenAI 兼容层的数据结构（仅网关用到的字段）

export type OpenAIMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAIMessageContentPart[] | null;
  name?: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  tools?: unknown[];
  [key: string]: unknown;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** 网关内部统一捕获的用量明细（各上游协议字段映射到这里） */
export interface GatewayUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number; // 缓存命中
  reasoningTokens: number; // 推理（OpenAI/DeepSeek completion_tokens_details.reasoning_tokens）
  thinkingTokens: number; // 思考（Gemini thoughtsTokenCount）
  estimated: boolean; // usage 是估算（上游未返回 usage）
  hasDetails: boolean; // 上游是否返回缓存/推理明细字段
}

export function emptyUsage(): GatewayUsage {
  return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, thinkingTokens: 0, estimated: false, hasDetails: false };
}

export interface OpenAIChatChoice {
  index: number;
  message: { role: "assistant"; content: string | null };
  finish_reason: string | null;
}

export interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage: OpenAIUsage;
}

export function openaiError(message: string, code: number, type = "gateway_error") {
  return Response.json(
    { error: { message, type, code } },
    { status: code },
  );
}

/** 上游不返回 usage 时的粗略估算（中文约 1.5 字/token，英文约 4 字符/token，取折中 3） */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3));
}

export function estimateUsage(req: OpenAIChatRequest, outputText: string): GatewayUsage {
  const inputText = (req.messages ?? [])
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")))
    .join("\n");
  return {
    promptTokens: estimateTokens(inputText),
    completionTokens: estimateTokens(outputText),
    cachedTokens: 0,
    reasoningTokens: 0,
    thinkingTokens: 0,
    estimated: true,
    hasDetails: false,
  };
}
