import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { downloads, models } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ensureDirs, DOWNLOADS_DIR, MODELS_DIR, FORMAT_RUNTIME_MATRIX, formatBytes } from "@/lib/vex";

// In-memory controllers for pause/cancel
const controllers = new Map<string, AbortController>();
const workers = new Map<string, Promise<void>>();

async function runDownload(id: string) {
  const rows = await db.select().from(downloads).where(eq(downloads.id, id));
  const dl = rows[0];
  if (!dl) return;
  if (workers.has(id)) return;
  const ctrl = new AbortController();
  controllers.set(id, ctrl);
  const worker = (async () => {
    try {
      await db.update(downloads).set({ status: "downloading", error: "" }).where(eq(downloads.id, id));
      ensureDirs();
      const dest = dl.destPath || path.join(DOWNLOADS_DIR, `${dl.modelName.replace(/[^a-zA-Z0-9._-]+/g, "_")}.part`);
      if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true });
      let start = 0;
      if (fs.existsSync(dest)) start = fs.statSync(dest).size;
      // Disk-space validation
      try {
        const stat = fs.statfsSync(DOWNLOADS_DIR);
        const freeBytes = Number(stat.bfree) * Number(stat.bsize);
        if (dl.totalBytes && freeBytes < (dl.totalBytes - start) + 100 * 1024 * 1024) {
          await db.update(downloads).set({ status: "failed", error: `Insufficient disk space. Need ${formatBytes(dl.totalBytes - start)}, free ${formatBytes(freeBytes)}.` }).where(eq(downloads.id, id));
          return;
        }
      } catch { /* statfs may be unavailable */ }
      const headers: Record<string, string> = {};
      if (start > 0) headers["Range"] = `bytes=${start}-`;
      const res = await fetch(dl.url, { headers, signal: ctrl.signal });
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const lenHeader = res.headers.get("content-length");
      const total = lenHeader ? start + Number(lenHeader) : dl.totalBytes || 0;
      await db.update(downloads).set({ totalBytes: total }).where(eq(downloads.id, id));
      const reader = res.body?.getReader();
      if (!reader) throw new Error("empty response body");
      const fd = fs.openSync(dest, start > 0 ? "a" : "w");
      let received = start;
      let lastTick = Date.now();
      let lastBytes = start;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          fs.writeSync(fd, value);
          received += value.length;
          const now = Date.now();
          if (now - lastTick > 600) {
            const speed = Math.round(((received - lastBytes) / Math.max(1, now - lastTick)) * 1000);
            const progress = total ? received / total : 0;
            await db.update(downloads).set({ bytesDownloaded: received, speedBps: speed, progress }).where(eq(downloads.id, id));
            lastTick = now; lastBytes = received;
          }
          const cur = (await db.select().from(downloads).where(eq(downloads.id, id)))[0];
          if (cur && (cur.status === "paused" || cur.status === "cancelled")) { try { reader.cancel(); } catch {} break; }
        }
      } finally { fs.closeSync(fd); }
      const cur = (await db.select().from(downloads).where(eq(downloads.id, id)))[0];
      if (!cur) return;
      if (cur.status === "cancelled") { try { fs.unlinkSync(dest); } catch {} return; }
      if (cur.status === "paused") { await db.update(downloads).set({ bytesDownloaded: received }).where(eq(downloads.id, id)); return; }
      // Verify + finalize: move to models dir, register model
      const st = fs.statSync(dest);
      if (total && st.size < total - 1024) {
        await db.update(downloads).set({ status: "failed", error: `Incomplete file: got ${formatBytes(st.size)} of ${formatBytes(total)}` }).where(eq(downloads.id, id));
        return;
      }
      // checksum (sha256) for integrity record
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(dest);
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (d) => hash.update(d));
        stream.on("end", () => resolve());
        stream.on("error", reject);
      });
      const finalPath = path.join(MODELS_DIR, `${dl.modelName.replace(/[^a-zA-Z0-9._-]+/g, "_")}.gguf`);
      fs.renameSync(dest, finalPath);
      await db.update(downloads).set({ status: "completed", progress: 1, bytesDownloaded: st.size, totalBytes: st.size || total }).where(eq(downloads.id, id));
      const fmt = "GGUF";
      await db.insert(models).values({
        name: dl.modelName, repo: dl.repo, version: "latest", format: fmt,
        quantization: dl.quantization || "Q4_K_M", sizeBytes: st.size,
        installPath: finalPath, runtimes: FORMAT_RUNTIME_MATRIX[fmt] || ["llama.cpp"],
        activeRuntime: "llama.cpp", compatibilityStatus: "compatible",
        status: "stopped", testStatus: "untested",
        description: `Downloaded from ${dl.repo || dl.url} · sha256:${hash.digest("hex").slice(0, 16)}…`,
        category: "chat", downloadUrl: dl.url,
      });
    } catch (e: unknown) {
      if ((e as Error)?.name === "AbortError") return;
      const cur = (await db.select().from(downloads).where(eq(downloads.id, id)))[0];
      if (cur && (cur.status === "paused" || cur.status === "cancelled")) return;
      await db.update(downloads).set({ status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "download failed" }).where(eq(downloads.id, id));
    } finally {
      controllers.delete(id);
      workers.delete(id);
    }
  })();
  workers.set(id, worker);
}

export async function GET() {
  ensureDirs();
  const rows = await db.select().from(downloads).orderBy(desc(downloads.createdAt));
  return NextResponse.json({ downloads: rows });
}

export async function POST(req: NextRequest) {
  ensureDirs();
  const body = await req.json().catch(() => ({}));
  const b = body as { url?: string; modelName?: string; repo?: string; quantization?: string; action?: string; id?: string };
  if (b.action && b.id) {
    const rows = await db.select().from(downloads).where(eq(downloads.id, b.id));
    const dl = rows[0];
    if (!dl) return NextResponse.json({ error: "download not found" }, { status: 404 });
    if (b.action === "pause") {
      await db.update(downloads).set({ status: "paused" }).where(eq(downloads.id, b.id));
      controllers.get(b.id)?.abort();
      return NextResponse.json({ ok: true });
    }
    if (b.action === "resume" || b.action === "retry") {
      await db.update(downloads).set({ status: "queued", error: "" }).where(eq(downloads.id, b.id));
      void runDownload(b.id);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "cancel") {
      await db.update(downloads).set({ status: "cancelled" }).where(eq(downloads.id, b.id));
      controllers.get(b.id)?.abort();
      return NextResponse.json({ ok: true });
    }
    if (b.action === "delete") {
      await db.delete(downloads).where(eq(downloads.id, b.id));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  if (!b.url || !b.modelName) return NextResponse.json({ error: "url and modelName required" }, { status: 400 });
  let total = 0;
  try {
    const head = await fetch(b.url, { method: "HEAD" });
    const cl = head.headers.get("content-length");
    if (cl) total = Number(cl);
  } catch { /* ignore */ }
  const dest = path.join(DOWNLOADS_DIR, `${b.modelName.replace(/[^a-zA-Z0-9._-]+/g, "_")}.part`);
  const [row] = await db.insert(downloads).values({
    modelName: b.modelName, repo: b.repo || "", url: b.url, destPath: dest,
    quantization: b.quantization || "Q4_K_M", status: "queued", totalBytes: total || 0,
  }).returning();
  void runDownload(row.id);
  return NextResponse.json({ download: row });
}
