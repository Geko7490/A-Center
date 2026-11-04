import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { robloxBridges, robloxCommands } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { currentBridge, matchesBridgeToken } from "@/lib/roblox";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if(request.headers.has("origin")) return NextResponse.json({error:"Browser requests are not allowed on the Studio bridge"},{status:403});
  const bridge = await currentBridge();
  if (!bridge || !matchesBridgeToken(request.headers.get("x-vex-token") || "", bridge.token)) {
    return NextResponse.json({ error: "invalid pairing token" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as { id?: string; ok?: boolean; result?: unknown };
  if (!body.id || !/^[0-9a-f-]{36}$/i.test(body.id)) return NextResponse.json({ error: "valid command id required" }, { status: 400 });
  const found = await db.select().from(robloxCommands)
    .where(and(eq(robloxCommands.id, body.id), eq(robloxCommands.bridgeId, bridge.id)));
  if (!found[0]) return NextResponse.json({ error: "command not found" }, { status: 404 });
  if(["completed","failed"].includes(found[0].status)&&JSON.stringify(found[0].result)===JSON.stringify(body.result??null))return NextResponse.json({ok:true});
  if(found[0].status!=="running") return NextResponse.json({error:"Command is not awaiting a result"},{status:409});

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

