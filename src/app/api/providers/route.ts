import { NextRequest, NextResponse } from "next/server";
import { aiManager, isProviderId } from "@/lib/ai/manager";
import { PROVIDERS, redact } from "@/lib/ai/provider";
import { cachedModels, providerConfig, usageHistory, writeValue, invalidateModelDetails, trackUsage } from "@/lib/ai/store";
import { ProviderError } from "@/lib/ai/types";
import { storageBusy } from "@/lib/maintenance";
export const dynamic="force-dynamic";
export async function GET() {
  const keys=await aiManager.keys.status();
  const providers=await Promise.all((Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]).map(async id=>({id,...PROVIDERS[id],config:await providerConfig(id),catalog:await cachedModels(id),keyConfigured:keys[id],keySource:keys.source[id],health:await import("@/lib/ai/store").then(s=>s.readValue(`ai.health.${id}`,null))})));
  return NextResponse.json({providers,secureStorageAvailable:keys.available,usage:await usageHistory()},{headers:{"cache-control":"no-store"}});
}
export async function POST(req:NextRequest) {
  if(storageBusy())return NextResponse.json({error:"Storage relocation in progress"},{status:409});
  const b=await req.json().catch(()=>({}));if(!isProviderId(b.provider))return NextResponse.json({error:"Unknown provider"},{status:400});
  const id=b.provider;
  try {
    if(b.action==="save-key") {if(typeof b.key!=="string")throw new ProviderError("API key required","invalid_request",400);await aiManager.keys.save(id,b.key);await invalidateModelDetails(id);await writeValue(`ai.catalog.${id}`,{at:0,models:[]});await writeValue(`ai.health.${id}`,{status:"key_changed_test_required"});return NextResponse.json({ok:true});}
    if(b.action==="delete-key") {await aiManager.keys.delete(id);await invalidateModelDetails(id);await writeValue(`ai.catalog.${id}`,{at:0,models:[]});await writeValue(`ai.health.${id}`,{status:"key_deleted"});return NextResponse.json({ok:true});}
    if(b.action==="config") {const old=await providerConfig(id);await writeValue(`ai.provider.${id}`,{enabled:typeof b.enabled==="boolean"?b.enabled:old.enabled,defaultModel:typeof b.defaultModel==="string"?b.defaultModel:old.defaultModel,mode:id==="evren"&&b.mode==="responses"?"responses":"chat"});return NextResponse.json({ok:true});}
    const client=await aiManager.client(id);
    if(b.action==="terms") {if(id!=="evren")throw new ProviderError("Terms API unavailable","unsupported",400);return NextResponse.json({status:await client.json("/terms/status"),text:await client.json("/terms/text")});}
    if(b.action==="accept-terms") {if(id!=="evren"||b.confirm!==true||!Number.isInteger(b.version))throw new ProviderError("Explicit acceptance and exact terms version required","consent_required",400);const current=await client.json("/terms/status");if(current.current_version!==b.version)throw new ProviderError("Terms changed. Read the new version.","terms_changed",409);return NextResponse.json(await client.json("/terms/accept",{version:b.version}));}
    if(b.action==="quota") {return NextResponse.json(id==="evren"?{quota:await client.json(`/quota${b.model?`?model=${encodeURIComponent(b.model)}`:""}`)}:{quota:null,note:"NVIDIA account quota API is not documented for this integration. Only observed usage is available.",usage:await usageHistory(id)});}
    if(b.action==="model") {if(typeof b.model!=="string")throw new ProviderError("Model required","invalid_request",400);return NextResponse.json({model:await aiManager.resolve(id,b.model)});}
    if(b.action==="input-tokens") {if(id!=="evren")throw new ProviderError("Token-count API not available","unsupported",400);return NextResponse.json(await client.json("/responses/input_tokens",{model:b.model,input:b.input}));}
    if(b.action==="refresh"||b.action==="test") {
      let terms;
      if(id==="evren"){terms=await client.json("/terms/status");if(terms.accepted!==true)return NextResponse.json({termsRequired:true,status:terms,text:await client.json("/terms/text")});}
      const models=await aiManager.catalog(id,true);const health={status:"catalog_connected",at:new Date().toISOString(),generationVerified:false};await writeValue(`ai.health.${id}`,health);
      if(b.action==="test") {
        const config=await providerConfig(id);
        if(!config.defaultModel)return NextResponse.json({models,health,note:"Katalog alındı. Kimlik doğrulamalı üretimi test etmek için varsayılan modeli seçip testi yeniden çalıştır."});
        const model=id==="evren"?await client.model(config.defaultModel):models.find(m=>m.id===config.defaultModel);
        if(!model)throw new ProviderError("Default model not found","model_not_found",404);
        if(id==="evren"&&!["chat","vision_chat"].includes(model.task))throw new ProviderError("Choose a chat model for the connection test","unsupported_task",400);
        let output="",reasoning=false,finish="";let usage;
        for await(const event of client.generate({model,messages:[{role:"user",content:"Reply briefly with OK."}],mode:config.mode,maxTokens:Math.min(64,model.capabilities.maxOutput||64),thinking:model.capabilities.thinking?false:undefined,signal:req.signal})){
          if(event.type==="text")output+=event.text||"";
          if(event.type==="reasoning"&&event.text)reasoning=true;
          if(event.type==="finish")finish=event.reason||"";
          if(event.type==="usage")usage=event.usage;
        }
        if(!finish||(!output.trim()&&!reasoning))throw new ProviderError("Provider returned no generated content","empty_response",502);
        if(usage)await trackUsage(id,model.id,usage,crypto.randomUUID());
        const verified={status:"generation_verified",at:new Date().toISOString(),generationVerified:true,model:model.id};await writeValue(`ai.health.${id}`,verified);
        return NextResponse.json({models,health:verified,note:`Gerçek model yanıtı alındı: ${model.id} (${config.mode}). ${config.enabled?"Workspace’te kullan düğmesiyle sohbeti açabilirsin.":"Sağlayıcı şu anda kapalı; sohbet için Workspace’te kullan düğmesine bas."}`,probe:{output:output.slice(0,500),reasoningReturned:reasoning,finishReason:finish,usage:usage||null}});
      }
      return NextResponse.json({models,health,terms,note:id==="nvidia"?"Public catalog retrieved. Account/model generation access is verified only by a successful chat request.":"Authenticated catalog retrieved; no generation test performed."});
    }
    throw new ProviderError("Unknown action","invalid_request",400);
  } catch(error) {
    const e=error instanceof ProviderError?error:new ProviderError("Provider operation failed","internal_error");
    await writeValue(`ai.health.${id}`,{status:"error",at:new Date().toISOString(),code:e.code});
    return NextResponse.json({error:redact(e.message),code:e.code,retryAfter:e.retryAfter},{status:e.status===499?400:e.status,headers:e.retryAfter!==undefined?{"retry-after":String(e.retryAfter)}:{}});
  }
}
