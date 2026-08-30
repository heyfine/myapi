import { sql, and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, logs } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { buildDailyTrend, buildHourlyTrend, buildMinutelyTrend } from "@/lib/trend";

export async function GET() {
  const r = await requireUser();
  if (r.error) return r.error;

  const dayAgo = new Date(Date.now() - 86400000);
  const scope = r.user.role !== "admin" ? eq(logs.userId, r.user.id) : undefined;

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
    .where(scope ? scope : undefined)
    .get();

  const today = db
    .select({
      total: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(cost), 0)`,
    })
    .from(logs)
    .where(scope ? and(scope, gte(logs.createdAt, dayAgo)) : gte(logs.createdAt, dayAgo))
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
    .where(scope ? and(scope, gte(logs.createdAt, dayAgo)) : gte(logs.createdAt, dayAgo))
    .groupBy(logs.model)
    .orderBy(sql`count(*) desc`)
    .limit(10)
    .all();

  // 趋势：公共库聚合（按模型分序列）；SQL 侧 GROUP BY，日志量大时不阻塞事件循环
  const daily = buildDailyTrend(logs.model, scope);
  const hourly = buildHourlyTrend(logs.model, scope);
  const minutely = buildMinutelyTrend(logs.model, scope);

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
