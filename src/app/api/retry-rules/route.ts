import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { retryRules } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const list = db.select().from(retryRules).orderBy(asc(retryRules.errorCode)).all();
  return Response.json({ data: list });
}

export async function POST(req: Request) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const body = await req.json().catch(() => null);
  const errorCode = Number(body?.errorCode);
  if (!Number.isInteger(errorCode) || errorCode < 1 || errorCode > 599) {
    return Response.json({ error: "错误代号必须是 1-599 的整数（全局默认规则已自动创建，请在列表中编辑）" }, { status: 400 });
  }
  const exists = db.select().from(retryRules).where(eq(retryRules.errorCode, errorCode)).get();
  if (exists) return Response.json({ error: `错误代号 ${errorCode === 0 ? "其他错误" : errorCode} 的规则已存在` }, { status: 400 });
  const maxRetries = clampInt(body?.maxRetries, 0, 20, 0);
  const initialDelayMs = clampInt(body?.initialDelayMs, 0, 600000, 1000);
  const maxDelayMs = clampInt(body?.maxDelayMs, 0, 600000, 10000);
  const jitterNum = Number(body?.jitter);
  const jitter = Number.isFinite(jitterNum) ? Math.max(0, Math.min(1, jitterNum)) : 0.1;
  const id = db
    .insert(retryRules)
    .values({ errorCode, maxRetries, initialDelayMs, maxDelayMs, jitter, enabled: body?.enabled === 0 ? 0 : 1 })
    .returning({ id: retryRules.id })
    .get();
  return Response.json({ id });
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.max(min, Math.min(max, n)));
}
