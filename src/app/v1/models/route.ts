import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { channels } from "@/lib/schema";
import { authenticateGatewayToken } from "@/lib/gateway/token-auth";

export async function GET(req: Request) {
  const auth = authenticateGatewayToken(req);
  if (auth instanceof Response) return auth;

  const rows = db
    .select({ models: channels.models })
    .from(channels)
    .where(and(eq(channels.status, 1), eq(channels.archived, 0)))
    .all();
  const modelSet = new Set<string>();
  for (const r of rows) {
    try {
      for (const m of JSON.parse(r.models) as string[]) modelSet.add(m);
    } catch {
      /* 忽略脏数据 */
    }
  }
  const now = Math.floor(Date.now() / 1000);
  return Response.json({
    object: "list",
    data: [...modelSet].sort().map((id) => ({ id, object: "model", created: now, owned_by: "gateway" })),
  });
}
