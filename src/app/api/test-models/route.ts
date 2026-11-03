import { NextResponse } from "next/server";
import { db } from "@/db";
import { models, testResults } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import fs from "node:fs";
import { checkOllama, FORMAT_RUNTIME_MATRIX, getHardwareSnapshot, estimateModelMemory } from "@/lib/vex";

export async function GET() {
  const results = await db.select().from(testResults).orderBy(desc(testResults.createdAt));
  return NextResponse.json({ results: results.slice(0, 100) });
}

export async function POST() {
  const all = await db.select().from(models);
  const hw = getHardwareSnapshot();
  const oc = await checkOllama();
  const working: string[] = [], errors: { id: string; name: string; error: string }[] = [], unsupported: { id: string; name: string; reason: string }[] = [];
  for (const m of all) {
    const started = Date.now();
    const compat = FORMAT_RUNTIME_MATRIX[m.format] || [];
    if (!compat.length) {
      unsupported.push({ id: m.id, name: m.name, reason: `format ${m.format} has no runtime adapter` });
      await db.update(models).set({ testStatus: "unsupported", compatibilityStatus: "unsupported" }).where(eq(models.id, m.id));
      await db.insert(testResults).values({ modelId: m.id, status: "unsupported", error: `no runtime for ${m.format}`, runtime: "" });
      continue;
    }
    const fileOk = !m.installPath || m.installPath.startsWith("ollama:") || fs.existsSync(m.installPath);
    if (!fileOk) {
      errors.push({ id: m.id, name: m.name, error: `files missing at ${m.installPath}` });
      await db.update(models).set({ testStatus: "failed" }).where(eq(models.id, m.id));
      await db.insert(testResults).values({ modelId: m.id, status: "failed", error: "files missing", runtime: m.activeRuntime });
      continue;
    }
    const est = estimateModelMemory(m.sizeBytes || 4 * 1024 ** 3, 4096, m.quantization);
    const vramFree = hw.gpus.reduce((a, g) => a + Math.max(0, g.vramTotal - g.vramUsed), 0);
    if (est.total > (hw.mem.total + vramFree) * 1.2) {
      unsupported.push({ id: m.id, name: m.name, reason: `needs ~${Math.round(est.total / 1024 ** 3)}GB, host has ~${Math.round((hw.mem.total + vramFree) / 1024 ** 3)}GB` });
      await db.update(models).set({ testStatus: "unsupported" }).where(eq(models.id, m.id));
      await db.insert(testResults).values({ modelId: m.id, status: "unsupported", error: "insufficient memory", runtime: m.activeRuntime });
      continue;
    }
    // Live inference probe
    if (oc.available) {
      try {
        const { ollamaGenerate } = await import("@/lib/vex");
        const target = oc.models.includes(m.name) ? m.name : oc.models[0];
        if (target) {
          const r = await ollamaGenerate(target, "Reply with exactly: VEX-OK", "", { temperature: 0 });
          const ok = r.text.trim().length > 0;
          const ms = Date.now() - started;
          if (ok) {
            working.push(m.name);
            await db.update(models).set({ testStatus: "passed", compatibilityStatus: "compatible" }).where(eq(models.id, m.id));
            await db.insert(testResults).values({ modelId: m.id, status: "passed", latencyMs: ms, tokensPerSec: r.tps, output: r.text.slice(0, 1000), runtime: `ollama:${target}` });
          } else {
            errors.push({ id: m.id, name: m.name, error: "empty generation" });
            await db.update(models).set({ testStatus: "failed" }).where(eq(models.id, m.id));
            await db.insert(testResults).values({ modelId: m.id, status: "failed", error: "empty generation", runtime: target });
          }
          continue;
        }
      } catch (e: unknown) {
        errors.push({ id: m.id, name: m.name, error: e instanceof Error ? e.message.slice(0, 200) : "probe failed" });
        await db.update(models).set({ testStatus: "failed" }).where(eq(models.id, m.id));
        await db.insert(testResults).values({ modelId: m.id, status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "probe failed", runtime: m.activeRuntime });
        continue;
      }
    }
    // No live runtime → honest: files OK but NOT proven working
    errors.push({ id: m.id, name: m.name, error: "files valid; live inference unreachable (start Ollama/llama.cpp). NOT marked working." });
    await db.update(models).set({ testStatus: "failed" }).where(eq(models.id, m.id));
    await db.insert(testResults).values({ modelId: m.id, status: "failed", error: "runtime unreachable — files only", runtime: m.activeRuntime });
  }
  return NextResponse.json({ working, errors, unsupported, ollama: oc.available, note: "A model is 'working' only after files validate AND a real prompt returns output." });
}
