import { NextResponse } from "next/server";
import { db } from "@/db";
import { models } from "@/db/schema";
import { cachedModels, providerConfig } from "@/lib/ai/store";
export async function GET() {
  const local=await db.select().from(models);
  const result:any[]=local.map(m=>({id:m.name,key:m.name,provider:"local",owner:"local",task:m.category,format:m.format,activeRuntime:m.activeRuntime,modalities:[],capabilities:{source:"local registry"},status:m.status}));
  for(const id of ["evren","nvidia"] as const){const config=await providerConfig(id);if(!config.enabled)continue;for(const m of (await cachedModels(id)).models){if(id==="evren"&&!["chat","vision_chat"].includes(m.task))continue;result.push({...m,key:`${id}::${m.id}`});if(m.id===config.defaultModel)result.push({...m,id:`${m.id} (default)`,key:`${id}::@default`});}}
  return NextResponse.json({models:result});
}
