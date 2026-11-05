# Persistent local inference — 0.3.0

## Setup

Place the complete matching Vulkan build, including **llama-server.exe** and its DLLs, under `runtimes/llama.cpp`. `llama-cli.exe` alone is no longer sufficient for GGUF chat. Runtime Manager → Re-detect lists the runtime's actual `--list-devices` output. Select `Vulkan0 · AMD Radeon RX 6700M`, or apply the RX 6700M preset (8 threads, 4K context, auto GPU layers, 1024 MiB VRAM reserve and 1024 MiB RAM prompt cache). CPU and other explicitly enumerated devices can also be selected.

Send a GGUF message in AI Workspace. The first request starts one private, authenticated, loopback-only llama-server with one slot. Subsequent requests with the same model file and loading settings reuse it. Structured system/user/assistant messages preserve the common prefix; `cache_prompt` and slot 0 reuse KV context when possible. Switching conversations may replace slot context; cache reuse is reported from the server, never assumed.

Changes to model file, device, layer count, context, thread count, cache size or memory reserve restart the worker. Temperature and output budget do not reload it. Stop, model deletion, runtime configuration changes and storage relocation unload an idle model. Active requests reject conflicting operations. A cancelled generation retains the loaded model. A supervisor pipe ensures an app/backend exit also terminates its model worker; the server does not remain in VRAM after the app closes.

## GPU offload and logs

Automatic device choice prefers the enumerated RX 6700M, then recognizable discrete GPUs; it does not mistake the integrated Radeon's shared RAM for larger dedicated VRAM. A missing explicit device is an error. The selected ID is passed via `--device` with one-device splitting. Native `-ngl auto --fit on` and a 1024 MiB margin replace the old hardcoded 32-layer fallback. Unsupported old builds require updating or an explicit numeric layer count. Manual layer counts disable fit so a failed allocation is visible instead of silently changing the request.

The actual `offloaded N/M layers` loader message supplies the displayed counts and `last-server.log`; the requested setting `auto` is not a measurement. Some Windows builds require trace verbosity 4 to forward loader details. Debug verbosity 5 is unnecessary. Only whitelisted startup lines are persisted, before the server becomes ready; prompts, completions and keys are excluded. Missing layer diagnostics display unknown. The private server key is passed via environment, not command-line arguments, and cloud credentials are removed from the worker environment.

## Measurements

Workspace stores separate `metadata.localMetrics`: evaluated prompt tokens/time/tok/s, generated tokens/time/tok/s, cached tokens, first-token latency, load time, process reuse/PID and actual device/offload counts. Native `timings` values are preferred; no text-length token estimates or generation-rate calculations from total request time are used. Missing metrics remain unknown. Ollama rates use its own prompt/eval counts and nanosecond durations; its nonstreaming API currently cannot supply TTFT.

Runtime TTFT starts when the manager receives the request and includes probes and model loading when needed. `requestTtftMs` starts immediately before the generation HTTP request and excludes loading. Neither includes the renderer's session-save/database setup. First reasoning or text content counts as the first token. A cold *server* measurement does not flush Windows' filesystem cache. Prompt tok/s for a one-token cache suffix is not a whole-document throughput comparison.

Help probes are coalesced and cached for ten minutes, keyed by executable identity/size/mtime; failed probes expire after three seconds. Device lists cache for 30 seconds. Ollama checks cache for ten seconds and never run on the GGUF request path. Re-detect forces refresh. Native VRAM fit still uses current memory at each model load.

## Tests and repeatable benchmark

- `npm run test:local`: device selection, real-metric decoding, probe coalescing, supervisor cleanup after backend crash, cold/warm process reuse, cache telemetry, changed settings, cancellation and stop guards. A real subprocess serves fixture SSE; it is not a real GPU benchmark.
- `npm test`: isolated API/storage/permissions/relay regressions. Set `A_CENTER_TEST_MODEL` to a GGUF and put its matching llama-server on PATH to also test real Workspace JSON + SSE generation, same-process history reuse and cache hits. Optional GPU assertions use `A_CENTER_TEST_DEVICE` (default Vulkan0).
- `npm run bench:local -- --model "D:/path/model.gguf" --runtime "D:/ACenter/A-Center/runtimes/llama.cpp" --device Vulkan0 --out report.json`: three real requests (cold server, identical warm prompt, conversation continuation). It checks process reuse and real cache counters, without unreliable fixed speed thresholds. No model downloads occur and no generated text is saved.

Measured on this RX 6700M laptop on 2026-11-05 (short fixed benchmark, temperature 0, 4K context, 8 threads):

| GGUF | Actual offload | First request TTFT | Repeated-prompt TTFT | Warm generation | Cached prompt tokens |
| --- | --- | --- | --- | --- | --- |
| SmolLM2 1.7B Q4_K_M | 25/25, Vulkan0 | 3996 ms | 22 ms | 133.2 tok/s | 1711 |
| Nemotron 3.5 Bolt E4B Q4_K_M, 6.18 GB | 43/43, Vulkan0 | 8907 ms | 106 ms | 54.8 tok/s | 1632 |

The conversation continuations also reused the process/cache; TTFT was 74 ms and 226 ms respectively in the final run. Earlier runs had substantially higher cold and continuation latency, illustrating effects of file/cache, power and thermal state. These are not guarantees. The previously present Luau 24B file was no longer available when its benchmark was attempted, so no Luau result is claimed.

Primary server contract: [llama.cpp server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server), plus the locally installed binary's `--help` and actual runtime responses.
