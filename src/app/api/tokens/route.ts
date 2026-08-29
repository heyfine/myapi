import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tokens } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { generateTokenKey } from "@/lib/crypto";

export async function GET() {
  const r = await requireUser();
  if (r.error) return r.error;
  const list =
    r.user.role === "admin"
      ? db.select().from(tokens).orderBy(desc(tokens.id)).all()
      : db.select().from(tokens).where(eq(tokens.userId, r.user.id)).orderBy(desc(tokens.id)).all();
  return Response.json({ data: list });
}

export async function POST(req: Request) {
  const r = await requireUser();
  if (r.error) return r.error;
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim() || "默认令牌";
  // 额度单位与用户余额一致（1 美元 = 100000）；支持以美元输入
  const quotaLimitUsd = Number(body?.quotaLimitUsd) || 0;
  const expiredDays = Number(body?.expiredDays) || 0;

  const { key, hash, prefix } = generateTokenKey();
  const id = db
    .insert(tokens)
    .values({
      userId: r.user.id,
      name,
      keyHash: hash,
      keyPrefix: prefix,
      quotaLimit: quotaLimitUsd > 0 ? Math.round(quotaLimitUsd * 100000) : 0,
      expiredAt: expiredDays > 0 ? new Date(Date.now() + expiredDays * 86400000) : null,
    })
    .returning({ id: tokens.id })
    .get();
  return Response.json({ id, key }); // 完整 key 只在此刻返回一次
}
