const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Runs in Electron's main process: safeStorage uses Windows DPAPI, not a file key.
async function createCredentialBridge(safeStorage, directory) {
  const token = crypto.randomBytes(32).toString("hex");
  const file = path.join(directory, "provider-credentials.json");
  const available = () => safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || !safeStorage.getSelectedStorageBackend || safeStorage.getSelectedStorageBackend() !== "basic_text");
  const read = () => { if (!fs.existsSync(file)) return {}; const value = JSON.parse(fs.readFileSync(file,"utf8")); if (!value || typeof value !== "object") throw Error("Invalid credential store"); return value; };
  const server = http.createServer(async (req,res) => {
    res.setHeader("content-type","application/json"); res.setHeader("cache-control","no-store");
    const supplied=String(req.headers["x-credential-token"] || "");
    const suppliedBytes=Buffer.from(supplied);
    if (suppliedBytes.length !== token.length || !crypto.timingSafeEqual(suppliedBytes,Buffer.from(token)) || req.method !== "POST" || req.url !== "/secrets") { res.writeHead(403);res.end('{"error":"Forbidden"}');return; }
    try {
      let text=""; for await(const chunk of req){text+=chunk;if(text.length>16384)throw Error("Request too large");}
      const body=JSON.parse(text); const store=read();
      if(body.action==="status"){res.end(JSON.stringify({available:available(),evren:!!store.evren,nvidia:!!store.nvidia}));return;}
      if(!["evren","nvidia"].includes(body.provider))throw Error("Unknown provider");
      if(!available())throw Error("OS credential encryption unavailable; plaintext storage is disabled");
      if(body.action==="get"){res.end(JSON.stringify({key:store[body.provider]?safeStorage.decryptString(Buffer.from(store[body.provider],"base64")):""}));return;}
      if(body.action==="set"){
        if(typeof body.key!=="string" || !body.key.trim() || body.key.length>8192)throw Error("Invalid API key");
        store[body.provider]=safeStorage.encryptString(body.key.trim()).toString("base64");
      } else if(body.action==="delete")delete store[body.provider]; else throw Error("Unknown action");
      fs.mkdirSync(directory,{recursive:true});const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(store),{mode:0o600});fs.renameSync(tmp,file);
      res.end('{"ok":true}');
    } catch {res.writeHead(400);res.end('{"error":"Credential operation failed; check OS encryption and credential-store permissions"}');}
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  return {url:`http://127.0.0.1:${server.address().port}/secrets`,token,close:()=>server.close()};
}
module.exports={createCredentialBridge};
