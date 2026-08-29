import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { retryRules } from "@/lib/schema";

export interface RetryRule {
  id: number;
  errorCode: number; // 0 = 其他错误兜底
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitter: number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 按上游状态码取重试规则：优先精确匹配错误代号，
 * 其次命中 error_code = 0 的兜底规则；都没有则不重试。
 */
export function getRetryRule(status: number): RetryRule | null {
  const rules = db.select().from(retryRules).where(eq(retryRules.enabled, 1)).all();
  return (
    rules.find((r) => r.errorCode === status) ??
    rules.find((r) => r.errorCode === 0) ??
    null
  );
}

/**
 * 计算第 retriesDone+1 次（从 0 计）重试前的等待时间：
 * 首次等待 initial_delay_ms，之后每次翻倍，上限 max_delay_ms，
 * 再乘以 (1 ± jitter) 的随机抖动，避免重试风暴。
 */
export function computeRetryDelay(rule: RetryRule, retriesDone: number): number {
  let delay = rule.initialDelayMs * Math.pow(2, retriesDone);
  delay = Math.min(delay, rule.maxDelayMs);
  const factor = 1 + (Math.random() * 2 - 1) * rule.jitter;
  return Math.max(0, Math.round(delay * factor));
}
