import { NextResponse } from "next/server";
import { db } from "@/db";
import { models, runtimes, downloads, tasks, projects, plugins, conversations } from "@/db/schema";
import { desc } from "drizzle-orm";
import { getHardwareSnapshot, checkOllama } from "@/lib/vex";

export async function GET() {
  const [m, r, d, t, p, pl, c] = await Promise.all([
    db.select().from(models), db.select().from(runtimes),
    db.select().from(downloads).orderBy(desc(downloads.createdAt)),
    db.select().from(tasks).orderBy(desc(tasks.updatedAt)),
    db.select().from(projects), db.select().from(plugins),
    db.select().from(conversations).orderBy(desc(conversations.createdAt)),
  ]);
  const hw = getHardwareSnapshot();
  const oc = await checkOllama();
  return NextResponse.json({
    counts: {
      models: m.length, running: m.filter((x) => x.status === "running").length,
      runtimes: r.filter((x) => x.installed).length, downloads: d.filter((x) => x.status === "downloading" || x.status === "queued").length,
      tasks: t.filter((x) => x.status === "running" || x.status === "queued").length,
      projects: p.length, plugins: pl.filter((x) => x.enabled).length, conversations: c.length,
    },
    models: m.slice(0, 6), downloads: d.slice(0, 5), tasks: t.slice(0, 5), conversations: c.slice(0, 5),
    hardware: { cpu: hw.cpu, mem: hw.mem, disk: hw.disk, gpus: hw.gpus, backends: hw.backends },
    ollama: oc,
  });
}
