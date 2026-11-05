import {db} from '@/db';
import {projects} from '@/db/schema';
import {eq} from 'drizzle-orm';
import fs from 'node:fs';import crypto from 'node:crypto';
import {simpleDiff} from './vex';
import {ToolCall} from './ai/types';
import {validateCall,authorizedFile} from './ai/tools';
export const LOCAL_FILE_TOOLS=new Set(['analyze_project','read_file','write_file']);
export async function fileState(projectId:string,file:string){
 const p=(await db.select().from(projects).where(eq(projects.id,projectId)))[0];if(!p)throw Error('Select a Local Dir project');
 const full=authorizedFile(p,file);let content='';const exists=fs.existsSync(full);
 if(exists){const stat=fs.statSync(full);if(!stat.isFile()||stat.size>Math.min(p.fileSizeLimitKb*1024,128000))throw Error('File exceeds local AI size limit');content=fs.readFileSync(full,'utf8');}
 return{project:p,exists,content,hash:crypto.createHash('sha256').update(content).digest('hex')};
}
export function parseLocalCalls(text:string):ToolCall[]{
 let value:any;try{value=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{throw Error('Local model did not return a valid file-action JSON plan. No files were changed.');}
 if(!value||!Array.isArray(value.calls)||value.calls.length>4)throw Error('Use a calls array with at most four file actions');
 return value.calls.map((c:any)=>{if(!LOCAL_FILE_TOOLS.has(c.name))throw Error('Local file agent only supports analyze_project, read_file and write_file');const call:ToolCall={id:crypto.randomUUID(),type:'function',function:{name:c.name,arguments:JSON.stringify(c.arguments)}};validateCall(call);return call;});
}
export async function proposalPreview(projectId:string,file:string,content:string){const before=await fileState(projectId,file);return{file,exists:before.exists,diff:simpleDiff(before.content,content),before:before.content,after:content};}
