import { AIEvent, ChatMessage, GenerateInput, ModelInfo, ProviderError, ProviderId, ToolCall } from "./types";
import { normalizeModel, NVIDIA_VERIFIED_MODEL_IDS } from "./catalog";
import { parseSSE } from "./sse";

export const PROVIDERS = {
  evren: { name: "EVREN", baseURL: "https://evren-llmapi.ssyz.org.tr/v1" },
  nvidia: { name: "NVIDIA Build / NIM", baseURL: "https://integrate.api.nvidia.com/v1" },
} as const;
export function redact(text: string, key = ""): string {
  return (key ? text.split(key).join("[REDACTED]") : text).replace(/(?:Bearer\s+)[^\s"<>]+/gi, "Bearer [REDACTED]").replace(/(?:nvapi-|evren_llm_)[A-Za-z0-9_-]+/g, "[REDACTED]");
}
function retrySeconds(header: string | null) { if (!header) return undefined; const n = Number(header); return Number.isFinite(n) ? Math.max(0, n) : Math.max(0, Math.ceil((Date.parse(header) - Date.now()) / 1000)); }
function delay(ms: number, signal: AbortSignal) { return new Promise<void>((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(new ProviderError("Request cancelled", "cancelled", 499)); }; const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms); if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); }); }
export function responseInput(messages: ChatMessage[]) {
  return messages.flatMap((m): object[] => {
    if (m.role === "tool") return [{ type: "function_call_output", call_id: m.tool_call_id, output: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }];
    const items: object[] = [];
    if (m.content) items.push({ role: m.role, content: Array.isArray(m.content) ? m.content.map(p => p.type === "image_url" ? { type: "input_image", image_url: p.image_url?.url } : { type: "input_text", text: p.text }) : m.content });
    for (const call of m.tool_calls || []) items.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    return items;
  });
}
export class OpenAICompatibleProvider {
  constructor(public id: ProviderId, private key: string, private baseURL: string = PROVIDERS[id].baseURL) {}
  async request(endpoint: string, options: { body?: object; signal?: AbortSignal; method?: string } = {}) {
    const signal = AbortSignal.any([options.signal || new AbortController().signal, AbortSignal.timeout(300000)]);
    const requestId = crypto.randomUUID();
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try { response = await fetch(this.baseURL + endpoint, { method: options.method || (options.body ? "POST" : "GET"), headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json", ...(this.id === "evren" ? { "Idempotency-Key": requestId } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined, signal, redirect: "error", cache:"no-store" }); }
      catch (error) { throw new ProviderError(signal.aborted ? (options.signal?.aborted ? "Request cancelled" : "Provider timeout") : "Provider network connection failed", signal.aborted ? (options.signal?.aborted ? "cancelled" : "timeout") : "network_error", signal.aborted ? 504 : 502); }
      if (response.ok && response.status !== 202) return response;
      const retryAfter = retrySeconds(response.headers.get("retry-after"));
      if (response.status === 503 && attempt < 2 && (retryAfter ?? 1) <= 10) { await response.body?.cancel(); await delay((retryAfter ?? (attempt + 1)) * 1000, signal); continue; }
      let data: any = {}; try { data = await response.json(); } catch {}
      const e = data.error || data;
      const code = typeof e.code === "string" ? e.code : ({401:"invalid_api_key",403:"access_denied",404:"model_not_found",429:"rate_limit",503:"capacity_full",202:"async_pending",400:"unsupported_parameter",422:"invalid_request"} as Record<number,string>)[response.status] || "provider_error";
      throw new ProviderError(redact(typeof e.message === "string" ? e.message : `Provider returned HTTP ${response.status}`, this.key).slice(0,1200), code, response.status>=400?response.status:502, retryAfter);
    }
  }
  async json(endpoint: string, body?: object, signal?: AbortSignal) { return (await this.request(endpoint, { body, signal: signal || AbortSignal.timeout(20000) })).json(); }
  async models(): Promise<ModelInfo[]> { const result = await this.json("/models"); if (!Array.isArray(result.data)) throw new ProviderError("Invalid model catalog", "invalid_catalog"); return result.data.filter((x: any) => typeof x.id === "string").map((x: any) => normalizeModel(this.id, x)); }
  async model(id: string): Promise<ModelInfo> { return normalizeModel(this.id, await this.json(`/models/${encodeURIComponent(id)}`)); }
  buildBody(input: GenerateInput) {
    const c = input.model.capabilities;
    if (input.tools?.length && c.tools !== true) throw new ProviderError("Model tool calling support is not verified", "unsupported_tools", 400);
    if (input.messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === "image_url")) && c.vision !== true) throw new ProviderError("Model vision support is not verified", "unsupported_vision", 400);
    const body: Record<string, any> = { model: input.model.id, stream: c.streaming === true };
    const max = Math.max(1, Math.floor(input.maxTokens));
    if (c.maxOutput && max > c.maxOutput) throw new ProviderError(`Output budget exceeds model limit (${c.maxOutput})`, "token_budget", 400);
    if (input.mode === "responses") { body.input = responseInput(input.messages.filter(m => m.role !== "system")); body.instructions = input.messages.filter(m => m.role === "system").map(m=>m.content).join("\n"); body.max_output_tokens = max; if (input.previousResponseId) body.previous_response_id = input.previousResponseId; }
    else { body.messages = input.messages; body.max_tokens = max; }
    if (c.parameters?.includes("temperature") && input.temperature !== undefined) body.temperature = input.temperature;
    if (body.stream && c.parameters?.includes("stream_options") && input.mode !== "responses") body.stream_options = { include_usage: true };
    if (input.tools?.length) body.tools = input.mode === "responses" ? input.tools.map((t:any)=>({type:"function",...t.function})) : input.tools;
    if (input.thinking !== undefined && c.thinking) {
      if (this.id === "evren") body.thinking = input.thinking;
      else if (c.reasoningStyle === "thinking") body.chat_template_kwargs = { thinking: input.thinking };
      else if (c.reasoningStyle === "enable_thinking") body.chat_template_kwargs = { enable_thinking: input.thinking };
      else if (c.reasoningStyle === "effort") body.reasoning_effort = input.thinking ? (input.effort || "high") : "none";
    }
    if (input.effort && input.thinking !== false) {
      if (!(c.parameters?.includes("reasoning_effort") || c.reasoningStyle === "effort")) throw new ProviderError("Reasoning effort unsupported", "unsupported_parameter", 400);
      if (c.effortValues && !c.effortValues.includes(input.effort)) throw new ProviderError("Reasoning effort is not in the verified model values", "unsupported_parameter", 400);
      if (!/^[a-z0-9_-]{1,32}$/i.test(input.effort)) throw new ProviderError("Invalid reasoning effort value", "unsupported_parameter", 400);
      if (input.mode === "responses") body.reasoning = { effort: input.effort }; else body.reasoning_effort = input.effort;
    }
    return body;
  }
  async *generate(input: GenerateInput): AsyncGenerator<AIEvent> {
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(300000)]);
    const mode = input.mode === "responses" && this.id === "evren" ? "responses" : "chat";
    const body = this.buildBody({ ...input, mode });
    let response: Response;
    try { response = await this.request(mode === "responses" ? "/responses" : "/chat/completions", { body, signal }); }
    catch (error) {
      // Only an explicitly rejected expired chain is replayed, before any output/tools.
      if (mode === "responses" && body.previous_response_id && error instanceof ProviderError && (error.status === 404 || /previous_response|response_expired/.test(error.code))) { delete body.previous_response_id; body.input = responseInput((input.fullMessages || input.messages).filter(m=>m.role!=="system")); response = await this.request("/responses", { body, signal: input.signal }); }
      else throw error;
    }
    yield { type: "status", status: "connected" };
    if (!body.stream) {
      const data = await response.json(); const m = data.choices?.[0]?.message;
      if (!m) throw new ProviderError("Provider returned no message", "invalid_response");
      if (m.reasoning_content || m.reasoning) yield { type: "reasoning", text: m.reasoning_content || m.reasoning };
      if (m.content) yield { type: "text", text: m.content };
      for (const call of m.tool_calls || []) yield { type: "tool", call };
      if (data.usage) yield { type: "usage", usage: data.usage };
      yield { type: "finish", reason: data.choices[0].finish_reason }; return;
    }
    if (!response.body) throw new ProviderError("Empty stream", "invalid_stream");
    const calls = new Map<string,ToolCall>(); let ended = false; let textEmitted=false;
    for await (const frame of parseSSE(response.body, signal)) {
      if (frame.data === "[DONE]") { ended = true; break; }
      let data: any; try { data = JSON.parse(frame.data); } catch { throw new ProviderError("Malformed provider event", "invalid_stream"); }
      if (data.error || data.type === "error" || data.type === "response.failed") throw new ProviderError(redact(data.error?.message || data.response?.error?.message || "Provider stream failed", this.key), data.error?.code || "stream_error");
      if (mode === "responses") {
        const type = data.type || frame.event;
        if (type === "response.output_text.delta") {textEmitted=true;yield { type: "text", text: data.delta };}
        if (/reasoning.*\.delta$/.test(type)) yield { type: "reasoning", text: data.delta };
        if (type === "response.output_item.added" && data.item?.type === "function_call") calls.set(data.item.id, { id: data.item.call_id, type: "function", function: { name: data.item.name, arguments: data.item.arguments || "" } });
        if (type === "response.function_call_arguments.delta") { const c = calls.get(data.item_id); if (!c) throw new ProviderError("Tool arguments arrived without a tool call", "invalid_tool_call"); c.function.arguments += data.delta; }
        if (type === "response.function_call_arguments.done" && calls.has(data.item_id)) calls.get(data.item_id)!.function.arguments=data.arguments;
        if (type === "response.output_item.done" && data.item?.type === "function_call") calls.set(data.item.id,{id:data.item.call_id,type:"function",function:{name:data.item.name,arguments:data.item.arguments||""}});
        if (["response.completed","response.incomplete"].includes(type)) {
          for(const item of data.response?.output||[]) {
            if(item.type==="function_call")calls.set(item.id||item.call_id,{id:item.call_id,type:"function",function:{name:item.name,arguments:item.arguments||""}});
            if(!textEmitted&&item.type==="message")for(const part of item.content||[])if(part.type==="output_text")yield{type:"text",text:part.text};
          }
          for (const c of calls.values()) yield { type: "tool", call: c };
          if (data.response?.usage) yield { type: "usage", usage: data.response.usage };
          if (type === "response.completed" && data.response?.id) yield { type: "response_id", id: data.response.id };
          yield { type: "finish", reason: type === "response.completed" ? (calls.size ? "tool_calls" : "stop") : data.response?.incomplete_details?.reason || "length" }; ended = true; break;
        }
      } else {
        const choice = data.choices?.[0]; const delta = choice?.delta;
        if (delta?.content) yield { type: "text", text: delta.content };
        if (delta?.reasoning_content || delta?.reasoning) yield { type: "reasoning", text: delta.reasoning_content || delta.reasoning };
        for (const c of delta?.tool_calls || []) { const index = String(c.index ?? 0); const old = calls.get(index) || { id: "", type: "function", function: { name: "", arguments: "" } }; old.id = c.id || old.id; old.function.name += c.function?.name || ""; old.function.arguments += c.function?.arguments || ""; if (old.function.arguments.length > 256000) throw new ProviderError("Tool arguments too large", "invalid_tool_call"); calls.set(index, old); }
        if (choice?.finish_reason) { for (const c of calls.values()) yield { type: "tool", call: c }; calls.clear(); yield { type: "finish", reason: choice.finish_reason }; }
        if (data.usage) yield { type: "usage", usage: data.usage };
      }
    }
    if (!ended) throw new ProviderError("Provider stream disconnected before completion", "stream_interrupted");
  }
}
export class EvrenProvider extends OpenAICompatibleProvider { constructor(key:string) { super("evren",key); } }
export class NvidiaBuildProvider extends OpenAICompatibleProvider {
  constructor(key:string) { super("nvidia",key); }
  async models() {
    try{return await super.models();}
    catch(error){if(error instanceof ProviderError&&[404,405].includes(error.status))return NVIDIA_VERIFIED_MODEL_IDS.map(id=>normalizeModel("nvidia",{id,owned_by:id.split("/")[0],catalog_source:"verified_official_contract_fallback",account_access:"unverified"}));throw error;}
  }
}
