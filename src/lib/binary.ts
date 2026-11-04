import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type BinaryResult = { stdout: string; stderr: string; code: number | null; signal: string | null };
export function runBinary(executable: string, args: string[], timeout = 600000, signal?: AbortSignal): Promise<BinaryResult> {
  return new Promise((resolve, reject) => {
    if(signal?.aborted){reject(new Error("Request cancelled"));return;}
    const child = spawn(executable, args, { windowsHide: true, cwd: path.isAbsolute(executable) ? path.dirname(executable) : undefined, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    const abort=()=>child.kill();signal?.addEventListener("abort",abort,{once:true});
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-8 * 1024 * 1024); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-1024 * 1024); });
    child.once("error", (error) => { clearTimeout(timer); signal?.removeEventListener("abort",abort); reject(error); });
    child.once("close", (code, exitSignal) => { clearTimeout(timer); signal?.removeEventListener("abort",abort); resolve({ stdout, stderr: signal?.aborted ? "Request cancelled" : timedOut ? `${stderr}\nGeneration timed out after ${timeout / 1000}s` : stderr, code, signal: exitSignal }); });
  });
}


