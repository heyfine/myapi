import { db } from "@/lib/db";
import { logs } from "@/lib/schema";

export interface LogEntry {
  userId: number | null;
  tokenId: number | null;
  channelId: number | null;
  channelName: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  thinkingTokens: number;
  usageSource: number; // 0 旧数据 1 上游返回 2 估算
  hasUsageDetails: boolean; // 上游是否返回缓存/推理明细
  cost: number;
  latencyMs: number;
  status: number;
  errorMsg?: string | null;
}

export function writeLog(entry: LogEntry): void {
  try {
    db.insert(logs)
      .values({
        userId: entry.userId,
        tokenId: entry.tokenId,
        channelId: entry.channelId,
        channelName: entry.channelName,
        model: entry.model,
        promptTokens: entry.promptTokens,
        completionTokens: entry.completionTokens,
        cachedTokens: entry.cachedTokens,
        reasoningTokens: entry.reasoningTokens,
        thinkingTokens: entry.thinkingTokens,
        usageSource: entry.usageSource,
        hasUsageDetails: entry.hasUsageDetails ? 1 : 0,
        cost: entry.cost,
        latencyMs: entry.latencyMs,
        status: entry.status,
        errorMsg: entry.errorMsg ?? null,
      })
      .run();
  } catch (err) {
    console.error("写日志失败", err);
  }
}
