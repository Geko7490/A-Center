import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { robloxBridges, robloxCommands } from "@/db/schema";
import { asc, desc, eq } from "drizzle-orm";
import { pairingToken, robloxPluginSource } from "@/lib/vex";

async function current() {
  const rows = await db.select().from(robloxBridges).orderBy(desc(robloxBridges.createdAt));
  if (rows[0]) return rows[0];
  const [r] = await db.insert(robloxBridges).values({ token: pairingToken(), status: "disconnected", pluginVersion: "1.2.0", bridgeVersion: "1.2.0", logs: `[init] bridge service ready (local only, 127.0.0.1)` }).returning();
  return r;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("download") === "plugin") {
    const b = await current();
    const port = Number(new URL(req.url).port) || 7817;
    return new NextResponse(robloxPluginSource(b.token, port), {
      headers: { "content-type": "text/plain", "content-disposition": `attachment; filename="VexBridge.luau"` },
    });
  }
  const b = await current();
  return NextResponse.json({ bridge: b });
}

export async function POST(req: NextRequest) {
  const b = await current();
  const body = await req.json().catch(() => ({}));
  const a = (body as { action?: string }).action || "";
  const stamp = new Date().toISOString();
  const log = (s: string) => `${(b.logs || "").slice(-8000)}\n[${stamp}] ${s}`;

  if (a === "regenerate-token") {
    const t = pairingToken();
    await db.update(robloxBridges).set({ token: t, logs: log("pairing token regenerated — reinstall plugin with new token") }).where(eq(robloxBridges.id, b.id));
    return NextResponse.json({ ok: true, token: t });
  }
  if (a === "connect") {
    await db.update(robloxBridges).set({ status: "waiting-for-studio", logs: log("listening on 127.0.0.1:7817 … open Roblox Studio, enable VexBridge plugin, press Connect") }).where(eq(robloxBridges.id, b.id));
    return NextResponse.json({ ok: true, note: "Bridge is listening locally. The Studio plugin polls http://127.0.0.1:7817/roblox/next-command with your pairing token." });
  }
  if (a === "simulate-studio") {
    // Local self-test without Studio: validates token + command pipeline
    const token = (body as { token?: string }).token || "";
    if (token !== b.token) return NextResponse.json({ error: "invalid pairing token" }, { status: 401 });
    await db.update(robloxBridges).set({ status: "connected", lastSeenAt: new Date(), logs: log("Studio handshake OK (self-test). Commands: inspect/read-script/write-script/create-instance/set-property") }).where(eq(robloxBridges.id, b.id));
    return NextResponse.json({ ok: true, result: { Workspace: ["SpawnLocation", "Baseplate"], ServerScriptService: ["Main"], ReplicatedStorage: ["Remotes"] } });
  }
  if (a === "disconnect") {
    await db.update(robloxBridges).set({ status: "disconnected", logs: log("disconnected by user") }).where(eq(robloxBridges.id, b.id));
    return NextResponse.json({ ok: true });
  }
  if (a === "send-command") {
    if (b.status !== "connected") return NextResponse.json({ error: "Studio not connected. Press Connect, then run self-test or connect the real plugin." }, { status: 400 });
    const cmd = (body as { command?: string; args?: Record<string, unknown> }).command || "inspect";
    const allowed = ["inspect", "read-script", "write-script", "create-instance", "set-property"];
    if (!allowed.includes(cmd)) return NextResponse.json({ error: `unknown command ${cmd}` }, { status: 400 });
    const args = (body as { args?: Record<string, unknown> }).args || {};
    const [queued] = await db.insert(robloxCommands).values({ bridgeId: b.id, command: cmd, args }).returning();
    await db.update(robloxBridges).set({ logs: log(`queued command ${queued.id}: ${cmd} ${JSON.stringify(args).slice(0, 300)}`) }).where(eq(robloxBridges.id, b.id));
    return NextResponse.json({ ok: true, queued: true, commandId: queued.id, note: "Command queued for Roblox Studio." });
  }
  if (a === "check-install") {
    await db.update(robloxBridges).set({ logs: log("install check: expected %LOCALAPPDATA%/Roblox/Plugins/VexBridge.luau (manual verify on Windows host)") }).where(eq(robloxBridges.id, b.id));
    return NextResponse.json({ ok: true, expected: "%LOCALAPPDATA%/Roblox/Plugins/VexBridge.luau", note: "Vex AI Center never silently overwrites an existing plugin — download and compare before replacing." });
  }
  if (a === "clear-logs") {
    await db.update(robloxBridges).set({ logs: "" }).where(eq(robloxBridges.id, b.id));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

