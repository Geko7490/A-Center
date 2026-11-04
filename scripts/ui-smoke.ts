import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
async function main(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"acenter-ui-"));process.env.VEX_STORAGE=temp;process.env.VEX_DATABASE=path.join(temp,"database");process.env.VEX_MIGRATIONS_DIR=path.resolve("drizzle");
 let child:ReturnType<typeof spawn>|undefined;let browser;
 try{
  const {db,client,initializeDb}=await import("../src/db/index");const schema=await import("../src/db/schema");await initializeDb();
  await db.insert(schema.models).values({name:"ui-local",format:"GGUF",installPath:path.join(temp,"ui-local.gguf")});
  const [conv]=await db.insert(schema.conversations).values({title:"Keep this conversation"}).returning();await db.insert(schema.messages).values({conversationId:conv.id,role:"user",content:"Remember me"});
  const {normalizeModel}=await import("../src/lib/ai/catalog");const evren=normalizeModel("evren",{id:"auto",task:"chat",context_length:32768});await db.insert(schema.appSettings).values([{key:"ai.provider.nvidia",value:JSON.stringify({enabled:true,defaultModel:"moonshotai/kimi-k2.6",mode:"chat"})},{key:"ai.catalog.nvidia",value:JSON.stringify({at:Date.now(),models:[normalizeModel("nvidia",{id:"moonshotai/kimi-k2.6"})]})},{key:"ai.provider.evren",value:JSON.stringify({enabled:false,defaultModel:"auto",mode:"chat"})},{key:"ai.catalog.evren",value:JSON.stringify({at:Date.now(),models:[evren]})}]);await client?.close();
  const socket=net.createServer();await new Promise<void>(r=>socket.listen(0,"127.0.0.1",r));const port=(socket.address() as any).port;await new Promise<void>(r=>socket.close(()=>r()));
  child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(port)],{env:process.env,stdio:["ignore","pipe","pipe"],windowsHide:true});
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
  const executable=process.env.A_CENTER_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  browser=await chromium.launch({headless:true,executablePath:executable});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`);await page.getByRole("button",{name:/API Providers$/}).click();await page.getByRole("heading",{name:"API Providers",exact:true}).waitFor();await page.getByRole("heading",{name:"EVREN",exact:true}).waitFor();assert.equal(await page.locator('input[type="password"]').count(),2);
  await page.getByRole("button",{name:/Model Center$/}).click();await page.getByRole("combobox").selectOption("nvidia");await page.getByRole("button",{name:"Workspace’te kullan",exact:true}).first().click();await page.getByText("Remember me",{exact:true}).waitFor();
  const selector=page.locator("label").filter({hasText:"Primary model"}).locator("select");assert((await selector.inputValue()).startsWith("nvidia::"));await selector.selectOption("ui-local");assert(await page.getByText("Remember me",{exact:true}).isVisible());
  await page.getByRole("button",{name:/Task Manager$/}).click();await page.getByPlaceholder("Task: Build a complete Roblox weapon system…").fill("UI agent plan");await page.getByRole("button",{name:"Create task",exact:true}).click();await page.getByRole("button",{name:"Open with Agent Engine",exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll("input")).some(i=>i.value==="UI agent plan"));assert.equal(await page.locator("label").filter({hasText:"General chat"}).locator("select").inputValue(),"agent");
  // UI-only cloud fixture: provider enable/selection and first-chat creation use real app routes.
  // Generation and credentials are mocked here; actual EVREN transport is covered separately.
  const existing=await(await page.request.get(`http://127.0.0.1:${port}/api/chat`)).json();for(const c of existing.conversations)await page.request.post(`http://127.0.0.1:${port}/api/chat`,{data:{action:"delete",conversationId:c.id}});
  await page.route("**/api/providers",async route=>{
    const body=route.request().postDataJSON();
    if(body?.action==="model"&&body.provider==="evren"){await route.fulfill({json:{model:evren}});return;}
    if(route.request().method()==="GET"){const response=await route.fetch();const data=await response.json();data.providers=data.providers.map((p:any)=>p.id==="evren"?{...p,keyConfigured:true}:p);await route.fulfill({json:data});return;}
    await route.continue();
  });
  let sentModel="";await page.route("**/api/chat",async route=>{const b=route.request().postDataJSON();if(b?.prompt&&!b.action){sentModel=b.modelId;await route.fulfill({contentType:"text/event-stream",body:`data: ${JSON.stringify({type:"text",text:"UI fixture OK"})}\n\ndata: ${JSON.stringify({type:"done",engine:"evren:auto",message:{role:"assistant",content:"UI fixture OK"}})}\n\n`});}else await route.continue();});
  await page.getByRole("button",{name:/API Providers$/}).click();const card=page.locator("section").filter({has:page.getByRole("heading",{name:"EVREN",exact:true})});await card.getByRole("button",{name:"Workspace’te kullan",exact:true}).click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll("select")).some(s=>s.value==="evren::auto"));await page.waitForFunction(()=>{const b=Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Send");return b&&!b.disabled;});assert.equal(await selector.inputValue(),"evren::auto");
  await page.getByPlaceholder(/Message .*Enter to send/).fill("hi");await page.getByRole("button",{name:"Send",exact:true}).click();await page.getByText("UI fixture OK",{exact:true}).waitFor();assert.equal(sentModel,"evren::auto");
  let runtimeConfig:any={cpuThreads:8,gpuLayers:'auto',ctxSize:4096},savedConfig:any;let modelReady=true;
  await page.route('**/api/runtimes*',async route=>{const body=route.request().postDataJSON();if(body?.action==='config'){savedConfig=body.config;runtimeConfig={...runtimeConfig,...body.config};}if(body?.action==='stop')modelReady=false;await route.fulfill({json:body?{ok:true}:{runtimes:[{name:'llama.cpp',installed:true,status:'ready',config:runtimeConfig}],ollama:{available:false},devices:[{id:'Vulkan0',name:'AMD Radeon RX 6700M',freeMiB:9000},{id:'Vulkan1',name:'AMD Radeon(TM) Graphics',freeMiB:15000}],server:{ready:modelReady,running:modelReady,device:'Vulkan0',offloadedLayers:43,totalLayers:43,workerPid:123}}});});
  await page.getByRole('button',{name:/Runtime Manager$/}).click();const gpu=page.locator('label').filter({hasText:'GPU / backend'}).locator('select');await gpu.selectOption('Vulkan1');assert.equal(await gpu.inputValue(),'Vulkan1');
  await page.getByRole('button',{name:/Apply hybrid profile/}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('select')).some(s=>s.value==='Vulkan0'));assert.equal(savedConfig.device,'Vulkan0');assert.equal(savedConfig.fitTargetMiB,1024);assert.equal(savedConfig.gpuLayers,'auto');
  await page.getByRole('button',{name:'Modeli bellekten çıkar',exact:true}).click();await page.getByText(/Sunucu: Kapalı/).waitFor();
  assert.equal(errors.length,0,errors.join("\n"));console.log("PASS provider/local history, first-chat selection, GPU selection/preset and persistent model stop (isolated UI fixtures; mocked cloud generation/runtime status)");
 }finally{await browser?.close();if(child){child.kill();await new Promise<void>(r=>child!.exitCode!==null?r():child!.once("close",()=>r()));}assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
