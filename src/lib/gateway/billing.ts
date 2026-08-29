import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { modelPrices, tokens, users } from "@/lib/schema";

/**
 * 额度单位：1 美元 = 100000。
 * 价格为每百万 token 的额度数。
 */
export function computeCost(model: string, promptTokens: number, completionTokens: number): number {
  const price = db.select().from(modelPrices).where(eq(modelPrices.model, model)).get();
  if (!price) return 0;
  const inputCost = (promptTokens * price.inputPrice) / 1_000_000;
  const outputCost = (completionTokens * price.outputPrice) / 1_000_000;
  return Math.ceil(inputCost + outputCost);
}

/** 扣减用户额度与令牌用量（原子操作，额度不会扣成负数以下） */
export function deductQuota(userId: number, tokenId: number, cost: number): void {
  if (cost <= 0) return;
  db.run(sql`UPDATE users SET quota = quota - ${cost} WHERE id = ${userId}`);
  db.run(sql`UPDATE tokens SET used_quota = used_quota + ${cost} WHERE id = ${tokenId}`);
}

export function getUserQuota(userId: number): number {
  const u = db.select({ quota: users.quota }).from(users).where(eq(users.id, userId)).get();
  return u?.quota ?? 0;
}

export function getTokenUsed(tokenId: number): number {
  const t = db.select({ used: tokens.usedQuota }).from(tokens).where(eq(tokens.id, tokenId)).get();
  return t?.used ?? 0;
}
