import { EvrenProvider, NvidiaBuildProvider } from "./provider";
import { APIKeyManager } from "./keys";
import { cachedModels, providerConfig, readValue, writeValue } from "./store";
import { ModelInfo, ProviderError, ProviderId } from "./types";
export const isProviderId = (value: unknown): value is ProviderId => value === "evren" || value === "nvidia";
export class AIProviderManager {
  keys = new APIKeyManager();
  async client(id:ProviderId) { const key=await this.keys.get(id); return id==="evren" ? new EvrenProvider(key) : new NvidiaBuildProvider(key); }
  async catalog(id:ProviderId, refresh=false) {
    const cached=await cachedModels(id); if(!refresh && Date.now()-cached.at<15*60*1000 && cached.models.length)return cached.models;
    const client=await this.client(id); const models=await client.models(); await writeValue(`ai.catalog.${id}`,{at:Date.now(),models}); return models;
  }
  async resolve(id:ProviderId, model:string):Promise<ModelInfo> {
    const config=await providerConfig(id);if(!config.enabled)throw new ProviderError("Provider is disabled", "provider_disabled",400);
    if(model==="@default")model=config.defaultModel;
    if(!model)throw new ProviderError("Select a default model in API Providers","model_required",400);
    const client=await this.client(id);
    if(id==="evren") {
      const terms=await client.json("/terms/status"); if(terms.accepted!==true)throw new ProviderError("Read and accept the current EVREN terms in API Providers", "terms_not_accepted",403);
      const detail=await readValue<{at:number;info?:ModelInfo}>(`ai.model.${id}.${model}`,{at:0});let info=detail.info;
      if(!info || Date.now()-detail.at>15*60*1000){info=await client.model(model);await writeValue(`ai.model.${id}.${model}`,{at:Date.now(),info});const cache=await cachedModels(id);const models=cache.models.filter(m=>m.id!==model);models.push(info);await writeValue(`ai.catalog.${id}`,{at:cache.at,models});}
      if(!["chat","vision_chat"].includes(info.task))throw new ProviderError("This model is not a chat model", "unsupported_task",400);
      return info;
    }
    const info=(await this.catalog(id)).find(m=>m.id===model); if(!info)throw new ProviderError("Model not found in the provider catalog", "model_not_found",404); return info;
  }
}
export const aiManager=new AIProviderManager();
