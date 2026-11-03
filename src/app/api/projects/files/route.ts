import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, fileHistory, pendingChanges } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { BACKUPS_DIR, ensureDirs, safeJoin, simpleDiff } from "@/lib/vex";

async function getProject(id: string) {
  const rows = await db.select().from(projects).where(eq(projects.id, id));
  return rows[0] || null;
}

function isProtected(p: { protectedFiles?: unknown }, rel: string): boolean {
  const list = (p.protectedFiles as string[]) || [];
  return list.some((pat) => {
    if (pat.includes("*")) {
      const rx = new RegExp("^" + pat.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
      return rx.test(rel) || rx.test(path.basename(rel));
    }
    return rel === pat || rel.endsWith("/" + pat) || path.basename(rel) === pat;
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") || "";
  const file = searchParams.get("file") || "";
  const pending = searchParams.get("pending") || "";
  if (pending && projectId) {
    const rows = await db.select().from(pendingChanges).where(eq(pendingChanges.projectId, projectId));
    return NextResponse.json({ pending: rows });
  }
  const p = await getProject(projectId);
  if (!p) return NextResponse.json({ error: "project not found" }, { status: 404 });
  try {
    const full = safeJoin(p.path, file);
    if (!fs.existsSync(full)) return NextResponse.json({ error: "file not found" }, { status: 404 });
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      const entries = fs.readdirSync(full, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }));
      return NextResponse.json({ dir: true, entries });
    }
    if (st.size > (p.fileSizeLimitKb || 1024) * 1024) return NextResponse.json({ error: `file exceeds limit (${p.fileSizeLimitKb}KB)` }, { status: 400 });
    return NextResponse.json({ content: fs.readFileSync(full, "utf8"), size: st.size });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "read failed" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  ensureDirs();
  const body = await req.json().catch(() => ({}));
  const b = body as { projectId?: string; file?: string; content?: string; action?: string; newPath?: string; id?: string; reason?: string };
  if (!b.projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const p = await getProject(b.projectId);
  if (!p) return NextResponse.json({ error: "project not found" }, { status: 404 });
  const action = b.action || "write";

  // approve / reject pending
  if (action === "approve" && b.id) {
    const rows = await db.select().from(pendingChanges).where(and(eq(pendingChanges.id, b.id), eq(pendingChanges.projectId, b.projectId)));
    const pc = rows[0];
    if (!pc) return NextResponse.json({ error: "pending change not found" }, { status: 404 });
    const full = safeJoin(p.path, pc.filePath);
    if (!fs.existsSync(path.dirname(full))) fs.mkdirSync(path.dirname(full), { recursive: true });
    let prev = "";
    if (fs.existsSync(full) && fs.statSync(full).isFile()) prev = fs.readFileSync(full, "utf8");
    const backupRel = `${p.name}/${Date.now()}_${pc.filePath.replace(/\//g, "_")}.bak`;
    const backupFull = path.join(BACKUPS_DIR, backupRel);
    fs.mkdirSync(path.dirname(backupFull), { recursive: true });
    fs.writeFileSync(backupFull, prev, "utf8");
    if (pc.action === "delete") { if (fs.existsSync(full)) fs.unlinkSync(full); }
    else fs.writeFileSync(full, pc.newContent, "utf8");
    await db.insert(fileHistory).values({ projectId: p.id, filePath: pc.filePath, action: pc.action, diff: pc.diff, backupPath: backupRel, previousContent: prev.slice(0, 20000) });
    await db.delete(pendingChanges).where(eq(pendingChanges.id, b.id));
    return NextResponse.json({ ok: true });
  }
  if (action === "reject" && b.id) {
    await db.delete(pendingChanges).where(eq(pendingChanges.id, b.id));
    return NextResponse.json({ ok: true });
  }
  if (action === "rollback" && b.id) {
    const rows = await db.select().from(fileHistory).where(and(eq(fileHistory.id, b.id), eq(fileHistory.projectId, b.projectId)));
    const h = rows[0];
    if (!h) return NextResponse.json({ error: "history entry not found" }, { status: 404 });
    const full = safeJoin(p.path, h.filePath);
    if (h.action === "create") { if (fs.existsSync(full)) fs.unlinkSync(full); }
    else {
      let content = h.previousContent;
      if ((!content || !content.length) && h.backupPath) {
        try { content = fs.readFileSync(path.join(BACKUPS_DIR, h.backupPath), "utf8"); } catch {}
      }
      if (!fs.existsSync(path.dirname(full))) fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
    await db.insert(fileHistory).values({ projectId: p.id, filePath: h.filePath, action: "rollback", diff: `rollback to ${h.id}`, backupPath: "", previousContent: "" });
    return NextResponse.json({ ok: true });
  }

  if (!b.file) return NextResponse.json({ error: "file required" }, { status: 400 });
  const rel = b.file.replace(/\\/g, "/").replace(/^\/+/, "");
  let full: string;
  try { full = safeJoin(p.path, rel); } catch (e: unknown) { return NextResponse.json({ error: e instanceof Error ? e.message : "bad path" }, { status: 400 }); }

  if (action === "mkdir") {
    if (p.permissionMode === "read-only") return NextResponse.json({ error: "Read-only mode: cannot create directories" }, { status: 403 });
    fs.mkdirSync(full, { recursive: true });
    return NextResponse.json({ ok: true });
  }
  if (action === "rename") {
    if (!b.newPath) return NextResponse.json({ error: "newPath required" }, { status: 400 });
    if (p.permissionMode === "read-only") return NextResponse.json({ error: "Read-only mode" }, { status: 403 });
    const dest = safeJoin(p.path, b.newPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(full, dest);
    await db.insert(fileHistory).values({ projectId: p.id, filePath: rel, action: "rename", diff: `rename ${rel} -> ${b.newPath}`, backupPath: "", previousContent: "" });
    return NextResponse.json({ ok: true });
  }
  if (action === "delete") {
    if (p.permissionMode === "read-only") return NextResponse.json({ error: "Read-only mode: cannot delete" }, { status: 403 });
    if (isProtected(p, rel)) return NextResponse.json({ error: `Protected file: ${rel} requires explicit unprotect first` }, { status: 403 });
    const prev = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
    if (p.permissionMode === "approval") {
      const [pc] = await db.insert(pendingChanges).values({ projectId: p.id, filePath: rel, action: "delete", newContent: "", diff: `delete ${rel} (${prev.length} chars)`, reason: b.reason || "" }).returning();
      return NextResponse.json({ ok: true, queued: true, pending: pc });
    }
    const backupRel = `${p.name}/${Date.now()}_${rel.replace(/\//g, "_")}.bak`;
    const backupFull = path.join(BACKUPS_DIR, backupRel);
    fs.mkdirSync(path.dirname(backupFull), { recursive: true });
    fs.writeFileSync(backupFull, prev, "utf8");
    fs.unlinkSync(full);
    await db.insert(fileHistory).values({ projectId: p.id, filePath: rel, action: "delete", diff: `deleted (${prev.length} chars)`, backupPath: backupRel, previousContent: prev.slice(0, 20000) });
    return NextResponse.json({ ok: true });
  }
  // write / create
  const content = b.content ?? "";
  if (p.permissionMode === "read-only") return NextResponse.json({ error: "Read-only mode: AI cannot modify files" }, { status: 403 });
  if (isProtected(p, rel)) return NextResponse.json({ error: `Protected file: ${rel} blocked even in auto mode` }, { status: 403 });
  if (Buffer.byteLength(content, "utf8") > (p.fileSizeLimitKb || 1024) * 1024) return NextResponse.json({ error: "content exceeds file size limit" }, { status: 400 });
  const prev = fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full, "utf8") : "";
  const diff = simpleDiff(prev, content);
  const isCreate = !fs.existsSync(full);
  if (p.permissionMode === "approval") {
    const [pc] = await db.insert(pendingChanges).values({ projectId: p.id, filePath: rel, action: isCreate ? "create" : "modify", newContent: content, diff, reason: b.reason || "" }).returning();
    return NextResponse.json({ ok: true, queued: true, pending: pc, diff });
  }
  // auto mode
  const backupRel = `${p.name}/${Date.now()}_${rel.replace(/\//g, "_")}.bak`;
  const backupFull = path.join(BACKUPS_DIR, backupRel);
  fs.mkdirSync(path.dirname(backupFull), { recursive: true });
  fs.writeFileSync(backupFull, prev, "utf8");
  if (!fs.existsSync(path.dirname(full))) fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  await db.insert(fileHistory).values({ projectId: p.id, filePath: rel, action: isCreate ? "create" : "modify", diff, backupPath: backupRel, previousContent: prev.slice(0, 20000) });
  return NextResponse.json({ ok: true, diff });
}
