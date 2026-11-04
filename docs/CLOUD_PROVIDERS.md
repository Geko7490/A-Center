# EVREN and NVIDIA integration (0.2.0)

## Setup and use

1. Open API Providers in the installed desktop app. Enter a key, save it, and enable the provider. API keys are never returned to the renderer after saving.
2. For EVREN, read the current terms and explicitly accept the exact displayed version. No background process accepts terms.
3. Refresh models, choose a default, and inspect capabilities in Model Center. Then press Test Connection: with a default model selected, it makes a small authenticated generation request and records actual usage. Without a default it reports only catalog connectivity. Public NVIDIA catalog access does not prove account-specific generation access; a successful inference is needed for that.
4. In AI Workspace, select a provider/model. A conversation retains its history when models change. Cloud messages, images and approved tool results leave the computer and go to the selected provider. Local GGUF/Ollama inference remains available.
5. For agent tools, select Agent mode and an authorized project. Tool-capable models propose actions. Inspect the full arguments, then approve or reject each action. Read-only/protected-file rules are rechecked at execution. Project terminal permission must also be enabled for commands/tests. Continue the agent with the actual results. Task Manager can open a plan in this agent flow; a model answer does not automatically verify checklist steps.

## Architecture and guarantees

- `src/lib/ai/provider.ts`: shared OpenAI-compatible transport and model-specific request construction. EVREN and NVIDIA use separate subclasses and fixed upstream URLs. No arbitrary browser-supplied API base URL receives stored credentials.
- `catalog.ts`: EVREN capabilities come from its live registry/detail endpoint. NVIDIA's generic model list lacks capability information, so only explicitly documented profiles enable optional tools/reasoning/vision. Other optional capabilities remain unknown. A documented-ID fallback is used only when the NVIDIA catalog endpoint explicitly returns 404/405.
- `sse.ts`: true UTF-8 SSE decoding, comments/keep-alives, CRLF and fragmented events, idle timeout, abort and interrupted-stream detection. Chat and Responses event formats are separate. No artificial typing animation or invented reasoning text.
- `chat.ts`: durable messages, separate reasoning, actual API usage, finish reason, tool proposals and Responses IDs. Expired Responses chains retry once with full history before output. Changing provider/model converts incompatible tool history into text summaries. History is not silently discarded; oversized requests are rejected.
- `keys.ts` and `desktop/credentials.cjs`: keys are encrypted with Electron safeStorage in the main process (DPAPI on Windows). A random-token, loopback-only credential bridge provides server access. No plaintext fallback. Linux basic_text storage is rejected. Development may supply EVREN_API_KEY / EVREN_LLM_API_KEY or NVIDIA_API_KEY through process environment. Do not put keys in source control.
- Tool calls are proposals and execution is a separate explicit action. Each proposal pins its project and atomically claims execution once. Completed/rejected/failed/executing calls cannot be replayed by repeating an approval. A crashed `executing` action stays unresolved for manual inspection, rather than being rerun automatically.
- Terminal commands have OS account permissions, not an OS sandbox. Workspace paths, project terminal opt-in, the existing dangerous-command gate and an explicit user approval apply. File writes reuse project approvals, protected-file checks and backup/history handling.
- Usage records store provider-reported `usage` objects, including cache/reasoning details when returned. Missing metrics are unknown, not estimated token counters. EVREN quota is read from `/quota`; no NVIDIA account-quota endpoint or fixed credit amount is invented. HTTP 429 preserves Retry-After; only rejected HTTP 503 requests have bounded retries. Interrupted generation or tool side effects are not automatically replayed.

## Contract sources checked during implementation

- EVREN live OpenAPI: https://evren-llmapi.ssyz.org.tr/openapi.json (retrieved successfully on 2026-11-04). It describes ModelCapabilities, ModelInfo, Responses, token counting, TermsStatus/TermsAcceptRequest and QuotaStatus.
- NVIDIA live catalog: https://integrate.api.nvidia.com/v1/models (anonymous request returned 200; this is not an account-access test).
- NVIDIA Kimi K2.6: https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k2-6-infer
- NVIDIA Kimi K3: https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3-infer
- NVIDIA Nemotron 3.5 Super VL: https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3_5-super-vl-120b-a12b-infer

## Validation and limits

`npm run test:ai` uses a clearly isolated mock HTTP upstream and a real temporary PGlite/project filesystem. It covers catalogs, capability filtering, reasoning/text/tool SSE, usage, Responses expiry, quota/terms gates, 429/503 handling, cancellation, idle timeout, real approved file edits, duplicate-approval rejection and a multi-turn agent loop. These tests do not prove a live provider account can generate.

`npm run test:credentials` runs Electron with no window and tests actual OS encryption, save/read/delete and unauthorized bridge access rejection. If OS encryption is unavailable, it verifies refusal and reports a skip rather than claiming encrypted storage passed.

`npm run test:ui` uses an isolated headless browser and fixture catalog. It checks provider cards, filtering and provider/local model switching without losing the conversation. Set A_CENTER_BROWSER to an installed Chromium browser executable outside Windows/Edge environments.

`npm test` runs existing local API/storage/download/permission regressions. Optional real GGUF validation requires A_CENTER_TEST_MODEL and a matching llama-cli on PATH.

No EVREN/NVIDIA API key was available during implementation. Authenticated live generation, live reasoning/tool calling and account-specific quotas remain to be verified by entering keys in the installed app. EVREN's unauthenticated `/models` correctly returned 401; its schema and NVIDIA's public catalog were checked live. A locally unavailable GGUF cannot be replaced by a mock and called a live model test.

Provider generation stops after a tool-proposal round for explicit user review. Continue resumes with real results; tools never run invisibly. Long-running interrupted tool actions require manual inspection. NVIDIA asynchronous HTTP 202 is reported as pending/unsupported rather than blindly resubmitting a potentially billable request. New model-specific optional parameters require a verified profile or provider metadata.
