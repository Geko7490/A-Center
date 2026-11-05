import { storageBusy } from "@/lib/maintenance";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { plugins } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PLUGIN_CATALOG, ensureDirs, PLUGINS_DIR } from "@/lib/vex";
import fs from "node:fs";
import path from "node:path";

async function seed() {
  ensureDirs();
  const rows = await db.select().from(plugins);
  for (const p of PLUGIN_CATALOG) {
    if (!rows.find((r) => r.key === p.key)) {
      await db.insert(plugins).values({ key: p.key, name: p.name, description: p.description, version: p.version, latestVersion: p.version, installed: false, enabled: false, status: "available", permissions: p.permissions, changelog: p.changelog, health: "unknown" });
    }
  }
}

export async function GET() {
  await seed();
  const rows = await db.select().from(plugins);
  return NextResponse.json({ plugins: rows });
}

export async function POST(req: NextRequest) {
  if (storageBusy()) return NextResponse.json({ error: "Storage relocation in progress. Restart A-Center before making changes." }, { status: 409 });
  await seed();
  const body = await req.json().catch(() => ({}));
  const b = body as { action?: string; key?: string };
  if (!b.key) return NextResponse.json({ error: "key required" }, { status: 400 });
  const rows = await db.select().from(plugins).where(eq(plugins.key, b.key));
  const p = rows[0];
  if (!p) return NextResponse.json({ error: "plugin not found" }, { status: 404 });
  const dir = path.join(PLUGINS_DIR, b.key);

  if (b.action === "install") {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ key: p.key, version: p.latestVersion, permissions: p.permissions, installedAt: new Date().toISOString() }, null, 2));
    fs.writeFileSync(path.join(dir, "README.md"), `# ${p.name}\n\n${p.description}\n\nPermissions: ${(p.permissions as string[]).join(", ")}\nSandboxed to workspace + declared APIs only.\n`);
    await db.update(plugins).set({ installed: true, enabled: true, status: "enabled", version: p.latestVersion, health: "unknown" }).where(eq(plugins.key, b.key));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "uninstall") {
    try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true }); } catch {}
    await db.update(plugins).set({ installed: false, enabled: false, status: "available", health: "unknown" }).where(eq(plugins.key, b.key));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "enable" || b.action === "disable") {
    if (!p.installed) return NextResponse.json({ error: "install first" }, { status: 400 });
    const en = b.action === "enable";
    await db.update(plugins).set({ enabled: en, status: en ? "enabled" : "disabled" }).where(eq(plugins.key, b.key));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "update") {
    await db.update(plugins).set({ version: p.latestVersion, health: "unknown" }).where(eq(plugins.key, b.key));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "health") {
    const healthy = p.installed && ["roblox-bridge", "github-connector", "terminal-tools"].includes(p.key) && fs.existsSync(path.join(dir, "manifest.json"));
    await db.update(plugins).set({ health: healthy ? "healthy" : "broken" }).where(eq(plugins.key, b.key));
    return NextResponse.json({ ok: true, health: healthy ? "healthy" : "broken", detail: healthy ? "Built-in adapter metadata present; verify connection in its integration menu" : "Adapter unavailable or manifest missing" });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
