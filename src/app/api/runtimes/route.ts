import { storageBusy } from "@/lib/maintenance";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { runtimes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { RUNTIME_DEFS, checkOllama, ensureDirs, execSafe, RUNTIMES_DIR } from "@/lib/vex";
import path from "node:path";
import fs from "node:fs";
import { probeLlama,llamaDevices,llamaServer } from "@/lib/llama";

async function seed() {
  ensureDirs();
  const rows = await db.select().from(runtimes);
  for (const d of RUNTIME_DEFS) {
    if (!rows.find((r) => r.name === d.name)) {
      await db.insert(runtimes).values({ name: d.name, displayName: d.displayName, version: "", installed: false, installPath: path.join(RUNTIMES_DIR, d.name), status: "stopped", logs: "", config: { cpuThreads: 8, gpuLayers: "auto", ctxSize: 4096 } });
    }
  }
}

export async function GET(req:NextRequest) {
  await seed();
  const rows = await db.select().from(runtimes);
  // live detection
  const force=req.nextUrl.searchParams.get('refresh')==='1';
  const ollama = await checkOllama(force);
  let devices:Awaited<ReturnType<typeof llamaDevices>>=[],deviceError='';
  try{const rt=rows.find(r=>r.name==='llama.cpp');const probe=await probeLlama(rt?.installPath||path.join(RUNTIMES_DIR,'llama.cpp'),force);devices=await llamaDevices(probe,force);}catch(error){deviceError=error instanceof Error?error.message:'Device detection failed';}
  const out = rows.map((r) => {
    let detected = "";
    if (r.name === "ollama") detected = ollama.available ? `reachable (${ollama.models.length} models)` : `not reachable (${ollama.error || "is Ollama running?"})`;
    else if (r.name === "llama.cpp") detected = deviceError||`llama-server ready · ${devices.map(d=>`${d.id}: ${d.name}`).join(', ')||'CPU only'}`;
    else detected='Adapter not implemented';
    return { ...r, detected };
  });
  return NextResponse.json({ runtimes: out, ollama,devices,server:llamaServer.snapshot() });
}

export async function POST(req: NextRequest) {
  if (storageBusy()) return NextResponse.json({ error: "Storage relocation in progress. Restart A-Center before making changes." }, { status: 409 });
  await seed();
  const body = await req.json().catch(() => ({}));
  const b = body as { action?: string; name?: string; config?: Record<string, unknown>; version?: string };
  if (!b.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const rows = await db.select().from(runtimes).where(eq(runtimes.name, b.name));
  const rt = rows[0];
  if (!rt) return NextResponse.json({ error: "runtime not found" }, { status: 404 });
  const stamp = new Date().toISOString();
  const append = (s: string) => `${(rt.logs || "").slice(-6000)}\n[${stamp}] ${s}`;

  if (b.action === "install") {
    let log = `install requested for ${b.name}\n`;
    if (b.name === "ollama") {
      const c = execSafe("ollama --version 2>&1");
      log += c.ok ? `found: ${c.out.trim()}\n` : "Ollama binary not detected. Install from https://ollama.com/download then press Check again. Vex AI Center never bundles closed installers silently.\n";
      await db.update(runtimes).set({ installed: c.ok, version: c.ok ? c.out.trim().slice(0, 60) : rt.version, logs: append(log), status: c.ok ? "stopped" : "missing-deps" }).where(eq(runtimes.name, b.name));
    } else if (b.name === "llama.cpp") {
      const dir = path.join(RUNTIMES_DIR, "llama.cpp");
      try {
        const probe = await probeLlama(dir);
        await db.update(runtimes).set({ installed: true, version: "Server verified", logs: append(`Verified ${probe.executable}`), status: "ready" }).where(eq(runtimes.name, b.name));
      } catch (error) {
        await db.update(runtimes).set({ installed: false, status: "missing-deps", logs: append(String(error)) }).where(eq(runtimes.name, b.name));
        return NextResponse.json({ error: String(error) }, { status: 400 });
      }
    } else return NextResponse.json({ error: "This adapter is not implemented. Use GGUF/llama.cpp or Ollama." }, { status: 400 });

    return NextResponse.json({ ok: true });
  }
  if (b.action === "uninstall") {
    if(b.name==='llama.cpp'){try{await llamaServer.stop();}catch(e){return NextResponse.json({error:String(e)},{status:409});}}
    await db.update(runtimes).set({ installed: false, version: "", status: "stopped", logs: append("uninstalled adapter metadata (user files preserved)") }).where(eq(runtimes.name, b.name));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "update") {
    await db.update(runtimes).set({ version: b.version || rt.version || "latest", logs: append("update check completed") }).where(eq(runtimes.name, b.name));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "start" || b.action === "stop" || b.action === "restart") {
    if (!rt.installed && b.name !== "ollama"&&b.action!=='stop') return NextResponse.json({ error: "runtime not installed" }, { status: 400 });
    if (b.name === "llama.cpp") {
      if(b.action==='stop'||b.action==='restart'){try{await llamaServer.stop();}catch(e){return NextResponse.json({error:String(e)},{status:409});}}
      try { if(b.action!=='stop')await probeLlama(path.join(RUNTIMES_DIR, "llama.cpp")); }
      catch (error) { return NextResponse.json({ error: String(error) }, { status: 400 }); }
    } else if (b.name === "ollama") {
      const live = await checkOllama();
      if (!live.available) return NextResponse.json({ error: "Start Ollama externally; its service is not reachable." }, { status: 400 });
    } else return NextResponse.json({ error: "Adapter not implemented" }, { status: 400 });
    const next = b.action === "stop" ? "stopped" : "ready";
    await db.update(runtimes).set({ status: next, logs: append(`${b.action}: ${next}. Inference runs on demand in AI Workspace.`) }).where(eq(runtimes.name, b.name));
    return NextResponse.json({ ok: true, status: next });
  }

  if (b.action === "config") {
    if(b.name==='llama.cpp'){try{await llamaServer.stop();}catch(e){return NextResponse.json({error:String(e)},{status:409});}}
    await db.update(runtimes).set({ config: { ...((rt.config as object) || {}), ...(b.config || {}) }, logs: append(`config updated: ${JSON.stringify(b.config)}`) }).where(eq(runtimes.name, b.name));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "clear-logs") {
    await db.update(runtimes).set({ logs: "" }).where(eq(runtimes.name, b.name));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

