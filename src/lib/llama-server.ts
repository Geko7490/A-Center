import {spawn,ChildProcessWithoutNullStreams} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {performance} from 'node:perf_hooks';
import {parseSSE} from './ai/sse';
import {binaryFingerprint,llamaDevices,LlamaDevice,LlamaProbe,probeLlama,selectDevice} from './llama-probe';
import {storageBusy} from './maintenance';
export type LocalMessage={role:'system'|'user'|'assistant';content:string};
export type LocalMetrics={promptTokens:number|null;generationTokens:number|null;cachedTokens:number|null;promptMs:number|null;generationMs:number|null;promptTokPerSec:number|null;generationTokPerSec:number|null;ttftMs:number|null;requestTtftMs:number|null;loadMs:number;totalMs:number;serverReused:boolean;workerPid:number|null;device:string;offloadedLayers:number|null;totalLayers:number|null};
export type LlamaOptions={temperature?:number;contextTokens?:number;cpuThreads?:number;gpuLayers?:number|string;device?:string;fitTargetMiB?:number;cacheRamMiB?:number;maxTokens?:number;fitOutputBudget?:boolean;signal?:AbortSignal;onText?:(text:string)=>void;onReasoning?:(text:string)=>void};
type Config={model:string;contextTokens:number;cpuThreads:number;gpuLayers:number|string;device:string;fitTargetMiB:number;cacheRamMiB:number};
type Worker={child:ChildProcessWithoutNullStreams;closed:Promise<void>;key:string;url:string;signature:string;config:Config;pid:number|null;ready:boolean;exited:boolean;offloadedLayers:number|null;totalLayers:number|null;log:string[];partial:string;logFile:string};
type Dependencies={probe:typeof probeLlama;devices:(p:LlamaProbe)=>Promise<LlamaDevice[]>;launch:(exe:string,args:string[],key:string)=>ChildProcessWithoutNullStreams};
async function freePort(){const server=net.createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=(server.address() as net.AddressInfo).port;await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));return port;}
function finite(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;}
export function decodeTimings(t:any,usage:any={}){
 const promptMs=finite(t?.prompt_ms),generationMs=finite(t?.predicted_ms),promptTokens=finite(t?.prompt_n),generationTokens=finite(t?.predicted_n)??finite(usage?.completion_tokens);
 return {promptTokens,generationTokens,cachedTokens:finite(t?.cache_n)??finite(usage?.prompt_tokens_details?.cached_tokens),promptMs,generationMs,
  promptTokPerSec:finite(t?.prompt_per_second)??(promptMs&&promptTokens!==null?promptTokens*1000/promptMs:null),generationTokPerSec:finite(t?.predicted_per_second)??(generationMs&&generationTokens!==null?generationTokens*1000/generationMs:null)};
}
export function buildServerArgs(probe:LlamaProbe,c:Config,port:number){
 const h=probe.help;for(const flag of ['--host','--port','--api-key','--parallel'])if(!h.includes(flag))throw Error(`This llama-server build lacks ${flag}. Update the Vulkan runtime.`);
 const args=['-m',c.model,'--host','127.0.0.1','--port',String(port),'-c',String(c.contextTokens),'-t',String(c.cpuThreads),'--parallel','1'];
 if(h.includes('--device'))args.push('--device',c.device);else if(c.device!=='none')throw Error('GPU selection requires a llama-server build with --device');
 if(h.includes('--split-mode'))args.push('--split-mode','none');
 if(c.device==='none')args.push('-ngl','0');
 else if(c.gpuLayers==='auto'){if(!/['"]auto['"]/.test(h)||!h.includes('--fit'))throw Error('Automatic VRAM fit requires a newer llama-server build. Update it or select a numeric GPU layer count.');args.push('-ngl','auto','--fit','on');}
 else{args.push('-ngl',String(c.gpuLayers));if(h.includes('--fit'))args.push('--fit','off');}
 if(h.includes('--fit-target')&&c.device!=='none'&&c.gpuLayers==='auto')args.push('--fit-target',String(c.fitTargetMiB));
 if(h.includes('--cache-ram'))args.push('--cache-ram',String(c.cacheRamMiB));
 // Some Windows builds only forward loader details at trace level (4).
 // The manager persists loader lines only, before health becomes ready.
 if(h.includes('--verbosity'))args.push('--verbosity','4');
 if(h.includes('--no-webui'))args.push('--no-webui');if(h.includes('--no-context-shift'))args.push('--no-context-shift');if(h.includes('--perf'))args.push('--perf');if(h.includes('--sse-ping-interval'))args.push('--sse-ping-interval','15');return args;
}
const defaultDependencies:Dependencies={probe:probeLlama,devices:llamaDevices,launch:(exe,args,key)=>{
 const env:NodeJS.ProcessEnv={...process.env,ELECTRON_RUN_AS_NODE:'1',LLAMA_API_KEY:key};
 for(const name of Object.keys(env))if(/^(?:EVREN_|NVIDIA_API_KEY|VEX_CREDENTIAL_|VEX_LOCAL_TOKEN|HF_TOKEN)/.test(name))delete env[name];
 return spawn(process.execPath,[process.env.VEX_LLAMA_SUPERVISOR||path.join(process.cwd(),'desktop','llama-supervisor.cjs'),exe,...args],{env,windowsHide:true,cwd:path.dirname(exe),stdio:['pipe','pipe','pipe']});
}};
export class LlamaServerManager{
 private worker?:Worker;private busy=false;
 constructor(private deps:Dependencies=defaultDependencies){}
 isGenerating(){return this.busy;}
 snapshot(){const w=this.worker;return{running:!!w&&w.child.exitCode===null,ready:!!w?.ready,busy:this.busy,model:w?.config.model||null,workerPid:w?.pid||null,device:w?.config.device||null,offloadedLayers:w?.offloadedLayers??null,totalLayers:w?.totalLayers??null,config:w?.config||null,logFile:w?.logFile||null};}
 private record(w:Worker,chunk:string){
  if(w.ready)return;
  const lines=(w.partial+chunk).split(/\r?\n/);w.partial=(lines.pop()||'').slice(-65536);
  for(const line of lines){
   const pid=line.match(/A_CENTER_WORKER_PID=(\d+)/);if(pid)w.pid=Number(pid[1]);const offload=line.match(/offloaded\s+(\d+)\s*\/\s*(\d+)\s+layers/i);if(offload){w.offloadedLayers=Number(offload[1]);w.totalLayers=Number(offload[2]);}
   // Only loader diagnostics enter the log: no prompts, output text or API keys.
   if(/ggml_vulkan:|offload(?:ing|ed) .*layers|using device .*\(|model buffer size|KV buffer size|compute buffer size|n_ctx(?:_per_seq)?\s*=|failed to allocate|out of (?:device )?memory|error loading model/i.test(line)){
    w.log.push(line.split(w.key).join('[REDACTED]').slice(0,1000));w.log=w.log.slice(-120);try{fs.writeFileSync(w.logFile,`Device: ${w.config.device}\nRequested GPU layers: ${w.config.gpuLayers}\n${w.log.join('\n')}\n`);}catch{}
   }
  }
 }
 private async closeWorker(){
  const w=this.worker;if(!w)return;this.worker=undefined;w.ready=false;w.child.stdin.end();
  const timer=setTimeout(()=>w.child.kill(),5000);try{await w.closed;}finally{clearTimeout(timer);}
 }
 async stop(model?:string){if(model&&this.worker?.config.model!==path.resolve(model))return;if(this.busy)throw Error('Wait for the current model response before unloading or changing the runtime.');await this.closeWorker();}
 private async ensure(runtimeDir:string,model:string,options:LlamaOptions,signal:AbortSignal){
  const probe=await this.deps.probe(runtimeDir),device=selectDevice(await this.deps.devices(probe),options.device||'auto');
  const clamp=(n:unknown,fallback:number,min:number,max:number)=>Math.floor(Math.max(min,Math.min(max,Number(n)||fallback)));
  const layers=options.gpuLayers??'auto';if(layers!=='auto'&&(!/^\d+$/.test(String(layers))||Number(layers)>10000))throw Error('GPU layers must be auto or an integer between 0 and 10000');
  const c:Config={model:path.resolve(model),contextTokens:clamp(options.contextTokens,4096,512,131072),cpuThreads:clamp(options.cpuThreads,8,1,128),gpuLayers:layers,device,fitTargetMiB:clamp(options.fitTargetMiB,1024,256,16384),cacheRamMiB:options.cacheRamMiB===0?0:clamp(options.cacheRamMiB,1024,0,8192)};
  const signature=JSON.stringify([probe.signature,binaryFingerprint(c.model),c]);
  if(this.worker?.ready&&this.worker.signature===signature&&this.worker.child.exitCode===null){try{const r=await fetch(this.worker.url+'/health',{signal:AbortSignal.any([signal,AbortSignal.timeout(2000)])});if(r.ok)return{worker:this.worker,reused:true,loadMs:0};}catch{if(signal.aborted)throw Error('Request cancelled');}}
  await this.closeWorker();signal.throwIfAborted();const port=await freePort(),args=buildServerArgs(probe,c,port),key=crypto.randomBytes(32).toString('hex');fs.mkdirSync(runtimeDir,{recursive:true});const started=performance.now(),child=this.deps.launch(probe.executable,args,key);
  let close!:()=>void;const closed=new Promise<void>(resolve=>{close=resolve;});
  const w:Worker={child,closed,key,url:`http://127.0.0.1:${port}`,signature,config:c,pid:null,ready:false,exited:false,offloadedLayers:null,totalLayers:null,log:[],partial:'',logFile:path.join(runtimeDir,'last-server.log')};this.worker=w;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',s=>this.record(w,s));child.stderr.on('data',s=>this.record(w,s));child.once('error',()=>{w.ready=false;w.exited=true;close();});child.once('close',()=>{w.ready=false;w.exited=true;close();});child.stdin.on('error',()=>{});
  try{while(performance.now()-started<600000){
   signal.throwIfAborted();if(w.exited||child.exitCode!==null||child.signalCode!==null)throw Error(`llama-server exited (${child.exitCode}). ${w.log.slice(-5).join(' ')} Log: ${w.logFile}`);
   try{const r=await fetch(w.url+'/health',{signal:AbortSignal.any([signal,AbortSignal.timeout(2000)])});if(r.ok){w.ready=true;return{worker:w,reused:false,loadMs:performance.now()-started};}}catch{signal.throwIfAborted();}
   await new Promise<void>(resolve=>setTimeout(resolve,150));
  }throw Error(`Model loading timed out. Log: ${w.logFile}`);}catch(error){await this.closeWorker();throw error;}
 }
 async generate(runtimeDir:string,model:string,messages:LocalMessage[],options:LlamaOptions={}){
  if(this.busy)throw Error('Another local model response is still running.');if(storageBusy())throw Error('Storage relocation in progress');if(!fs.existsSync(model))throw Error(`GGUF model file not found: ${model}`);if(JSON.stringify(messages).length>2*1024*1024)throw Error('Conversation is too large; start a new chat or reduce attached context.');
  this.busy=true;const started=performance.now(),signal=AbortSignal.any([options.signal||new AbortController().signal,AbortSignal.timeout(600000)]);
  try{
   const {worker:w,reused,loadMs}=await this.ensure(runtimeDir,model,options,signal),requestStart=performance.now();
   let maxTokens=Math.floor(Math.max(1,Math.min(131072,options.maxTokens||512)));
   if(options.fitOutputBudget){
    const headers={'content-type':'application/json',authorization:`Bearer ${w.key}`};
    const template=await fetch(w.url+'/apply-template',{method:'POST',headers,signal,body:JSON.stringify({messages,add_generation_prompt:true})});if(!template.ok)throw Error('Could not apply model chat template for Studio token budgeting');
    const formatted=await template.json();const counted=await fetch(w.url+'/tokenize',{method:'POST',headers,signal,body:JSON.stringify({content:formatted.prompt,add_special:false,parse_special:true})});if(!counted.ok)throw Error('Could not count Studio prompt tokens');const tokenized=await counted.json();if(!Array.isArray(tokenized.tokens))throw Error('Invalid tokenizer response');
    const available=w.config.contextTokens-tokenized.tokens.length-32;if(available<256)throw Error(`Studio context is too large: ${tokenized.tokens.length} input tokens, ${w.config.contextTokens} context. Increase runtime context or request a smaller/named script.`);maxTokens=Math.min(maxTokens,available);
   }
   const response=await fetch(w.url+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${w.key}`},signal,redirect:'error',body:JSON.stringify({model:'local',messages,stream:true,stream_options:{include_usage:true},cache_prompt:true,id_slot:0,temperature:options.temperature??0.7,max_tokens:maxTokens})});
   if(!response.ok){let error:any={};try{error=(await response.json()).error||{};}catch{}let detail=typeof error.message==='string'?error.message:'Request rejected';detail=detail.split(w.key).join('[REDACTED]');for(const m of messages)if(m.content)detail=detail.split(m.content).join('[context redacted]');throw Error(`llama-server HTTP ${response.status}: ${detail.slice(0,1200)}${error.n_prompt_tokens!==undefined?` (prompt=${error.n_prompt_tokens}, ctx=${error.n_ctx??w.config.contextTokens})`:''}. Log: ${w.logFile}`);}
   let text='',reasoning='',first:number|null=null,finish='',timings:any,usage:any,ended=false;if(!response.body)throw Error('llama-server returned no stream');
   for await(const frame of parseSSE(response.body,signal)){
    if(frame.data==='[DONE]'){ended=true;break;}const data=JSON.parse(frame.data);if(data.error)throw Error('llama-server generation failed');const choice=data.choices?.[0],delta=choice?.delta;
    for(const [piece,isReasoning] of [[delta?.content,false],[delta?.reasoning_content||delta?.reasoning,true]] as const)if(typeof piece==='string'&&piece){if(first===null)first=performance.now();if(isReasoning){reasoning+=piece;options.onReasoning?.(piece);}else{text+=piece;options.onText?.(piece);}}
    if(text.length+reasoning.length>4*1024*1024)throw Error('Local response exceeded size limit');if(choice?.finish_reason)finish=choice.finish_reason;if(data.timings)timings=data.timings;if(data.usage)usage=data.usage;
   }
   if(!ended||!finish)throw Error('Local stream ended before completion');if(!text&&!reasoning)throw Error('Model returned no answer');
   const metrics:LocalMetrics={...decodeTimings(timings,usage),ttftMs:first===null?null:first-started,requestTtftMs:first===null?null:first-requestStart,loadMs,totalMs:performance.now()-started,serverReused:reused,workerPid:w.pid,device:w.config.device,offloadedLayers:w.offloadedLayers,totalLayers:w.totalLayers};
   return{text,reasoning,ms:metrics.totalMs,tps:metrics.generationTokPerSec||0,metrics,usage:usage||null,finishReason:finish};
  }finally{this.busy=false;}
 }
}
const state=globalThis as typeof globalThis & {aCenterLlamaServer?:LlamaServerManager};
export const llamaServer=state.aCenterLlamaServer ||= new LlamaServerManager();
