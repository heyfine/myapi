import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels } from "@/lib/schema";
import { decryptSecret } from "@/lib/crypto";
import { authenticateGatewayToken } from "@/lib/gateway/token-auth";
import { computeCost, deductQuota } from "@/lib/gateway/billing";
import { writeLog } from "@/lib/gateway/logger";
import { openaiError, estimateTokens } from "@/lib/gateway/openai-types";

const EMBED_TYPES = ["openai", "openai-compatible"];

export async function POST(req: Request) {
  const started = Date.now();
  const auth = authenticateGatewayToken(req);
  if (auth instanceof Response) return auth;

  let body: { model?: string; input?: unknown };
  try {
    body = await req.json();
  } catch {
    return openaiError("请求体不是合法 JSON", 400, "invalid_request_error");
  }
  if (!body?.model || body.input === undefined) {
    return openaiError("缺少 model 或 input 字段", 400, "invalid_request_error");
  }

  const candidate = db
    .select()
    .from(channels)
    .where(
      and(
        eq(channels.status, 1),
        eq(channels.archived, 0),
        inArray(channels.type, EMBED_TYPES),
        sql`EXISTS (SELECT 1 FROM json_each(${channels.models}) WHERE json_each.value = ${body.model})`,
      ),
    )
    .all();

  if (candidate.length === 0) {
    return openaiError(`嵌入模型 ${body.model} 无可用渠道`, 404, "model_not_found");
  }

  let lastError = "";
  for (const channel of candidate) {
    try {
      const res = await fetch(`${channel.baseUrl.replace(/\/+$/, "")}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${decryptSecret(channel.apiKeyEnc)}`,
        },
        body: JSON.stringify({ model: body.model, input: body.input }),
        signal: req.signal,
      });
      if (!res.ok) {
        lastError = (await res.text().catch(() => "")).slice(0, 300) || `HTTP ${res.status}`;
        continue;
      }
      const data = (await res.json()) as {
        usage?: { prompt_tokens?: number };
        data?: Array<{ embedding: number[] }>;
      };
      const promptTokens = data.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(body.input));
      const cost = computeCost(body.model, promptTokens, 0);
      deductQuota(auth.userId, auth.tokenId, cost);
      writeLog({
        userId: auth.userId,
        tokenId: auth.tokenId,
        channelId: channel.id,
        channelName: channel.name,
        model: body.model!,
        promptTokens,
        completionTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        thinkingTokens: 0,
        usageSource: 1,
        hasUsageDetails: false,
        cost,
        latencyMs: Date.now() - started,
        status: 200,
      });
      return Response.json(data);
    } catch (err) {
      lastError = err instanceof Error ? err.message : "上游请求失败";
    }
  }

  writeLog({
    userId: auth.userId,
    tokenId: auth.tokenId,
    channelId: null,
    channelName: null,
    model: body.model!,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    thinkingTokens: 0,
    usageSource: 0,
    hasUsageDetails: false,
    cost: 0,
    latencyMs: Date.now() - started,
    status: 502,
    errorMsg: lastError,
  });
  return openaiError(`嵌入请求失败: ${lastError}`, 502, "upstream_error");
}
