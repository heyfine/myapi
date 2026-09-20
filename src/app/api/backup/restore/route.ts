import { db } from "@/lib/db";
import { channels, logs, modelPrices, retryRules, sessions, tokens, users } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";

interface BackupChannel {
  name: string;
  supplier?: string;
  type: string;
  baseUrl: string;
  apiKey: string;
  models: string;
  modelMapping?: string;
  proxy?: string;
  priority?: number;
  weight?: number;
  status?: number;
  archived?: number;
  archivedAt?: number | null;
}
interface BackupUser {
  username: string;
  passwordHash: string;
  role: string;
  quota: number;
  status: number;
}
interface BackupToken {
  username: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  quotaLimit: number;
  usedQuota: number;
  expiredAt: number | null;
  status: number;
}
interface BackupLog {
  createdAt: number;
  username: string;
  model: string | null;
  channelName: string | null;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  thinkingTokens: number;
  usageSource: number;
  hasUsageDetails: number;
  cost: number;
  latencyMs: number;
  status: number;
  errorMsg?: string;
}

/** 全量还原：覆盖现有渠道/用户/令牌/重试规则/模型定价；v2 备份额外还原调用日志 */
export async function POST(req: Request) {
  const r = await requireAdmin();
  if (r.error) return r.error;

  const body = await req.json().catch(() => null);
  const data = body?.data;
  if (!data || (data.version !== 1 && data.version !== 2) || !Array.isArray(data.channels)) {
    return Response.json({ error: "备份文件格式不正确（缺少 version 或 channels）" }, { status: 400 });
  }
  // v1 = 纯配置备份（无日志），v2 = 配置 + 调用日志
  const hasLogs = data.version === 2 && Array.isArray(data.logs);
  const backupLogs = (hasLogs ? data.logs : []) as BackupLog[];

  const backupChannels = data.channels as BackupChannel[];
  const backupUsers = (Array.isArray(data.users) ? data.users : []) as BackupUser[];
  const backupTokens = (Array.isArray(data.tokens) ? data.tokens : []) as BackupToken[];
  const backupRules = (Array.isArray(data.retryRules) ? data.retryRules : []) as Array<{
    errorCode: number;
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    jitter: number;
    enabled: number;
  }>;
  const backupPrices = (Array.isArray(data.modelPrices) ? data.modelPrices : []) as Array<{
    model: string;
    inputPrice: number;
    outputPrice: number;
  }>;

  // 渠道必填字段校验
  for (const [i, c] of backupChannels.entries()) {
    if (!c.name || !c.type || !c.baseUrl) {
      return Response.json({ error: `备份文件第 ${i + 1} 个渠道缺少 name/type/baseUrl` }, { status: 400 });
    }
  }

  const counts = { channels: 0, users: 0, tokens: 0, retryRules: 0, modelPrices: 0, logs: 0 };

  db.transaction((tx) => {
    // 清 sessions：还原会重建用户表，若不清会话，旧 token 可能映射到重排后 id 不同的另一个用户
    tx.delete(sessions).run();
    if (hasLogs) tx.delete(logs).run();
    tx.delete(tokens).run();
    tx.delete(channels).run();
    tx.delete(retryRules).run();
    tx.delete(modelPrices).run();
    tx.delete(users).run();

    // 用户：密码哈希原样带入，原账号密码在还原后依然有效
    for (const u of backupUsers) {
      tx.insert(users)
        .values({
          username: u.username,
          passwordHash: u.passwordHash,
          role: u.role === "admin" ? "admin" : "user",
          quota: u.quota ?? 0,
          status: u.status ?? 1,
        })
        .run();
      counts.users++;
    }

    // 令牌：按用户名关联到新用户；找不到所属用户的令牌跳过
    const insertedIds = tx.select({ id: users.id, username: users.username }).from(users).all();
    for (const t of backupTokens) {
      const newUserId = insertedIds.find((u) => u.username === t.username)?.id;
      if (!newUserId) continue;
      tx.insert(tokens)
        .values({
          userId: newUserId,
          name: t.name,
          keyHash: t.keyHash,
          keyPrefix: t.keyPrefix,
          quotaLimit: t.quotaLimit ?? 0,
          usedQuota: t.usedQuota ?? 0,
          expiredAt: t.expiredAt ? new Date(t.expiredAt) : null,
          status: t.status ?? 1,
        })
        .run();
      counts.tokens++;
    }

    // 渠道：API Key 用本机主密钥重新加密
    for (const c of backupChannels) {
      tx.insert(channels)
        .values({
          name: c.name,
          // 旧备份无该字段视为空（归入未分组）
          supplier: c.supplier ?? "",
          type: c.type,
          baseUrl: c.baseUrl.replace(/\/+$/, ""),
          apiKeyEnc: encryptSecret(c.apiKey ?? ""),
          models: c.models ?? "[]",
          modelMapping: c.modelMapping ?? "{}",
          proxy: c.proxy ?? "",
          priority: c.priority ?? 0,
          weight: Math.max(1, c.weight ?? 1),
          status: c.status ?? 1,
          // 归档状态：旧备份（v1/v2 无该字段）视为未归档
          archived: c.archived ? 1 : 0,
          archivedAt: c.archivedAt ? new Date(c.archivedAt) : null,
        })
        .run();
      counts.channels++;
    }

    for (const rule of backupRules) {
      tx.insert(retryRules)
        .values({
          errorCode: rule.errorCode,
          maxRetries: rule.maxRetries ?? 0,
          initialDelayMs: rule.initialDelayMs ?? 1000,
          maxDelayMs: rule.maxDelayMs ?? 10000,
          jitter: rule.jitter ?? 0.1,
          enabled: rule.enabled ?? 1,
        })
        .run();
      counts.retryRules++;
    }

    for (const p of backupPrices) {
      tx.insert(modelPrices)
        .values({ model: p.model, inputPrice: p.inputPrice ?? 0, outputPrice: p.outputPrice ?? 0 })
        .run();
      counts.modelPrices++;
    }

    // 日志（仅 v2 备份携带）：按用户名重挂 userId；找不到所属用户时挂 null，保留统计总量。
    // channelId/tokenId 置 null——已核实无任何查询读这两列，渠道归属走 channelName 字符串列。
    for (const l of backupLogs) {
      tx.insert(logs)
        .values({
          userId: insertedIds.find((u) => u.username === l.username)?.id ?? null,
          tokenId: null,
          channelId: null,
          channelName: l.channelName ?? null,
          model: l.model ?? null,
          promptTokens: l.promptTokens ?? 0,
          completionTokens: l.completionTokens ?? 0,
          cachedTokens: l.cachedTokens ?? 0,
          reasoningTokens: l.reasoningTokens ?? 0,
          thinkingTokens: l.thinkingTokens ?? 0,
          usageSource: l.usageSource ?? 0,
          hasUsageDetails: l.hasUsageDetails ?? 0,
          cost: l.cost ?? 0,
          latencyMs: l.latencyMs ?? 0,
          status: l.status ?? 0,
          errorMsg: l.errorMsg && l.errorMsg.length > 0 ? l.errorMsg : null,
          createdAt: new Date(l.createdAt),
        })
        .run();
      counts.logs++;
    }
  });

  return Response.json({ ok: true, counts });
}
