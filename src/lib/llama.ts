import {llamaServer,LlamaOptions} from './llama-server';
export {probeLlama,llamaCandidates,llamaDevices} from './llama-probe';
export {runBinary} from './binary';
export {llamaServer};
export function isGenerating(){return llamaServer.isGenerating();}
export function generateLlama(runtimeDir:string,model:string,prompt:string,system:string,options:LlamaOptions={}){
 return llamaServer.generate(runtimeDir,model,[...(system?[{role:'system' as const,content:system}]:[]),{role:'user',content:prompt}],options);
}
