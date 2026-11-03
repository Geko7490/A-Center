import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { robloxBridges, robloxCommands } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

function matchesToken(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const rows = await db.select().from(robloxBridges).orderBy(desc(robloxBridges.createdAt));
  const bridge = rows[0];
  if (!bridge || !matchesToken(request.headers.get("x-vex-token") || "", bridge.token)) {
    return NextResponse.json({ error: "invalid pairing token" }, { status: 401 });
  }
  await db.update(robloxBridges).set({ status: "connected", lastSeenAt: new Date() }).where(eq(robloxBridges.id, bridge.id));
  const queued = await db.select().from(robloxCommands)
    .where(and(eq(robloxCommands.bridgeId, bridge.id), eq(robloxCommands.status, "queued")))
    .orderBy(asc(robloxCommands.createdAt)).limit(1);
  const command = queued[0];
  if (!command) return NextResponse.json({});

  await db.update(robloxCommands).set({ status: "running" }).where(eq(robloxCommands.id, command.id));
  return NextResponse.json({ id: command.id, action: command.command, ...command.args });
}

