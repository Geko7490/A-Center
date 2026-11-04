import { storageBusy } from "@/lib/maintenance";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { models, testResults } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const results = await db.select().from(testResults).orderBy(desc(testResults.createdAt));
  return NextResponse.json({ results: results.slice(0, 100) });
}

export async function POST() {
  if (storageBusy()) return NextResponse.json({ error: "Storage relocation in progress. Restart A-Center before making changes." }, { status: 409 });
  const all = await db.select().from(models);
  const working: string[] = [], errors: { id: string; name: string; error: string }[] = [];
  const { PATCH } = await import("../models/[id]/route");
  const { NextRequest } = await import("next/server");
  for (const model of all) {
    try {
      const response = await PATCH(new NextRequest("http://127.0.0.1/api/models/" + model.id, { method: "PATCH", body: JSON.stringify({ action: "test" }) }), { params: Promise.resolve({ id: model.id }) });
      const result = await response.json();
      if (result.ok) working.push(model.name);
      else errors.push({ id: model.id, name: model.name, error: result.error || "Inference failed" });
    } catch (error) { errors.push({ id: model.id, name: model.name, error: String(error) }); }
  }
  return NextResponse.json({ working, errors, unsupported: [] });
}
