import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { requireAdmin } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";

export async function GET() {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const list = db
    .select({ id: users.id, username: users.username, role: users.role, quota: users.quota, status: users.status, createdAt: users.createdAt })
    .from(users)
    .orderBy(desc(users.id))
    .all();
  return Response.json({ data: list });
}

export async function POST(req: Request) {
  const r = await requireAdmin();
  if (r.error) return r.error;
  const body = await req.json().catch(() => null);
  if (!body?.username || !body?.password) {
    return Response.json({ error: "用户名和密码为必填" }, { status: 400 });
  }
  const exists = db.select({ id: users.id }).from(users).where(eq(users.username, body.username)).get();
  if (exists) return Response.json({ error: "用户名已存在" }, { status: 400 });
  const quotaUsd = Number(body?.quotaUsd) || 0;
  const id = db
    .insert(users)
    .values({
      username: String(body.username).trim(),
      passwordHash: hashPassword(String(body.password)),
      role: body.role === "admin" ? "admin" : "user",
      quota: Math.round(quotaUsd * 100000),
    })
    .returning({ id: users.id })
    .get();
  return Response.json({ id });
}
