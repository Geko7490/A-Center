import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { robloxBridges, robloxCommands } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { currentBridge, matchesBridgeToken, BRIDGE_VERSION } from "@/lib/roblox";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if(request.headers.has("origin")) return NextResponse.json({error:"Browser requests are not allowed on the Studio bridge"},{status:403});
  const bridge = await currentBridge();
  if (!bridge || !matchesBridgeToken(request.headers.get("x-vex-token") || "", bridge.token)) {
    return NextResponse.json({ error: "invalid pairing token" }, { status: 401 });
  }
  if(bridge.status === "disconnected") return NextResponse.json({error:"Bridge disconnected in A-Center; press Connect to Studio"},{status:409});
  const version = request.nextUrl.searchParams.get("version") || "legacy";
  await db.update(robloxBridges).set({ status: "connected", lastSeenAt: new Date(), pluginVersion:version.slice(0,24),bridgeVersion:BRIDGE_VERSION }).where(eq(robloxBridges.id, bridge.id));
  const queued = await db.select().from(robloxCommands)
    .where(and(eq(robloxCommands.bridgeId, bridge.id), eq(robloxCommands.status, "queued")))
    .orderBy(asc(robloxCommands.createdAt)).limit(1);
  const command = queued[0];
  if (!command) return NextResponse.json({ok:true,bridgeVersion:BRIDGE_VERSION},{headers:{"cache-control":"no-store"}});

  const claimed=await db.update(robloxCommands).set({ status: "running" }).where(and(eq(robloxCommands.id, command.id),eq(robloxCommands.status,"queued"))).returning();
  return NextResponse.json(claimed.length?{ ...command.args, id: command.id, action: command.command }:{ok:true},{headers:{"cache-control":"no-store"}});
}

