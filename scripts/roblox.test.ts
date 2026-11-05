import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('Studio task actually generates proposals, waits for approval and verifies read-back',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'acenter-studio-'));process.env.VEX_STORAGE=temp;process.env.VEX_DATABASE=path.join(temp,'db');process.env.VEX_MIGRATIONS_DIR=path.resolve('drizzle');
 const {db,client,initializeDb}=await import('../src/db');await initializeDb();const {tasks,robloxBridges}=await import('../src/db/schema');const {eq}=await import('drizzle-orm');const {NextRequest}=await import('next/server');
 const {aiManager}=await import('../src/lib/ai/manager');const resolve=aiManager.resolve,makeClient=aiManager.client;
 try{
  await db.insert(robloxBridges).values({token:'test-pair',status:'connected',pluginVersion:'1.4.0',lastSeenAt:new Date()});
  aiManager.resolve=async()=>({id:'mock',capabilities:{source:'test fixture'},provider:'evren',owner:'mock',task:'chat',modalities:[]});
  aiManager.client=async()=>({async *generate(){yield{type:'text',text:JSON.stringify({commands:[{action:'write-script',args:{name:'Main',parent:'ServerScriptService',source:'print("hello")'}}]})};}} as any);
  const {POST:taskAction}=await import('../src/app/api/tasks/route');const {GET:next}=await import('../src/app/roblox/next-command/route');const {POST:result}=await import('../src/app/roblox/command-result/route');const {GET:panel,POST:panelAction}=await import('../src/app/roblox/panel/route');const {taskCommands,parseStudioPlan}=await import('../src/lib/roblox-tasks');
  const req=(url:string,body?:object)=>new NextRequest('http://127.0.0.1'+(url==='/roblox/next-command'?url+'?version=1.4.0':url),{method:body?'POST':'GET',headers:{'x-vex-token':'test-pair'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await panel(new NextRequest('http://127.0.0.1/roblox/panel'))).status,401);
  assert.throws(()=>parseStudioPlan('{"commands":[{"action":"delete-game","args":{}}]}'),/Invalid/);
  assert.throws(()=>parseStudioPlan('{"commands":[{"action":"write-script","args":{"name":"x","source":"x","id":"fake"}}]}'),/Invalid/);
  const created=await taskAction(req('/api/tasks',{action:'create',kind:'roblox',title:'Create Roblox script',assignedModel:'evren::mock'}));assert.equal(created.status,200);const id=(await created.json()).task.id;
  const wait=async<T>(read:()=>Promise<T>,check:(v:T)=>boolean)=>{for(let i=0;i<150;i++){const value=await read();if(check(value))return value;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out waiting for real task state');};
  const inspect=await wait(async()=>await(await next(req('/roblox/next-command?version=1.4.0'))).json(),v=>v.action==='inspect');
  assert.equal((await result(req('/roblox/command-result',{id:inspect.id,ok:true,result:{tree:{Name:'Workspace'},scripts:[]}}))).status,200);
  const proposals=await wait(()=>taskCommands(id),rows=>rows.some(c=>c.status==='proposed'));const proposal=proposals.find(c=>c.status==='proposed')!;
  assert.equal((await(await next(req('/roblox/next-command'))).json()).action,undefined);
  assert.equal((await(await panel(req('/roblox/panel'))).json()).proposals[0].args.source,'print("hello")');
  assert.equal((await panelAction(req('/roblox/panel',{action:'approve',id:proposal.id}))).status,200);
  assert.equal((await next(new NextRequest('http://127.0.0.1/roblox/next-command',{headers:{'x-vex-token':'test-pair'}}))).status,409);
  assert.equal((await panelAction(req('/roblox/panel',{action:'approve',id:proposal.id}))).status,400);
  const write=await(await next(req('/roblox/next-command'))).json();assert.equal(write.action,'write-script');
  const receipt={id:write.id,ok:true,result:{verified:true,Source:write.source,PreviousSource:'',Path:'ServerScriptService.Main'}};
  assert.equal((await result(req('/roblox/command-result',receipt))).status,200);assert.equal((await result(req('/roblox/command-result',receipt))).status,200);
  const reviewed=await wait(async()=>(await db.select().from(tasks).where(eq(tasks.id,id)))[0],t=>t.status==='awaiting_review');assert.notEqual(reviewed.status,'completed');assert.match(reviewed.logs,/read back/);
  const second=await taskAction(req('/api/tasks',{action:'create',kind:'roblox',title:'Second Roblox script',assignedModel:'evren::mock'}));const secondId=(await second.json()).task.id;
  await taskAction(req('/api/tasks',{action:'cancel',id:secondId}));assert.equal((await db.select().from(tasks).where(eq(tasks.id,secondId)))[0].status,'cancelled');
  await new Promise(r=>setTimeout(r,600));assert(!(await taskCommands(secondId)).some(c=>c.status==='proposed'));
  const third=await taskAction(req('/api/tasks',{action:'create',kind:'roblox',title:'Verify Roblox script',assignedModel:'evren::mock'}));const thirdId=(await third.json()).task.id;
  const check=await wait(async()=>await(await next(req('/roblox/next-command?version=1.4.0'))).json(),v=>v.action==='inspect');await result(req('/roblox/command-result',{id:check.id,ok:true,result:{Name:'Workspace'}}));
  const invalid=(await wait(()=>taskCommands(thirdId),rows=>rows.some(c=>c.status==='proposed'))).find(c=>c.status==='proposed')!;await panelAction(req('/roblox/panel',{action:'approve',id:invalid.id}));const delivered=await(await next(req('/roblox/next-command'))).json();await result(req('/roblox/command-result',{id:delivered.id,ok:true,result:{verified:true,Source:'wrong source'}}));
  const failed=await wait(async()=>(await db.select().from(tasks).where(eq(tasks.id,thirdId)))[0],t=>t.status==='failed');assert.match(failed.error,/read-back/);
 }finally{aiManager.resolve=resolve;aiManager.client=makeClient;await client?.close();assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
