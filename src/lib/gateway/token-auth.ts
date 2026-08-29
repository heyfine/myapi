import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tokens, users } from "@/lib/schema";
import { sha256 } from "@/lib/crypto";
import { openaiError } from "./openai-types";

export interface GatewayAuth {
  userId: number;
  userQuota: number;
  tokenId: number;
  tokenQuotaLimit: number;
  tokenUsedQuota: number;
}

/** 校验 Bearer sk- 令牌，返回网关鉴权信息或 OpenAI 风格错误 */
export function authenticateGatewayToken(req: Request): GatewayAuth | Response {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!key || !key.startsWith("sk-")) {
    return openaiError("缺少 API 令牌，请在 Authorization 头中提供 sk- 开头的令牌", 401, "invalid_request_error");
  }
  const row = db
    .select({
      tokenId: tokens.id,
      keyHash: tokens.keyHash,
      status: tokens.status,
      expiredAt: tokens.expiredAt,
      quotaLimit: tokens.quotaLimit,
      usedQuota: tokens.usedQuota,
      userId: users.id,
      userStatus: users.status,
      userQuota: users.quota,
    })
    .from(tokens)
    .innerJoin(users, eq(users.id, tokens.userId))
    .where(eq(tokens.keyHash, sha256(key)))
    .get();

  if (!row) return openaiError("无效的 API 令牌", 401, "invalid_request_error");
  if (row.status !== 1) return openaiError("该令牌已被禁用", 403, "permission_error");
  if (row.expiredAt && row.expiredAt.getTime() < Date.now()) {
    return openaiError("该令牌已过期", 403, "permission_error");
  }
  if (row.quotaLimit > 0 && row.usedQuota >= row.quotaLimit) {
    return openaiError("该令牌额度已用尽", 402, "insufficient_quota");
  }
  if (row.userStatus !== 1) return openaiError("账号已被禁用", 403, "permission_error");
  if (row.userQuota <= 0) return openaiError("账户余额不足，请联系管理员充值", 402, "insufficient_quota");

  return {
    userId: row.userId,
    userQuota: row.userQuota,
    tokenId: row.tokenId,
    tokenQuotaLimit: row.quotaLimit,
    tokenUsedQuota: row.usedQuota,
  };
}
