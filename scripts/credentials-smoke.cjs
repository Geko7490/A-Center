const {app,safeStorage}=require("electron");
const fs=require("node:fs");const os=require("node:os");const path=require("node:path");const assert=require("node:assert/strict");
app.whenReady().then(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),"acenter-credentials-"));let bridge;
 try{
  bridge=await require("../desktop/credentials.cjs").createCredentialBridge(safeStorage,directory);
  const call=async(body,token=bridge.token)=>{const r=await fetch(bridge.url,{method:"POST",headers:{"x-credential-token":token},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
  const status=await call({action:"status"});
  if(!status.data.available){assert.equal((await call({action:"set",provider:"evren",key:"dummy-test-key"})).status,400);console.log("SKIP OS encryption unavailable; verified plaintext storage is rejected");return;}
  assert.equal((await call({action:"set",provider:"evren",key:"dummy-test-key"})).status,200);
  assert(!fs.readFileSync(path.join(directory,"provider-credentials.json"),"utf8").includes("dummy-test-key"));
  assert.equal((await call({action:"get",provider:"evren"})).data.key,"dummy-test-key");assert.equal((await call({action:"get",provider:"evren"},"wrong")).status,403);
  await call({action:"delete",provider:"evren"});assert.equal((await call({action:"status"})).data.evren,false);console.log("PASS real OS-encrypted key save/read/delete and unauthorized access rejection");
 }catch(e){console.error(e.message);process.exitCode=1;}finally{bridge?.close();assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
