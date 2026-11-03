import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { robloxBridges, robloxCommands } from "@/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

function matchesToken(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const rows = await db.select().from(robloxBridges).orderBy(desc(robloxBridges.createdAt));
  const bridge = rows[0];
  if (!bridge || !matchesToken(request.headers.get("x-vex-token") || "", bridge.token)) {
    return NextResponse.json({ error: "invalid pairing token" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as { id?: string; ok?: boolean; result?: unknown };
  if (!body.id) return NextResponse.json({ error: "command id required" }, { status: 400 });
  const found = await db.select().from(robloxCommands)
    .where(and(eq(robloxCommands.id, body.id), eq(robloxCommands.bridgeId, bridge.id)));
  if (!found[0]) return NextResponse.json({ error: "command not found" }, { status: 404 });

  const succeeded = body.ok === true && !(body.result && typeof body.result === "object" && "error" in body.result);
  await db.update(robloxCommands).set({
    status: succeeded ? "completed" : "failed",
    result: body.result ?? null,
    error: succeeded ? "" : JSON.stringify(body.result ?? "Studio command failed").slice(0, 1000),
    completedAt: new Date(),
  }).where(eq(robloxCommands.id, body.id));
  await db.update(robloxBridges).set({ status: "connected", lastSeenAt: new Date() }).where(eq(robloxBridges.id, bridge.id));
  return NextResponse.json({ ok: true });
}

