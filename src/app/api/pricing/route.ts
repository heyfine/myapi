import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { modelPrices } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const list = db.select().from(modelPrices).orderBy(asc(modelPrices.model)).all();
  return Response.json({ data: list });
}

/** 批量保存定价（每百万 token 的美元价格） */
export async function POST(req: Request) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const body = await req.json().catch(() => null);
  const items = body?.items as Array<{ model: string; inputUsd: number; outputUsd: number }> | undefined;
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "items 不能为空" }, { status: 400 });
  }
  for (const it of items) {
    const model = String(it.model ?? "").trim();
    if (!model) continue;
    db.insert(modelPrices)
      .values({
        model,
        inputPrice: Math.round((Number(it.inputUsd) || 0) * 100000),
        outputPrice: Math.round((Number(it.outputUsd) || 0) * 100000),
      })
      .onConflictDoUpdate({
        target: modelPrices.model,
        set: {
          inputPrice: Math.round((Number(it.inputUsd) || 0) * 100000),
          outputPrice: Math.round((Number(it.outputUsd) || 0) * 100000),
        },
      })
      .run();
  }
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const model = new URL(req.url).searchParams.get("model");
  if (!model) return Response.json({ error: "缺少 model 参数" }, { status: 400 });
  db.delete(modelPrices).where(eq(modelPrices.model, model)).run();
  return Response.json({ ok: true });
}
