import { db } from "@/lib/db";
import { authenticateGatewayToken } from "@/lib/gateway/token-auth";
import { callUpstream, selectChannels, shouldFailover } from "@/lib/gateway/router";
import { computeCost, deductQuota } from "@/lib/gateway/billing";
import { writeLog } from "@/lib/gateway/logger";
import { getRetryRule, computeRetryDelay, sleep } from "@/lib/gateway/retry";
import { openaiError, type OpenAIChatRequest } from "@/lib/gateway/openai-types";

export const maxDuration = 300;

/** 最多尝试的渠道数（failover 上限）；每个渠道内还会按重试规则再试 */
const MAX_CHANNELS = 3;

export async function POST(req: Request) {
  const started = Date.now();

  // 1. 令牌鉴权
  const auth = authenticateGatewayToken(req);
  if (auth instanceof Response) return auth;

  // 2. 解析请求体
  let body: OpenAIChatRequest;
  try {
    body = (await req.json()) as OpenAIChatRequest;
  } catch {
    return openaiError("请求体不是合法 JSON", 400, "invalid_request_error");
  }
  if (!body?.model || !Array.isArray(body?.messages) || body.messages.length === 0) {
    return openaiError("缺少 model 或 messages 字段", 400, "invalid_request_error");
  }

  // 3. 选路
  const candidates = selectChannels(body.model);
  if (candidates.length === 0) {
    return openaiError(`模型 ${body.model} 无可用渠道`, 404, "model_not_found");
  }

  const attempted = candidates.slice(0, MAX_CHANNELS);
  let lastFailure: { status: number; error: string; channelName: string; channelId: number } | null = null;

  for (let ci = 0; ci < attempted.length; ci++) {
    const channel = attempted[ci];
    const usageHolder = { value: null as import("@/lib/gateway/openai-types").GatewayUsage | null };
    const onUsage = (u: import("@/lib/gateway/openai-types").GatewayUsage) => {
      usageHolder.value = u;
    };

    // 同一渠道：按重试规则指数退避重试
    let retriesDone = 0;
    let result = await callUpstream(channel, body, onUsage, req.signal);
    while (!result.ok) {
      const rule = getRetryRule(result.status);
      if (rule && retriesDone < rule.maxRetries) {
        await sleep(computeRetryDelay(rule, retriesDone));
        retriesDone++;
        result = await callUpstream(channel, body, onUsage, req.signal);
        continue;
      }

      // 不重试或重试耗尽：决定 failover 还是直接返回错误
      lastFailure = { status: result.status, error: result.error, channelName: result.channelName, channelId: result.channelId };
      const canFailover = shouldFailover(result) && ci < attempted.length - 1;
      if (!canFailover) {
        writeLog({
          userId: auth.userId,
          tokenId: auth.tokenId,
          channelId: result.channelId,
          channelName: result.channelName,
          model: body.model,
          promptTokens: 0,
          completionTokens: 0,
          cachedTokens: 0,
          reasoningTokens: 0,
          thinkingTokens: 0,
          usageSource: 0,
          hasUsageDetails: false,
          cost: 0,
          latencyMs: Date.now() - started,
          status: result.status,
          errorMsg: `重试 ${retriesDone} 次后失败: ${result.error}`,
        });
        return openaiError(
          `上游渠道「${result.channelName}」返回错误: ${result.error}`,
          result.status >= 400 && result.status < 600 ? result.status : 502,
          "upstream_error",
        );
      }
      break; // 切换下一渠道
    }

    if (!result.ok) continue; // failover 到下一个渠道

    // 4. 成功：计费与日志在响应完成后执行
    const finish = () => {
      const u = usageHolder.value ?? {
        promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, thinkingTokens: 0,
        estimated: true, hasDetails: false,
      };
      const cost = computeCost(body.model, u.promptTokens, u.completionTokens);
      deductQuota(auth.userId, auth.tokenId, cost);
      writeLog({
        userId: auth.userId,
        tokenId: auth.tokenId,
        channelId: result.ok ? result.channelId : null,
        channelName: result.ok ? result.channelName : null,
        model: body.model,
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        cachedTokens: u.cachedTokens,
        reasoningTokens: u.reasoningTokens,
        thinkingTokens: u.thinkingTokens,
        usageSource: u.estimated ? 2 : 1,
        hasUsageDetails: u.hasDetails,
        cost,
        latencyMs: Date.now() - started,
        status: 200,
        errorMsg: retriesDone > 0 ? `经 ${retriesDone} 次重试后成功` : null,
      });
    };

    if (body.stream) {
      const inner = result.response.body!;
      const wrapped = inner.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          flush() {
            try {
              finish();
            } catch (err) {
              console.error("流式记账失败", err);
            }
          },
        }),
      );
      return new Response(wrapped, { headers: result.response.headers });
    }

    finish();
    return result.response;
  }

  return openaiError(
    `所有候选渠道均失败，最后错误（${lastFailure?.channelName}）: ${lastFailure?.error}`,
    lastFailure?.status ?? 502,
    "upstream_error",
  );
}
