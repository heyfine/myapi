import { and, eq, gte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, logs } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { buildDailyTrend, buildHourlyTrend, buildMinutelyTrend } from "@/lib/trend";

/** 单个模型的详细统计：供应商渠道、按渠道分解、耗时/状态/Token 明细 */
export async function GET(req: Request) {
  const r = await requireUser();
  if (r.error) return r.error;
  const url = new URL(req.url);
  const model = url.searchParams.get("model") ?? "";
  const range = url.searchParams.get("range") ?? "all"; // all | 24h | 7d
  if (!model) return Response.json({ error: "缺少 model 参数" }, { status: 400 });

  const conds: SQL[] = [eq(logs.model, model)];
  if (r.user.role !== "admin") conds.push(eq(logs.userId, r.user.id));
  if (range === "24h") conds.push(gte(logs.createdAt, new Date(Date.now() - 86400000)));
  else if (range === "7d") conds.push(gte(logs.createdAt, new Date(Date.now() - 7 * 86400000)));
  const where = and(...conds);

  const agg = db
    .select({
      total: sql<number>`count(*)`,
      success: sql<number>`sum(case when status = 200 then 1 else 0 end)`,
      cost: sql<number>`coalesce(sum(cost), 0)`,
      avgLatency: sql<number>`coalesce(avg(latency_ms), 0)`,
      maxLatency: sql<number>`coalesce(max(latency_ms), 0)`,
      promptTokens: sql<number>`coalesce(sum(prompt_tokens), 0)`,
      completionTokens: sql<number>`coalesce(sum(completion_tokens), 0)`,
      cachedTokens: sql<number>`coalesce(sum(cached_tokens), 0)`,
      reasoningTokens: sql<number>`coalesce(sum(reasoning_tokens), 0)`,
      thinkingTokens: sql<number>`coalesce(sum(thinking_tokens), 0)`,
      // 与 /api/stats 同口径：不限制 usage_source，否则迁移前写入的成功调用（usage_source=0）漏算
      detailMissing: sql<number>`sum(case when status = 200 and has_usage_details = 0 then 1 else 0 end)`,
      estimatedCount: sql<number>`sum(case when status = 200 and usage_source = 2 then 1 else 0 end)`,
    })
    .from(logs)
    .where(where)
    .get();

  // 按渠道分解
  const byChannel = db
    .select({
      channelName: logs.channelName,
      total: sql<number>`count(*)`,
      success: sql<number>`sum(case when status = 200 then 1 else 0 end)`,
      cost: sql<number>`coalesce(sum(cost), 0)`,
      avgLatency: sql<number>`coalesce(avg(latency_ms), 0)`,
      promptTokens: sql<number>`coalesce(sum(prompt_tokens), 0)`,
      completionTokens: sql<number>`coalesce(sum(completion_tokens), 0)`,
      cachedTokens: sql<number>`coalesce(sum(cached_tokens), 0)`,
      reasoningTokens: sql<number>`coalesce(sum(reasoning_tokens), 0)`,
      thinkingTokens: sql<number>`coalesce(sum(thinking_tokens), 0)`,
    })
    .from(logs)
    .where(where)
    .groupBy(logs.channelName)
    .orderBy(sql`count(*) desc`)
    .all();

  // 承载该模型的渠道（仅管理员可见完整信息）
  let providers: Array<Record<string, unknown>> = [];
  if (r.user.role === "admin") {
    providers = db
      .select({
        id: channels.id,
        name: channels.name,
        type: channels.type,
        baseUrl: channels.baseUrl,
        proxy: channels.proxy,
        priority: channels.priority,
        weight: channels.weight,
        status: channels.status,
      })
      .from(channels)
      .where(
        and(
          eq(channels.archived, 0),
          sql`EXISTS (SELECT 1 FROM json_each(${channels.models}) WHERE json_each.value = ${model})`,
        ),
      )
      .all();
  }

  // 趋势（按渠道分序列：模型固定，看各渠道承载）——与仪表盘同一套公共聚合库，
  // 窗口固定 14 天/24 小时/60 分钟，不随上方 range 选择器变化（选择器只影响统计卡/渠道表）
  const userCond = r.user.role !== "admin" ? eq(logs.userId, r.user.id) : undefined;
  const trendScope = userCond ? and(eq(logs.model, model), userCond) : eq(logs.model, model);
  const daily = buildDailyTrend(logs.channelName, trendScope);
  const hourly = buildHourlyTrend(logs.channelName, trendScope);
  const minutely = buildMinutelyTrend(logs.channelName, trendScope);

  // no-store：模型详情页 5s 轮询此端点
  return Response.json({
    model,
    range,
    agg: agg ?? {
      total: 0, success: 0, cost: 0, avgLatency: 0, maxLatency: 0,
      promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, thinkingTokens: 0,
      detailMissing: 0, estimatedCount: 0,
    },
    byChannel,
    providers,
    daily,
    hourly,
    minutely,
  }, { headers: { "Cache-Control": "no-store" } });
}
