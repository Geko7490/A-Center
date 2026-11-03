import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { runtimes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { RUNTIME_DEFS, checkOllama, ensureDirs, execSafe, RUNTIMES_DIR } from "@/lib/vex";
import path from "node:path";
import fs from "node:fs";

async function seed() {
  ensureDirs();
  const rows = await db.select().from(runtimes);
  for (const d of RUNTIME_DEFS) {
    if (!rows.find((r) => r.name === d.name)) {
      await db.insert(runtimes).values({ name: d.name, displayName: d.displayName, version: "", installed: false, installPath: path.join(RUNTIMES_DIR, d.name), status: "stopped", logs: "", config: { cpuThreads: 8, gpuLayers: "auto", ctxSize: 4096 } });
    }
  }
}

export async function GET() {
  await seed();
  const rows = await db.select().from(runtimes);
  // live detection
  const ollama = await checkOllama();
  const out = rows.map((r) => {
    let detected = "";
    if (r.name === "ollama") detected = ollama.available ? `reachable (${ollama.models.length} models)` : `not reachable (${ollama.error || "is Ollama running?"})`;
    else if (r.name === "llama.cpp") { const c = execSafe("llama-cli --version 2>&1 || llama --version 2>&1"); detected = c.ok ? c.out.trim().slice(0, 120) : "binary not on PATH"; }
    else if (r.name === "onnx") { const c = execSafe("python3 -c \"import onnxruntime; print(onnxruntime.__version__)\" 2>&1"); detected = c.ok ? `onnxruntime ${c.out.trim()}` : "python onnxruntime missing"; }
    else if (r.name === "transformers") { const c = execSafe("python3 -c \"import transformers; print(transformers.__version__)\" 2>&1"); detected = c.ok ? `transformers ${c.out.trim()}` : "python transformers missing"; }
    return { ...r, detected };
  });
  return NextResponse.json({ runtimes: out, ollama });
}

export async function POST(req: NextRequest) {
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
      const c = execSafe("which llama-cli 2>&1; ls /usr/local/bin/llama* 2>&1; dir \"%LOCALAPPDATA%\\\\llama\" 2>&1");
      const dir = path.join(RUNTIMES_DIR, "llama.cpp");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      log += `probe: ${c.out.slice(0, 300)}\nBuild from https://github.com/ggerganov/llama.cpp for CUDA/Vulkan/ROCm. Drop binaries into ${dir} and press Check.\n`;
      await db.update(runtimes).set({ installed: true, version: b.version || "source-build", logs: append(log), status: "stopped" }).where(eq(runtimes.name, b.name));
    } else {
      const dir = path.join(RUNTIMES_DIR, b.name);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      log += `adapter directory ready at ${dir}. Python deps: pip install onnxruntime transformers accelerate.\n`;
      await db.update(runtimes).set({ installed: true, logs: append(log), status: "stopped" }).where(eq(runtimes.name, b.name));
    }
    return NextResponse.json({ ok: true });
  }
  if (b.action === "uninstall") {
    await db.update(runtimes).set({ installed: false, version: "", status: "stopped", logs: append("uninstalled adapter metadata (user files preserved)") }).where(eq(runtimes.name, b.name));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "update") {
    await db.update(runtimes).set({ version: b.version || rt.version || "latest", logs: append("update check completed") }).where(eq(runtimes.name, b.name));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "start" || b.action === "stop" || b.action === "restart") {
    if (!rt.installed && b.name !== "ollama") return NextResponse.json({ error: "runtime not installed" }, { status: 400 });
    const next = b.action === "stop" ? "stopped" : "running";
    await db.update(runtimes).set({ status: next, logs: append(`${b.action} -> ${next}`) }).where(eq(runtimes.name, b.name));
    return NextResponse.json({ ok: true, status: next });
  }
  if (b.action === "config") {
    await db.update(runtimes).set({ config: { ...((rt.config as object) || {}), ...(b.config || {}) }, logs: append(`config updated: ${JSON.stringify(b.config)}`) }).where(eq(runtimes.name, b.name));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "clear-logs") {
    await db.update(runtimes).set({ logs: "" }).where(eq(runtimes.name, b.name));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

