import { db } from "@/db";
import { projects, gitRepos } from "@/db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { safeJoin, walkDir } from "@/lib/vex";
import { NextRequest } from "next/server";
import { ProviderError, ToolCall } from "./types";

const definition=(name:string,description:string,properties:object,required:string[])=>({type:"function",function:{name,description,parameters:{type:"object",properties,required,additionalProperties:false}}});
export const AGENT_TOOLS = [
  definition("read_file","Read a project file after explicit user approval. Protected files are blocked.",{file:{type:"string"}},["file"]),
  definition("write_file","Propose creation or replacement of a project file. The user reviews the complete content before execution. Existing project permissions and backups apply.",{file:{type:"string"},content:{type:"string"}},["file","content"]),
  definition("analyze_project","List project files, sizes and languages. Does not read protected file contents.",{},[]),
  definition("run_terminal","Run a command after explicit user approval, only if project terminal permission is enabled. Command has the user's OS permissions; never claim a test passed unless exit status confirms it.",{command:{type:"string"},purpose:{type:"string",enum:["command","test"]}},["command","purpose"]),
  definition("git_operation","Operate on a connected repository whose path matches this project. Mutations require explicit user approval and repository permissions.",{action:{type:"string",enum:["status","diff","fetch","pull","commit","push"]},message:{type:"string"}},["action"]),
];
export function validateCall(call:ToolCall) {
  if(!call.id || call.id.length>256 || call.type!=="function")throw new ProviderError("Missing or invalid tool call ID","invalid_tool_call",400);
  const definition=AGENT_TOOLS.find(t=>t.function.name===call.function?.name); if(!definition)throw new ProviderError("Unknown tool call","invalid_tool_call",400);
  if(typeof call.function.arguments!=="string" || call.function.arguments.length>256000)throw new ProviderError("Invalid tool arguments","invalid_tool_call",400);
  let args:Record<string,unknown>;try{args=JSON.parse(call.function.arguments);}catch{throw new ProviderError("Tool arguments are not JSON","invalid_tool_call",400);}
  if(!args || typeof args!=="object" || Array.isArray(args))throw new ProviderError("Tool arguments must be an object","invalid_tool_call",400);
  const props=definition.function.parameters.properties as Record<string,{type:string;enum?:string[]}>;
  for(const k of Object.keys(args))if(!props[k])throw new ProviderError(`Unexpected tool argument: ${k}`,"invalid_tool_call",400);
  for(const k of definition.function.parameters.required)if(typeof args[k]!=="string")throw new ProviderError(`Missing tool argument: ${k}`,"invalid_tool_call",400);
  for(const [k,v] of Object.entries(args))if(typeof v!=="string" || (props[k].enum&&!props[k].enum.includes(v)))throw new ProviderError("Invalid tool argument value","invalid_tool_call",400);
  return args;
}
function protectedFile(patterns:string[],file:string) {
  const normalized=file.replace(/\\/g,"/");
  return patterns.some(p=>{const regex=new RegExp("^"+p.split("*").map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join(".*")+"$","i");return regex.test(normalized)||regex.test(path.basename(normalized));});
}
export async function executeTool(name:string,args:Record<string,unknown>,projectId:string,signal?:AbortSignal) {
  const p=(await db.select().from(projects).where(eq(projects.id,projectId)))[0];if(!p)throw new ProviderError("Select an authorized project in the session","project_required",400);
  if(name==="read_file"||name==="write_file") {
    const file=String(args.file);const full=safeJoin(p.path,file);
    if(protectedFile(p.protectedFiles,file))throw new ProviderError("Protected file access is blocked","protected_file",403);
    if(name==="read_file"){const stat=fs.statSync(full);if(!stat.isFile()||stat.size>Math.min(p.fileSizeLimitKb*1024,128000))throw new ProviderError("File exceeds tool size limit","file_limit",400);return{content:fs.readFileSync(full,"utf8")};}
    const {POST}=await import("@/app/api/projects/files/route");
    const invoke=(body:object)=>POST(new NextRequest("http://127.0.0.1/api/projects/files",{method:"POST",body:JSON.stringify(body)}));
    const response=await invoke({projectId:p.id,file,content:args.content,action:"write",reason:"User approved AI tool proposal"});const result=await response.json();if(!response.ok)throw new ProviderError(result.error,"file_permission",response.status);
    if(result.queued){const approved=await invoke({projectId:p.id,id:result.pending.id,action:"approve"});const value=await approved.json();if(!approved.ok)throw new ProviderError(value.error,"file_permission",approved.status);}
    return{written:file,permissionMode:p.permissionMode};
  }
  if(name==="analyze_project")return{files:walkDir(p.path,{maxFiles:400,exclude:p.excludedDirs}).filter(f=>!protectedFile(p.protectedFiles,f.path))};
  if(name==="run_terminal") {
    if(p.permissionMode==="read-only")throw new ProviderError("Read-only projects cannot execute terminal commands","read_only",403);
    if(!p.terminalAllowed)throw new ProviderError("Enable this project's terminal permission before approving commands","terminal_permission",403);
    const {POST}=await import("@/app/api/terminal/route");const response=await POST(new NextRequest("http://127.0.0.1/api/terminal",{method:"POST",signal,body:JSON.stringify({command:args.command,cwd:p.path,approveDangerous:true})}));const result=await response.json();if(!response.ok)throw new ProviderError(result.error,"terminal_permission",response.status);return result.entry;
  }
  if(name==="git_operation") {
    const repos=await db.select().from(gitRepos);const repo=repos.find(r=>path.resolve(r.localPath).toLowerCase()===path.resolve(p.path).toLowerCase());if(!repo)throw new ProviderError("Connect this project repository in GitHub Manager first","repository_required",400);
    if(p.permissionMode==="read-only" && !["status","diff"].includes(String(args.action)))throw new ProviderError("Read-only project","read_only",403);
    const {POST}=await import("@/app/api/git/route");const response=await POST(new NextRequest("http://127.0.0.1/api/git",{method:"POST",signal,body:JSON.stringify({action:args.action,id:repo.id,message:args.message})}));const result=await response.json();if(!response.ok || result.ok===false)throw new ProviderError(result.error||result.out||"Git failed","git_error",400);return result;
  }
  throw new ProviderError("Unknown tool","invalid_tool_call",400);
}
