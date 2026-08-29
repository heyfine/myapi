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
      detailMissing: sql<number>`sum(case when status = 200 and has_usage_details = 0 and usage_source = 1 then 1 else 0 end)`,
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

  // 近 14 天逐日趋势（在 JS 侧按本地时区聚合，含逐模型分解供堆叠图使用）
  const daysAgo14 = new Date(Date.now() - 14 * 86400000);
  daysAgo14.setHours(0, 0, 0, 0);
  type Bucket = {
    total: number;
    success: number;
    cost: number;
    promptTokens: number;
    completionTokens: number;
    perModel: Record<string, { count: number; cost: number; tokens: number }>;
  };
  const newBucket = (): Bucket => ({ total: 0, success: 0, cost: 0, promptTokens: 0, completionTokens: 0, perModel: {} });
  const addToBucket = (b: Bucket, model: string, status: number, cost: number, p: number, c: number) => {
    b.total++;
    if (status === 200) b.success++;
    b.cost += cost;
    b.promptTokens += p;
    b.completionTokens += c;
    const pm = (b.perModel[model] ??= { count: 0, cost: 0, tokens: 0 });
    pm.count++;
    pm.cost += cost;
    pm.tokens += p + c;
  };
  const trendRows = db
    .select({ createdAt: logs.createdAt, cost: logs.cost, status: logs.status, promptTokens: logs.promptTokens, completionTokens: logs.completionTokens, model: logs.model })
    .from(logs)
    .where(scope.length > 0 ? and(...scope, gte(logs.createdAt, daysAgo14)) : gte(logs.createdAt, daysAgo14))
    .all();
  const dailyMap = new Map<string, Bucket>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(daysAgo14.getTime() + i * 86400000);
    dailyMap.set(localDateKey(d), newBucket());
  }
  for (const row of trendRows) {
    const bucket = dailyMap.get(localDateKey(new Date(row.createdAt)));
    if (bucket) addToBucket(bucket, row.model ?? "未知", row.status, row.cost, row.promptTokens, row.completionTokens);
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

  // 近 24 小时逐小时趋势
  const now = Date.now();
  const hourBuckets = new Map<number, Bucket>();
  const hourlyLabels: number[] = [];
  for (let i = 23; i >= 0; i--) {
    const start = new Date(Math.floor((now - i * 3600000) / 3600000) * 3600000);
    hourBuckets.set(start.getTime(), newBucket());
    hourlyLabels.push(start.getTime());
  }
  const dayAgo24 = new Date(now - 24 * 3600000);
  const hourRows = db
    .select({ createdAt: logs.createdAt, cost: logs.cost, status: logs.status, promptTokens: logs.promptTokens, completionTokens: logs.completionTokens, model: logs.model })
    .from(logs)
    .where(scope.length > 0 ? and(...scope, gte(logs.createdAt, dayAgo24)) : gte(logs.createdAt, dayAgo24))
    .all();
  for (const row of hourRows) {
    const bucketStart = Math.floor(new Date(row.createdAt).getTime() / 3600000) * 3600000;
    const bucket = hourBuckets.get(bucketStart);
    if (bucket) addToBucket(bucket, row.model ?? "未知", row.status, row.cost, row.promptTokens, row.completionTokens);
  }
  const hourly = hourlyLabels.map((ts) => {
    const d = new Date(ts);
    const v = hourBuckets.get(ts)!;
    return {
      date: `${String(d.getHours()).padStart(2, "0")}:00`,
      label: `${String(d.getHours()).padStart(2, "0")}时`,
      ...v,
    };
  });

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
    allModels,
  });
}
