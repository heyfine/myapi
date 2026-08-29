import { db } from "@/lib/db";
import { channels, modelPrices, retryRules, tokens, users } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";

/** 导出全部配置：渠道（含解密后的 Key）、用户、令牌、重试规则、模型定价 */
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

  const payload = {
    version: 1,
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
        type: c.type,
        baseUrl: c.baseUrl,
        apiKey,
        models: c.models,
        modelMapping: c.modelMapping,
        proxy: c.proxy,
        priority: c.priority,
        weight: c.weight,
        status: c.status,
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
  };

  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="gateway-backup-${stamp}.json"`,
    },
  });
}
