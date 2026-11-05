import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { robloxCommands } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db.select().from(robloxCommands).where(eq(robloxCommands.id, id));
  if (!rows[0]) return NextResponse.json({ error: "command not found" }, { status: 404 });
  return NextResponse.json({ command: rows[0] });
}

