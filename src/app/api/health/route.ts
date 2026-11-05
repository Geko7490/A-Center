import { db, initializeDb } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await initializeDb();
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, service: "a-center" });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "startup failed" }, { status: 503 });
  }
}

