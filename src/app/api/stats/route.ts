import { sql, and, eq, gte, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, logs } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

/** 本地时区的 YYYY-MM-DD */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET() {
  const r = await requireUser();
  if (r.error) return r.error;

  const dayAgo = new Date(Date.now() - 86400000);
  const scope: SQL[] = [];
  if (r.user.role !== "admin") scope.push(eq(logs.userId, r.user.id));

  const overall = db
    .select({
      total: sql<number>`count(*)`,
      success: sql<number>`sum(case when status = 200 then 1 else 0 end)`,
      cost: sql<number>`coalesce(sum(cost), 0)`,
      promptTokens: sql<number>`coalesce(sum(prompt_tokens), 0)`,
      completionTokens: sql<number>`coalesce(sum(completion_tokens), 0)`,
      cachedTokens: sql<number>`coalesce(sum(cached_tokens), 0)`,
      reasoningTokens: sql<number>`coalesce(sum(reasoning_tokens), 0)`,
      thinkingTokens: sql<number>`coalesce(sum(thinking_tokens), 0)`,
      // 不限制 usage_source：usage_source/has_usage_details 是 PRAGMA 迁移列（ALTER TABLE 默认 0），
      // 迁移前写入的成功调用 usage_source=0 但同样没有明细，原条件 usage_source = 1 会漏算这批
      detailMissing: sql<number>`sum(case when status = 200 and has_usage_details = 0 then 1 else 0 end)`,
      estimatedCount: sql<number>`sum(case when status = 200 and usage_source = 2 then 1 else 0 end)`,
    })
    .from(logs)
    .where(scope.length > 0 ? and(...scope) : undefined)
    .get();

  const today = db
    .select({
      total: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(cost), 0)`,
    })
    .from(logs)
    .where(scope.length > 0 ? and(...scope, gte(logs.createdAt, dayAgo)) : gte(logs.createdAt, dayAgo))
    .get();

  const byModel = db
    .select({
      model: logs.model,
      total: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(cost), 0)`,
      promptTokens: sql<number>`coalesce(sum(prompt_tokens), 0)`,
      completionTokens: sql<number>`coalesce(sum(completion_tokens), 0)`,
      cachedTokens: sql<number>`coalesce(sum(cached_tokens), 0)`,
      reasoningTokens: sql<number>`coalesce(sum(reasoning_tokens), 0)`,
      thinkingTokens: sql<number>`coalesce(sum(thinking_tokens), 0)`,
    })
    .from(logs)
    .where(scope.length > 0 ? and(...scope, gte(logs.createdAt, dayAgo)) : gte(logs.createdAt, dayAgo))
    .groupBy(logs.model)
    .orderBy(sql`count(*) desc`)
    .limit(10)
    .all();

  // ---- 趋势聚合 ----
  // 桶 × 模型 在 SQL 侧 GROUP BY，只返回聚合行；避免把整段窗口日志捞进内存再遍历
  // （日志量大时那一步是 O(全量行) 的同步阻塞，会占住事件循环，卡住并发跑的网关转发）
  interface Bucket {
    total: number;
    success: number;
    cost: number;
    promptTokens: number;
    completionTokens: number;
    perModel: Record<string, { count: number; cost: number; tokens: number }>;
  }
  interface TrendRow {
    bucket: unknown;
    model: string | null;
    total: number;
    success: number;
    cost: number;
    promptTokens: number;
    completionTokens: number;
  }
  function emptyBucket(): Bucket {
    return { total: 0, success: 0, cost: 0, promptTokens: 0, completionTokens: 0, perModel: {} };
  }
  function mergeBucket(b: Bucket, row: TrendRow): void {
    b.total += row.total;
    b.success += row.success;
    b.cost += row.cost;
    b.promptTokens += row.promptTokens;
    b.completionTokens += row.completionTokens;
    const pm = (b.perModel[row.model ?? "未知"] ??= { count: 0, cost: 0, tokens: 0 });
    pm.count += row.total;
    pm.cost += row.cost;
    pm.tokens += row.promptTokens + row.completionTokens;
  }
  function groupedTrend(bucketExpr: SQL, since: Date): TrendRow[] {
    return db
      .select({
        bucket: bucketExpr,
        model: logs.model,
        total: sql<number>`count(*)`,
        success: sql<number>`sum(case when ${logs.status} = 200 then 1 else 0 end)`,
        cost: sql<number>`coalesce(sum(${logs.cost}), 0)`,
        promptTokens: sql<number>`coalesce(sum(${logs.promptTokens}), 0)`,
        completionTokens: sql<number>`coalesce(sum(${logs.completionTokens}), 0)`,
      })
      .from(logs)
      .where(scope.length > 0 ? and(...scope, gte(logs.createdAt, since)) : gte(logs.createdAt, since))
      .groupBy(bucketExpr, logs.model)
      .all();
  }

  // 近 14 天逐日趋势（SQL 侧 GROUP BY 日×模型，JS 侧只补零桶与标签）
  const daysAgo14 = new Date(Date.now() - 14 * 86400000);
  daysAgo14.setHours(0, 0, 0, 0);
  const dailyMap = new Map<string, Bucket>();
  for (let i = 0; i < 14; i++) {
    dailyMap.set(localDateKey(new Date(daysAgo14.getTime() + i * 86400000)), emptyBucket());
  }
  for (const row of groupedTrend(sql`date(${logs.createdAt} / 1000, 'unixepoch', 'localtime')`, daysAgo14)) {
    const b = dailyMap.get(String(row.bucket));
    if (b) mergeBucket(b, row);
  }
  const daily = [...dailyMap.entries()].map(([date, v]) => ({
    date,
    label: date.slice(5).replace("-", "/"),
    ...v,
  }));

  // 全部模型（来自启用的渠道），供仪表盘模型列表展示
  const enabledChannels = db.select({ models: channels.models }).from(channels).where(eq(channels.status, 1)).all();
  const modelSet = new Set<string>();
  for (const c of enabledChannels) {
    try {
      for (const m of JSON.parse(c.models) as string[]) if (m) modelSet.add(m);
    } catch {
      /* 忽略脏数据 */
    }
  }
  const allModels = [...modelSet].sort();

  // 近 24 小时逐小时趋势（桶边界沿用原实现：UTC 整点，标签取本地小时）
  const now = Date.now();
  const hourBuckets = new Map<number, Bucket>();
  const hourlyLabels: number[] = [];
  for (let i = 23; i >= 0; i--) {
    const start = Math.floor((now - i * 3600000) / 3600000) * 3600000;
    hourBuckets.set(start, emptyBucket());
    hourlyLabels.push(start);
  }
  for (const row of groupedTrend(sql`(${logs.createdAt} / 3600000) * 3600000`, new Date(now - 24 * 3600000))) {
    const b = hourBuckets.get(Number(row.bucket));
    if (b) mergeBucket(b, row);
  }
  const hourly = hourlyLabels.map((ts) => {
    const d = new Date(ts);
    return {
      date: `${String(d.getHours()).padStart(2, "0")}:00`,
      label: `${String(d.getHours()).padStart(2, "0")}时`,
      ...hourBuckets.get(ts)!,
    };
  });

  // 近 60 分钟逐分钟趋势（桶边界沿用同构实现：UTC 整分钟；配合前端 5s 轮询，分钟级波动实时可见）
  const MINUTES = 60;
  const minuteBuckets = new Map<number, Bucket>();
  const minuteLabels: number[] = [];
  for (let i = MINUTES - 1; i >= 0; i--) {
    const start = Math.floor((now - i * 60000) / 60000) * 60000;
    minuteBuckets.set(start, emptyBucket());
    minuteLabels.push(start);
  }
  for (const row of groupedTrend(sql`(${logs.createdAt} / 60000) * 60000`, new Date(now - MINUTES * 60000))) {
    const b = minuteBuckets.get(Number(row.bucket));
    if (b) mergeBucket(b, row);
  }
  const minutely = minuteLabels.map((ts) => {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return { date: `${hh}:${mm}`, label: `${hh}:${mm}`, ...minuteBuckets.get(ts)! };
  });

  // no-store：前端 5s 轮询此端点，不允许浏览器启发式缓存，否则表现为"轮询了但数字不动"
  return Response.json({
    overall:
      overall ??
      {
        total: 0,
        success: 0,
        cost: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        thinkingTokens: 0,
        detailMissing: 0,
        estimatedCount: 0,
      },
    today: today ?? { total: 0, cost: 0 },
    byModel,
    daily,
    hourly,
    minutely,
    allModels,
  }, { headers: { "Cache-Control": "no-store" } });
}
