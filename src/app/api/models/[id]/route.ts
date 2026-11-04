import { storageBusy } from "@/lib/maintenance";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { models, testResults } from "@/db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import { probeLlama } from "@/lib/llama";
import { RUNTIMES_DIR } from "@/lib/vex";
import path from "node:path";
import { checkOllama, estimateModelMemory, FORMAT_RUNTIME_MATRIX, getHardwareSnapshot, llamaCppGenerate } from "@/lib/vex";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (storageBusy()) return NextResponse.json({ error: "Storage relocation in progress. Restart A-Center before making changes." }, { status: 409 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = (body as { action?: string }).action || "";
  const rows = await db.select().from(models).where(eq(models.id, id));
  const m = rows[0];
  if (!m) return NextResponse.json({ error: "model not found" }, { status: 404 });

  if (action === "start") {
    // Compatibility verification pipeline
    const compat = FORMAT_RUNTIME_MATRIX[m.format] || [];
    if (!compat.length) {
      await db.update(models).set({ status: "error", compatibilityStatus: "unsupported" }).where(eq(models.id, id));
      return NextResponse.json({ error: `No runtime supports format ${m.format}`, model: { ...m, status: "error" } }, { status: 400 });
    }
    if (m.installPath && !m.installPath.startsWith("ollama:") && !fs.existsSync(m.installPath)) {
      await db.update(models).set({ status: "error", compatibilityStatus: "missing-files" }).where(eq(models.id, id));
      return NextResponse.json({ error: `Model files missing at ${m.installPath}. Re-download or re-import.`, model: { ...m, status: "error" } }, { status: 400 });
    }
    const hw = getHardwareSnapshot();
    const est = estimateModelMemory(m.sizeBytes || 4 * 1024 ** 3, 4096, m.quantization);
    const availRam = hw.mem.free;
    const vramFree = hw.gpus.length ? hw.gpus.reduce((a, g) => a + Math.max(0, g.vramTotal - g.vramUsed), 0) : 0;
    const totalAvail = vramFree + availRam;
    const fits = totalAvail >= est.total * 0.6;
    // Try ollama if active runtime is ollama
    const runtime = (body as { runtime?: string }).runtime || m.activeRuntime || compat[0];
    let note = `Runtime: ${runtime}. Est ${Math.round(est.total / 1024 ** 3 * 10) / 10}GB needed.`;
    if (!fits) note += " WARNING: low memory — expect CPU offload / slow tokens.";
    if (runtime === "ollama") {
      const oc = await checkOllama();
      if (!oc.available) {
        await db.update(models).set({ status: "error", compatibilityStatus: "runtime-unreachable", activeRuntime: runtime }).where(eq(models.id, id));
        return NextResponse.json({ error: `Ollama unreachable (${oc.error || "not running"}). Start Ollama or pick llama.cpp.`, model: { ...m, status: "error" } }, { status: 400 });
      }
      note += ` Ollama reachable (${oc.models.length} models).`;
    }
    if (runtime === "llama.cpp") {
      try { await probeLlama(path.join(RUNTIMES_DIR, "llama.cpp")); }
      catch (error) { return NextResponse.json({ error: String(error) }, { status: 400 }); }
    } else if (runtime !== "ollama") return NextResponse.json({ error: "Adapter not implemented" }, { status: 400 });
    await db.update(models).set({ status: "ready", compatibilityStatus: fits ? "compatible" : "compatible-low-mem", activeRuntime: runtime, lastUsedAt: new Date() }).where(eq(models.id, id));
    return NextResponse.json({ ok: true, note, estimate: est, hardware: { ramFree: availRam, vramFree } });
  }
  if (action === "stop" || action === "restart") {
    const next = "stopped";
    await db.update(models).set({ status: next, lastUsedAt: new Date() }).where(eq(models.id, id));
    return NextResponse.json({ ok: true, status: next });
  }
  if (action === "test") {
    const started = Date.now();
    const fileOk = !m.installPath || m.installPath.startsWith("ollama:") || fs.existsSync(m.installPath);
    if (!fileOk) {
      await db.update(models).set({ testStatus: "failed", status: "error" }).where(eq(models.id, id));
      await db.insert(testResults).values({ modelId: id, status: "failed", error: "model files missing", runtime: m.activeRuntime });
      return NextResponse.json({ error: "Model files missing — marked as failed, not working." }, { status: 400 });
    }
    // Real inference test via Ollama if possible
    let output = "", tps = 0, status = "passed", error = "";
    try {
      if (m.format === "GGUF" && !m.installPath.startsWith("ollama:") && m.activeRuntime !== "ollama") {
        const result = await llamaCppGenerate(m.installPath, "Reply with OK.", "", { contextTokens: 1024, gpuLayers: "auto", cpuThreads: 8 });
        output = result.text; tps = result.tps;
      } else if (m.activeRuntime === "ollama" || m.installPath.startsWith("ollama:")) {
        const oc = await checkOllama();
        const name = m.installPath.startsWith("ollama:") ? m.installPath.slice(7) : m.name;
        const target = oc.models.find((x) => x === name || x === `${name}:latest`);
        if (!target) throw new Error(`Selected model not found in Ollama: ${name}`);
        const { ollamaGenerate } = await import("@/lib/vex");
        const result = await ollamaGenerate(target, "Reply with OK.", "", { temperature: 0 });
        output = result.text; tps = result.tps;
      } else throw new Error("Adapter not implemented for this model");
      if (!output.trim()) throw new Error("No generated text");
    } catch (e: unknown) {
      status = "failed"; error = e instanceof Error ? e.message : "test crashed";
    }
    const ms = Date.now() - started;
    await db.update(models).set({ testStatus: status }).where(eq(models.id, id));
    await db.insert(testResults).values({ modelId: id, status, latencyMs: ms, tokensPerSec: tps, output: output.slice(0, 2000), error: error.slice(0, 1000), runtime: m.activeRuntime });
    return NextResponse.json({ ok: status === "passed", status, output, error, ms, tps });
  }
  if (action === "set-runtime") {
    const rt = (body as { runtime?: string }).runtime || "";
    const compat = FORMAT_RUNTIME_MATRIX[m.format] || [];
    if (!compat.includes(rt)) return NextResponse.json({ error: `${rt} does not support ${m.format}. Compatible: ${compat.join(", ")}` }, { status: 400 });
    await db.update(models).set({ activeRuntime: rt }).where(eq(models.id, id));
    return NextResponse.json({ ok: true });
  }
  if (action === "configure") {
    const patch: Partial<typeof m> = {};
    const b = body as Record<string, unknown>;
    if (typeof b.version === "string") patch.version = b.version;
    if (typeof b.quantization === "string") patch.quantization = b.quantization;
    if (typeof b.description === "string") patch.description = b.description;
    await db.update(models).set(patch).where(eq(models.id, id));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (storageBusy()) return NextResponse.json({ error: "Storage relocation in progress. Restart A-Center before making changes." }, { status: 409 });
  const { id } = await params;
  const rows = await db.select().from(models).where(eq(models.id, id));
  const m = rows[0];
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (m.status === "running") return NextResponse.json({ error: "Stop the model before deleting." }, { status: 400 });
  try {
    if (m.installPath && fs.existsSync(m.installPath)) {
      const st = fs.statSync(m.installPath);
      if (st.isFile()) fs.unlinkSync(m.installPath);
    }
  } catch { /* keep db delete anyway */ }
  await db.delete(models).where(eq(models.id, id));
  return NextResponse.json({ ok: true });
}
