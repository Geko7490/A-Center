import { db } from "@/db";
import { appSettings, aiUsage } from "@/db/schema";
import { desc, eq, like } from "drizzle-orm";
import { ModelInfo, ProviderConfig, ProviderId, Usage } from "./types";
export async function readValue<T>(key: string, fallback: T): Promise<T> { const rows = await db.select().from(appSettings).where(eq(appSettings.key,key)); try { return rows[0] ? JSON.parse(rows[0].value) : fallback; } catch { return fallback; } }
export async function writeValue(key: string, value: unknown) { await db.insert(appSettings).values({key,value:JSON.stringify(value)}).onConflictDoUpdate({target:appSettings.key,set:{value:JSON.stringify(value),updatedAt:new Date()}}); }
export const providerConfig = (id:ProviderId) => readValue<ProviderConfig>(`ai.provider.${id}`,{enabled:false,defaultModel:"",mode:"chat"});
export const cachedModels = (id:ProviderId) => readValue<{at:number;models:ModelInfo[]}>(`ai.catalog.${id}`,{at:0,models:[]});
export async function invalidateModelDetails(id:ProviderId) { await db.delete(appSettings).where(like(appSettings.key,`ai.model.${id}.%`)); }
export async function trackUsage(provider: ProviderId, model: string, usage: Usage, requestId: string) { await db.insert(aiUsage).values({provider,model,usage,requestId}).onConflictDoNothing(); }
export async function usageHistory(provider?:string) { return provider ? db.select().from(aiUsage).where(eq(aiUsage.provider,provider)).orderBy(desc(aiUsage.createdAt)).limit(100) : db.select().from(aiUsage).orderBy(desc(aiUsage.createdAt)).limit(100); }
