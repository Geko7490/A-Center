import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { aiToolCalls, messages } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { executeTool } from "@/lib/ai/tools";
import { ProviderError } from "@/lib/ai/types";
import { storageBusy, beginAIOperation, endAIOperation } from "@/lib/maintenance";
import { redact } from "@/lib/ai/provider";
import { redactKnownSecrets } from "@/lib/ai/keys";
import { fileState,proposalPreview,LOCAL_FILE_TOOLS } from '@/lib/local-files';
async function checkLocalBase(call:typeof aiToolCalls.$inferSelect,source:typeof messages.$inferSelect|undefined){
  if(!source?.metadata.localFileAgent)return;
  if(!LOCAL_FILE_TOOLS.has(call.name))throw new ProviderError('Unsupported local file action','invalid_tool_call',400);
  if(call.name!=='write_file')return;
  const base=(source.metadata.fileBases as Record<string,{exists:boolean;hash:string}>|undefined)?.[call.callId];
  const now=await fileState(call.projectId,String(call.args.file));
  if(!base||base.exists!==now.exists||base.hash!==now.hash)throw new ProviderError('File changed since this proposal. Continue the agent to read it again before editing.','file_conflict',409);
}
export async function GET(req:NextRequest){
  const id=req.nextUrl.searchParams.get('conversationId')||'';
  const calls=await db.select().from(aiToolCalls).where(eq(aiToolCalls.conversationId,id));
  const result=[];
  for(const call of calls){
    if(call.name!=='write_file'||call.state!=='proposed'){result.push(call);continue;}
    const source=(await db.select().from(messages).where(eq(messages.id,call.messageId)))[0];
    try{await checkLocalBase(call,source);result.push({...call,preview:await proposalPreview(call.projectId,String(call.args.file),String(call.args.content))});}
    catch(e){result.push({...call,previewError:e instanceof Error?e.message:'File preview unavailable'});}
  }
  return NextResponse.json({calls:result});
}
export async function POST(req:NextRequest) {
  if(!beginAIOperation())return NextResponse.json({error:"Storage relocation in progress"},{status:409});
  try { return await handleDecision(req); } finally { endAIOperation(); }
}
async function handleDecision(req:NextRequest) {
  if(storageBusy())return NextResponse.json({error:"Storage relocation in progress"},{status:409});
  const b=await req.json().catch(()=>({}));
  if(!["approve","reject"].includes(b.decision))return NextResponse.json({error:"Explicit approve/reject decision required"},{status:400});
  const call=(await db.select().from(aiToolCalls).where(eq(aiToolCalls.id,b.id||"")))[0];if(!call)return NextResponse.json({error:"Tool call not found"},{status:404});
  // Claim once. An interrupted executing call is never automatically repeated.
  const claimed=await db.update(aiToolCalls).set({state:"executing"}).where(and(eq(aiToolCalls.id,call.id),eq(aiToolCalls.state,"proposed"))).returning();
  if(!claimed.length)return NextResponse.json({error:"This proposal is already resolved or executing. It will not be repeated."},{status:409});
  const source=(await db.select().from(messages).where(eq(messages.id,call.messageId)))[0];
  let output:string;let state="completed";
  try {if(b.decision==="reject"){state="rejected";output="User rejected this tool call. Do not repeat it without a new user instruction.";}else {await checkLocalBase(call,source);output=JSON.stringify(await executeTool(call.name,call.args,call.projectId,req.signal));}}
  catch(error){state="failed";output=JSON.stringify({error:redact(error instanceof ProviderError?error.message:"Tool execution failed; inspect the local project/terminal history"),code:error instanceof ProviderError?error.code:"tool_error"});}
  output=await redactKnownSecrets(output);
  await db.transaction(async tx=>{await tx.update(aiToolCalls).set({state,output}).where(eq(aiToolCalls.id,call.id));await tx.insert(messages).values({conversationId:call.conversationId,role:"tool",content:output.slice(0,128000),metadata:{tool_call_id:call.callId,provider:source?.metadata.provider,model:source?.metadata.model,state}});});
  return NextResponse.json({state,output});
}
