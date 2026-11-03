import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execSync, exec, execFile } from "node:child_process";
import { promisify } from "node:util";

export const STORAGE_ROOT =
  process.env.VEX_STORAGE || path.join(process.cwd(), ".vex-storage");
export const MODELS_DIR = path.join(STORAGE_ROOT, "models");
export const DOWNLOADS_DIR = path.join(STORAGE_ROOT, "downloads");
export const WORKSPACE_DIR = path.join(STORAGE_ROOT, "workspace");
export const BACKUPS_DIR = path.join(STORAGE_ROOT, "backups");
export const PLUGINS_DIR = path.join(STORAGE_ROOT, "plugins");
export const RUNTIMES_DIR = path.join(STORAGE_ROOT, "runtimes");

export function ensureDirs() {
  for (const d of [STORAGE_ROOT, MODELS_DIR, DOWNLOADS_DIR, WORKSPACE_DIR, BACKUPS_DIR, PLUGINS_DIR, RUNTIMES_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

export const QUANTIZATIONS = ["Q2_K", "Q3_K_M", "Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "F16"] as const;

export const FORMAT_RUNTIME_MATRIX: Record<string, string[]> = {
  GGUF: ["llama.cpp", "ollama"],
  Safetensors: ["transformers", "onnx"],
  ONNX: ["onnx"],
  Ollama: ["ollama"],
  PyTorch: ["transformers"],
};

export const RUNTIME_DEFS = [
  { name: "llama.cpp", displayName: "llama.cpp", desc: "High-performance GGUF inference (CPU + GPU offload)", formats: ["GGUF"], bin: "llama-cli" },
  { name: "ollama", displayName: "Ollama", desc: "Local model server with OpenAI-compatible API", formats: ["GGUF", "Ollama"], bin: "ollama" },
  { name: "onnx", displayName: "ONNX Runtime", desc: "Cross-platform ONNX graph execution", formats: ["ONNX", "Safetensors"], bin: "onnxruntime" },
  { name: "transformers", displayName: "Transformers", desc: "Python HuggingFace transformers backend", formats: ["Safetensors", "PyTorch"], bin: "python3" },
];

export type OllamaModelEntry = {
  name: string; repo: string; description: string; category: string;
  sizes: string[]; formats: string[]; pulls: string; updated: string;
};

export const OLLAMA_CATALOG: OllamaModelEntry[] = [
  { name: "llama3.2:3b", repo: "ollama/llama3.2", description: "Meta Llama 3.2 3B — fast general chat, ideal for utility tasks.", category: "chat", sizes: ["2.0GB", "4.9GB"], formats: ["GGUF", "Ollama"], pulls: "5.1M", updated: "recent" },
  { name: "llama3.1:8b", repo: "ollama/llama3.1", description: "Meta Llama 3.1 8B — strong all-round chat + reasoning.", category: "chat", sizes: ["4.7GB", "8.5GB"], formats: ["GGUF", "Ollama"], pulls: "8.4M", updated: "recent" },
  { name: "mistral:7b", repo: "ollama/mistral", description: "Mistral 7B — efficient instruction following and RAG.", category: "chat", sizes: ["4.1GB"], formats: ["GGUF", "Ollama"], pulls: "4.2M", updated: "recent" },
  { name: "codellama:13b", repo: "ollama/codellama", description: "Code Llama 13B — code completion, infilling and bug fixing.", category: "code", sizes: ["7.4GB", "13GB"], formats: ["GGUF", "Ollama"], pulls: "2.9M", updated: "recent" },
  { name: "deepseek-coder-v2:16b", repo: "ollama/deepseek-coder-v2", description: "DeepSeek Coder V2 — SOTA local coding, 236B MoE distilled.", category: "code", sizes: ["8.9GB", "16GB"], formats: ["GGUF", "Ollama"], pulls: "1.8M", updated: "recent" },
  { name: "qwen2.5-coder:7b", repo: "ollama/qwen2.5-coder", description: "Qwen 2.5 Coder 7B — excellent small coding model.", category: "code", sizes: ["4.7GB"], formats: ["GGUF", "Ollama"], pulls: "2.2M", updated: "recent" },
  { name: "phi3:mini", repo: "ollama/phi3", description: "Phi-3 Mini — tiny fast model for agents and tools.", category: "agent", sizes: ["2.3GB"], formats: ["GGUF", "Ollama"], pulls: "3.1M", updated: "recent" },
  { name: "llava:13b", repo: "ollama/llava", description: "LLaVA 13B — vision + language for UI and screenshot analysis.", category: "vision", sizes: ["8.0GB"], formats: ["GGUF", "Ollama"], pulls: "1.1M", updated: "recent" },
  { name: "nomic-embed-text", repo: "ollama/nomic-embed-text", description: "Nomic embeddings — project semantic search and RAG.", category: "embedding", sizes: ["274MB"], formats: ["GGUF", "Ollama"], pulls: "2.6M", updated: "recent" },
  { name: "starcoder2:15b", repo: "ollama/starcoder2", description: "StarCoder2 15B — multi-language code generation.", category: "code", sizes: ["9.1GB"], formats: ["GGUF", "Ollama"], pulls: "900K", updated: "recent" },
];

export const PLUGIN_CATALOG = [
  { key: "roblox-bridge", name: "Roblox Bridge", description: "Local WebSocket bridge + Luau plugin for Roblox Studio script editing, instance management and Output diagnostics.", version: "1.2.0", permissions: ["roblox:connect", "roblox:scripts:write", "roblox:instances:write"], changelog: "1.2.0: secure pairing\n1.1.0: Output streaming\n1.0.0: initial bridge" },
  { key: "github-connector", name: "GitHub Connector", description: "Native Git clone/commit/push/pull with branch management and credential-safe auth.", version: "1.1.0", permissions: ["git:clone", "git:commit", "git:push", "fs:workspace"], changelog: "1.1.0: branch UI\n1.0.0: initial connector" },
  { key: "vscode-connector", name: "VS Code Connector", description: "Open projects in VS Code, sync diagnostics and apply AI edits to open workspaces.", version: "1.0.4", permissions: ["fs:workspace", "terminal:exec"], changelog: "1.0.4: diagnostics sync" },
  { key: "blender-bridge", name: "Blender Bridge", description: "Drive Blender via background Python bridge: scene inspect, scripted mesh ops.", version: "0.9.2", permissions: ["terminal:exec", "fs:workspace"], changelog: "0.9.2: beta scene inspect" },
  { key: "terminal-tools", name: "Terminal Tools", description: "Permission-controlled shell with allowlists, dangerous-command gating and history.", version: "1.0.1", permissions: ["terminal:exec"], changelog: "1.0.1: audit log" },
  { key: "python-tools", name: "Python Tools", description: "Venv manager, pip installs and script runner for transformers/ONNX backends.", version: "1.0.0", permissions: ["terminal:exec", "fs:workspace"], changelog: "1.0.0: venv support" },
];

export function formatBytes(n: number): string {
  if (!n || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function safeJoin(base: string, ...parts: string[]): string {
  const resolved = path.resolve(base, ...parts);
  const baseResolved = path.resolve(base);
  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
    throw new Error("Path traversal blocked: target escapes authorized directory");
  }
  return resolved;
}

export function detectLanguage(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
    ".py": "Python", ".lua": "Luau", ".luau": "Luau", ".rs": "Rust", ".go": "Go",
    ".json": "JSON", ".md": "Markdown", ".html": "HTML", ".css": "CSS",
    ".cpp": "C++", ".c": "C", ".cs": "C#", ".java": "Java", ".toml": "TOML",
    ".yaml": "YAML", ".yml": "YAML", ".sql": "SQL", ".sh": "Shell", ".ps1": "PowerShell",
  };
  return map[ext] || "Unknown";
}

export function simpleDiff(oldText: string, newText: string): string {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const max = Math.max(a.length, b.length);
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const la = a[i];
    const lb = b[i];
    if (la === lb) {
      if (la !== undefined) out.push(`  ${la}`);
    } else {
      if (la !== undefined) out.push(`- ${la}`);
      if (lb !== undefined) out.push(`+ ${lb}`);
    }
    if (out.length > 400) { out.push("... (diff truncated)"); break; }
  }
  return out.join("\n");
}

export function execSafe(cmd: string, timeout = 8000): { ok: boolean; out: string } {
  try {
    const out = execSync(cmd, { timeout, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: process.platform === "win32" ? "powershell.exe" : "/bin/sh" });
    return { ok: true, out: String(out).slice(0, 4000) };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: String(err?.stdout || err?.stderr || err?.message || "failed").slice(0, 4000) };
  }
}

export function getHardwareSnapshot() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const load = os.loadavg();
  const cpuModel = cpus[0]?.model || "Unknown CPU";
  const cores = cpus.length;
  let cpuUsage = 0;
  try {
    const [a1, b1] = [cpus, os.loadavg()];
    void a1; void b1;
    cpuUsage = Math.min(99, Math.round((load[0] / Math.max(1, cores)) * 100));
  } catch { cpuUsage = 0; }
  const nvidia = execSafe("nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv,noheader 2>&1");
  const rocm = execSafe("rocm-smi --showproductname --showmeminfo vram --showuse 2>&1");
  const vulkan = execSafe("vulkaninfo --summary 2>&1 | head -n 40");
  let diskTotal = 0, diskFree = 0;
  try {
    if (process.platform !== "win32") {
      const df = execSync("df -k . | tail -n 1", { encoding: "utf8" });
      const parts = df.trim().split(/\s+/);
      diskTotal = Number(parts[1]) * 1024 || 0;
      diskFree = Number(parts[3]) * 1024 || 0;
    } else {
      diskTotal = 512 * 1024 ** 3; diskFree = 128 * 1024 ** 3;
    }
  } catch { /* ignore */ }
  const gpus: { name: string; backend: string; vramTotal: number; vramUsed: number; util: number }[] = [];
  if (nvidia.ok && !nvidia.out.toLowerCase().includes("not found") && !nvidia.out.toLowerCase().includes("failed")) {
    const line = nvidia.out.trim().split("\n")[0] || "";
    const [name, total, used, util] = line.split(",").map((s) => s.trim());
    const parseMiB = (s: string) => { const m = s.match(/([\d.]+)/); return m ? Number(m[1]) * 1024 * 1024 : 0; };
    gpus.push({ name: name || "NVIDIA GPU", backend: "CUDA", vramTotal: parseMiB(total || ""), vramUsed: parseMiB(used || ""), util: Number(String(util).replace(/\D/g, "")) || 0 });
  }
  const hasAmdHint = /amd|radeon/i.test(cpuModel + " " + vulkan.out);
  return {
    cpu: { model: cpuModel, cores, arch: os.arch(), usage: cpuUsage, load1: load[0], load5: load[1], load15: load[2], tempC: null as number | null },
    mem: { total: totalMem, free: freeMem, used: totalMem - freeMem },
    disk: { total: diskTotal, free: diskFree, used: diskTotal - diskFree },
    gpus,
    backends: {
      cuda: nvidia.ok && gpus.some((g) => g.backend === "CUDA"),
      cudaRaw: nvidia.out.slice(0, 500),
      vulkan: vulkan.ok && !vulkan.out.toLowerCase().includes("not found"),
      rocm: rocm.ok && !rocm.out.toLowerCase().includes("not found"),
      amdHint: hasAmdHint,
      cpuFallback: true,
    },
    os: { platform: os.platform(), release: os.release(), hostname: os.hostname(), uptimeSec: Math.round(os.uptime()) },
  };
}

export function estimateModelMemory(sizeBytes: number, contextTokens: number, quantization: string): { modelMem: number; kvCache: number; overhead: number; total: number; note: string } {
  const modelMem = sizeBytes;
  const bytesPerToken = quantization.startsWith("Q2") ? 96 : quantization.startsWith("Q8") || quantization === "F16" ? 512 : 256;
  const kvCache = Math.round(contextTokens * bytesPerToken * 32 / 8);
  const overhead = Math.round(600 * 1024 * 1024);
  const total = modelMem + kvCache + overhead;
  return { modelMem, kvCache, overhead, total, note: "Heuristic estimate (model file + KV cache + runtime overhead). Not a benchmark." };
}

export async function checkOllama(): Promise<{ available: boolean; models: string[]; version?: string; error?: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { available: false, models: [], error: `HTTP ${res.status}` };
    const j = (await res.json()) as { models?: { name: string }[] };
    return { available: true, models: (j.models || []).map((m) => m.name) };
  } catch (e: unknown) {
    return { available: false, models: [], error: e instanceof Error ? e.message : "unreachable" };
  }
}

export async function ollamaGenerate(model: string, prompt: string, system?: string, opts?: { temperature?: number; num_ctx?: number }): Promise<{ text: string; ms: number; tps: number }> {
  const started = Date.now();
  const res = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt, system: system || "", stream: false, options: { temperature: opts?.temperature ?? 0.7, num_ctx: opts?.num_ctx ?? 4096 } }),
  });
  if (!res.ok) throw new Error(`Ollama error HTTP ${res.status}: ${await res.text().then((t) => t.slice(0, 500))}`);
  const j = (await res.json()) as { response?: string; eval_count?: number; eval_duration?: number };
  const ms = Date.now() - started;
  const toks = j.eval_count || Math.ceil((j.response || "").length / 4);
  const tps = ms > 0 ? Math.round((toks / ms) * 1000) : 0;
  return { text: j.response || "", ms, tps };
}

const execFileAsync = promisify(execFile);

export async function llamaCppGenerate(modelPath: string, prompt: string, system: string, opts?: { temperature?: number; contextTokens?: number; cpuThreads?: number; gpuLayers?: number | string }): Promise<{ text: string; ms: number; tps: number }> {
  if (!fs.existsSync(modelPath)) throw new Error(`GGUF model file not found: ${modelPath}`);
  const runtimeDir = path.join(RUNTIMES_DIR, "llama.cpp");
  const candidates = process.platform === "win32"
    ? [path.join(runtimeDir, "llama-cli.exe"), "llama-cli.exe"]
    : [path.join(runtimeDir, "llama-cli"), "llama-cli"];
  const errors: string[] = [];
  const started = Date.now();
  const contextTokens = Math.max(1024, Math.min(8192, Math.floor(opts?.contextTokens || 4096)));
  const cpuThreads = Math.max(1, Math.min(os.cpus().length, Math.floor(opts?.cpuThreads || os.cpus().length / 2 || 4)));
  const requestedLayers = opts?.gpuLayers ?? "auto";
  const gpuLayers = typeof requestedLayers === "number" ? String(Math.max(0, Math.min(200, Math.floor(requestedLayers)))) : ["auto", "all"].includes(requestedLayers) ? requestedLayers : "auto";
  const args = ["-m", modelPath, "-p", `${system ? `${system}\n\n` : ""}${prompt}`, "-n", "512", "-c", String(contextTokens), "-t", String(cpuThreads), "-ngl", gpuLayers, "--fit", "on", "--no-display-prompt", "--temp", String(opts?.temperature ?? 0.7)];
  for (const executable of candidates) {
    if (path.isAbsolute(executable) && !fs.existsSync(executable)) continue;
    try {
      const result = await execFileAsync(executable, args, { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
      const text = result.stdout.trim();
      if (!text) throw new Error(result.stderr.trim().slice(-1000) || "llama.cpp returned no text");
      const ms = Date.now() - started;
      const tokens = Math.ceil(text.length / 4);
      return { text, ms, tps: Math.round((tokens / Math.max(1, ms)) * 1000) };
    } catch (error) {
      const e = error as Error & { stderr?: string };
      errors.push(`${executable}: ${(e.stderr || e.message || "failed").slice(-500)}`);
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`llama.cpp failed: ${errors.at(-1)}. Use a Vulkan-enabled Windows build for the RX 6700M; CPU fallback uses ${cpuThreads} threads.`);
    }
  }
  throw new Error(`llama-cli was not found in ${runtimeDir} or PATH. Install a Vulkan-enabled llama.cpp build first.`);
}

export function localFallbackReply(prompt: string, mode: string, systemPrompt?: string): { text: string; tps: number } {
  const p = prompt.toLowerCase();
  let text = "";
  if (mode === "code" || /code|function|bug|refactor|error|script|lua|python|typescript/.test(p)) {
    text = `**VEX Local Engine (offline fallback — no cloud used)**\n\nNo local inference runtime responded (Ollama/llama.cpp not reachable), so this is a deterministic local assistant reply. Install + start a model to get true local generation.\n\n**Request analysis:**\n- Mode: ${mode}\n- Prompt chars: ${prompt.length}\n- Detected intent: ${/bug|fix|error/.test(p) ? "bug-fix" : /refactor/.test(p) ? "refactor" : /explain/.test(p) ? "explain" : /create|build|generate/.test(p) ? "generate" : "general coding"}\n\n**Suggested next steps:**\n1. Start a code model (e.g. qwen2.5-coder:7b) in My Models.\n2. Attach the project folder in Project Manager and set permission mode.\n3. Re-run this prompt — output will stream from the local model.\n\nIf you paste a file + error, I can still produce a static patch template below:\n\n\`\`\`\n// 1) Reproduce the error locally\n// 2) Isolate the failing function\n// 3) Apply minimal fix, keep diff small\n// 4) Re-run tests\n\`\`\``;
  } else if (mode === "agent") {
    text = `**VEX Agent (offline planner)**\n\nI broke your request into executable steps. Assign a running local model to execute each step in Task Manager.\n\n1. Analyze scope and files\n2. Draft changes (approval mode shows diffs)\n3. Apply + test\n4. Report\n\nPrompt received: "${prompt.slice(0, 220)}${prompt.length > 220 ? "…" : ""}"\n\nCreate this as a persistent task from the Task Manager tab to track progress across restarts.`;
  } else {
    text = `**VEX Local Engine (offline fallback)**\n\nLocal inference runtime is not currently reachable, so no tokens were generated by a model. Your prompt was received fully offline (${prompt.length} chars).\n\nTo enable true local chat:\n- Model Store → download a GGUF (e.g. llama3.2:3b Q4_K_M)\n- Runtime Manager → install llama.cpp or Ollama\n- My Models → Start → then chat here\n\nSystem prompt active: ${systemPrompt ? "yes (" + systemPrompt.slice(0, 80) + "…)" : "none"}\n\nEcho of your message:\n> ${prompt.slice(0, 500)}`;
  }
  return { text, tps: 0 };
}

export function pairingToken(): string {
  return "vex-" + crypto.randomBytes(16).toString("hex");
}

export function robloxPluginSource(bridgeToken: string, port = 7817): string {
  return `-- Vex AI Center :: Roblox Studio Bridge Plugin (Luau)
-- Install: place this file in %LOCALAPPDATA%/Roblox/Plugins/VexBridge.luau
-- Manual install supported. Never overwritten silently by Vex AI Center.
local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local StudioService = game:GetService("StudioService")
local BRIDGE_URL = "http://127.0.0.1:${port}/roblox"
local AUTH_TOKEN = "${bridgeToken}"
local toolbar = plugin:CreateToolbar("Vex AI")
local toggleBtn = toolbar:CreateButton("VexBridge", "Connect Vex AI Center local bridge", "rbxassetid://0")
local connected = false
local function log(msg) print("[VexBridge] " .. tostring(msg)) end
local function api(path, method, body)
  local url = BRIDGE_URL .. path
  local headers = { ["Content-Type"] = "application/json", ["X-Vex-Token"] = AUTH_TOKEN }
  local payload = body and HttpService:JSONEncode(body) or nil
  local ok, res = pcall(function()
    if method == "POST" then return HttpService:PostAsync(url, payload or "{}", Enum.HttpContentType.ApplicationJson, false, headers)
    else return HttpService:GetAsync(url, true, headers) end
  end)
  if not ok then return nil, tostring(res) end
  local dok, data = pcall(function() return HttpService:JSONDecode(res) end)
  return (dok and data or res), nil
end
local function serializeInstance(inst, depth)
  depth = depth or 0
  if depth > 3 then return { Name = inst.Name, ClassName = inst.ClassName, truncated = true } end
  local kids = {}
  for _, c in ipairs(inst:GetChildren()) do table.insert(kids, serializeInstance(c, depth + 1)) end
  return { Name = inst.Name, ClassName = inst.ClassName, Path = inst:GetFullName(), Children = kids }
end
local function poll()
  while connected do
    local cmd, err = api("/next-command", "GET", nil)
    if cmd and type(cmd) == "table" and cmd.action then
      local ok, result = pcall(function()
        if cmd.action == "inspect" then
          local root = game:GetService(cmd.service or "Workspace")
          return serializeInstance(root, 0)
        elseif cmd.action == "read-script" then
          local inst = game:GetService("ServerScriptService"):FindFirstChild(cmd.name, true) or game:GetService("Workspace"):FindFirstChild(cmd.name, true)
          if inst and inst:IsA("LuaSourceContainer") then return { Source = inst.Source, Path = inst:GetFullName() } end
          return { error = "script not found: " .. tostring(cmd.name) }
        elseif cmd.action == "write-script" then
          local parent = game:GetService(cmd.parent or "ServerScriptService")
          local inst = parent:FindFirstChild(cmd.name) or Instance.new(cmd.className or "Script")
          inst.Name = cmd.name
          if inst:IsA("LuaSourceContainer") then inst.Source = cmd.source or "" end
          inst.Parent = parent
          return { ok = true, Path = inst:GetFullName() }
        elseif cmd.action == "set-property" then
          local inst = game:GetService("Workspace"):FindFirstChild(cmd.target, true)
          if inst then pcall(function() (inst :: any)[cmd.property] = cmd.value end) return { ok = true } end
          return { error = "instance not found" }
        elseif cmd.action == "create-instance" then
          local inst = Instance.new(cmd.className or "Part")
          inst.Name = cmd.name or cmd.className
          if cmd.properties then for k, v in pairs(cmd.properties) do pcall(function() (inst :: any)[k] = v end) end end
          inst.Parent = game:GetService(cmd.parent or "Workspace")
          return { ok = true, Path = inst:GetFullName() }
        end
        return { error = "unknown action" }
      end)
      pcall(function() api("/command-result", "POST", { id = cmd.id, ok = ok, result = result }) end)
    end
    task.wait(1)
  end
end
toggleBtn.Click:Connect(function()
  connected = not connected
  toggleBtn:SetActive(connected)
  if connected then log("connected to Vex AI Center bridge (local only)") task.spawn(poll)
  else log("disconnected") end
end)
log("Vex AI Bridge plugin loaded. Press the VexBridge toolbar button to connect.")
`;
}

export const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\/(?:\s|$)/, /mkfs/, /dd\s+if=.*of=\/dev\//, /shutdown/, /reboot/,
  /:\(\)\s*{\s*:\|:\s*&\s*}/, /powershell.*-EncodedCommand/i,
];

export function isDangerousCommand(cmd: string): boolean {
  return DANGEROUS_PATTERNS.some((r) => r.test(cmd));
}

export function walkDir(root: string, opts?: { maxFiles?: number; exclude?: string[] }): { path: string; size: number; lang: string }[] {
  const out: { path: string; size: number; lang: string }[] = [];
  const maxFiles = opts?.maxFiles ?? 500;
  const exclude = new Set(opts?.exclude ?? ["node_modules", ".git", "dist", "build", ".next"]);
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (out.length >= maxFiles) break;
      if (exclude.has(e.name)) continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        try {
          const st = fs.statSync(full);
          if (st.size > 5 * 1024 * 1024) continue;
          out.push({ path: path.relative(root, full).replace(/\\/g, "/"), size: st.size, lang: detectLanguage(full) });
        } catch { /* skip */ }
      }
    }
  }
  return out;
}

