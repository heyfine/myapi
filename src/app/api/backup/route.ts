import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, logs, modelPrices, retryRules, tokens, users } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";

/** 导出全部配置 + 调用日志：渠道（含解密后的 Key）、用户、令牌、重试规则、模型定价、日志（Token 用量统计的数据源） */
export async function GET() {
  const r = await requireAdmin();
  if (r.error) return r.error;

  const channelList = db.select().from(channels).all();
  const userRows = db
    .select({ id: users.id, username: users.username, passwordHash: users.passwordHash, role: users.role, quota: users.quota, status: users.status })
    .from(users)
    .all();
  const tokenRows = db.select().from(tokens).all();
  const ruleRows = db.select().from(retryRules).all();
  const priceRows = db.select().from(modelPrices).all();
  const logRows = db
    .select({ createdAt: logs.createdAt, username: users.username, model: logs.model, channelName: logs.channelName, promptTokens: logs.promptTokens, completionTokens: logs.completionTokens, cachedTokens: logs.cachedTokens, reasoningTokens: logs.reasoningTokens, thinkingTokens: logs.thinkingTokens, usageSource: logs.usageSource, hasUsageDetails: logs.hasUsageDetails, cost: logs.cost, latencyMs: logs.latencyMs, status: logs.status, errorMsg: logs.errorMsg })
    .from(logs)
    .leftJoin(users, eq(users.id, logs.userId))
    .orderBy(logs.id)
    .all();

  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    channels: channelList.map((c) => {
      let apiKey = "";
      try {
        apiKey = decryptSecret(c.apiKeyEnc);
      } catch {
        apiKey = ""; // 解密失败（如主密钥变更），留空让导入方手动补填
      }
      return {
        name: c.name,
        supplier: c.supplier,
        type: c.type,
        baseUrl: c.baseUrl,
        apiKey,
        models: c.models,
        modelMapping: c.modelMapping,
        proxy: c.proxy,
        priority: c.priority,
        weight: c.weight,
        status: c.status,
        archived: c.archived,
        archivedAt: c.archivedAt ? c.archivedAt.getTime() : null,
      };
    }),
    users: userRows,
    tokens: tokenRows.map((t) => ({
      username: userRows.find((u) => u.id === t.userId)?.username ?? "",
      name: t.name,
      keyHash: t.keyHash,
      keyPrefix: t.keyPrefix,
      quotaLimit: t.quotaLimit,
      usedQuota: t.usedQuota,
      expiredAt: t.expiredAt ? t.expiredAt.getTime() : null,
      status: t.status,
    })),
    retryRules: ruleRows,
    modelPrices: priceRows,
    // 调用日志：Token 用量统计 / 仪表盘 / 模型详情页的数据源。
    // 以 username 关联（还原时重挂到新 userId）；channelName 是日志表自带的字符串列，
    // 不依赖渠道表外键；channelId/tokenId 不导出——已核实无任何查询读这两列，置空零损失。
    logs: logRows.map((l) => ({
      createdAt: l.createdAt.getTime(),
      username: l.username ?? "",
      model: l.model,
      channelName: l.channelName,
      promptTokens: l.promptTokens,
      completionTokens: l.completionTokens,
      cachedTokens: l.cachedTokens,
      reasoningTokens: l.reasoningTokens,
      thinkingTokens: l.thinkingTokens,
      usageSource: l.usageSource,
      hasUsageDetails: l.hasUsageDetails,
      cost: l.cost,
      latencyMs: l.latencyMs,
      status: l.status,
      errorMsg: l.errorMsg ?? "",
    })),
  };

  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="gateway-backup-${stamp}.json"`,
    },
  });
}
