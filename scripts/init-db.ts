import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { hashPassword } from "../src/lib/crypto";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "gateway.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  quota INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,
  models TEXT NOT NULL DEFAULT '[]',
  model_mapping TEXT NOT NULL DEFAULT '{}',
  proxy TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  weight INTEGER NOT NULL DEFAULT 1,
  status INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_enc TEXT NOT NULL DEFAULT '',
  key_prefix TEXT NOT NULL,
  quota_limit INTEGER NOT NULL DEFAULT 0,
  used_quota INTEGER NOT NULL DEFAULT 0,
  expired_at INTEGER,
  status INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_user_idx ON tokens(user_id);
CREATE TABLE IF NOT EXISTS model_prices (
  model TEXT PRIMARY KEY,
  input_price INTEGER NOT NULL DEFAULT 0,
  output_price INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS retry_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  error_code INTEGER NOT NULL,
  max_retries INTEGER NOT NULL DEFAULT 0,
  initial_delay_ms INTEGER NOT NULL DEFAULT 1000,
  max_delay_ms INTEGER NOT NULL DEFAULT 10000,
  jitter REAL NOT NULL DEFAULT 0.1,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  token_id INTEGER,
  channel_id INTEGER,
  channel_name TEXT,
  model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  thinking_tokens INTEGER NOT NULL DEFAULT 0,
  usage_source INTEGER NOT NULL DEFAULT 0,
  has_usage_details INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL,
  error_msg TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_user_idx ON logs(user_id);
CREATE INDEX IF NOT EXISTS logs_created_idx ON logs(created_at);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expired_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`);

// 旧库迁移：为 retry_rules 补充指数退避字段，并把原重试间隔迁移为首次等待
const retryCols = (
  db.prepare("PRAGMA table_info(retry_rules)").all() as Array<{ name: string }>
).map((c) => c.name);
if (!retryCols.includes("initial_delay_ms")) {
  db.exec("ALTER TABLE retry_rules ADD COLUMN initial_delay_ms INTEGER NOT NULL DEFAULT 1000");
  db.exec("UPDATE retry_rules SET initial_delay_ms = interval_ms");
  console.log("已迁移: interval_ms -> initial_delay_ms");
}
if (!retryCols.includes("max_delay_ms")) {
  db.exec("ALTER TABLE retry_rules ADD COLUMN max_delay_ms INTEGER NOT NULL DEFAULT 10000");
}
if (!retryCols.includes("jitter")) {
  db.exec("ALTER TABLE retry_rules ADD COLUMN jitter REAL NOT NULL DEFAULT 0.1");
}

// 旧库迁移：channels 补充 model_mapping 列
const channelCols = (
  db.prepare("PRAGMA table_info(channels)").all() as Array<{ name: string }>
).map((c) => c.name);
if (!channelCols.includes("model_mapping")) {
  db.exec("ALTER TABLE channels ADD COLUMN model_mapping TEXT NOT NULL DEFAULT '{}'");
  console.log("已迁移: channels 增加 model_mapping 列");
}
if (!channelCols.includes("proxy")) {
  db.exec("ALTER TABLE channels ADD COLUMN proxy TEXT NOT NULL DEFAULT ''");
  console.log("已迁移: channels 增加 proxy 列");
}
if (!channelCols.includes("archived")) {
  db.exec("ALTER TABLE channels ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
  console.log("已迁移: channels 增加 archived 列");
}
if (!channelCols.includes("archived_at")) {
  db.exec("ALTER TABLE channels ADD COLUMN archived_at INTEGER");
  console.log("已迁移: channels 增加 archived_at 列");
}

// 旧库迁移：logs 补充 Token 分类统计列
const logCols = (
  db.prepare("PRAGMA table_info(logs)").all() as Array<{ name: string }>
).map((c) => c.name);
if (!logCols.includes("cached_tokens")) {
  db.exec("ALTER TABLE logs ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0");
  db.exec("ALTER TABLE logs ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0");
  db.exec("ALTER TABLE logs ADD COLUMN thinking_tokens INTEGER NOT NULL DEFAULT 0");
  console.log("已迁移: logs 增加 cached/reasoning/thinking_tokens 列");
}
if (!logCols.includes("usage_source")) {
  db.exec("ALTER TABLE logs ADD COLUMN usage_source INTEGER NOT NULL DEFAULT 0");
  db.exec("ALTER TABLE logs ADD COLUMN has_usage_details INTEGER NOT NULL DEFAULT 0");
  console.log("已迁移: logs 增加 usage_source / has_usage_details 列");
}
// 旧库迁移：tokens 补充 key_enc 列（旧令牌无明文，无法补录）
const tokenCols = (
  db.prepare("PRAGMA table_info(tokens)").all() as Array<{ name: string }>
).map((c) => c.name);
if (!tokenCols.includes("key_enc")) {
  db.exec("ALTER TABLE tokens ADD COLUMN key_enc TEXT NOT NULL DEFAULT ''");
  console.log("已迁移: tokens 增加 key_enc 列（旧令牌不可取回明文）");
}

// 种子管理员：admin / admin123
const admin = db
  .prepare("SELECT id FROM users WHERE username = ?")
  .get("admin") as { id: number } | undefined;
if (!admin) {
  db.prepare(
    "INSERT INTO users (username, password_hash, role, quota, status, created_at) VALUES (?, ?, 'admin', 100000000, 1, ?)",
  ).run("admin", hashPassword("admin123"), Date.now());
  console.log("已创建管理员账号: admin / admin123（请尽快修改密码）");
}

// 常见模型默认定价（每百万 token，单位：1 美元 = 100000）
const prices: Record<string, [number, number]> = {
  "gpt-4o": [25000, 50000],
  "gpt-4o-mini": [1500, 6000],
  "gpt-4.1": [20000, 80000],
  "gpt-4.1-mini": [4000, 16000],
  o3: [20000, 80000],
  "claude-3-5-sonnet-20241022": [30000, 150000],
  "claude-3-5-haiku-20241022": [8000, 40000],
  "claude-sonnet-4-20250514": [30000, 150000],
  "gemini-2.0-flash": [1000, 4000],
  "gemini-2.5-pro": [12500, 50000],
  "deepseek-chat": [2700, 11000],
  "glm-4.5": [6000, 6000],
  "glm-4.5-air": [2000, 2000],
  "text-embedding-3-small": [200, 0],
  "text-embedding-3-large": [1300, 0],
};
const insPrice = db.prepare(
  "INSERT OR IGNORE INTO model_prices (model, input_price, output_price) VALUES (?, ?, ?)",
);
for (const [m, [i, o]] of Object.entries(prices)) insPrice.run(m, i, o);

// 失败重连规则默认值（仅表为空时写入）
const ruleCount = (db.prepare("SELECT count(*) AS n FROM retry_rules").get() as { n: number }).n;
if (ruleCount === 0) {
  const insRule = db.prepare(
    "INSERT INTO retry_rules (error_code, max_retries, initial_delay_ms, max_delay_ms, jitter, enabled) VALUES (?, ?, ?, ?, ?, 1)",
  );
  insRule.run(0, 1, 1000, 10000, 0.1); // 全局默认：所有未单独设置的代号走这条
  insRule.run(429, 3, 2000, 10000, 0.1); // 限流：重试 3 次，首次等 2s
  insRule.run(500, 1, 1000, 10000, 0.1); // 服务端错误：重试 1 次，首次等 1s
  console.log("已写入默认重试规则: 全局默认→1次/首等1s, 429→3次/首等2s, 500→1次/首等1s");
} else {
  // 确保全局默认规则（error_code = 0）常驻存在
  const hasGlobal = db.prepare("SELECT id FROM retry_rules WHERE error_code = 0").get();
  if (!hasGlobal) {
    db.prepare(
      "INSERT INTO retry_rules (error_code, max_retries, initial_delay_ms, max_delay_ms, jitter, enabled) VALUES (0, 1, 1000, 10000, 0.1, 1)",
    ).run();
    console.log("已补建全局默认重试规则: 1次/首等1s/上限10s/10%抖动");
  }
}

console.log("数据库初始化完成:", path.join(DATA_DIR, "gateway.db"));
db.close();
