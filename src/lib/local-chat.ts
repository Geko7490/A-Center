import {db} from '@/db';
import {conversations,messages,models,runtimes} from '@/db/schema';
import {eq} from 'drizzle-orm';
import path from 'node:path';
import {llamaServer,LocalMessage,LlamaOptions} from './llama-server';
import {RUNTIMES_DIR} from './vex';
import {beginAIOperation,endAIOperation} from './maintenance';
const state=globalThis as typeof globalThis & {aCenterLocalChat?:boolean};
export async function localChat(req:Request,conv:typeof conversations.$inferSelect,b:Record<string,any>,model:typeof models.$inferSelect){
 if(state.aCenterLocalChat||llamaServer.isGenerating())return Response.json({error:'Another local model response is still running.'},{status:409});
 if(!beginAIOperation())return Response.json({error:'Storage relocation in progress'},{status:409});
 state.aCenterLocalChat=true;const abort=new AbortController(),signal=AbortSignal.any([req.signal,abort.signal]);
 const run=async(emit:(event:object)=>void)=>{
  try{
   const history=await db.select().from(messages).where(eq(messages.conversationId,conv.id)).orderBy(messages.createdAt);
   const content=String(b.prompt)+(b.attachment?`\n\n[attached context]\n${String(b.attachment).slice(0,32000)}`:'');
   const wire:LocalMessage[]=[{role:'system',content:conv.systemPrompt||'You are a helpful assistant.'},...history.filter(m=>['user','assistant','tool'].includes(m.role)).map(m=>({role:m.role==='assistant'?'assistant' as const:'user' as const,content:m.role==='tool'?`[Tool result]\n${m.content}`:m.content})),{role:'user',content}];
   await db.insert(messages).values({conversationId:conv.id,role:'user',content});
   const rt=(await db.select().from(runtimes).where(eq(runtimes.name,'llama.cpp')))[0];const config=(rt?.config||{}) as LlamaOptions&{ctxSize?:number};
   emit({type:'status',status:llamaServer.snapshot().ready&&llamaServer.snapshot().model===path.resolve(model.installPath)?'connecting':'loading_model'});
   const result=await llamaServer.generate(rt?.installPath||path.join(RUNTIMES_DIR,'llama.cpp'),model.installPath,wire,{...config,temperature:conv.temperature,contextTokens:conv.contextTokens||config.ctxSize||4096,maxTokens:Number(b.maxTokens)||Number(conv.providerData.maxTokens)||512,signal,onText:text=>{emit({type:'status',status:'generating'});emit({type:'text',text});},onReasoning:text=>{emit({type:'status',status:'thinking'});emit({type:'reasoning',text});}});
   const [message]=await db.insert(messages).values({conversationId:conv.id,role:'assistant',content:result.text,tokens:result.metrics.generationTokens||0,genMs:Math.round(result.ms),tokensPerSec:result.metrics.generationTokPerSec||0,metadata:{localMetrics:result.metrics,reasoning:result.reasoning,usage:result.usage,finishReason:result.finishReason}}).returning();
   if(conv.title==='New conversation')await db.update(conversations).set({title:String(b.prompt).slice(0,48)}).where(eq(conversations.id,conv.id));
   await db.update(models).set({lastUsedAt:new Date()}).where(eq(models.id,model.id));
   return{message,engine:`llama-server:${model.name}`,truncated:result.finishReason==='length'};
  }finally{state.aCenterLocalChat=false;endAIOperation();}
 };
 if(b.stream!==true){try{return Response.json(await run(()=>{}));}catch(e){return Response.json({error:signal.aborted?'Request cancelled':e instanceof Error?e.message:'Local inference failed'},{status:502});}}
 let closed=false;const encoder=new TextEncoder();
 return new Response(new ReadableStream({start(controller){const send=(event:object)=>{if(!closed&&!signal.aborted)try{controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));}catch{abort.abort();}};const ping=setInterval(()=>{if(!closed)try{controller.enqueue(encoder.encode(': keep-alive\n\n'));}catch{abort.abort();}},15000);
  void run(send).then(result=>send({type:'done',...result})).catch(e=>send({type:'error',error:signal.aborted?'Request cancelled':e instanceof Error?e.message:'Local inference failed',code:signal.aborted?'cancelled':'local_inference_failed'})).finally(()=>{clearInterval(ping);closed=true;try{controller.close();}catch{}});
 },cancel(){closed=true;abort.abort();}}),{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','x-accel-buffering':'no'}});
}

