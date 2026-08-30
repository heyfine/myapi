import { desc, eq, and, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { logs } from "@/lib/schema";
import { requireUser } from "@/lib/auth";

export async function GET(req: Request) {
  const r = await requireUser();
  if (r.error) return r.error;
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(1000, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
  const model = url.searchParams.get("model") ?? "";
  const channelName = url.searchParams.get("channel") ?? "";

  const conds: SQL[] = [];
  if (r.user.role !== "admin") conds.push(eq(logs.userId, r.user.id));
  if (model) conds.push(eq(logs.model, model));
  if (channelName) conds.push(eq(logs.channelName, channelName));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = where
    ? db.select().from(logs).where(where).orderBy(desc(logs.id)).limit(pageSize).offset((page - 1) * pageSize).all()
    : db.select().from(logs).orderBy(desc(logs.id)).limit(pageSize).offset((page - 1) * pageSize).all();

  const countRow = where
    ? db.select({ n: sql<number>`count(*)` }).from(logs).where(where).get()
    : db.select({ n: sql<number>`count(*)` }).from(logs).get();

  // no-store：模型详情页 5s 轮询此端点（日志页翻页场景也可能触发重复请求）
  return Response.json({ data: rows, page, total: countRow?.n ?? 0, pageSize }, { headers: { "Cache-Control": "no-store" } });
}
