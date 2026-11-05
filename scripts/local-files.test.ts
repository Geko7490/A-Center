import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';

test('Local Dir: local model proposals, approved reads/edits, backups and conflict protection',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'acenter-local-files-'));
 process.env.VEX_STORAGE=path.join(temp,'storage');process.env.VEX_DATABASE=path.join(temp,'db');process.env.VEX_MIGRATIONS_DIR=path.resolve('drizzle');
 const {db,client,initializeDb}=await import('../src/db/index');await initializeDb();
 const schema=await import('../src/db/schema');const {eq}=await import('drizzle-orm');const {NextRequest}=await import('next/server');
 const {POST:register}=await import('../src/app/api/projects/route');const {POST:chat}=await import('../src/app/api/chat/route');
 const {GET:list,POST:decision}=await import('../src/app/api/ai/tools/route');
 const {llamaServer}=await import('../src/lib/llama-server');const original=llamaServer.generate;
 const {executeTool}=await import('../src/lib/ai/tools');const {parseLocalCalls}=await import('../src/lib/local-files');
 const req=(url:string,body:object)=>new NextRequest('http://127.0.0.1'+url,{method:'POST',body:JSON.stringify(body)});
 try{
  const root=path.join(temp,'external-project');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'existing.txt'),'original');
  const registered=await register(req('/api/projects',{action:'connect-local',localDir:root}));assert.equal(registered.status,200);
  const {project}=await registered.json();assert.equal(project.path,fs.realpathSync(root));assert.equal(project.permissionMode,'approval');assert.equal(project.terminalAllowed,false);
  assert.equal(fs.existsSync(path.join(process.env.VEX_STORAGE!,'workspace','external-project')),false,'Local Dir must not be mirrored');
  assert.equal((await (await register(req('/api/projects',{action:'connect-local',localDir:root}))).json()).project.id,project.id);
  assert.equal((await register(req('/api/projects',{action:'connect-local',repoId:'00000000-0000-0000-0000-000000000000',localDir:root}))).status,400);
  const [model]=await db.insert(schema.models).values({name:'local-file-fixture',format:'GGUF',installPath:path.join(temp,'fixture.gguf')}).returning();
  const [conv]=await db.insert(schema.conversations).values({mode:'agent',modelId:model.name,providerData:{projectId:project.id}}).returning();
  let plan:any[]=[];let wire:any[]=[];
  llamaServer.generate=async(_runtime,_model,input)=>{wire=input;return {text:JSON.stringify({calls:plan}),metrics:{generationTokens:10,generationTokPerSec:2},ms:1,reasoning:'',usage:null,finishReason:'stop'} as any;};
  const send=async(prompt?:string)=>{const response=await chat(req('/api/chat',{conversationId:conv.id,...(prompt?{prompt}:{continue:true})}));const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
  const calls=async()=> (await (await list(new NextRequest('http://127.0.0.1/api/ai/tools?conversationId='+conv.id))).json()).calls as any[];
  const latest=async()=> (await calls()).filter(c=>c.state==='proposed').at(-1)!;
  const decide=async(id:string,value='approve')=> (await (await decision(req('/api/ai/tools',{id,decision:value}))).json());
  plan=[{name:'write_file',arguments:{file:'src/hello.luau',content:'print("hello")\n'}}];
  await send('Create a Luau file');let call=await latest();assert.equal(call.preview.exists,false);assert.match(call.preview.diff,/print/);assert(!fs.existsSync(path.join(root,'src')));
  assert.equal((await chat(req('/api/chat',{conversationId:conv.id,prompt:'another'}))).status,502,'pending proposal must block another generation');
  assert.equal((await decide(call.id)).state,'completed');assert.equal(fs.readFileSync(path.join(root,'src','hello.luau'),'utf8'),'print("hello")\n');
  assert.equal((await decision(req('/api/ai/tools',{id:call.id,decision:'approve'}))).status,409);
  plan=[{name:'write_file',arguments:{file:'existing.txt',content:'edited'}}];await send('Edit existing.txt');call=await latest();assert.equal(call.name,'read_file','an unread existing file must be read before editing');assert.equal(fs.readFileSync(path.join(root,'existing.txt'),'utf8'),'original');
  assert.equal((await decide(call.id)).state,'completed');await send();assert(wire.some(m=>m.content.includes('original')),'approved read must reach the local model');
  call=await latest();assert.equal(call.name,'write_file');assert.equal(call.preview.before,'original');assert.equal(call.preview.after,'edited');
  assert.equal((await decide(call.id)).state,'completed');assert.equal(fs.readFileSync(path.join(root,'existing.txt'),'utf8'),'edited');
  const history=await db.select().from(schema.fileHistory).where(eq(schema.fileHistory.projectId,project.id));const edit=history.find(h=>h.filePath==='existing.txt')!;
  assert.equal(edit.previousContent,'original');assert.equal(fs.readFileSync(path.join(process.env.VEX_STORAGE!,'backups',edit.backupPath),'utf8'),'original');
  plan=[{name:'write_file',arguments:{file:'reject.txt',content:'no'}}];await send('Create optional file');call=await latest();assert.equal((await decide(call.id,'reject')).state,'rejected');assert(!fs.existsSync(path.join(root,'reject.txt')));
  plan=[{name:'write_file',arguments:{file:'conflict.txt',content:'model'}}];await send('Create conflict.txt');call=await latest();fs.writeFileSync(path.join(root,'conflict.txt'),'user edit');
  assert.match((await latest()).previewError,/changed/);const conflict=await decide(call.id);assert.equal(conflict.state,'failed');assert.equal(JSON.parse(conflict.output).code,'file_conflict');assert.equal(fs.readFileSync(path.join(root,'conflict.txt'),'utf8'),'user edit');
  plan=[{name:'write_file',arguments:{file:'pinned.txt',content:'correct project'}}];await send('Create pinned.txt');call=await latest();
  const other=path.join(temp,'other');fs.mkdirSync(other);const [otherProject]=await db.insert(schema.projects).values({name:'other',path:other}).returning();await db.update(schema.conversations).set({providerData:{projectId:otherProject.id}}).where(eq(schema.conversations.id,conv.id));
  assert.equal((await decide(call.id)).state,'completed');assert(fs.existsSync(path.join(root,'pinned.txt')));assert(!fs.existsSync(path.join(other,'pinned.txt')));
  for(const file of ['../escape.txt','.env','.env.local','.git/config','NODE_MODULES/x','existing.txt:stream','nested/../.env'])await assert.rejects(executeTool('read_file',{file},project.id));
  fs.symlinkSync(other,path.join(root,'outside'),process.platform==='win32'?'junction':'dir');await assert.rejects(executeTool('write_file',{file:'outside/escape.txt',content:'x'},project.id),/escapes/);assert(!fs.existsSync(path.join(other,'escape.txt')));
  assert.throws(()=>parseLocalCalls('{"calls":[{"name":"run_terminal","arguments":{"command":"bad"}}]}'),/only supports/);
  assert.throws(()=>parseLocalCalls('{"calls":[{"name":"read_file","arguments":{"file":"x","projectId":"other"}}]}'),/Unexpected/);
  const [ollamaModel]=await db.insert(schema.models).values({name:'ollama-fixture',format:'Ollama',activeRuntime:'ollama',installPath:'ollama:fixture:latest'}).returning();
  const [ollamaConv]=await db.insert(schema.conversations).values({mode:'agent',modelId:ollamaModel.name,providerData:{projectId:project.id}}).returning();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{if(String(input)==='http://127.0.0.1:11434/api/generate'){const body=JSON.parse(String(init?.body));assert.equal(body.model,'fixture:latest');assert.equal(body.options.num_predict,900);assert.match(body.system,/local project file agent/);return Response.json({response:JSON.stringify({calls:[{name:'write_file',arguments:{file:'ollama.txt',content:'ollama file'}}]}),eval_count:10,eval_duration:1000000000});}return originalFetch(input,init);};
  try{const response=await chat(req('/api/chat',{conversationId:ollamaConv.id,prompt:'Create ollama.txt',maxTokens:900}));assert.equal(response.status,200);const result=await response.json();assert.equal(result.needsApproval,true);assert(!fs.existsSync(path.join(root,'ollama.txt')));const proposal=(await db.select().from(schema.aiToolCalls).where(eq(schema.aiToolCalls.conversationId,ollamaConv.id)))[0];assert.equal((await decide(proposal.id)).state,'completed');assert.equal(fs.readFileSync(path.join(root,'ollama.txt'),'utf8'),'ollama file');}finally{globalThis.fetch=originalFetch;}
  const [repo]=await db.insert(schema.gitRepos).values({url:'local-test',localPath:root,permission:'read-only'}).returning();
  await assert.rejects(executeTool('write_file',{file:'readonly.txt',content:'x'},project.id),/Read-only repository/);
  const readonly=await(await register(req('/api/projects',{action:'connect-local',repoId:repo.id}))).json();assert.equal(readonly.project.id,project.id);assert.equal(readonly.project.permissionMode,'read-only');
  await assert.rejects(executeTool('write_file',{file:'readonly.txt',content:'x'},project.id),/Read-only/);assert(!fs.existsSync(path.join(root,'readonly.txt')));
  // Optional real GGUF check: actual local generation + actual approval pipeline in an isolated folder.
  if(process.env.A_CENTER_TEST_MODEL){
   llamaServer.generate=original;
   const nativeRoot=path.join(temp,'native');fs.mkdirSync(nativeRoot);const [nativeProject]=await db.insert(schema.projects).values({name:'native file test',path:nativeRoot,permissionMode:'approval'}).returning();
   const [nativeModel]=await db.insert(schema.models).values({name:'native-file-test',format:'GGUF',installPath:process.env.A_CENTER_TEST_MODEL}).returning();
   await db.insert(schema.runtimes).values({name:'llama.cpp',installPath:process.env.A_CENTER_TEST_RUNTIME||path.join(path.dirname(path.dirname(nativeModel.installPath)),'runtimes','llama.cpp'),config:{device:process.env.A_CENTER_TEST_DEVICE||'Vulkan0',cpuThreads:8,gpuLayers:'auto'}});
   const [native]=await db.insert(schema.conversations).values({mode:'agent',modelId:nativeModel.name,contextTokens:8192,temperature:0,providerData:{projectId:nativeProject.id}}).returning();
   for(let turn=0;turn<5;turn++){
    const response=await chat(req('/api/chat',{conversationId:native.id,maxTokens:1536,...(turn?{continue:true}:{prompt:'Create a new file hello.txt with exactly the text LOCAL_FILE_OK. Use write_file now. The selected project folder is empty.'})}));const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
    const pending=(await db.select().from(schema.aiToolCalls).where(eq(schema.aiToolCalls.conversationId,native.id))).filter(c=>c.state==='proposed');
    for(const proposal of pending){assert(!fs.existsSync(path.join(nativeRoot,'hello.txt')));assert.equal((await decide(proposal.id)).state,'completed');}
    if(fs.existsSync(path.join(nativeRoot,'hello.txt')))break;
   }
   assert.equal(fs.readFileSync(path.join(nativeRoot,'hello.txt'),'utf8').trim(),'LOCAL_FILE_OK');
   for(let turn=0;turn<5;turn++){
    const response=await chat(req('/api/chat',{conversationId:native.id,maxTokens:1536,...(turn?{continue:true}:{prompt:'Edit the existing hello.txt file. Replace its entire content with exactly LOCAL_FILE_EDIT_OK. Read the current file first if needed, then propose write_file.'})}));const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
    const pending=(await db.select().from(schema.aiToolCalls).where(eq(schema.aiToolCalls.conversationId,native.id))).filter(c=>c.state==='proposed');
    for(const proposal of pending)assert.equal((await decide(proposal.id)).state,'completed');
    if(fs.readFileSync(path.join(nativeRoot,'hello.txt'),'utf8').trim()==='LOCAL_FILE_EDIT_OK')break;
   }
   assert.equal(fs.readFileSync(path.join(nativeRoot,'hello.txt'),'utf8').trim(),'LOCAL_FILE_EDIT_OK');console.log('PASS actual GGUF generated create/read/edit proposals; explicit approvals saved the files in Local Dir');
  }
 }finally{llamaServer.generate=original;await llamaServer.stop();await client?.close();assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
