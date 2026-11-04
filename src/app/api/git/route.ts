import { storageBusy } from "@/lib/maintenance";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gitRepos } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_DIR, ensureDirs, safeJoin } from "@/lib/vex";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await run("git", args, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 * 4 });
    return { ok: true, out: (stdout + stderr).slice(0, 6000) };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: String((err.stdout || "") + (err.stderr || "") + (err.message || "")).slice(0, 6000) };
  }
}

export async function GET() {
  ensureDirs();
  const rows = await db.select().from(gitRepos).orderBy(desc(gitRepos.createdAt));
  const enriched = [];
  for (const r of rows) {
    let status = "", branches = "", log = "";
    if (fs.existsSync(r.localPath)) {
      const s = await git(r.localPath, ["status", "--short", "--branch"]);
      status = s.out;
      const br = await git(r.localPath, ["branch", "-a"]);
      branches = br.out;
      const lg = await git(r.localPath, ["log", "--oneline", "-n", "8"]);
      log = lg.out;
    } else status = "local path missing";
    enriched.push({ ...r, liveStatus: status, liveBranches: branches, liveLog: log });
  }
  return NextResponse.json({ repos: enriched });
}

export async function POST(req: NextRequest) {
  if (storageBusy()) return NextResponse.json({ error: "Storage relocation in progress. Restart A-Center before making changes." }, { status: 409 });
  ensureDirs();
  const body = await req.json().catch(() => ({}));
  const b = body as { action?: string; id?: string; url?: string; branch?: string; localDir?: string; message?: string; files?: string[]; newBranch?: string; permission?: string };
  if (b.action === "clone") {
    if (!b.url) return NextResponse.json({ error: "url required" }, { status: 400 });
    const m = b.url.match(/([^/]+?)(?:\.git)?\/?$/);
    const dirName = (b.localDir || (m ? m[1] : "repo")).replace(/[^a-zA-Z0-9._-]+/g, "_");
    const target = safeJoin(WORKSPACE_DIR, dirName);
    if (fs.existsSync(target)) return NextResponse.json({ error: `Directory ${dirName} already exists. Connect it instead of cloning.` }, { status: 400 });
    const args = ["clone", "--progress", b.branch ? "--branch" : "", b.branch || "", b.url, target].filter(Boolean);
    const r = await git(WORKSPACE_DIR, args);
    if (!r.ok) return NextResponse.json({ error: r.out }, { status: 400 });
    const [row] = await db.insert(gitRepos).values({ url: b.url, localPath: target, branch: b.branch || "main", permission: b.permission || "read-write" }).returning();
    return NextResponse.json({ ok: true, repo: row, output: r.out });
  }
  if (b.action === "connect") {
    if (!b.url || !b.localDir) return NextResponse.json({ error: "url and localDir required" }, { status: 400 });
    const target = path.isAbsolute(b.localDir) ? b.localDir : safeJoin(WORKSPACE_DIR, b.localDir);
    if (!fs.existsSync(path.join(target, ".git"))) return NextResponse.json({ error: "not a git repository (.git missing)" }, { status: 400 });
    const [row] = await db.insert(gitRepos).values({ url: b.url, localPath: target, branch: b.branch || "main", permission: b.permission || "read-write" }).returning();
    return NextResponse.json({ ok: true, repo: row });
  }
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const rows = await db.select().from(gitRepos).where(eq(gitRepos.id, b.id));
  const repo = rows[0];
  if (!repo) return NextResponse.json({ error: "repo not found" }, { status: 404 });
  if (!fs.existsSync(repo.localPath)) return NextResponse.json({ error: "local path missing" }, { status: 400 });
  if (b.action === "status") return NextResponse.json(await git(repo.localPath, ["status"]));
  if (b.action === "diff") return NextResponse.json(await git(repo.localPath, ["diff", "--stat", "-p", "--", "."]));
  if (b.action === "pull") {
    if (repo.permission === "read-only") return NextResponse.json({ error: "read-only permission" }, { status: 403 });
    return NextResponse.json(await git(repo.localPath, ["pull", "--ff-only"]));
  }
  if (b.action === "fetch") return NextResponse.json(await git(repo.localPath, ["fetch", "--all"]));
  if (b.action === "commit") {
    if (repo.permission === "read-only") return NextResponse.json({ error: "read-only permission" }, { status: 403 });
    if (!b.message) return NextResponse.json({ error: "commit message required" }, { status: 400 });
    const files = b.files && b.files.length ? b.files : ["-A"];
    if (files[0] === "-A") await git(repo.localPath, ["add", "-A"]);
    else await git(repo.localPath, ["add", "--", ...files]);
    return NextResponse.json(await git(repo.localPath, ["commit", "-m", b.message]));
  }
  if (b.action === "push") {
    if (repo.permission !== "read-write") return NextResponse.json({ error: "push requires read-write + manual approval (this endpoint IS the manual approval)" }, { status: 403 });
    return NextResponse.json(await git(repo.localPath, ["push", "origin", repo.branch]));
  }
  if (b.action === "branch-create") {
    if (!b.newBranch) return NextResponse.json({ error: "newBranch required" }, { status: 400 });
    const result = await git(repo.localPath, ["checkout", "-b", b.newBranch]);
    if (result.ok) await db.update(gitRepos).set({ branch: b.newBranch }).where(eq(gitRepos.id, b.id));
    return NextResponse.json(result);
  }
  if (b.action === "checkout") {
    if (!b.branch) return NextResponse.json({ error: "branch required" }, { status: 400 });
    const r = await git(repo.localPath, ["checkout", b.branch]);
    if (r.ok) await db.update(gitRepos).set({ branch: b.branch }).where(eq(gitRepos.id, b.id));
    return NextResponse.json(r);
  }
  if (b.action === "delete") {
    await db.delete(gitRepos).where(eq(gitRepos.id, b.id));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
