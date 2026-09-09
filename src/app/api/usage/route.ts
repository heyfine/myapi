import { sql, and, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { logs } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

/**
 * Token 用量统计表（按日期维度）：仪表盘/模型详情页共用。
 * granularity=day|month|year + from/to（YYYY-MM-DD，可省略走默认窗口）+ 可选 model。
 * breakdown=channel 时按「日期桶×渠道」分组（new-api 风格明细表），细分缓存/推理列。
 * 与 /api/stats 同口径：桶表达式用 sqlite localtime（容器 TZ=Asia/Shanghai）。
 */

interface BaseRow {
  date: string;
  count: number;
  success: number;
  cost: number;
  promptTokens: number;
  completionTokens: number;
}

interface ChannelRow extends BaseRow {
  channel: string | null;
  cachedTokens: number;
  reasoningTokens: number;
}

function err(msg: string): Response {
  return Response.json({ error: msg }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const r = await requireUser();
  if (r.error) return r.error;

  const url = new URL(request.url);
  const granularity = url.searchParams.get("granularity") ?? "day";
  const breakdown = url.searchParams.get("breakdown") === "channel" ? "channel" : "none";
  const model = url.searchParams.get("model") || undefined;
  let from = url.searchParams.get("from") || "";
  let to = url.searchParams.get("to") || "";

  if (granularity !== "day" && granularity !== "month" && granularity !== "year") {
    return err("granularity 必须是 day / month / year");
  }

  // 默认窗口：day=近30天（含今天），month=近12个月，year=全部
  const now = new Date();
  if (!from || !to) {
    if (granularity === "day") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 29);
      from = isoLocal(start);
      to = isoLocal(now);
    } else if (granularity === "month") {
      const start = new Date(now.getFullYear(), now.getMonth() - 11, 1, 0, 0, 0, 0);
      from = isoLocal(start);
      to = isoLocal(now);
    }
    // year：from/to 留空 = 全部
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (from && !DATE_RE.test(from)) return err("from 格式应为 YYYY-MM-DD");
  if (to && !DATE_RE.test(to)) return err("to 格式应为 YYYY-MM-DD");
  if (from && to && from > to) return err("from 不能晚于 to");

  // 桶表达式：本地时区分组（server TZ=Asia/Shanghai）
  const bucketExpr =
    granularity === "day"
      ? sql`date(${logs.createdAt} / 1000, 'unixepoch', 'localtime')`
      : granularity === "month"
        ? sql`strftime('%Y-%m', ${logs.createdAt} / 1000, 'unixepoch', 'localtime')`
        : sql`strftime('%Y', ${logs.createdAt} / 1000, 'unixepoch', 'localtime')`;

  // 边界闭区间：to 取当天 23:59:59.999，from 取当天 00:00；缺省则不加条件（全部）
  // 注意不能用 MAX_SAFE_INTEGER 当上界哨兵：超出 JS Date 合法范围（±8.64e15ms）会得 Invalid Date
  const conds: SQL[] = [];
  if (from) conds.push(gte(logs.createdAt, new Date(`${from}T00:00:00`)));
  if (to) conds.push(lte(logs.createdAt, new Date(`${to}T23:59:59.999`)));
  if (model) conds.push(eq(logs.model, model));
  if (r.user.role !== "admin") conds.push(eq(logs.userId, r.user.id));

  const where = and(...conds);

  if (breakdown === "channel") {
    // 按日期桶 × 渠道 分组：每行是某渠道在某个桶的用量明细
    const rows = db
      .select({
        date: bucketExpr,
        channel: logs.channelName,
        count: sql<number>`count(*)`,
        success: sql<number>`sum(case when ${logs.status} = 200 then 1 else 0 end)`,
        cost: sql<number>`coalesce(sum(${logs.cost}), 0)`,
        promptTokens: sql<number>`coalesce(sum(${logs.promptTokens}), 0)`,
        completionTokens: sql<number>`coalesce(sum(${logs.completionTokens}), 0)`,
        cachedTokens: sql<number>`coalesce(sum(${logs.cachedTokens}), 0)`,
        reasoningTokens: sql<number>`coalesce(sum(${logs.reasoningTokens}) + sum(${logs.thinkingTokens}), 0)`,
      })
      .from(logs)
      .where(where)
      .groupBy(bucketExpr, logs.channelName)
      .orderBy(sql`1 desc`, sql`count(*) desc`)
      .all() as Array<ChannelRow & { channel: string | null }>;

    const total = rows.reduce(
      (acc, row) => ({
        count: acc.count + row.count,
        success: acc.success + row.success,
        cost: acc.cost + row.cost,
        promptTokens: acc.promptTokens + row.promptTokens,
        completionTokens: acc.completionTokens + row.completionTokens,
        cachedTokens: acc.cachedTokens + row.cachedTokens,
        reasoningTokens: acc.reasoningTokens + row.reasoningTokens,
      }),
      { count: 0, success: 0, cost: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
    );

    return Response.json(
      { granularity, from: from || null, to: to || null, model: model ?? null, breakdown, rows, total },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const rows = db
    .select({
      date: bucketExpr,
      count: sql<number>`count(*)`,
      success: sql<number>`sum(case when ${logs.status} = 200 then 1 else 0 end)`,
      cost: sql<number>`coalesce(sum(${logs.cost}), 0)`,
      promptTokens: sql<number>`coalesce(sum(${logs.promptTokens}), 0)`,
      completionTokens: sql<number>`coalesce(sum(${logs.completionTokens}), 0)`,
      cachedTokens: sql<number>`coalesce(sum(${logs.cachedTokens}), 0)`,
      reasoningTokens: sql<number>`coalesce(sum(${logs.reasoningTokens}) + sum(${logs.thinkingTokens}), 0)`,
    })
    .from(logs)
    .where(where)
    .groupBy(bucketExpr)
    .orderBy(sql`1 desc`)
    .all() as Array<BaseRow & { cachedTokens: number; reasoningTokens: number }>;

  const total = rows.reduce(
    (acc, row) => ({
      count: acc.count + row.count,
      success: acc.success + row.success,
      cost: acc.cost + row.cost,
      promptTokens: acc.promptTokens + row.promptTokens,
      completionTokens: acc.completionTokens + row.completionTokens,
      cachedTokens: acc.cachedTokens + row.cachedTokens,
      reasoningTokens: acc.reasoningTokens + row.reasoningTokens,
    }),
    { count: 0, success: 0, cost: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
  );

  // 前端 5s 轮询随页面节奏，同样禁缓存
  return Response.json(
    { granularity, from: from || null, to: to || null, model: model ?? null, breakdown, rows, total },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** 本地时区 YYYY-MM-DD（new Date().toISOString() 是 UTC，会差一天） */
function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
