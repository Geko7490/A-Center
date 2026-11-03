import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { terminalHistory, appSettings } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { exec } from "node:child_process";
import { WORKSPACE_DIR, ensureDirs, isDangerousCommand } from "@/lib/vex";

export async function GET() {
  const rows = await db.select().from(terminalHistory).orderBy(desc(terminalHistory.createdAt));
  return NextResponse.json({ history: rows.slice(0, 100) });
}

export async function POST(req: NextRequest) {
  ensureDirs();
  const body = await req.json().catch(() => ({}));
  const b = body as { command?: string; cwd?: string; approveDangerous?: boolean };
  const cmd = (b.command || "").trim();
  if (!cmd) return NextResponse.json({ error: "command required" }, { status: 400 });
  if (cmd.length > 2000) return NextResponse.json({ error: "command too long" }, { status: 400 });
  const settings = await db.select().from(appSettings);
  const allowDangerous = settings.find((s) => s.key === "terminal.allowDangerous")?.value === "1";
  const dangerous = isDangerousCommand(cmd);
  if (dangerous && !(b.approveDangerous && allowDangerous)) {
    return NextResponse.json({ error: "Dangerous command blocked. Enable Settings → Terminal → Allow dangerous commands, then re-run with explicit approval.", dangerous: true }, { status: 403 });
  }
  const cwd = b.cwd && b.cwd.startsWith(WORKSPACE_DIR) ? b.cwd : WORKSPACE_DIR;
  const started = Date.now();
  const output: string = await new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 25000, maxBuffer: 1024 * 1024 * 2, shell: process.platform === "win32" ? "powershell.exe" : "/bin/sh" }, (err, stdout, stderr) => {
      const code = (err as { code?: number } | null)?.code ?? 0;
      resolve(`$ ${cmd}\n(exit ${code})\n${(stdout || "")}${stderr ? `\n[stderr]\n${stderr}` : ""}`.slice(0, 8000));
    });
  });
  const ms = Date.now() - started;
  const exitCode = output.includes("(exit 0)") ? 0 : 1;
  const [row] = await db.insert(terminalHistory).values({ command: cmd, output, exitCode, cwd, durationMs: ms }).returning();
  return NextResponse.json({ entry: row });
}
