// Keep complete entries; never cut JSON or splice a partial script into a prompt.
export function studioContext(context:any,request:string,maxChars=6000){
 const entries:any[]=[];const walk=(node:any)=>{if(!node||entries.length>=24)return;entries.push({Name:String(node.Name||'').slice(0,100),ClassName:node.ClassName,Path:String(node.Path||node.Name||'').slice(0,200)});for(const child of node.Children||[])walk(child);};walk(context.tree||context);
 const value:any={instances:entries,scripts:[],note:'Bounded Studio context. Source is included only when the request names that script.'};
 for(const s of context.scripts||[]){const name=String(s.Path||'').split('.').pop()||'';const named=name.length>2&&request.toLowerCase().includes(name.toLowerCase());const item=named&&!s.truncated?{Path:s.Path,Source:s.Source}:{Path:s.Path,sourceOmitted:true};value.scripts.push(item);if(JSON.stringify(value).length>maxChars){value.scripts.pop();value.note='Some context omitted to fit the model; ask for a named script or increase context for larger edits.';break;}}
 while(JSON.stringify(value).length>maxChars&&value.instances.length)value.instances.pop();return JSON.stringify(value);
}
