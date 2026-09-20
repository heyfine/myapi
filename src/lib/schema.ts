import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

// 额度单位：统一用"美分 ×1000"的整数（即 0.001 美分 = 1 单位），避免浮点误差。
// 1 美元 = 100000 单位。

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"), // admin | user
  quota: integer("quota").notNull().default(0), // 剩余额度（单位见上）
  status: integer("status").notNull().default(1), // 1 启用 0 禁用
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const channels = sqliteTable("channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(), // openai | openai-compatible | anthropic | gemini
  baseUrl: text("base_url").notNull(),
  apiKeyEnc: text("api_key_enc").notNull(), // AES-256-GCM 密文
  models: text("models").notNull().default("[]"), // JSON 数组：对外暴露的模型名
  modelMapping: text("model_mapping").notNull().default("{}"), // JSON 对象：对外模型名 -> 上游真实模型名
  proxy: text("proxy").notNull().default(""), // 代理地址：http:// 或 socks5://，空为直连
  priority: integer("priority").notNull().default(0), // 数字越大越优先
  weight: integer("weight").notNull().default(1),
  status: integer("status").notNull().default(1), // 1 启用 0 停用
  archived: integer("archived").notNull().default(0), // 1 归档（不参与路由/统计，仅在归档页可见）
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }), // 归档时间；未归档为 null
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const tokens = sqliteTable(
  "tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(), // SHA-256(sk-key)
    keyEnc: text("key_enc").notNull().default(""), // 加密存储的完整 Key（旧令牌为空，无法取回）
    keyPrefix: text("key_prefix").notNull(), // 展示用前缀 sk-xxxx
    quotaLimit: integer("quota_limit").notNull().default(0), // 0 = 不限
    usedQuota: integer("used_quota").notNull().default(0),
    expiredAt: integer("expired_at", { mode: "timestamp_ms" }), // null = 永不过期
    status: integer("status").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("tokens_user_idx").on(t.userId)],
);

export const modelPrices = sqliteTable("model_prices", {
  model: text("model").primaryKey(),
  // 每百万 token 的价格（单位同上：1 美元 = 100000）
  inputPrice: integer("input_price").notNull().default(0),
  outputPrice: integer("output_price").notNull().default(0),
});

// 失败重连规则：error_code = 上游 HTTP 状态码，0 表示"其他错误"兜底规则
// 等待时间指数退避：第 n 次重试等待 initial_delay_ms × 2^(n-1)，不超过 max_delay_ms，
// 再乘以 (1±jitter) 的随机抖动
export const retryRules = sqliteTable("retry_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  errorCode: integer("error_code").notNull(),
  maxRetries: integer("max_retries").notNull().default(0),
  initialDelayMs: integer("initial_delay_ms").notNull().default(1000),
  maxDelayMs: integer("max_delay_ms").notNull().default(10000),
  jitter: real("jitter").notNull().default(0.1),
  enabled: integer("enabled").notNull().default(1),
});

export const logs = sqliteTable(
  "logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id"),
    tokenId: integer("token_id"),
    channelId: integer("channel_id"),
    channelName: text("channel_name"),
    model: text("model"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0), // 缓存命中
    reasoningTokens: integer("reasoning_tokens").notNull().default(0), // 推理（OpenAI/DeepSeek 系）
    thinkingTokens: integer("thinking_tokens").notNull().default(0), // 思考（Gemini thoughtsTokenCount）
    usageSource: integer("usage_source").notNull().default(0), // 0 旧数据 1 上游返回 2 估算
    hasUsageDetails: integer("has_usage_details").notNull().default(0), // 上游是否返回缓存/推理明细字段
    cost: integer("cost").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    status: integer("status").notNull(), // 200 成功；其他为上游/网关状态码
    errorMsg: text("error_msg"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("logs_user_idx").on(t.userId), index("logs_created_idx").on(t.createdAt)],
);

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(), // 随机会话 id 的哈希
  userId: integer("user_id").notNull(),
  expiredAt: integer("expired_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
