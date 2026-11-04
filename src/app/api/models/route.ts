import { storageBusy } from "@/lib/maintenance";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { models } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureDirs, MODELS_DIR, FORMAT_RUNTIME_MATRIX } from "@/lib/vex";
import path from "node:path";
import fs from "node:fs";

export async function GET() {
  ensureDirs();
  const rows = await db.select().from(models).orderBy(desc(models.createdAt));
  return NextResponse.json({ models: rows });
}

export async function POST(req: NextRequest) {
  if (storageBusy()) return NextResponse.json({ error: "Storage relocation in progress. Restart A-Center before making changes." }, { status: 409 });
  ensureDirs();
  const body = await req.json().catch(() => ({}));
  const { name, repo, version, format, quantization, sizeBytes, description, category, downloadUrl, installPath } = body as Record<string, unknown>;
  if (!name || typeof name !== "string") return NextResponse.json({ error: "name required" }, { status: 400 });
  const fmt = typeof format === "string" ? format : "GGUF";
  const runtimes = FORMAT_RUNTIME_MATRIX[fmt] || ["llama.cpp"];
  const finalPath = typeof installPath === "string" && installPath ? installPath : path.join(MODELS_DIR, name.replace(/[^a-zA-Z0-9._-]+/g, "_"));
  const [row] = await db.insert(models).values({
    name, repo: typeof repo === "string" ? repo : "",
    version: typeof version === "string" ? version : "latest",
    format: fmt, quantization: typeof quantization === "string" ? quantization : "Q4_K_M",
    sizeBytes: typeof sizeBytes === "number" ? Math.round(sizeBytes) : 0,
    installPath: finalPath, runtimes, activeRuntime: runtimes[0] || "",
    compatibilityStatus: "unknown", status: "stopped", testStatus: "untested",
    description: typeof description === "string" ? description : "",
    category: typeof category === "string" ? category : "chat",
    downloadUrl: typeof downloadUrl === "string" ? downloadUrl : "",
  }).returning();
  // If local file import: validate existence
  if (body && (body as { checkFile?: boolean }).checkFile && finalPath) {
    try {
      const exists = fs.existsSync(finalPath);
      if (exists) {
        const st = fs.statSync(finalPath);
        await db.update(models).set({ sizeBytes: st.size, compatibilityStatus: "compatible", status: "stopped" }).where(eq(models.id, row.id));
      }
    } catch { /* ignore */ }
  }
  return NextResponse.json({ model: row });
}
