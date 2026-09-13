import { sql, and, eq, gte, lt, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels, logs } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { buildDailyTrend, buildHourlyTrend, buildMinutelyTrend, buildRangeTrend, pickGranularity, type Granularity } from "@/lib/trend";

const DAY_MS = 86400000;

export type RangeKey = "day" | "week" | "month" | "custom" | "all";

function mdOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 解析范围参数 → 窗口 [fromMs, toMs)（toMs=null 表示无上界）+ 展示文案。
 * day=今日 0 点起；week=近 7 个自然日；month=本月；custom=日期框（含 to 当日）；all=无时间限制。
 * 非法 custom 回退为 all。
 */
function resolveRange(raw: string | null, from: string | null, to: string | null): { range: RangeKey; fromMs: number | null; toMs: number | null; label: string } {
  const now = new Date();
  if (raw === "day") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return { range: "day", fromMs: d.getTime(), toMs: null, label: `今日 ${mdOf(d.getTime())}` };
  }
  if (raw === "week") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 6);
    return { range: "week", fromMs: d.getTime(), toMs: null, label: `近 7 天 ${mdOf(d.getTime())}~${mdOf(now.getTime())}` };
  }
  if (raw === "month") {
    const d = new Date(now);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return { range: "month", fromMs: d.getTime(), toMs: null, label: `本月 ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` };
  }
  if (raw === "custom" && from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    // 注意：必须带 T 的格式才是本地时间（'YYYY-MM-DD' 字符串按 UTC 解析，见 PROJECT_MEMORY 踩坑）
    const f = new Date(`${from}T00:00:00`);
    if (!isNaN(f.getTime())) {
      let fromMs = f.getTime();
      let tEnd: number | null = null;
      if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
        const t = new Date(`${to}T00:00:00`);
        if (!isNaN(t.getTime())) tEnd = t.getTime() + DAY_MS; // to 当日含头含尾 → 排他上界 = 次日 0 点
      }
      if (tEnd !== null && tEnd <= fromMs) [fromMs, tEnd] = [tEnd - DAY_MS, fromMs + DAY_MS]; // 反了就交换
      return { range: "custom", fromMs, toMs: tEnd, label: `自定义 ${mdOf(fromMs)}~${tEnd !== null ? mdOf(tEnd - DAY_MS) : "至今"}` };
    }
  }
  return { range: "all", fromMs: null, toMs: null, label: "全部" };
}

export async function GET(req: Request) {
  const r = await requireUser();
  if (r.error) return r.error;

  const sp = new URL(req.url).searchParams;
  const { range, fromMs, toMs, label: rangeLabel } = resolveRange(sp.get("range"), sp.get("from"), sp.get("to"));

  const dayAgo = new Date(Date.now() - 86400000);
  const userScope = r.user.role !== "admin" ? eq(logs.userId, r.user.id) : undefined;

  // 范围窗口条件（all 时无下界；custom 有排他上界）
  const windowConds: SQL[] = [];
  if (fromMs !== null) windowConds.push(gte(logs.createdAt, new Date(fromMs)));
  if (toMs !== null) windowConds.push(lt(logs.createdAt, new Date(toMs)));
  if (userScope) windowConds.push(userScope);
  const windowWhere = and(...windowConds);

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
    .where(windowWhere)
    .get();

  const today = db
    .select({
      total: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(cost), 0)`,
    })
    .from(logs)
    .where(userScope ? and(userScope, gte(logs.createdAt, dayAgo)) : gte(logs.createdAt, dayAgo))
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
    .where(userScope ? and(userScope, gte(logs.createdAt, dayAgo)) : gte(logs.createdAt, dayAgo))
    .groupBy(logs.model)
    .orderBy(sql`count(*) desc`)
    .limit(10)
    .all();

  // 固定窗口实时趋势（按天=近 14 天 / 按小时 / 按分钟），与范围选择器无关
  const daily = buildDailyTrend(logs.model, userScope);
  const hourly = buildHourlyTrend(logs.model, userScope);
  const minutely = buildMinutelyTrend(logs.model, userScope);

  // 范围趋势：窗口 = 所选范围；粒度按窗口长度自适应（≤48h 时 / ≤31 天 日 / 更久 月）。
  // all 无下界时用最早一条日志起算，否则 pickGranularity 拿不到 span。
  let rangeFromMs = fromMs;
  if (rangeFromMs === null) {
    const minRow = db
      .select({ min: sql<number | null>`min(created_at)` })
      .from(logs)
      .where(userScope)
      .get();
    rangeFromMs = minRow?.min ?? null;
  }
  const rangeToMs = toMs ?? Date.now();
  let trend: ReturnType<typeof buildRangeTrend> = [];
  let trendGranularity: Granularity = "day";
  if (rangeFromMs !== null && rangeToMs > rangeFromMs) {
    trendGranularity = pickGranularity(rangeFromMs, rangeToMs);
    trend = buildRangeTrend(rangeFromMs, rangeToMs, trendGranularity, logs.model, userScope);
  }
  const gText = trendGranularity === "hour" ? "按小时" : trendGranularity === "month" ? "按月" : "按天";

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
    range,
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
    trend,
    trendGranularity,
    trendLabel: `${rangeLabel} · ${gText}`,
    allModels,
  }, { headers: { "Cache-Control": "no-store" } });
}
