import { storageBusy } from "@/lib/maintenance";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, fileHistory,gitRepos } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { ensureDirs, WORKSPACE_DIR, walkDir, detectLanguage, safeJoin } from "@/lib/vex";

export async function GET(req: NextRequest) {
  ensureDirs();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (id) {
    const rows = await db.select().from(projects).where(eq(projects.id, id));
    const p = rows[0];
    if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
    let files: { path: string; size: number; lang: string }[] = [];
    let langs: Record<string, number> = {};
    let totalSize = 0;
    try {
      if (fs.existsSync(p.path)) {
        files = walkDir(p.path, { maxFiles: 800, exclude: (p.excludedDirs as string[]) || [] });
        for (const f of files) { langs[f.lang] = (langs[f.lang] || 0) + 1; totalSize += f.size; }
      }
    } catch (e: unknown) { return NextResponse.json({ project: p, error: e instanceof Error ? e.message : "scan failed" }); }
    const history = await db.select().from(fileHistory).where(eq(fileHistory.projectId, id)).orderBy(desc(fileHistory.createdAt));
    // dependency sniffing
    const deps: Record<string, string> = {};
    try {
      const pkg = path.join(p.path, "package.json");
      if (fs.existsSync(pkg)) deps["node"] = Object.keys(JSON.parse(fs.readFileSync(pkg, "utf8")).dependencies || {}).slice(0, 12).join(", ");
      const req2 = path.join(p.path, "requirements.txt");
      if (fs.existsSync(req2)) deps["python"] = fs.readFileSync(req2, "utf8").split("\n").slice(0, 12).join(", ");
      const cargo = path.join(p.path, "Cargo.toml");
      if (fs.existsSync(cargo)) deps["rust"] = "Cargo.toml present";
    } catch { /* ignore */ }
    await db.update(projects).set({ lastScannedAt: new Date() }).where(eq(projects.id, id));
    return NextResponse.json({ project: p, files, langs, totalSize, fileCount: files.length, deps, history: history.slice(0, 60) });
  }
  const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
  return NextResponse.json({ projects: rows });
}

export async function POST(req: NextRequest) {
  if (storageBusy()) return NextResponse.json({ error: "Storage relocation in progress. Restart A-Center before making changes." }, { status: 409 });
  ensureDirs();
  const body = await req.json().catch(() => ({}));
  const b = body as { repoId?:string; localDir?:string; action?: string; id?: string; name?: string; path?: string; permissionMode?: string; protectedFiles?: string[]; excludedDirs?: string[]; fileSizeLimitKb?: number; terminalAllowed?: boolean };
  if(b.action==='connect-local'){
    try{
      const repo=b.repoId?(await db.select().from(gitRepos).where(eq(gitRepos.id,b.repoId)))[0]:undefined;
      if(b.repoId&&!repo)throw Error('Repository not found');
      const dir=repo?.localPath||b.localDir;if(!dir||!path.isAbsolute(dir)||!fs.existsSync(dir)||!fs.statSync(dir).isDirectory())throw Error('Choose an existing absolute Local Dir folder');
      const target=fs.realpathSync(dir);if(target===path.parse(target).root)throw Error('Choose a dedicated project folder');
      const readOnly=repo?.permission==='read-only'||b.permissionMode==='read-only';
      const existing=(await db.select().from(projects)).find(p=>fs.existsSync(p.path)&&fs.realpathSync(p.path).toLowerCase()===target.toLowerCase());
      if(existing){if(readOnly&&existing.permissionMode!=='read-only')await db.update(projects).set({permissionMode:'read-only'}).where(eq(projects.id,existing.id));return NextResponse.json({project:{...existing,...(readOnly?{permissionMode:'read-only'}:{})}});}
      const [project]=await db.insert(projects).values({name:b.name||path.basename(target),path:target,permissionMode:readOnly?'read-only':'approval',protectedFiles:['.env','.env.*','*.pem','credentials.json'],excludedDirs:['node_modules','.git','dist','build','.next'],terminalAllowed:false,fileSizeLimitKb:1024}).returning();
      return NextResponse.json({project});
    }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Local Dir registration failed'},{status:400});}
  }
  if (b.action === "delete" && b.id) {
    await db.delete(projects).where(eq(projects.id, b.id));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "update" && b.id) {
    await db.update(projects).set({
      ...(b.permissionMode ? { permissionMode: b.permissionMode } : {}),
      ...(b.protectedFiles ? { protectedFiles: b.protectedFiles } : {}),
      ...(b.excludedDirs ? { excludedDirs: b.excludedDirs } : {}),
      ...(typeof b.fileSizeLimitKb === "number" ? { fileSizeLimitKb: b.fileSizeLimitKb } : {}),
      ...(typeof b.terminalAllowed === "boolean" ? { terminalAllowed: b.terminalAllowed } : {}),
      ...(b.name ? { name: b.name } : {}),
    }).where(eq(projects.id, b.id));
    return NextResponse.json({ ok: true });
  }
  // register: path must resolve inside WORKSPACE_DIR or be created there
  const name = b.name || "Untitled Project";
  let target = "";
  if (b.path && path.isAbsolute(b.path)) {
    // Allow any absolute path but sandbox note: in web preview we jail to workspace
    const resolved = path.resolve(b.path);
    const wsResolved = path.resolve(WORKSPACE_DIR);
    if (resolved === wsResolved || resolved.startsWith(wsResolved + path.sep)) target = resolved;
    else {
      // mirror external path as workspace subdir
      target = path.join(WORKSPACE_DIR, name.replace(/[^a-zA-Z0-9._-]+/g, "_"));
    }
  } else {
    try { target = safeJoin(WORKSPACE_DIR, (b.path || name).replace(/[^a-zA-Z0-9._/-]+/g, "_")); }
    catch { return NextResponse.json({ error: "Project path escapes workspace" }, { status: 400 }); }
  }
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "README.md"), `# ${name}\n\nRegistered in Vex AI Center.\nPermission: ${b.permissionMode || "approval"}\n`, "utf8");
    fs.writeFileSync(path.join(target, "main.lua"), `-- ${name} entry\nprint("Hello from ${name}")\n`, "utf8");
  }
  const [row] = await db.insert(projects).values({
    name, path: target, permissionMode: b.permissionMode || "approval",
    protectedFiles: b.protectedFiles || [".env", "*.pem", "credentials.json"],
    excludedDirs: b.excludedDirs || ["node_modules", ".git", "dist", "build", ".next"],
    fileSizeLimitKb: b.fileSizeLimitKb ?? 1024, terminalAllowed: b.terminalAllowed ?? false,
  }).returning();
  void detectLanguage;
  return NextResponse.json({ project: row });
}
