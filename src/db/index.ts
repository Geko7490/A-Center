import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import fs from "node:fs";
import path from "node:path";
import { STORAGE_ROOT } from "@/lib/vex";
import * as schema from "./schema";

const globalForDb = globalThis as typeof globalThis & {
  __aCenterPglite?: PGlite;
  __aCenterMigration?: Promise<void>;
};

const isNextBuild = process.env.NEXT_PHASE === "phase-production-build";
if (!isNextBuild) fs.mkdirSync(STORAGE_ROOT, { recursive: true });
export const client = isNextBuild ? null : globalForDb.__aCenterPglite ?? new PGlite(path.join(STORAGE_ROOT, "database"));
if (client) globalForDb.__aCenterPglite = client;

const createDb = () => drizzle(client!, { schema });
export const db = (client ? createDb() : null) as ReturnType<typeof createDb>;
const migrationsFolder = process.env.VEX_MIGRATIONS_DIR || path.join(process.cwd(), "drizzle");

export function initializeDb(): Promise<void> {
  if (!client) return Promise.reject(new Error("Database is unavailable during the Next.js build."));
  if (!globalForDb.__aCenterMigration) {
    globalForDb.__aCenterMigration = migrate(db, { migrationsFolder });
  }
  return globalForDb.__aCenterMigration;
}

