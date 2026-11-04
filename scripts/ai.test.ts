import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OpenAICompatibleProvider } from "../src/lib/ai/provider";
import { normalizeModel } from "../src/lib/ai/catalog";
import { parseSSE } from "../src/lib/ai/sse";
import { ProviderError } from "../src/lib/ai/types";

const info=normalizeModel("evren",{id:"mock",task:"chat",context_length:32768,capabilities:{tools:true,thinking:true,reasoning_effort:true,reasoning_effort_values:["low","high"]}});
async function withServer(handler:http.RequestListener,run:(base:string)=>Promise<void>){const server=http.createServer(handler);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));try{await run(`http://127.0.0.1:${(server.address() as any).port}`);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}}
const input=()=>({model:info,messages:[{role:"user" as const,content:"hi"}],maxTokens:128,signal:new AbortController().signal});
const event=(data:unknown)=>`data: ${JSON.stringify(data)}\n\n`;

test("SSE handles UTF-8 fragmentation, comments and multi-line data",async()=>{
 const bytes=new TextEncoder().encode(': ping\r\nevent: token\r\ndata: {"text":\r\ndata: "Merhaba 🌍"}\r\n\r\n');
 const body=new ReadableStream<Uint8Array>({start(c){for(let i=0;i<bytes.length;i+=2)c.enqueue(bytes.slice(i,i+2));c.close();}});
 const frames=[];for await(const f of parseSSE(body,new AbortController().signal))frames.push(f);assert.equal(frames.length,1);assert.equal(frames[0].event,"token");assert.equal(JSON.parse(frames[0].data).text,"Merhaba 🌍");
});
test("Chat stream preserves reasoning, tool argument fragments and real usage",async()=>{
 await withServer(async(req,res)=>{let body="";for await(const c of req)body+=c;assert.equal(req.headers.authorization,"Bearer mock-key");const b=JSON.parse(body);assert.equal(b.thinking,true);res.writeHead(200,{"content-type":"text/event-stream"});res.write(": ping\n\n");for(const data of [{choices:[{delta:{reasoning_content:"think"}}]},{choices:[{delta:{content:"OK"}}]},{choices:[{delta:{tool_calls:[{index:0,id:"c1",function:{name:"read_file",arguments:'{"fi'}}]}}]},{choices:[{delta:{tool_calls:[{index:0,function:{arguments:'le":"a.ts"}'}}]},finish_reason:"tool_calls"}]},{choices:[],usage:{prompt_tokens:10,completion_tokens:5,prompt_tokens_details:{cached_tokens:7}}}])res.write(event(data));res.end('data: [DONE]\n\n');},async(base)=>{const events=[];for await(const e of new OpenAICompatibleProvider("evren","mock-key",base).generate({...input(),thinking:true,tools:[{type:"function",function:{name:"read_file"}}]}))events.push(e);assert.equal(events.find(e=>e.type==="reasoning")?.text,"think");assert.equal(events.find(e=>e.type==="text")?.text,"OK");assert.equal(events.find(e=>e.type==="tool")?.call?.function.arguments,'{"file":"a.ts"}');assert.equal(events.find(e=>e.type==="usage")?.usage?.completion_tokens,5);});
});
test("Unsupported parameters are omitted; unknown capabilities cannot enable tools",()=>{
 const unknown=normalizeModel("nvidia",{id:"unverified/model"});const provider=new OpenAICompatibleProvider("nvidia","key");const body=provider.buildBody({...input(),model:unknown,thinking:true,temperature:0.2});assert.equal(body.stream,false);assert(!("thinking"in body));assert(!("temperature"in body));assert.throws(()=>provider.buildBody({...input(),model:unknown,tools:[{}]}),/not verified/);
 const nemotron=normalizeModel("nvidia",{id:"nvidia/nemotron-3.5-super-vl-120b-a12b"});assert.equal(provider.buildBody({...input(),model:nemotron,thinking:false}).reasoning_effort,"none");
});
test("Catalog and selected-model metadata come from the provider, not starter IDs",async()=>{
 await withServer((req,res)=>{res.setHeader("content-type","application/json");res.end(JSON.stringify(req.url==="/models"?{data:[{id:"new-model",task:"chat",capabilities:{tools:false}}]}:{id:"new-model",task:"chat",context_length:12345,capabilities:{tools:true,vision:true}}));},async(base)=>{const provider=new OpenAICompatibleProvider("evren","key",base);assert.equal((await provider.models())[0].id,"new-model");const detail=await provider.model("new-model");assert.equal(detail.capabilities.contextLength,12345);assert.equal(detail.capabilities.tools,true);});
});
test("429 keeps Retry-After and redacts credentials; 503 has bounded retries",async()=>{
 let hits=0;await withServer((req,res)=>{hits++;res.writeHead(429,{"retry-after":"45"});res.end(JSON.stringify({error:{code:"daily_token_limit_exceeded",message:"bad mock-key Bearer mock-key"}}));},async(base)=>{await assert.rejects(new OpenAICompatibleProvider("evren","mock-key",base).models(),(e:ProviderError)=>e.code==="daily_token_limit_exceeded"&&e.retryAfter===45&&!e.message.includes("mock-key"));assert.equal(hits,1);});
 hits=0;await withServer((req,res)=>{hits++;if(hits<3){res.writeHead(503,{"retry-after":"0"});res.end('{}');}else res.end('{"data":[]}');},async(base)=>{await new OpenAICompatibleProvider("evren","key",base).models();assert.equal(hits,3);});
});
test("An interrupted stream is not silently marked completed",async()=>{
 await withServer((req,res)=>{res.writeHead(200,{"content-type":"text/event-stream"});res.end(event({choices:[{delta:{content:"partial"}}]}));},async(base)=>{await assert.rejects(async()=>{for await(const e of new OpenAICompatibleProvider("evren","key",base).generate(input()))void e;},(e:ProviderError)=>e.code==="stream_interrupted");});
});
test("Responses expired-chain fallback sends full history and records new response ID",async()=>{
 const requests:any[]=[];await withServer(async(req,res)=>{let s="";for await(const c of req)s+=c;const b=JSON.parse(s);requests.push(b);if(b.previous_response_id){res.writeHead(404);res.end('{"error":{"code":"response_expired"}}');return;}res.writeHead(200,{"content-type":"text/event-stream"});res.write('event: response.output_text.delta\n'+event({type:"response.output_text.delta",delta:"answer"}));res.end('event: response.completed\n'+event({type:"response.completed",response:{id:"resp-new",usage:{input_tokens:22,output_tokens:4}}}));},async(base)=>{const events=[];for await(const e of new OpenAICompatibleProvider("evren","key",base).generate({...input(),mode:"responses",previousResponseId:"expired",fullMessages:[{role:"user",content:"old"},{role:"assistant",content:"history"},{role:"user",content:"new"}]}))events.push(e);assert.equal(requests.length,2);assert.equal(requests[1].input.length,3);assert.equal(events.find(e=>e.type==="response_id")?.id,"resp-new");});
});
test("Cancellation aborts an active stream without retrying",async()=>{
 let hits=0;await withServer((req,res)=>{hits++;res.writeHead(200,{"content-type":"text/event-stream"});res.write(event({choices:[{delta:{content:"start"}}]}));},async(base)=>{const c=new AbortController();await assert.rejects(async()=>{for await(const e of new OpenAICompatibleProvider("evren","key",base).generate({...input(),signal:c.signal})){if(e.type==="text")c.abort();}},(e:ProviderError)=>e.code==="cancelled");assert.equal(hits,1);});
});
test("Idle streams fail with a timeout, not successful completion",async()=>{
 const body=new ReadableStream<Uint8Array>({start(){}});
 await assert.rejects(async()=>{for await(const f of parseSSE(body,new AbortController().signal,10))void f;},(e:ProviderError)=>e.code==="timeout");
});
test("Authentication, access, model, parameter and capacity failures remain distinct",async()=>{
 for(const [status,code] of [[401,"invalid_api_key"],[403,"access_denied"],[404,"model_not_found"],[400,"unsupported_parameter"],[503,"capacity_full"]] as const){await withServer((req,res)=>{res.writeHead(status,{"retry-after":"60"});res.end('{}');},async(base)=>{await assert.rejects(new OpenAICompatibleProvider("nvidia","key",base).models(),(e:ProviderError)=>e.code===code&&e.status===status);});}
});
test("JSON Responses output is accepted when a provider answers a streaming request with JSON",async()=>{
 await withServer((req,res)=>{res.setHeader("content-type","application/json");res.end(JSON.stringify({id:"resp-json",status:"completed",output:[{type:"message",content:[{type:"output_text",text:"OK"}]}],usage:{output_tokens:2}}));},async(base)=>{
  const events=[];for await(const e of new OpenAICompatibleProvider("evren","mock-key",base).generate({...input(),mode:"responses"}))events.push(e);
  assert.equal(events.find(e=>e.type==="text")?.text,"OK");assert.equal(events.find(e=>e.type==="response_id")?.id,"resp-json");assert.equal(events.find(e=>e.type==="finish")?.reason,"stop");
 });
});
test("Upgrade from 0.1.1 preserves existing conversations and messages",async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"acenter-upgrade-"));const old=path.join(temp,"old-migrations");fs.mkdirSync(path.join(old,"meta"),{recursive:true});const journal=JSON.parse(fs.readFileSync("drizzle/meta/_journal.json","utf8"));fs.writeFileSync(path.join(old,"meta","_journal.json"),JSON.stringify({...journal,entries:journal.entries.filter((e:any)=>e.idx<=1)}));for(const entry of journal.entries.filter((e:any)=>e.idx<=1))fs.copyFileSync(path.join("drizzle",entry.tag+".sql"),path.join(old,entry.tag+".sql"));
 const {PGlite}=await import("@electric-sql/pglite");const {drizzle}=await import("drizzle-orm/pglite");const {migrate}=await import("drizzle-orm/pglite/migrator");const client=new PGlite(path.join(temp,"db"));
 try{const database=drizzle(client);await migrate(database,{migrationsFolder:old});const result=await client.query<{id:string}>("insert into vex_conversations(title) values ('existing chat') returning id");await client.query("insert into vex_messages(conversation_id,role,content) values ($1,'user','preserved history')",[result.rows[0].id]);await migrate(database,{migrationsFolder:path.resolve("drizzle")});const rows=await client.query<{title:string;provider_data:object}>("select title,provider_data from vex_conversations");assert.equal(rows.rows[0].title,"existing chat");assert.deepEqual(rows.rows[0].provider_data,{});assert.equal((await client.query<{content:string}>("select content from vex_messages")).rows[0].content,"preserved history");}finally{await client.close();assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
test("Agent file edits use real project permissions; tool approvals cannot execute twice",async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"acenter-ai-tools-"));process.env.VEX_STORAGE=temp;process.env.VEX_DATABASE=path.join(temp,"database");process.env.VEX_MIGRATIONS_DIR=path.resolve("drizzle");
 try{
  const {initializeDb,db,client}=await import("../src/db/index");await initializeDb();const schema=await import("../src/db/schema");const {eq}=await import("drizzle-orm");
  const root=path.join(temp,"workspace","project");fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,"main.txt"),"before");
  const [project]=await db.insert(schema.projects).values({name:"approved",path:root,permissionMode:"approval",protectedFiles:[".env"]}).returning();
  const [conv]=await db.insert(schema.conversations).values({providerData:{projectId:project.id}}).returning();const [msg]=await db.insert(schema.messages).values({conversationId:conv.id,role:"assistant",content:""}).returning();
  const [call]=await db.insert(schema.aiToolCalls).values({conversationId:conv.id,messageId:msg.id,projectId:project.id,callId:"real-call",name:"write_file",args:{file:"main.txt",content:"after"}}).returning();
  const {POST}=await import("../src/app/api/ai/tools/route");const {NextRequest}=await import("next/server");const request=()=>new NextRequest("http://127.0.0.1/api/ai/tools",{method:"POST",body:JSON.stringify({id:call.id,decision:"approve"})});
  const result=await POST(request());assert.equal(result.status,200);assert.equal(fs.readFileSync(path.join(root,"main.txt"),"utf8"),"after");assert.equal((await POST(request())).status,409);
  const {executeTool,validateCall}=await import("../src/lib/ai/tools");await assert.rejects(executeTool("read_file",{file:".env"},project.id),/Protected/);await assert.rejects(executeTool("run_terminal",{command:"echo bad",purpose:"test"},project.id),/terminal permission/);
  await db.update(schema.projects).set({terminalAllowed:true}).where(eq(schema.projects.id,project.id));const oldKey=process.env.EVREN_API_KEY;process.env.EVREN_API_KEY="sensitive-test-secret";
  try{const command=process.platform==="win32"?"Write-Output 'sensitive-test-secret'; Write-Output '(exit 0)'; exit 7":"echo sensitive-test-secret; echo '(exit 0)'; exit 7";const terminal:any=await executeTool("run_terminal",{command,purpose:"test"},project.id);assert.equal(terminal.exitCode,7);assert(!terminal.output.includes("sensitive-test-secret"));const logged=(await db.select().from(schema.terminalHistory))[0];assert(!logged.command.includes("sensitive-test-secret"));}finally{if(oldKey===undefined)delete process.env.EVREN_API_KEY;else process.env.EVREN_API_KEY=oldKey;}
  await db.update(schema.projects).set({permissionMode:"read-only"}).where(eq(schema.projects.id,project.id));await assert.rejects(executeTool("write_file",{file:"main.txt",content:"forbidden"},project.id),/Read-only/);
  assert.throws(()=>validateCall({id:"call",type:"function",function:{name:"read_file",arguments:'{"file":"x","projectId":"other"}'}}),/Unexpected/);
  // Complete two model turns with a real approval and file edit between them.
  await db.update(schema.projects).set({permissionMode:"approval"}).where(eq(schema.projects.id,project.id));
  await db.insert(schema.appSettings).values({key:"ai.provider.evren",value:JSON.stringify({enabled:true,mode:"chat",defaultModel:"mock"})});
  const [agent]=await db.insert(schema.conversations).values({mode:"agent",modelId:"evren::mock",providerData:{projectId:project.id}}).returning();
  const {aiManager}=await import("../src/lib/ai/manager");const {cloudChat}=await import("../src/lib/ai/chat");const resolve=aiManager.resolve,makeClient=aiManager.client;
  const {POST:providerAction}=await import("../src/app/api/providers/route");let acceptCalls=0;const endpoints:string[]=[];
  aiManager.client=async()=>({json:async(endpoint:string)=>{endpoints.push(endpoint);if(endpoint==="/terms/status")return{current_version:2,accepted:false};if(endpoint==="/terms/accept"){acceptCalls++;return{accepted:true};}if(endpoint==="/quota")return{daily_remaining_tokens:123,daily_reset_at:"mock-time"};return{};}} as any);
  try{
    const action=(body:object)=>providerAction(new NextRequest("http://127.0.0.1/api/providers",{method:"POST",body:JSON.stringify(body)}));
    assert.equal((await action({provider:"evren",action:"accept-terms",version:2})).status,400);assert.equal(acceptCalls,0);
    assert.equal((await action({provider:"evren",action:"accept-terms",version:1,confirm:true})).status,409);assert.equal(acceptCalls,0);
    assert.equal((await action({provider:"evren",action:"accept-terms",version:2,confirm:true})).status,200);assert.equal(acceptCalls,1);
    assert.equal((await (await action({provider:"evren",action:"quota"})).json()).quota.daily_remaining_tokens,123);
    endpoints.length=0;const nvidiaQuota=await(await action({provider:"nvidia",action:"quota"})).json();assert.equal(nvidiaQuota.quota,null);assert.equal(endpoints.length,0);
  }finally{aiManager.client=makeClient;}
  try{
   await withServer(async(req,res)=>{if(req.url==="/terms/status"){res.end('{"accepted":true,"current_version":2}');return;}if(req.url==="/models"){res.end(JSON.stringify({data:[{id:"mock",task:"chat",capabilities:{tools:true,thinking:true}}]}));return;}if(req.url==="/models/mock"){res.end(JSON.stringify({id:"mock",task:"chat",capabilities:{tools:true,thinking:true}}));return;}let raw="";for await(const c of req)raw+=c;const b=JSON.parse(raw);if(req.url==="/responses/input_tokens"){res.end('{"input_tokens":12}');return;}res.writeHead(200,{"content-type":"text/event-stream"});if(!b.tools){res.write(event({choices:[{delta:{content:"OK"},finish_reason:"stop"}]}));}else if(b.messages.some((m:any)=>m.role==="tool")){assert(b.messages.some((m:any)=>m.role==="tool"&&m.content.includes("written")));res.write(event({choices:[{delta:{content:"Edit confirmed"},finish_reason:"stop"}]}));}else res.write(event({choices:[{delta:{tool_calls:[{index:0,id:"agent-write",function:{name:"write_file",arguments:JSON.stringify({file:"agent.txt",content:"real edit"})}}]},finish_reason:"tool_calls"}]}));res.end(event({usage:{prompt_tokens:12,completion_tokens:3}})+'data: [DONE]\n\n');},async(base)=>{
    aiManager.resolve=async()=>info;aiManager.client=async()=>new OpenAICompatibleProvider("evren","mock-key",base);
    const probe=await providerAction(new NextRequest("http://127.0.0.1/api/providers",{method:"POST",body:JSON.stringify({provider:"evren",action:"test"})}));assert.equal(probe.status,200);const probed=await probe.json();assert.equal(probed.health.generationVerified,true);assert.equal(probed.probe.output,"OK");
    const first=await cloudChat(new Request("http://127.0.0.1/api/chat"),agent,{prompt:"Make a file"},"evren::mock");const events=[];for await(const frame of parseSSE(first.body!,new AbortController().signal))events.push(JSON.parse(frame.data));assert(events.some(e=>e.type==="done"&&e.needsApproval));assert(!fs.existsSync(path.join(root,"agent.txt")));
    const proposed=(await db.select().from(schema.aiToolCalls).where(eq(schema.aiToolCalls.conversationId,agent.id)))[0];assert.equal(proposed.projectId,project.id);
    assert.equal((await POST(new NextRequest("http://127.0.0.1/api/ai/tools",{method:"POST",body:JSON.stringify({id:proposed.id,decision:"approve"})}))).status,200);assert.equal(fs.readFileSync(path.join(root,"agent.txt"),"utf8"),"real edit");
    const current=(await db.select().from(schema.conversations).where(eq(schema.conversations.id,agent.id)))[0];const next=await cloudChat(new Request("http://127.0.0.1/api/chat"),current,{continue:true},"evren::mock");const second=[];for await(const frame of parseSSE(next.body!,new AbortController().signal))second.push(JSON.parse(frame.data));assert(second.some(e=>e.type==="done"&&e.message.content==="Edit confirmed"));assert.equal((await db.select().from(schema.aiUsage)).length,3);
    // Reproduce a model whose connection test works at 64 tokens, but whose default Workspace budget used to exceed its output limit.
    const [chat]=await db.insert(schema.conversations).values({modelId:"evren::mock"}).returning();
    aiManager.resolve=async()=>({...info,capabilities:{...info.capabilities,maxOutput:128}});
    const {POST:chatAction}=await import("../src/app/api/chat/route");
    const response=await chatAction(new NextRequest("http://127.0.0.1/api/chat",{method:"POST",body:JSON.stringify({conversationId:chat.id,modelId:"evren::mock",prompt:"hi",maxTokens:2048})}));
    const frames=[];for await(const frame of parseSSE(response.body!,new AbortController().signal))frames.push(JSON.parse(frame.data));assert(frames.some(e=>e.type==="done"&&e.message.content==="OK"),JSON.stringify(frames));
   });
   // The real EVREN contract: `auto` generates successfully but cannot count input tokens.
   // Use the real manager and chat route so the probe-to-Workspace path cannot hide this regression.
   aiManager.resolve=resolve;let counts=0,responses=0;
   const {writeValue}=await import("../src/lib/ai/store");await writeValue("ai.provider.evren",{enabled:true,mode:"responses",defaultModel:"auto"});
   await withServer(async(req,res)=>{
    if(req.url==="/terms/status"){res.end('{"accepted":true}');return;}
    if(req.url==="/models"){res.end(JSON.stringify({data:[{id:"auto",task:"chat",context_length:32768}]}));return;}
    if(req.url==="/models/auto"){res.end(JSON.stringify({id:"auto",task:"chat",context_length:32768}));return;}
    if(req.url==="/responses/input_tokens"){counts++;res.writeHead(400);res.end('{"error":{"code":"invalid_model","message":"auto cannot count tokens"}}');return;}
    assert.equal(req.url,"/responses");responses++;res.writeHead(200,{"content-type":"text/event-stream"});res.end(event({type:"response.completed",response:{id:`resp-${responses}`,output:[{type:"message",content:[{type:"output_text",text:"OK"}]}]}}));
   },async(base)=>{
    aiManager.client=async()=>new OpenAICompatibleProvider("evren","mock-key",base);
    const probe=await providerAction(new NextRequest("http://127.0.0.1/api/providers",{method:"POST",body:JSON.stringify({provider:"evren",action:"test"})}));assert.equal(probe.status,200);
    const [auto]=await db.insert(schema.conversations).values({modelId:"evren::@default"}).returning();
    const {POST:chatAction}=await import("../src/app/api/chat/route");const response=await chatAction(new NextRequest("http://127.0.0.1/api/chat",{method:"POST",body:JSON.stringify({conversationId:auto.id,prompt:"hi"})}));
    const frames=[];for await(const frame of parseSSE(response.body!,new AbortController().signal))frames.push(JSON.parse(frame.data));assert(frames.some(e=>e.type==="done"&&e.message.content==="OK"),JSON.stringify(frames));assert.equal(counts,0);assert.equal(responses,2);
   });
  }finally{aiManager.resolve=resolve;aiManager.client=makeClient;}
  await client?.close();
 }finally{assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
