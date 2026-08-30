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
