export type ProviderId = "evren" | "nvidia";
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null | { type: string; text?: string; image_url?: { url: string } }[]; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?: string };
export type Capabilities = { tools?: boolean; reasoning?: boolean; thinking?: boolean; vision?: boolean; streaming?: boolean; effortValues?: string[]; parameters?: string[]; contextLength?: number; maxOutput?: number; maxImages?: number; source: string; reasoningStyle?: "thinking" | "enable_thinking" | "effort" };
export type ModelInfo = { id: string; provider: ProviderId; owner: string; task: string; modalities: string[]; capabilities: Capabilities; raw?: Record<string, unknown> };
export type ProviderConfig = { enabled: boolean; defaultModel: string; mode: "chat" | "responses" };
export type Usage = Record<string, unknown>;
export type AIEvent = { type: "status" | "text" | "reasoning" | "tool" | "usage" | "finish" | "response_id"; text?: string; status?: string; call?: ToolCall; usage?: Usage; reason?: string; id?: string };
export type GenerateInput = { model: ModelInfo; messages: ChatMessage[]; fullMessages?: ChatMessage[]; tools?: object[]; maxTokens: number; temperature?: number; thinking?: boolean; effort?: string; mode?: "chat" | "responses"; previousResponseId?: string; signal: AbortSignal };
export class ProviderError extends Error {
  constructor(message: string, public code = "provider_error", public status = 502, public retryAfter?: number) { super(message); this.name = "ProviderError"; }
}
