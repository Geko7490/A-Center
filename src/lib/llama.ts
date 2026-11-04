import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type BinaryResult = { stdout: string; stderr: string; code: number | null; signal: string | null };
export function runBinary(executable: string, args: string[], timeout = 600000): Promise<BinaryResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, cwd: path.isAbsolute(executable) ? path.dirname(executable) : undefined, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-8 * 1024 * 1024); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-1024 * 1024); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => { clearTimeout(timer); resolve({ stdout, stderr: timedOut ? `${stderr}\nGeneration timed out after ${timeout / 1000}s` : stderr, code, signal }); });
  });
}

export function llamaCandidates(runtimeDir: string): string[] {
  const name = process.platform === "win32" ? "llama-cli.exe" : "llama-cli";
  return [path.join(runtimeDir, name), name];
}

export async function probeLlama(runtimeDir: string) {
  for (const executable of llamaCandidates(runtimeDir)) {
    if (path.isAbsolute(executable) && !fs.existsSync(executable)) continue;
    try {
      const help = await runBinary(executable, ["--help"], 15000);
      if (help.code !== 0) throw new Error(`exit=${help.code}; ${help.stderr || help.stdout}`);
      return { executable, help: help.stdout + help.stderr };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`llama-cli not found in ${runtimeDir} or PATH. Copy the complete Vulkan build (EXE and DLL files) into that folder.`);
}

const inferenceState = globalThis as typeof globalThis & { aCenterGenerating?: boolean };
export function isGenerating() { return inferenceState.aCenterGenerating === true; }
export async function generateLlama(runtimeDir: string, model: string, prompt: string, system: string, options: { temperature?: number; contextTokens?: number; cpuThreads?: number; gpuLayers?: number | string; maxTokens?: number }) {
  if (isGenerating()) throw new Error("Another model response is still running. Wait for it to finish before sending again.");
  if (!fs.existsSync(model)) throw new Error(`GGUF model file not found: ${model}`);
  inferenceState.aCenterGenerating = true;
  try {
    const { executable, help } = await probeLlama(runtimeDir);
    const args = ["-m", model, "-p", `${system ? system + "\n\n" : ""}${prompt}`, "-n", String(options.maxTokens || 512), "-c", String(Math.max(1024, Math.min(8192, options.contextTokens || 4096))), "-t", String(Math.max(1, Math.min(32, options.cpuThreads || 8))), "--temp", String(options.temperature ?? 0.7)];
    const layers = options.gpuLayers ?? "auto";
    args.push("-ngl", layers === "auto" && !help.includes("'auto'") ? "32" : String(layers));
    if (help.includes("--fit")) args.push("--fit", "on");
    if (help.includes("--single-turn")) args.push("--single-turn");
    else if (help.includes("--no-conversation")) args.push("--no-conversation");
    if (help.includes("--simple-io")) args.push("--simple-io");
    if (help.includes("--no-display-prompt")) args.push("--no-display-prompt");
    if (help.includes("--reasoning-budget")) args.push("--reasoning-budget", "0");
    if (help.includes("--no-show-timings")) args.push("--no-show-timings");
    const started = Date.now();
    const result = await runBinary(executable, args);
    fs.mkdirSync(runtimeDir, { recursive: true });
    const log = path.join(runtimeDir, "last-inference.log");
    // Do not persist user prompts in diagnostic logs.
    fs.writeFileSync(log, `${new Date().toISOString()}\nExecutable: ${executable}\nModel: ${model}\nExit: ${result.code} Signal: ${result.signal}\n${result.stderr}`, "utf8");
    if (result.code !== 0 || !result.stdout.trim()) throw new Error(`llama.cpp exit=${result.code}, signal=${result.signal || "none"}. ${result.stderr.trim().slice(-1800) || "No diagnostic output. Check that EXE and DLLs belong to the same build."} Log: ${log}`);
    // New CLI versions print a terminal banner even with --no-display-prompt.
    let text = result.stdout.replace(/\r/g, "");
    const marker = `> ${system ? system + "\n\n" : ""}${prompt}`;
    const markerAt = text.indexOf(marker);
    if (markerAt >= 0) text = text.slice(markerAt + marker.length);
    text = text.replace(/\n\[ Prompt: [^\n]*\][\s\S]*$/, "").replace(/\nExiting\.\.\.[\s\S]*$/, "").trim();
    if (!text) throw new Error(`Model returned no answer. Diagnostic log: ${log}`);
    const ms = Date.now() - started;
    return { text, ms, tps: Math.round((text.length / 4) / Math.max(1, ms) * 1000) };
  } finally { inferenceState.aCenterGenerating = false; }
}
