import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { STORAGE_ROOT, MODELS_DIR, WORKSPACE_DIR } from "@/lib/vex";

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
  const body = await req.json().catch(() => ({}));
  const b = body as { key?: string; value?: string; values?: Record<string, string> };
  const entries: [string, string][] = [];
  if (b.key) entries.push([b.key, String(b.value ?? "")]);
  if (b.values) for (const [k, v] of Object.entries(b.values)) entries.push([k, String(v)]);
  for (const [k, v] of entries) {
    if (k.includes("secret") || k.includes("token") || k.includes("password")) {
      // Never store secrets in plaintext per spec — refuse with guidance
      return NextResponse.json({ error: `Refusing to store secret '${k}' in plaintext. Use OS credential manager / Git credential helper.` }, { status: 400 });
    }
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, k));
    if (rows[0]) await db.update(appSettings).set({ value: v }).where(eq(appSettings.key, k));
    else await db.insert(appSettings).values({ key: k, value: v });
  }
  return NextResponse.json({ ok: true });
}
