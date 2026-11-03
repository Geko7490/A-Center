import { NextRequest, NextResponse } from "next/server";
import { OLLAMA_CATALOG, QUANTIZATIONS } from "@/lib/vex";

type HFModel = { id: string; likes?: number; downloads?: number; tags?: string[]; sha?: string; lastModified?: string };

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const category = searchParams.get("category") || "all";
  const format = searchParams.get("format") || "all";
  const quant = searchParams.get("quant") || "all";
  const source = searchParams.get("source") || "all";

  // Ollama catalog (always available offline)
  let ollama = OLLAMA_CATALOG.map((m, i) => ({
    id: `ollama:${m.name}`, name: m.name, repo: m.repo, source: "ollama",
    description: m.description, category: m.category, formats: m.formats,
    quants: [...QUANTIZATIONS].slice(2, 6), sizes: m.sizes, pulls: m.pulls,
    runtimes: ["ollama", "llama.cpp"], likes: 5000 - i * 300,
  }));
  if (q) ollama = ollama.filter((m) => (m.name + m.description + m.repo).toLowerCase().includes(q.toLowerCase()));
  if (category !== "all") ollama = ollama.filter((m) => m.category === category);
  if (format !== "all") ollama = ollama.filter((m) => m.formats.includes(format));

  // Hugging Face live search (online op)
  let hf: unknown[] = [];
  let hfError = "";
  if (source === "all" || source === "huggingface") {
    try {
      const params = new URLSearchParams({ search: q || "gguf", limit: "24", sort: "downloads", direction: "-1" });
      if (format === "GGUF") params.set("filter", "gguf");
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      const res = await fetch(`https://huggingface.co/api/models?${params.toString()}`, { signal: ctrl.signal, headers: { "user-agent": "VexAICenter/1.0" } });
      clearTimeout(t);
      if (res.ok) {
        const arr = (await res.json()) as HFModel[];
        hf = arr.map((m) => {
          const tags = m.tags || [];
          const isGguf = tags.includes("gguf") || m.id.toLowerCase().includes("gguf");
          const isVision = tags.some((x) => /llava|vision|clip|vl/i.test(x));
          const isCode = tags.some((x) => /code/i.test(x)) || /coder|code/i.test(m.id);
          // Guess download URL pattern for gguf repos (informational; user picks file in detail view)
          const guessFile = m.id.includes("/") ? `https://huggingface.co/${m.id}/resolve/main/` : "";
          return {
            id: `hf:${m.id}`, name: m.id.split("/")[1] || m.id, repo: m.id, source: "huggingface",
            description: `${m.downloads?.toLocaleString() || 0} downloads · ${m.likes || 0} likes · ${(m.tags || []).slice(0, 6).join(", ")}`,
            category: isCode ? "code" : isVision ? "vision" : "chat",
            formats: isGguf ? ["GGUF"] : ["Safetensors"],
            quants: isGguf ? [...QUANTIZATIONS] : ["F16"],
            sizes: ["varies"], pulls: String(m.downloads || 0),
            runtimes: isGguf ? ["llama.cpp", "ollama"] : ["transformers", "onnx"],
            guessFile, sha: m.sha || "", lastModified: m.lastModified || "",
          };
        });
        if (category !== "all") hf = (hf as { category: string }[]).filter((m) => m.category === category);
        if (format !== "all") hf = (hf as { formats: string[] }[]).filter((m) => m.formats.includes(format));
      } else hfError = `HF HTTP ${res.status}`;
    } catch (e: unknown) {
      hfError = e instanceof Error ? e.message : "HF unreachable (offline?)";
    }
  }
  if (quant !== "all") {
    const f = (m: { quants: string[] }) => m.quants.includes(quant);
    ollama = ollama.filter(f);
    hf = (hf as { quants: string[] }[]).filter(f);
  }
  const results = source === "ollama" ? ollama : source === "huggingface" ? hf : [...ollama, ...hf];
  return NextResponse.json({ results, hfError, counts: { ollama: ollama.length, hf: (hf as unknown[]).length } });
}
