import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { requireUser } from "@/lib/auth";
import { verifyPassword, hashPassword } from "@/lib/crypto";

/** 修改自己的用户名/密码（改密码需验证当前密码） */
export async function PATCH(req: Request) {
  const r = await requireUser();
  if (r.error) return r.error;
  const body = await req.json().catch(() => null);
  const newUsername = String(body?.newUsername ?? "").trim();
  const currentPassword = String(body?.currentPassword ?? "");
  const newPassword = String(body?.newPassword ?? "");

  if (!newUsername && !newPassword) {
    return Response.json({ error: "没有要修改的内容" }, { status: 400 });
  }

  const user = db.select().from(users).where(eq(users.id, r.user.id)).get();
  if (!user) return Response.json({ error: "用户不存在" }, { status: 404 });

  const updates: Partial<typeof users.$inferInsert> = {};
  if (newUsername && newUsername !== user.username) {
    const dup = db.select({ id: users.id }).from(users).where(eq(users.username, newUsername)).get();
    if (dup) return Response.json({ error: "该用户名已被占用" }, { status: 400 });
    updates.username = newUsername;
  }
  if (newPassword) {
    if (newPassword.length < 6) {
      return Response.json({ error: "新密码至少 6 位" }, { status: 400 });
    }
    if (!currentPassword || !verifyPassword(currentPassword, user.passwordHash)) {
      return Response.json({ error: "当前密码错误" }, { status: 400 });
    }
    updates.passwordHash = hashPassword(newPassword);
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ ok: true, username: user.username, unchanged: true });
  }
  db.update(users).set(updates).where(eq(users.id, r.user.id)).run();
  return Response.json({ ok: true, username: updates.username ?? user.username });
}
