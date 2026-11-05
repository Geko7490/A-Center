import { NextRequest, NextResponse } from "next/server";

type HubSibling = { rfilename: string; size?: number; lfs?: { size?: number } };
type HubModel = { id: string; siblings?: HubSibling[] };

function parseRepo(input: string): string | null {
  const value = input.trim().replace(/^https?:\/\/huggingface\.co\//i, "").replace(/\/(tree|blob)\/[^/]+.*$/i, "").replace(/\/$/, "");
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

export async function GET(req: NextRequest) {
  const input = req.nextUrl.searchParams.get("repo") || "";
  const repo = parseRepo(input);
  if (!repo) return NextResponse.json({ error: "Enter a Hugging Face repository as owner/name." }, { status: 400 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://huggingface.co/api/models/${repo}?blobs=true`, {
      signal: controller.signal,
      headers: { "user-agent": "A-Center/1.0" },
    });
    if (response.status === 404) return NextResponse.json({ error: `Hugging Face repo not found: ${repo}` }, { status: 404 });
    if (!response.ok) return NextResponse.json({ error: `Hugging Face returned HTTP ${response.status}. The repo may be private or gated.` }, { status: response.status === 401 || response.status === 403 ? 403 : 502 });

    const model = (await response.json()) as HubModel;
    const files = (model.siblings || [])
      .filter((file) => file.rfilename.toLowerCase().endsWith(".gguf"))
      .map((file) => ({
        name: file.rfilename,
        sizeBytes: file.size ?? file.lfs?.size ?? 0,
        quantization: file.rfilename.match(/(?:^|[._-])(Q[2-8]_[K0-9A-Z]+|IQ[0-9A-Z_]+|F16|BF16)(?:[._-]|$)/i)?.[1]?.toUpperCase() || "GGUF",
      }))
      .sort((a, b) => a.sizeBytes - b.sizeBytes || a.name.localeCompare(b.name));

    return NextResponse.json({ repo: model.id || repo, files });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hugging Face is unreachable.";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

