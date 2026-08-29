import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { verifyPassword } from "@/lib/crypto";
import { createSession } from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.username || !body?.password) {
    return Response.json({ error: "请输入用户名和密码" }, { status: 400 });
  }
  const user = db.select().from(users).where(eq(users.username, body.username)).get();
  if (!user || !verifyPassword(body.password, user.passwordHash)) {
    return Response.json({ error: "用户名或密码错误" }, { status: 401 });
  }
  if (user.status !== 1) {
    return Response.json({ error: "账号已被禁用" }, { status: 403 });
  }
  await createSession(user.id);
  return Response.json({
    id: user.id,
    username: user.username,
    role: user.role,
    quota: user.quota,
  });
}
