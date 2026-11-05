import { storageBusy } from "@/lib/maintenance";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import {startRobloxTask,cancelRobloxTask,recoverRobloxTasks} from '@/lib/roblox-tasks';

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
  if (storageBusy()) return NextResponse.json({ error: "Storage relocation in progress. Restart A-Center before making changes." }, { status: 409 });
  const body = await req.json().catch(() => ({}));
  const b = body as { action?: string; id?: string; title?: string; kind?: string; assignedModel?: string; projectId?: string; steps?: { title: string; status: string; log: string }[] };
  if (!b.action || b.action === "create") {
    if (!b.title) return NextResponse.json({ error: "title required" }, { status: 400 });
    const kind=b.kind==='roblox'||((!b.kind||b.kind==='general')&&/roblox|npc|luau|studio|weapon/i.test(b.title))?'roblox':b.kind||'general';
    if(kind==='roblox'&&!b.assignedModel)return NextResponse.json({error:'Select a model for the Roblox task'},{status:400});
    const steps = b.steps?.length ? b.steps : planSteps(b.title, b.kind || "general");
    const [row] = await db.insert(tasks).values({ title: b.title, kind, status: "queued", progress: 0, assignedModel: b.assignedModel || "", projectId: b.projectId || "", steps, currentStep: 0, logs: `[created] ${b.title}\n` }).returning();
    if(kind==='roblox'){try{await startRobloxTask(row.id);}catch(e){await db.update(tasks).set({status:'failed',error:String(e)}).where(eq(tasks.id,row.id));return NextResponse.json({error:String(e),taskId:row.id},{status:409});}}
    return NextResponse.json({ task: row });
  }
  if(b.action==='recover'){await recoverRobloxTasks();return NextResponse.json({ok:true,note:'Active workers retain their state. Paused tasks are never replayed automatically.'});}
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const rows = await db.select().from(tasks).where(eq(tasks.id, b.id));
  const t = rows[0];
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  const steps = [...(t.steps as { title: string; status: string; log: string }[])];

  if (b.action === "complete-step") {
    if (["completed", "cancelled"].includes(t.status)) return NextResponse.json({ error: "Task is closed" }, { status: 400 });
    const index = t.currentStep;
    if (!steps[index]) return NextResponse.json({ error: "No pending step" }, { status: 400 });
    steps[index] = { ...steps[index], status: "done", log: "Manually marked complete by user; not automatically verified." };
    await db.update(tasks).set({ steps, currentStep: index + 1, progress: (index + 1) / steps.length, status: index + 1 === steps.length ? "completed" : "paused", error: "", logs: t.logs + `Manual completion: ${steps[index].title}\n`, updatedAt: new Date() }).where(eq(tasks.id, b.id));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "start" || b.action === "resume" || b.action === "step") {
    if(t.kind==='roblox'){try{return NextResponse.json(await startRobloxTask(t.id));}catch(e){return NextResponse.json({error:String(e)},{status:409});}}
    await db.update(tasks).set({ status: "paused", error: "Planner only: automatic code execution is not available. No files were changed or tests run.", updatedAt: new Date() }).where(eq(tasks.id, b.id));
    return NextResponse.json({ error: "This task is a plan. Execute and verify its steps manually in AI Workspace and Project Manager." }, { status: 409 });
  }

  if (b.action === "pause") {
    await cancelRobloxTask(t.id);
    await db.update(tasks).set({ status: "paused", updatedAt: new Date(), logs: (t.logs || "") + "[paused]\n" }).where(eq(tasks.id, b.id));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "cancel") {
    await cancelRobloxTask(t.id);
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
    await cancelRobloxTask(t.id);
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
