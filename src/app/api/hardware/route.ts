import { NextRequest, NextResponse } from "next/server";
import { getHardwareSnapshot, estimateModelMemory, checkOllama, execSafe } from "@/lib/vex";

export async function GET(req: NextRequest) {
  const hw = getHardwareSnapshot();
  const ollama = await checkOllama();
  const git = execSafe("git --version 2>&1");
  const node = execSafe("node --version 2>&1");
  const python = execSafe("python3 --version 2>&1 || python --version 2>&1");
  const { searchParams } = new URL(req.url);
  const sizeGb = Number(searchParams.get("sizeGb") || "0");
  const quant = searchParams.get("quant") || "Q4_K_M";
  const ctx = Number(searchParams.get("ctx") || "4096");
  let estimate = null;
  if (sizeGb > 0) {
    const e = estimateModelMemory(sizeGb * 1024 ** 3, ctx, quant);
    const vramFree = hw.gpus.reduce((a, g) => a + Math.max(0, g.vramTotal - g.vramUsed), 0);
    const verdict = e.total < hw.mem.free + vramFree ? "likely fits" : e.total < (hw.mem.total + vramFree) * 0.9 ? "tight — reduce context or use smaller quant" : "unlikely to fit — use smaller model/quant";
    const runtimes = ["llama.cpp", "ollama"];
    estimate = { ...e, vramFree, ramFree: hw.mem.free, verdict, runtimes };
  }
  return NextResponse.json({ ...hw, ollama, tools: { git: git.out.trim().slice(0, 80), node: node.out.trim().slice(0, 40), python: python.out.trim().slice(0, 80) }, estimate });
}
