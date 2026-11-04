import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'acenter-smoke-'));
const storage = path.join(temp, 'source');
const target = path.join(temp, 'target');
const config = path.join(temp, 'config', 'settings.json');
fs.mkdirSync(storage); fs.writeFileSync(path.join(storage, 'sentinel.txt'), 'preserve me');
const socket = net.createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port; await new Promise(r => socket.close(r));
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env: { ...process.env, VEX_STORAGE: storage, VEX_DATABASE: path.join(storage, 'database'), VEX_CONFIG_PATH: config, VEX_LOCAL_TOKEN: 'smoke-token' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let logs=''; child.stdout.on('data', x => logs+=x); child.stderr.on('data', x=>logs+=x);
async function api(url, body, method = 'POST') {
 const response = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'content-type': 'application/json', 'x-vex-local-token': 'smoke-token', origin: `http://localhost:${port}` }, ...(body ? {body:JSON.stringify(body)}:{}) });
 return {status:response.status, data:await response.json()};
}
let origin;
try {
 let healthy=false;
 for(let i=0;i<120;i++){ try {if((await api('/api/health',null,'GET')).status===200){healthy=true;break;}}catch{} await new Promise(r=>setTimeout(r,500)); }
 assert(healthy, logs);
 const crossOrigin=await fetch(`http://127.0.0.1:${port}/api/providers`,{method:'POST',headers:{'content-type':'application/json','x-vex-local-token':'smoke-token',origin:'https://untrusted.invalid'},body:JSON.stringify({provider:'evren',action:'test'})});assert.equal(crossOrigin.status,403);
 assert.equal((await api('/api/settings',{values:{'storage.root':path.parse(target).root}})).status,400);
 assert.equal((await api('/api/projects',{name:'escape',path:'../escape'})).status,400);
 const project=(await api('/api/projects',{name:'permission-test',path:'permission-test'})).data.project;
 assert.equal((await api('/api/projects/files',{projectId:project.id,action:'mkdir',file:'blocked'})).status,403);
 const outside=path.join(temp,'outside'); fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'private.txt'),'private');
 fs.symlinkSync(outside,path.join(project.path,'link'),process.platform==='win32'?'junction':'dir');
 assert.equal((await api(`/api/projects/files?projectId=${project.id}&file=link/private.txt`,null,'GET')).status,400);
 fs.unlinkSync(path.join(project.path,'link'));
 assert.equal((await api('/api/terminal',{command:'echo test',cwd:outside,approveDangerous:true})).status,400);
 console.log('PASS project traversal, junction escape, approval mode and terminal directory guards');
 // Real model validation is optional; CI exercises transport/storage without multi-GB downloads.
 if(process.env.A_CENTER_TEST_MODEL) {
  const model=(await api('/api/models',{name:'smoke-model',format:'GGUF',installPath:process.env.A_CENTER_TEST_MODEL})).data.model;
  const conv=(await api('/api/chat',{action:'create',modelId:model.name})).data.conversation;
  const reply=await api('/api/chat',{conversationId:conv.id,prompt:'Sadece OK yaz.'});
  assert.equal(reply.status,200,JSON.stringify(reply)); assert.match(reply.data.engine,/llama.cpp/); assert.match(reply.data.message.content,/OK/i);
  assert(!reply.data.message.content.includes('available commands:'), 'CLI banner leaked');
  console.log('PASS real GGUF response through AI Workspace API');
 }
 // Range-ignoring server must cause a restart, never append a second full file.
 const bytes=Buffer.alloc(2*1024*1024,42); bytes.write('GGUF');
 origin=http.createServer((req,res)=>{res.writeHead(200,{'content-length':bytes.length});if(req.method==='HEAD'){res.end();return;}let offset=0;const timer=setInterval(()=>{if(offset>=bytes.length){clearInterval(timer);res.end();return;}res.write(bytes.subarray(offset,offset+32768));offset+=32768;},10);res.on('close',()=>clearInterval(timer));});
 await new Promise(r=>origin.listen(0,'127.0.0.1',r));
 const download=(await api('/api/downloads',{url:`http://127.0.0.1:${origin.address().port}/model`,modelName:'range-test'})).data.download;
 await new Promise(r=>setTimeout(r,300)); await api('/api/downloads',{id:download.id,action:'pause'});
 await new Promise(r=>setTimeout(r,100)); await api('/api/downloads',{id:download.id,action:'resume'});
 let dl;
 for(let i=0;i<100;i++){dl=(await api('/api/downloads',null,'GET')).data.downloads.find(x=>x.id===download.id);if(['completed','failed'].includes(dl.status))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(dl.status,'completed',JSON.stringify(dl));
 const downloaded=(await api('/api/models',null,'GET')).data.models.find(x=>x.name==='range-test');assert.deepEqual(fs.readFileSync(downloaded.installPath),bytes);
 console.log('PASS interrupted download resumed against Range-ignoring server');
 // Missing config parent forces failure after copy; DB and files must roll back.
 const failed=await api('/api/settings',{values:{'storage.root':target}}); assert.equal(failed.status,500,JSON.stringify(failed)); assert(!fs.existsSync(target)); assert(fs.existsSync(path.join(storage,'sentinel.txt')));
 fs.mkdirSync(path.dirname(config));
 const moved=await api('/api/settings',{values:{'storage.root':target,'terminal.defaultCwd':'obsolete'}});assert.equal(moved.status,200,JSON.stringify(moved)); assert(moved.data.restartRequired);
 assert.equal(fs.readFileSync(path.join(target,'sentinel.txt'),'utf8'),'preserve me');assert(fs.existsSync(path.join(storage,'sentinel.txt')));assert.equal(JSON.parse(fs.readFileSync(config)).storageRoot,target);
 const settings=(await api('/api/settings',null,'GET')).data.settings; assert.equal(settings['terminal.defaultCwd'],path.join(target,'workspace'));
 assert.equal((await api('/api/models',{name:'blocked'})).status,409);
 console.log('PASS volume-root rejection, rollback, relocation, source backup and restart lock');
} finally {
 origin?.close(); child.kill(); await new Promise(r=>child.exitCode!==null?r():child.once('close',r));
 assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep)); fs.rmSync(temp,{recursive:true,force:true});
}
