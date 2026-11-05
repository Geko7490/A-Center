import { db } from "@/db";
import { robloxBridges, robloxCommands } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { pairingToken } from "./vex";

export const BRIDGE_VERSION = "1.4.0";
export function matchesBridgeToken(supplied: string, expected: string) {
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
export function studioConnected(bridge: typeof robloxBridges.$inferSelect) {
  return bridge.status === "connected" && !!bridge.lastSeenAt && Date.now() - bridge.lastSeenAt.getTime() < 15000;
}
export async function currentBridge(create = false) {
  const rows = await db.select().from(robloxBridges).orderBy(desc(robloxBridges.createdAt)).limit(1);
  if (rows[0]) return rows[0];
  if (!create) return undefined;
  return (await db.insert(robloxBridges).values({token:pairingToken(), status:"waiting-for-studio", pluginVersion:"unknown", bridgeVersion:BRIDGE_VERSION, logs:"[init] Waiting for a real Studio heartbeat"}).returning())[0];
}
export async function cancelBridgeCommands(id: string) {
  await db.update(robloxCommands).set({status:"failed",error:"Bridge disconnected or pairing token changed; command was not replayed. Inspect Studio before retrying.",completedAt:new Date()}).where(and(eq(robloxCommands.bridgeId,id),inArray(robloxCommands.status,["proposed","queued","running"])));
}
