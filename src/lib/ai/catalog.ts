import type { Capabilities, ModelInfo, ProviderId } from "./types";
// Verified model-specific contracts; never infer optional features from model names.
const nvidiaProfiles: Record<string, Capabilities> = {
  "moonshotai/kimi-k2.6": { tools: true, reasoning: true, thinking: true, vision: true, streaming: true, reasoningStyle: "thinking", maxOutput: 65536, parameters: ["temperature", "max_tokens", "stream_options"], source: "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k2-6-infer" },
  "moonshotai/kimi-k3": { tools: true, reasoning: true, vision: true, streaming: true, reasoningStyle: "effort", parameters: ["max_tokens", "stream_options"], source: "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3-infer" },
  "nvidia/nemotron-3.5-super-vl-120b-a12b": { tools: true, reasoning: true, thinking: true, vision: true, streaming: true, reasoningStyle: "effort", effortValues: ["none", "low", "high"], maxOutput: 131072, parameters: ["temperature", "max_tokens", "stream_options"], source: "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3_5-super-vl-120b-a12b-infer" },
};
export const NVIDIA_VERIFIED_MODEL_IDS = Object.keys(nvidiaProfiles);
export const EVREN_STARTER_IDS = ["glm-5.3", "deepseek-v4.1-flash", "mimo-v2.6-pro", "qwen3.8-flash-next", "gemma-4-31b", "qwen3-vl-30b", "auto"];
export function normalizeModel(provider: ProviderId, raw: Record<string, any>): ModelInfo {
  const c = raw.capabilities || {};
  const capabilities: Capabilities = provider === "evren" ? {
    tools: c.tools === true, reasoning: c.thinking === true || c.reasoning_effort === true, thinking: c.thinking === true, vision: c.vision === true,
    streaming: true, reasoningStyle: "thinking", effortValues: c.reasoning_effort_values || undefined,
    parameters: ["temperature", "max_tokens", ...(c.thinking ? ["thinking"] : []), ...(c.reasoning_effort ? ["reasoning_effort"] : [])],
    contextLength: raw.context_length ?? undefined, maxOutput: raw.max_output_tokens ?? undefined, maxImages: c.max_images_per_request ?? undefined,
    source: "https://evren-llmapi.ssyz.org.tr/openapi.json",
  } : nvidiaProfiles[raw.id] || { source: "https://integrate.api.nvidia.com/v1/models" };
  return { id: raw.id, provider, owner: raw.owned_by || provider, task: raw.task || "unknown", modalities: raw.modalities || [], capabilities, raw };
}
