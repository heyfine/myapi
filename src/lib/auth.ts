import { cookies } from "next/headers";
import crypto from "node:crypto";
import { eq, and, gt } from "drizzle-orm";
import { db } from "./db";
import { sessions, users } from "./schema";
import { sha256 } from "./crypto";

export const SESSION_COOKIE = "gateway_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export type SessionUser = {
  id: number;
  username: string;
  role: string;
  quota: number;
};

export async function createSession(userId: number): Promise<void> {
  const raw = crypto.randomBytes(32).toString("hex");
  const token = sha256(raw);
  const expiredAt = new Date(Date.now() + SESSION_TTL_MS);
  db.insert(sessions).values({ token, userId, expiredAt }).run();
  const store = await cookies();
  store.set(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiredAt,
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const row = db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      quota: users.quota,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.token, sha256(raw)), gt(sessions.expiredAt, new Date())))
    .get();
  if (!row || row.status !== 1) return null;
  return { id: row.id, username: row.username, role: row.role, quota: row.quota };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw) db.delete(sessions).where(eq(sessions.token, sha256(raw))).run();
  store.delete(SESSION_COOKIE);
}

/** API 路由守卫：返回用户或 401 Response */
export async function requireUser(): Promise<
  { user: SessionUser; error: null } | { user: null; error: Response }
> {
  const user = await getSessionUser();
  if (!user) {
    return {
      user: null,
      error: Response.json({ error: "未登录或会话已过期" }, { status: 401 }),
    };
  }
  return { user, error: null };
}

export async function requireAdmin(): Promise<
  { user: SessionUser; error: null } | { user: null; error: Response }
> {
  const r = await requireUser();
  if (r.error) return r;
  if (r.user.role !== "admin") {
    return { user: null, error: Response.json({ error: "需要管理员权限" }, { status: 403 }) };
  }
  return r;
}
