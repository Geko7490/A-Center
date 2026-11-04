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
  const {normalizeModel}=await import("../src/lib/ai/catalog");await db.insert(schema.appSettings).values([{key:"ai.provider.nvidia",value:JSON.stringify({enabled:true,defaultModel:"moonshotai/kimi-k2.6",mode:"chat"})},{key:"ai.catalog.nvidia",value:JSON.stringify({at:Date.now(),models:[normalizeModel("nvidia",{id:"moonshotai/kimi-k2.6"})]})}]);await client?.close();
  const socket=net.createServer();await new Promise<void>(r=>socket.listen(0,"127.0.0.1",r));const port=(socket.address() as any).port;await new Promise<void>(r=>socket.close(()=>r()));
  child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(port)],{env:process.env,stdio:["ignore","pipe","pipe"],windowsHide:true});
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
  const executable=process.env.A_CENTER_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  browser=await chromium.launch({headless:true,executablePath:executable});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`);await page.getByRole("button",{name:/API Providers$/}).click();await page.getByRole("heading",{name:"API Providers",exact:true}).waitFor();await page.getByRole("heading",{name:"EVREN",exact:true}).waitFor();assert.equal(await page.locator('input[type="password"]').count(),2);
  await page.getByRole("button",{name:/Model Center$/}).click();await page.getByRole("combobox").selectOption("nvidia");await page.getByRole("button",{name:"Workspace’te kullan",exact:true}).first().click();await page.getByText("Remember me",{exact:true}).waitFor();
  const selector=page.locator("label").filter({hasText:"Primary model"}).locator("select");assert((await selector.inputValue()).startsWith("nvidia::"));await selector.selectOption("ui-local");assert(await page.getByText("Remember me",{exact:true}).isVisible());
  await page.getByRole("button",{name:/Task Manager$/}).click();await page.getByPlaceholder("Task: Build a complete Roblox weapon system…").fill("UI agent plan");await page.getByRole("button",{name:"Create task",exact:true}).click();await page.getByRole("button",{name:"Open with Agent Engine",exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll("input")).some(i=>i.value==="UI agent plan"));assert.equal(await page.locator("label").filter({hasText:"General chat"}).locator("select").inputValue(),"agent");
  assert.equal(errors.length,0,errors.join("\n"));console.log("PASS rendered provider cards, Model Center filters, cloud/local switching and conversation preservation (isolated UI fixtures; no live generation)");
 }finally{await browser?.close();if(child){child.kill();await new Promise<void>(r=>child!.exitCode!==null?r():child!.once("close",()=>r()));}assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
