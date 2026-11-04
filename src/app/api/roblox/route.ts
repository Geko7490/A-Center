import { storageBusy } from "@/lib/maintenance";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { robloxBridges, robloxCommands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { pairingToken, robloxPluginSource } from "@/lib/vex";
import { currentBridge, studioConnected, cancelBridgeCommands, BRIDGE_VERSION } from "@/lib/roblox";
import fs from "node:fs";
import path from "node:path";

async function current() {
  return (await currentBridge(true))!;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("download") === "plugin") {
    const b = await current();
    if(process.env.VEX_ROBLOX_ERROR)return NextResponse.json({error:process.env.VEX_ROBLOX_ERROR},{status:503});
    const port = Number(process.env.VEX_ROBLOX_PORT || new URL(req.url).port) || 7817;
    return new NextResponse(robloxPluginSource(b.token, port), {
      headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="VexBridge.lua"` },
    });
  }
  const b = await current();
  return NextResponse.json({ bridge: {...b,bridgeVersion:BRIDGE_VERSION,status:b.status==="connected"&&!studioConnected(b)?"studio-offline":b.status}, endpoint:`http://127.0.0.1:${process.env.VEX_ROBLOX_PORT||new URL(req.url).port||7817}/roblox`,error:process.env.VEX_ROBLOX_ERROR||null },{headers:{"cache-control":"no-store"}});
}

export async function POST(req: NextRequest) {
  if (storageBusy()) return NextResponse.json({ error: "Storage relocation in progress. Restart A-Center before making changes." }, { status: 409 });
  const b = await current();
  const body = await req.json().catch(() => ({}));
  const a = (body as { action?: string }).action || "";
  const stamp = new Date().toISOString();
  const log = (s: string) => `${(b.logs || "").slice(-8000)}\n[${stamp}] ${s}`;

  if (a === "regenerate-token") {
    await cancelBridgeCommands(b.id);
    const t = pairingToken();
    await db.update(robloxBridges).set({ token: t, status:"waiting-for-studio",lastSeenAt:null, logs: log("pairing token regenerated — reinstall plugin with new token") }).where(eq(robloxBridges.id, b.id));
    return NextResponse.json({ ok: true, token: t });
  }
  if (a === "connect") {
    if(process.env.VEX_ROBLOX_ERROR)return NextResponse.json({error:process.env.VEX_ROBLOX_ERROR},{status:503});
    if(!studioConnected(b))await db.update(robloxBridges).set({ status: "waiting-for-studio",lastSeenAt:null, logs: log("waiting for authenticated Studio heartbeat; enable the downloaded VexBridge plugin") }).where(eq(robloxBridges.id, b.id));
    return NextResponse.json({ ok: true, note: "Waiting for the Studio plugin. Press VexBridge in Studio and allow its localhost HTTP permission; status changes only after a real heartbeat." });
  }
  if (a === "simulate-studio") {
    // Local self-test without Studio: validates token + command pipeline
    const token = (body as { token?: string }).token || "";
    if (token !== b.token) return NextResponse.json({ error: "invalid pairing token" }, { status: 401 });
    return NextResponse.json({ ok: true, note:"Pairing-token self-test passed. This does not connect Roblox Studio; use the Studio toolbar button for a real heartbeat." });
  }
  if (a === "disconnect") {
    await cancelBridgeCommands(b.id);
    await db.update(robloxBridges).set({ status: "disconnected", logs: log("disconnected by user") }).where(eq(robloxBridges.id, b.id));
    return NextResponse.json({ ok: true });
  }
  if (a === "send-command") {
    if (!studioConnected(b)) return NextResponse.json({ error: "Studio has no recent heartbeat. Connect the real VexBridge plugin in Studio." }, { status: 409 });
    const cmd = (body as { command?: string; args?: Record<string, unknown> }).command || "inspect";
    const allowed = ["inspect", "read-script", "write-script", "create-instance", "set-property"];
    if (!allowed.includes(cmd)) return NextResponse.json({ error: `unknown command ${cmd}` }, { status: 400 });
    const args = (body as { args?: Record<string, unknown> }).args || {};
    if(typeof args!=="object"||Array.isArray(args)||"id" in args||"action" in args||JSON.stringify(args).length>1024*1024)return NextResponse.json({error:"Command args must be an object within 1 MB and cannot override id/action"},{status:400});
    const [queued] = await db.insert(robloxCommands).values({ bridgeId: b.id, command: cmd, args }).returning();
    await db.update(robloxBridges).set({ logs: log(`queued command ${queued.id}: ${cmd} ${JSON.stringify(args).slice(0, 300)}`) }).where(eq(robloxBridges.id, b.id));
    return NextResponse.json({ ok: true, queued: true, commandId: queued.id, note: "Command queued for Roblox Studio." });
  }
  if (a === "check-install") {
    if(process.platform!=="win32"||!process.env.LOCALAPPDATA)return NextResponse.json({ok:true,note:"Open Studio → Plugins → Plugins Folder and install the downloaded VexBridge.lua."});
    const directory=path.join(process.env.LOCALAPPDATA,"Roblox","Plugins");
    const files=fs.existsSync(directory)?fs.readdirSync(directory).filter(name=>/^vex.*\.(lua|luau|rbxmx)$/i.test(name)):[];
    const port=Number(process.env.VEX_ROBLOX_PORT||new URL(req.url).port)||7817;
    const plugins=files.map(name=>{try{const file=path.join(directory,name);if(fs.statSync(file).size>2*1024*1024)return{name,checked:false};const text=fs.readFileSync(file,"utf8");return{name,checked:true,matchingToken:text.includes(b.token),matchingEndpoint:text.includes(`http://127.0.0.1:${port}/roblox`),currentVersion:text.includes("/next-command?version=1.3.0")};}catch{return{name,checked:false};}});
    return NextResponse.json({ok:true,result:{directory,plugins,note:"One current VexBridge.lua copy should be enabled. Replace the old VexBridge copy, restart Studio, allow localhost HTTP access and press VexBridge. Other Vex plugins may use a different bridge protocol; do not enable them for this connection."}});
  }
  if (a === "clear-logs") {
    await db.update(robloxBridges).set({ logs: "" }).where(eq(robloxBridges.id, b.id));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

