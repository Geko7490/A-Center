import fs from 'node:fs';
import path from 'node:path';
import {runBinary} from './binary';
import {ProbeCache} from './cache';
export type LlamaProbe={executable:string;help:string;signature:string};
export type LlamaDevice={id:string;name:string;totalMiB:number;freeMiB:number};
const state=globalThis as typeof globalThis & {llamaHelpCache?:ProbeCache<LlamaProbe>;llamaDevicesCache?:ProbeCache<LlamaDevice[]>};
const helpCache=state.llamaHelpCache ||= new ProbeCache<LlamaProbe>();
const deviceCache=state.llamaDevicesCache ||= new ProbeCache<LlamaDevice[]>(30000);
export function binaryFingerprint(file:string){const s=fs.statSync(file);return `${fs.realpathSync(file)}:${s.size}:${s.mtimeMs}`;}
export function llamaCandidates(runtimeDir:string){
 const name=process.platform==='win32'?'llama-server.exe':'llama-server';
 return [path.join(runtimeDir,name),...(process.env.PATH||'').split(path.delimiter).filter(Boolean).map(dir=>path.join(dir.replace(/^"|"$/g,''),name))];
}
export async function probeLlama(runtimeDir:string,force=false):Promise<LlamaProbe>{
 const executable=llamaCandidates(runtimeDir).find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());
 if(!executable)throw Error(`llama-server not found in ${runtimeDir} or PATH. Install the complete Vulkan server build (EXE and matching DLL files); llama-cli alone is insufficient.`);
 const signature=binaryFingerprint(executable);
 return helpCache.get(signature,async()=>{const r=await runBinary(executable,['--help'],15000);if(r.code!==0)throw Error(`llama-server verification failed (exit ${r.code}); check matching EXE/DLL versions.`);return{executable,signature,help:r.stdout+r.stderr};},force);
}
export function parseDevices(text:string):LlamaDevice[]{
 return text.split(/\r?\n/).flatMap(line=>{const m=line.match(/^\s*([\w-]+\d+):\s*(.+?)\s*\(([\d.]+) MiB,\s*([\d.]+) MiB free\)/);return m?[{id:m[1],name:m[2],totalMiB:Number(m[3]),freeMiB:Number(m[4])}]:[];});
}
export async function llamaDevices(probe:LlamaProbe,force=false){
 if(!probe.help.includes('--list-devices'))return [];
 return deviceCache.get(probe.signature,async()=>{const r=await runBinary(probe.executable,['--list-devices'],15000);if(r.code!==0)throw Error('Could not list llama-server GPU devices');return parseDevices(r.stdout+r.stderr);},force);
}
export function selectDevice(devices:LlamaDevice[],selection='auto'){
 if(selection==='none')return 'none';
 if(selection!=='auto'){if(!devices.some(d=>d.id===selection))throw Error(`Selected device ${selection} is unavailable. Re-detect devices in Runtime Manager.`);return selection;}
 // Do not sort by apparent VRAM: integrated Radeon reports shared system RAM.
 return (devices.find(d=>/RX\s*6700M/i.test(d.name))||devices.find(d=>/GeForce|RTX|Radeon.*RX\s*\d|Arc\s+[AB]\d/i.test(d.name))||devices[0])?.id||'none';
}
