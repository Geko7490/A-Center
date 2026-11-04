import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {LlamaServerManager,decodeTimings,buildServerArgs} from '../src/lib/llama-server';
import {parseDevices,selectDevice} from '../src/lib/llama-probe';
import {ProbeCache} from '../src/lib/cache';
const help="--host --port --api-key --parallel --device --split-mode --fit --fit-target --cache-ram --no-webui --perf --sse-ping-interval --no-context-shift gpu layers 'auto'";
test('Device selection prefers discrete RX 6700M over larger shared iGPU memory',()=>{
 const devices=parseDevices('Available devices:\n Vulkan0: AMD Radeon RX 6700M (10224 MiB, 9426 MiB free)\n Vulkan1: AMD Radeon(TM) Graphics (16325 MiB, 15508 MiB free)');
 assert.equal(selectDevice(devices),'Vulkan0');assert.equal(selectDevice(devices,'Vulkan1'),'Vulkan1');assert.equal(selectDevice(devices,'none'),'none');assert.throws(()=>selectDevice(devices,'CUDA0'),/unavailable/);
});
test('Timings are server metrics, never characters divided by total latency',()=>{
 assert.equal(decodeTimings({prompt_n:20,prompt_ms:10,predicted_n:4,predicted_ms:40}).promptTokPerSec,2000);
 assert.equal(decodeTimings({predicted_n:4,predicted_ms:40}).generationTokPerSec,100);
 assert.equal(decodeTimings(undefined).generationTokPerSec,null);
 const args=buildServerArgs({executable:'server',signature:'1',help},{model:'m',contextTokens:4096,cpuThreads:8,gpuLayers:'auto',device:'Vulkan0',fitTargetMiB:1024,cacheRamMiB:1024},123);
 assert(args.includes('auto'));assert(!args.includes('32'));assert.equal(args[args.indexOf('--parallel')+1],'1');assert.equal(args[args.indexOf('--device')+1],'Vulkan0');
 assert.throws(()=>buildServerArgs({executable:'server',signature:'1',help:help.replace("'auto'",'')},{model:'m',contextTokens:4096,cpuThreads:8,gpuLayers:'auto',device:'Vulkan0',fitTargetMiB:1024,cacheRamMiB:0},123),/newer/);
});
test('Probe cache deduplicates in-flight work and honors force refresh',async()=>{
 const cache=new ProbeCache<number>();let hits=0;const work=async()=>++hits;
 assert.deepEqual(await Promise.all([cache.get('a',work),cache.get('a',work)]),[1,1]);assert.equal(await cache.get('a',work),1);assert.equal(await cache.get('a',work,true),2);
});
test('A backend crash closes the supervisor pipe and removes its model worker',async()=>{
 const code=`const {spawn}=require('node:child_process');const c=spawn(process.execPath,${JSON.stringify([path.resolve('desktop/llama-supervisor.cjs'),process.execPath,path.resolve('scripts/mock-llama-server.cjs'),'--port','0'])},{env:process.env,stdio:['pipe','pipe','pipe'],windowsHide:true});c.stdout.pipe(process.stdout);c.stderr.resume();setInterval(()=>{},1000);`;
 const parent=spawn(process.execPath,['-e',code],{windowsHide:true,stdio:['ignore','pipe','pipe']});let worker=0;
 try{
  worker=await new Promise<number>((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(Error('No worker PID')),5000);parent.stdout.on('data',s=>{buffer+=s;const m=buffer.match(/A_CENTER_WORKER_PID=(\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});parent.once('error',reject);});
  parent.kill();await new Promise<void>(r=>parent.once('close',()=>r()));
  let exists=true;for(let i=0;i<50;i++){try{process.kill(worker,0);}catch{exists=false;break;}await new Promise(r=>setTimeout(r,50));}assert.equal(exists,false,'Model worker survived backend crash');
 }finally{if(parent.exitCode===null)parent.kill();if(worker)try{process.kill(worker);}catch{}}
});
test('Persistent process, cold TTFT, cached context, reconfiguration and cancel recovery',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'acenter-llama-'));const model=path.join(temp,'model.gguf');fs.writeFileSync(model,'fixture model');let launches=0;
 const manager=new LlamaServerManager({probe:async()=>({executable:process.execPath,signature:'fixture-v1',help}),devices:async()=>[{id:'Vulkan0',name:'AMD Radeon RX 6700M',totalMiB:10224,freeMiB:9000}],launch:(exe,args,key)=>{
  launches++;return spawn(process.execPath,[path.resolve('desktop/llama-supervisor.cjs'),exe,path.resolve('scripts/mock-llama-server.cjs'),...args],{env:{...process.env,LLAMA_API_KEY:key},windowsHide:true,stdio:['pipe','pipe','pipe']});
 }});
 const messages=[{role:'user' as const,content:'repeat this context'}];
 try{
  const cold=await manager.generate(temp,model,messages);const warm=await manager.generate(temp,model,messages);
  assert.equal(launches,1);assert.equal(warm.metrics.workerPid,cold.metrics.workerPid);assert.equal(cold.metrics.serverReused,false);assert.equal(warm.metrics.serverReused,true);assert.equal(warm.metrics.loadMs,0);assert.equal(warm.metrics.cachedTokens,120);
  assert(cold.metrics.ttftMs!>=cold.metrics.loadMs);assert(warm.metrics.requestTtftMs!>=30);assert.equal(warm.metrics.generationTokens,4);assert.equal(warm.metrics.generationTokPerSec,80);assert.equal(warm.metrics.offloadedLayers,24);assert.equal(warm.metrics.totalLayers,25);
  const ctrl=new AbortController();const slow=manager.generate(temp,model,[{role:'user',content:'slow'}],{signal:ctrl.signal});await new Promise(r=>setTimeout(r,100));
  await assert.rejects(manager.generate(temp,model,messages),/still running/);await assert.rejects(manager.stop(),/current model/);ctrl.abort();await assert.rejects(slow);
  const recovered=await manager.generate(temp,model,messages);assert.equal(recovered.metrics.workerPid,warm.metrics.workerPid);
  const changed=await manager.generate(temp,model,messages,{device:'none'});assert.equal(launches,2);assert.notEqual(changed.metrics.workerPid,warm.metrics.workerPid);
  const log=fs.readFileSync(path.join(temp,'last-server.log'),'utf8');assert(!log.includes('repeat this context'));assert.match(log,/offloaded 24\/25/);
  const pid=changed.metrics.workerPid!;await manager.stop();assert.equal(manager.snapshot().running,false);assert.throws(()=>process.kill(pid,0));
 }finally{await manager.stop();assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
