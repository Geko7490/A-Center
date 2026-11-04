import { ProviderError, ProviderId } from "./types";
async function bridge(action: string, provider?: ProviderId, key?: string) {
  const url = process.env.VEX_CREDENTIAL_URL; const token = process.env.VEX_CREDENTIAL_TOKEN;
  if (!url || !token) throw new ProviderError("Secure API key storage is available in the desktop app. Development can use EVREN_API_KEY or NVIDIA_API_KEY environment variables.", "credential_store_unavailable", 400);
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" || parsed.protocol !== "http:") throw new ProviderError("Invalid credential bridge", "credential_store_unavailable");
  const result = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-credential-token": token }, body: JSON.stringify({ action, provider, key }), signal: AbortSignal.timeout(5000), redirect: "error" });
  if (!result.ok) throw new ProviderError("OS credential operation failed. No plaintext fallback was used.", "credential_store_error", 400);
  return result.json();
}
export class APIKeyManager {
  async get(provider: ProviderId) { const env = provider === "evren" ? process.env.EVREN_API_KEY || process.env.EVREN_LLM_API_KEY : process.env.NVIDIA_API_KEY; if (env) return env; const value = await bridge("get", provider); if (!value.key) throw new ProviderError("Add an API key in API Providers", "missing_api_key", 401); return String(value.key); }
  async save(provider: ProviderId, key: string) { await bridge("set", provider, key); }
  async delete(provider: ProviderId) { await bridge("delete", provider); }
  async status() {
    let status = { available: false, evren: false, nvidia: false }; if (process.env.VEX_CREDENTIAL_URL) status = await bridge("status");
    return { ...status, evren: status.evren || !!(process.env.EVREN_API_KEY || process.env.EVREN_LLM_API_KEY), nvidia: status.nvidia || !!process.env.NVIDIA_API_KEY, source: { evren: process.env.EVREN_API_KEY || process.env.EVREN_LLM_API_KEY ? "environment" : "os_encrypted", nvidia: process.env.NVIDIA_API_KEY ? "environment" : "os_encrypted" } };
  }
}
export async function redactKnownSecrets(text:string) {
  const manager=new APIKeyManager();
  for(const id of ["evren","nvidia"] as const){try{const key=await manager.get(id);if(key)text=text.split(key).join("[REDACTED]");}catch{}}
  return text.replace(/(?:nvapi-|evren_llm_)[A-Za-z0-9_-]+/g,"[REDACTED]");
}
