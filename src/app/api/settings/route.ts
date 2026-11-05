import { storageBusy, setStorageBusy, aiOperationActive } from "@/lib/maintenance";
import { isGenerating,llamaServer } from "@/lib/llama";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings, downloads, fileHistory, gitRepos, models, projects, runtimes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { STORAGE_ROOT, MODELS_DIR, WORKSPACE_DIR } from "@/lib/vex";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULTS: Record<string, string> = {
  "storage.root": STORAGE_ROOT,
  "storage.models": MODELS_DIR,
  "storage.workspace": WORKSPACE_DIR,
  "models.autoRuntime": "1",
  "terminal.allowDangerous": "0",
  "terminal.defaultCwd": WORKSPACE_DIR,
  "chat.defaultTemp": "0.7",
  "chat.defaultCtx": "4096",
  "roblox.port": "7817",
  "updates.check": "1",
};

export async function GET() {
  const rows = await db.select().from(appSettings);
  const map: Record<string, string> = { ...DEFAULTS };
  for (const r of rows) map[r.key] = r.value;
  return NextResponse.json({ settings: map });
}

export async function POST(req: NextRequest) {
  if (storageBusy()) return NextResponse.json({ error: "Storage relocation already in progress. Restart the app." }, { status: 409 });
  setStorageBusy(true);
  let restart = false;
  try {
    const response = await saveSettings(req);
    restart = (await response.clone().json()).restartRequired === true;
    return response;
  } finally { if (!restart) setStorageBusy(false); }
}

async function saveSettings(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const b = body as { key?: string; value?: string; values?: Record<string, string> };
  const entries: [string, string][] = [];
  if (b.key) entries.push([b.key, String(b.value ?? "")]);
  if (b.values) for (const [k, v] of Object.entries(b.values)) entries.push([k, String(v)]);
  const requestedRoot = entries.find(([key]) => key === "storage.root")?.[1];
  let restartRequired = false;
  if (requestedRoot && !samePath(requestedRoot, STORAGE_ROOT)) {
    const configPath = process.env.VEX_CONFIG_PATH;
    if (!configPath) return NextResponse.json({ error: "Storage relocation is available from the installed desktop app." }, { status: 400 });
    if (!path.isAbsolute(requestedRoot)) return NextResponse.json({ error: "Choose an absolute folder path." }, { status: 400 });

    const targetRoot = path.resolve(requestedRoot);
    if (targetRoot === path.parse(targetRoot).root) return NextResponse.json({ error: "Choose a dedicated folder, such as D:\\A-Center, not the drive root." }, { status: 400 });
    const currentRoot = path.resolve(STORAGE_ROOT);
    if (isWithin(targetRoot, currentRoot) || isWithin(currentRoot, targetRoot)) {
      return NextResponse.json({ error: "Choose a separate folder, such as D:\\A-Center." }, { status: 400 });
    }

    if (isGenerating() || aiOperationActive()) return NextResponse.json({ error: "Wait for the current model response or tool operation before relocating storage." }, { status: 409 });
    await llamaServer.stop();
    const activeDownloads = await db.select().from(downloads);
    if (activeDownloads.some((download) => ["queued", "downloading", "paused"].includes(download.status))) {
      return NextResponse.json({ error: "Finish or cancel active model downloads before moving storage." }, { status: 409 });
    }
    const activeRuntimes = await db.select().from(runtimes);
    if (activeRuntimes.some((runtime) => ["running", "starting"].includes(runtime.status))) {
      return NextResponse.json({ error: "Stop running runtimes before moving storage." }, { status: 409 });
    }

    const stagingRoot = `${targetRoot}.a-center-moving-${crypto.randomUUID()}`;
    const previousConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : null;
    let targetCreated = false;
    let configChanged = false;
    try {
      const parent = path.dirname(targetRoot);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
      fs.accessSync(parent, fs.constants.W_OK);
      if (fs.existsSync(targetRoot) && fs.readdirSync(targetRoot).length > 0) {
        return NextResponse.json({ error: "The selected A-Center folder is not empty." }, { status: 409 });
      }
      fs.rmSync(stagingRoot, { recursive: true, force: true });
      fs.mkdirSync(stagingRoot, { recursive: true });
      if (fs.existsSync(currentRoot)) {
        fs.cpSync(currentRoot, stagingRoot, {
          recursive: true,
          filter: (source) => path.resolve(source) !== path.resolve(process.env.VEX_DATABASE || path.join(currentRoot, "database")),
        });
      }
      if (fs.existsSync(targetRoot)) fs.rmdirSync(targetRoot);
      fs.renameSync(stagingRoot, targetRoot);
      targetCreated = true;

      await db.transaction(async (tx) => {
        const updatePathRows = async <T extends { id: string }>(rows: T[], getPath: (row: T) => string, update: (row: T, nextPath: string) => Promise<unknown>) => {
          for (const row of rows) {
            const oldValue = getPath(row);
            const nextValue = relocatePath(oldValue, currentRoot, targetRoot);
            if (nextValue !== oldValue) await update(row, nextValue);
          }
        };
        await updatePathRows(await tx.select().from(models), (row) => row.installPath, (row, value) => tx.update(models).set({ installPath: value }).where(eq(models.id, row.id)));
        await updatePathRows(await tx.select().from(runtimes), (row) => row.installPath, (row, value) => tx.update(runtimes).set({ installPath: value }).where(eq(runtimes.name, row.name)));
        await updatePathRows(await tx.select().from(downloads), (row) => row.destPath, (row, value) => tx.update(downloads).set({ destPath: value }).where(eq(downloads.id, row.id)));
        await updatePathRows(await tx.select().from(projects), (row) => row.path, (row, value) => tx.update(projects).set({ path: value }).where(eq(projects.id, row.id)));
        await updatePathRows((await tx.select().from(fileHistory)).filter((row) => path.isAbsolute(row.backupPath)), (row) => row.backupPath, (row, value) => tx.update(fileHistory).set({ backupPath: value }).where(eq(fileHistory.id, row.id)));
        await updatePathRows(await tx.select().from(gitRepos), (row) => row.localPath, (row, value) => tx.update(gitRepos).set({ localPath: value }).where(eq(gitRepos.id, row.id)));
        const stored = [
          ["storage.root", targetRoot],
          ["storage.models", path.join(targetRoot, "models")],
          ["storage.workspace", path.join(targetRoot, "workspace")],
          ["terminal.defaultCwd", path.join(targetRoot, "workspace")],
        ] as const;
        for (const [key, value] of stored) {
          const rows = await tx.select().from(appSettings).where(eq(appSettings.key, key));
          if (rows[0]) await tx.update(appSettings).set({ value }).where(eq(appSettings.key, key));
          else await tx.insert(appSettings).values({ key, value });
        }
        const tempConfig = `${configPath}.tmp`;
        fs.writeFileSync(tempConfig, JSON.stringify({ storageRoot: targetRoot, previousStorageRoot: currentRoot }, null, 2), "utf8");
        fs.renameSync(tempConfig, configPath);
        configChanged = true;
      });
      restartRequired = true;
    } catch (error) {
      // The original files remain untouched even when config/DB commit fails.
      if (configChanged) {
        if (previousConfig === null) fs.rmSync(configPath, { force: true });
        else fs.writeFileSync(configPath, previousConfig, "utf8");
      }
      fs.rmSync(stagingRoot, { recursive: true, force: true });
      if (targetCreated) fs.rmSync(targetRoot, { recursive: true, force: true });
      return NextResponse.json({ error: `Could not move storage: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
    }
  }

  for (const [k, v] of entries) {
    if (["storage.root", "storage.models", "storage.workspace"].includes(k) || (restartRequired && k === "terminal.defaultCwd")) continue;
    if (k.includes("secret") || k.includes("token") || k.includes("password")) {
      // Never store secrets in plaintext per spec — refuse with guidance
      return NextResponse.json({ error: `Refusing to store secret '${k}' in plaintext. Use OS credential manager / Git credential helper.` }, { status: 400 });
    }
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, k));
    if (rows[0]) await db.update(appSettings).set({ value: v }).where(eq(appSettings.key, k));
    else await db.insert(appSettings).values({ key: k, value: v });
  }
  return NextResponse.json({ ok: true, restartRequired });
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function relocatePath(value: string, from: string, to: string): string {
  const relative = path.relative(from, value);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return value;
  return path.join(to, relative);
}

