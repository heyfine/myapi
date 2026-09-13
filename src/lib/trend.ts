import { sql, and, gte, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "@/lib/db";
import { logs } from "@/lib/schema";

/** 序列维度：logs.model（按模型）或 logs.channelName（按渠道） */
export type SeriesExpr = SQL | SQLiteColumn;

/** 趋势桶：一段时间窗内的聚合 + 按维度（模型或渠道）分解 */
export interface TrendBucket {
  total: number;
  success: number;
  cost: number;
  promptTokens: number;
  completionTokens: number;
  /** key 为模型名或渠道名（null 归为 "未知"） */
  perSeries: Record<string, { count: number; cost: number; tokens: number }>;
}

/** 带标签的趋势点，前端图表直接可用 */
export type TrendPoint = TrendBucket & { date: string; label: string };

/** 本地时区的 YYYY-MM-DD（服务端标签用，容器需设 TZ 才是目标时区） */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface TrendRow {
  bucket: unknown;
  series: string | null;
  total: number;
  success: number;
  cost: number;
  promptTokens: number;
  completionTokens: number;
}

/**
 * 生成趋势查询：桶表达式 × 序列维度（模型或渠道名）GROUP BY，SQL 侧聚合。
 * 日志量大时必须 SQL 侧聚合——JS 捞全量行会同步阻塞事件循环，卡住网关转发。
 * seriesExpr 传 logs.model（按模型）或 logs.channelName（按渠道）。
 */
export function groupedTrend(
  bucketExpr: SQL,
  since: Date,
  seriesExpr: SeriesExpr,
  scope?: SQL,
): TrendRow[] {
  const conds: SQL[] = [gte(logs.createdAt, since)];
  if (scope) conds.push(scope);
  const rows = db
    .select({
      bucket: bucketExpr,
      series: seriesExpr as SQL,
      total: sql<number>`count(*)`,
      success: sql<number>`sum(case when ${logs.status} = 200 then 1 else 0 end)`,
      cost: sql<number>`coalesce(sum(${logs.cost}), 0)`,
      promptTokens: sql<number>`coalesce(sum(${logs.promptTokens}), 0)`,
      completionTokens: sql<number>`coalesce(sum(${logs.completionTokens}), 0)`,
    })
    .from(logs)
    .where(and(...conds))
    .groupBy(bucketExpr, seriesExpr)
    .all();
  return rows as TrendRow[];
}

export function emptyBucket(): TrendBucket {
  return { total: 0, success: 0, cost: 0, promptTokens: 0, completionTokens: 0, perSeries: {} };
}

export function mergeBucket(b: TrendBucket, row: TrendRow): void {
  b.total += row.total;
  b.success += row.success;
  b.cost += row.cost;
  b.promptTokens += row.promptTokens;
  b.completionTokens += row.completionTokens;
  const pm = (b.perSeries[row.series ?? "未知"] ??= { count: 0, cost: 0, tokens: 0 });
  pm.count += row.total;
  pm.cost += row.cost;
  pm.tokens += row.promptTokens + row.completionTokens;
}

/** 日趋势：近 14 个自然日（含今天），按本地时区切日 */
export function buildDailyTrend(seriesExpr: SeriesExpr, scope?: SQL): TrendPoint[] {
  // 从今天往前推 13 天作为第一桶（含今天共 14 桶）；修复原实现"14 桶落在 14天前..昨天"的 off-by-one
  const firstDay = new Date();
  firstDay.setHours(0, 0, 0, 0);
  firstDay.setDate(firstDay.getDate() - 13);
  const dailyMap = new Map<string, TrendBucket>();
  for (let i = 0; i < 14; i++) {
    dailyMap.set(localDateKey(new Date(firstDay.getTime() + i * 86400000)), emptyBucket());
  }
  for (const row of groupedTrend(sql`date(${logs.createdAt} / 1000, 'unixepoch', 'localtime')`, firstDay, seriesExpr, scope)) {
    const b = dailyMap.get(String(row.bucket));
    if (b) mergeBucket(b, row);
  }
  return [...dailyMap.entries()].map(([date, v]) => ({ date, label: date.slice(5).replace("-", "/"), ...v }));
}

/** 小时趋势：近 24 个整点桶（UTC 边界，本地小时标签） */
export function buildHourlyTrend(seriesExpr: SeriesExpr, scope?: SQL): TrendPoint[] {
  const now = Date.now();
  const buckets = new Map<number, TrendBucket>();
  const labels: number[] = [];
  for (let i = 23; i >= 0; i--) {
    const start = Math.floor((now - i * 3600000) / 3600000) * 3600000;
    buckets.set(start, emptyBucket());
    labels.push(start);
  }
  for (const row of groupedTrend(sql`(${logs.createdAt} / 3600000) * 3600000`, new Date(now - 24 * 3600000), seriesExpr, scope)) {
    const b = buckets.get(Number(row.bucket));
    if (b) mergeBucket(b, row);
  }
  return labels.map((ts) => {
    const d = new Date(ts);
    return {
      date: `${String(d.getHours()).padStart(2, "0")}:00`,
      label: `${String(d.getHours()).padStart(2, "0")}时`,
      ...buckets.get(ts)!,
    };
  });
}

/** 分钟趋势：近 60 个整分钟桶（UTC 边界，本地 HH:MM 标签），配合前端 5s 轮询近实时 */
export function buildMinutelyTrend(seriesExpr: SeriesExpr, scope?: SQL): TrendPoint[] {
  const MINUTES = 60;
  const now = Date.now();
  const buckets = new Map<number, TrendBucket>();
  const labels: number[] = [];
  for (let i = MINUTES - 1; i >= 0; i--) {
    const start = Math.floor((now - i * 60000) / 60000) * 60000;
    buckets.set(start, emptyBucket());
    labels.push(start);
  }
  for (const row of groupedTrend(sql`(${logs.createdAt} / 60000) * 60000`, new Date(now - MINUTES * 60000), seriesExpr, scope)) {
    const b = buckets.get(Number(row.bucket));
    if (b) mergeBucket(b, row);
  }
  return labels.map((ts) => {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return { date: `${hh}:${mm}`, label: `${hh}:${mm}`, ...buckets.get(ts)! };
  });
}

/* ============ 全局时间范围（仪表盘范围选择器）============ */

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

/** 范围桶粒度 */
export type Granularity = "hour" | "day" | "month";

/** 按窗口长度自动选粒度：≤48h 按小时，≤31 天按天，更长按月 */
export function pickGranularity(fromMs: number, toMs: number): Granularity {
  const span = toMs - fromMs;
  if (span <= 48 * HOUR_MS) return "hour";
  if (span <= 31 * DAY_MS) return "day";
  return "month";
}

/** 本地时区的 YYYY-MM */
function localMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 零填充上限（超出保留最近的）：hour 49 / day 400 / month 240，防自定义到 1970 年造出巨量空桶 */
const RANGE_CAP: Record<Granularity, number> = { hour: 49, day: 400, month: 240 };

/** 生成窗口内的桶起点序列（本地时区日历边界） */
function rangeStarts(fromMs: number, toMs: number, granularity: Granularity): number[] {
  const lastEnd = toMs - 1;
  const starts: number[] = [];
  if (granularity === "hour") {
    const end = Math.floor(lastEnd / HOUR_MS) * HOUR_MS;
    const first = Math.max(Math.floor(fromMs / HOUR_MS) * HOUR_MS, end - (RANGE_CAP.hour - 1) * HOUR_MS);
    for (let t = first; t <= end; t += HOUR_MS) starts.push(t);
  } else if (granularity === "day") {
    const d = new Date(fromMs);
    d.setHours(0, 0, 0, 0);
    const e = new Date(lastEnd);
    e.setHours(0, 0, 0, 0);
    const first = Math.max(d.getTime(), e.getTime() - (RANGE_CAP.day - 1) * DAY_MS);
    for (let t = first; t <= e.getTime(); t += DAY_MS) starts.push(t);
  } else {
    const s = new Date(fromMs);
    const e = new Date(lastEnd);
    let y = e.getFullYear();
    let m = e.getMonth();
    const months: number[] = [];
    for (;;) {
      months.unshift(new Date(y, m, 1).getTime());
      if (y === s.getFullYear() && m === s.getMonth()) break;
      m--;
      if (m < 0) { m = 11; y--; }
      if (months.length >= RANGE_CAP.month) break;
    }
    starts.push(...months);
  }
  return starts;
}

/**
 * 范围趋势：[fromMs, 至] 窗口内按粒度聚合（本地时区切桶，与 localtime 修饰符同口径）。
 * 返回零填充的 TrendPoint（month 粒度 label/date 为 YYYY-MM；day 为 YYYY-MM-DD；hour 为 HH时）。
 */
export function buildRangeTrend(
  fromMs: number,
  toMs: number,
  granularity: Granularity,
  seriesExpr: SeriesExpr,
  scope?: SQL,
): TrendPoint[] {
  const starts = rangeStarts(fromMs, toMs, granularity);
  if (starts.length === 0) return [];
  const keyOf = (ts: number): string => {
    if (granularity === "hour") return String(ts);
    const d = new Date(ts);
    return granularity === "day" ? localDateKey(d) : localMonthKey(d);
  };
  const bucketExpr =
    granularity === "hour"
      ? sql`(${logs.createdAt} / ${HOUR_MS}) * ${HOUR_MS}`
      : granularity === "day"
        ? sql`date(${logs.createdAt} / 1000, 'unixepoch', 'localtime')`
        : sql`strftime('%Y-%m', ${logs.createdAt} / 1000, 'unixepoch', 'localtime')`;

  const buckets = new Map<string, TrendBucket>();
  for (const ts of starts) buckets.set(keyOf(ts), emptyBucket());
  for (const row of groupedTrend(bucketExpr, new Date(starts[0]), seriesExpr, scope)) {
    const b = buckets.get(String(row.bucket));
    if (b) mergeBucket(b, row);
  }

  return starts.map((ts) => {
    const d = new Date(ts);
    const key = keyOf(ts);
    const label =
      granularity === "hour" ? `${String(d.getHours()).padStart(2, "0")}时` : granularity === "day" ? key.slice(5).replace("-", "/") : key;
    return { date: key, label, ...buckets.get(key)! };
  });
}
