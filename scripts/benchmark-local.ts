import fs from 'node:fs';import path from 'node:path';
import {llamaServer,LocalMessage} from '../src/lib/llama-server';
async function main(){
 const args=process.argv.slice(2);const arg=(name:string)=>{const i=args.indexOf(name);if(i>=0&&(!args[i+1]||args[i+1].startsWith('--')))throw Error(`Missing value for ${name}`);return i>=0?args[i+1]:undefined;};
 const model=arg('--model')||process.env.A_CENTER_TEST_MODEL;if(!model)throw Error('Pass --model <existing GGUF path> or A_CENTER_TEST_MODEL. No download is performed.');
 const runtime=arg('--runtime')||path.join(path.dirname(path.dirname(model)),'runtimes','llama.cpp');
 const messages:LocalMessage[]=[{role:'system',content:'You are a helpful assistant. Be concise.'},{role:'user',content:'The test document contains these numbered entries: '+Array.from({length:80},(_,i)=>`Entry ${i+1}: persistent local inference keeps the same model and caches a shared prompt prefix.`).join('\n')+'\nSummarize the document in one short sentence.'}];
 const options={device:arg('--device')||'auto',contextTokens:4096,cpuThreads:8,gpuLayers:'auto',maxTokens:64,temperature:0};
 try{
  const cold=await llamaServer.generate(runtime,model,messages,options),warm=await llamaServer.generate(runtime,model,messages,options);
  const next=await llamaServer.generate(runtime,model,[...messages,{role:'assistant',content:warm.text},{role:'user',content:'Now give the entry count only.'}],options);
  const report={at:new Date().toISOString(),model:path.basename(model),cold:cold.metrics,warm:warm.metrics,conversation:next.metrics,checks:{sameProcess:cold.metrics.workerPid===warm.metrics.workerPid&&warm.metrics.workerPid===next.metrics.workerPid,warmReused:warm.metrics.serverReused,warmCacheObserved:(warm.metrics.cachedTokens||0)>0,conversationCacheObserved:(next.metrics.cachedTokens||0)>0},note:'Measured hardware results, not a guaranteed speed threshold. TTFT includes startup on the cold request. No generated text or user prompts are saved.'};
  const output=arg('--out');if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));}console.log(JSON.stringify(report,null,2));
  if(Object.values(report.checks).some(v=>!v))process.exitCode=1;
 }finally{await llamaServer.stop();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
