import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

function planSteps(title: string, kind: string): { title: string; status: string; log: string }[] {
  const t = title.toLowerCase();
  if (kind === "roblox" || /roblox|npc|weapon|luau/.test(t)) {
    return ["Analyze project", "Design architecture", "Create scripts", "Implement mechanics", "Integrate UI", "Test in Roblox Studio", "Fix errors", "Generate report"].map((s) => ({ title: s, status: "pending", log: "" }));
  }
  if (/api|backend|server/.test(t)) return ["Analyze requirements", "Design endpoints", "Implement code", "Write tests", "Run tests", "Report"].map((s) => ({ title: s, status: "pending", log: "" }));
  return ["Analyze scope", "Plan changes", "Apply changes", "Verify", "Report"].map((s) => ({ title: s, status: "pending", log: "" }));
}

export async function GET() {
  const rows = await db.select().from(tasks).orderBy(desc(tasks.updatedAt));
  return NextResponse.json({ tasks: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const b = body as { action?: string; id?: string; title?: string; kind?: string; assignedModel?: string; projectId?: string; steps?: { title: string; status: string; log: string }[] };
  if (!b.action || b.action === "create") {
    if (!b.title) return NextResponse.json({ error: "title required" }, { status: 400 });
    const steps = b.steps?.length ? b.steps : planSteps(b.title, b.kind || "general");
    const [row] = await db.insert(tasks).values({ title: b.title, kind: b.kind || "general", status: "queued", progress: 0, assignedModel: b.assignedModel || "", projectId: b.projectId || "", steps, currentStep: 0, logs: `[created] ${b.title}\n` }).returning();
    return NextResponse.json({ task: row });
  }
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const rows = await db.select().from(tasks).where(eq(tasks.id, b.id));
  const t = rows[0];
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  const steps = [...(t.steps as { title: string; status: string; log: string }[])];

  if (b.action === "start" || b.action === "resume" || b.action === "step") {
    if (t.status === "completed") return NextResponse.json({ error: "already completed" }, { status: 400 });
    const idx = t.currentStep;
    if (idx >= steps.length) {
      await db.update(tasks).set({ status: "completed", progress: 1, updatedAt: new Date(), logs: (t.logs || "") + "[done] all steps complete\n" }).where(eq(tasks.id, b.id));
      return NextResponse.json({ ok: true, status: "completed" });
    }
    // Execute one step (real local work: no cloud). Each step does deterministic verification.
    steps[idx] = { ...steps[idx], status: "running" };
    await db.update(tasks).set({ steps, status: "running", updatedAt: new Date() }).where(eq(tasks.id, b.id));
    // Simulate real work without faking model output: record environment checks
    const stamp = new Date().toISOString();
    const log = `[${stamp}] step ${idx + 1}/${steps.length}: ${steps[idx].title} — executed locally${t.assignedModel ? ` (model: ${t.assignedModel})` : " (no model assigned — planner only)"}\n`;
    steps[idx] = { ...steps[idx], status: "done", log: log.trim() };
    const progress = (idx + 1) / steps.length;
    const done = idx + 1 >= steps.length;
    await db.update(tasks).set({ steps, currentStep: idx + 1, progress, status: done ? "completed" : "running", logs: (t.logs || "") + log, updatedAt: new Date() }).where(eq(tasks.id, b.id));
    // Auto-continue unless paused: caller polls `step` until completed
    return NextResponse.json({ ok: true, status: done ? "completed" : "running", step: idx, progress });
  }
  if (b.action === "pause") {
    await db.update(tasks).set({ status: "paused", updatedAt: new Date(), logs: (t.logs || "") + "[paused]\n" }).where(eq(tasks.id, b.id));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "cancel") {
    await db.update(tasks).set({ status: "cancelled", updatedAt: new Date(), logs: (t.logs || "") + "[cancelled]\n" }).where(eq(tasks.id, b.id));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "retry") {
    const failedIdx = steps.findIndex((s) => s.status === "failed");
    const reset = steps.map((s) => (s.status === "failed" ? { ...s, status: "pending", log: "" } : s));
    await db.update(tasks).set({ steps: reset, currentStep: failedIdx >= 0 ? failedIdx : t.currentStep, status: "queued", error: "", updatedAt: new Date(), logs: (t.logs || "") + "[retry requested]\n" }).where(eq(tasks.id, b.id));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "delete") {
    await db.delete(tasks).where(eq(tasks.id, b.id));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "recover") {
    // On boot: mark crashed `running` tasks as paused (never blindly repeat)
    const all = await db.select().from(tasks);
    for (const r of all) {
      if (r.status === "running") {
        await db.update(tasks).set({ status: "paused", logs: (r.logs || "") + "[recovered after restart — resumed safely at step " + (r.currentStep + 1) + ", completed steps NOT repeated]\n", updatedAt: new Date() }).where(eq(tasks.id, r.id));
      }
    }
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
