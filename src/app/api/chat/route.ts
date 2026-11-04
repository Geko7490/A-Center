import { storageBusy } from "@/lib/maintenance";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages, models, runtimes } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { checkOllama, ollamaGenerate, llamaCppGenerate } from "@/lib/vex";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const cid = searchParams.get("conversationId");
  const convs = await db.select().from(conversations).orderBy(desc(conversations.createdAt));
  if (!cid) return NextResponse.json({ conversations: convs });
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, cid)).orderBy(messages.createdAt);
  return NextResponse.json({ conversations: convs, messages: msgs });
}

export async function POST(req: NextRequest) {
  if (storageBusy()) return NextResponse.json({ error: "Storage relocation in progress. Restart A-Center before making changes." }, { status: 409 });
  const body = await req.json().catch(() => ({}));
  const b = body as { action?: string; title?: string; mode?: string; conversationId?: string; prompt?: string; modelId?: string; systemPrompt?: string; temperature?: number; contextTokens?: number; planningModel?: string; codingModel?: string; utilityModel?: string; attachment?: string };
  if (b.action === "create") {
    const [c] = await db.insert(conversations).values({
      title: b.title || "New conversation", mode: b.mode || "chat",
      modelId: b.modelId || "", planningModel: b.planningModel || "", codingModel: b.codingModel || "", utilityModel: b.utilityModel || "",
      systemPrompt: b.systemPrompt || "", temperature: b.temperature ?? 0.7, contextTokens: b.contextTokens ?? 4096,
    }).returning();
    return NextResponse.json({ conversation: c });
  }
  if (b.action === "update") {
    if (!b.conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    await db.update(conversations).set({
      ...(b.mode ? { mode: b.mode } : {}), ...(b.modelId !== undefined ? { modelId: b.modelId } : {}),
      ...(b.systemPrompt !== undefined ? { systemPrompt: b.systemPrompt } : {}),
      ...(b.temperature !== undefined ? { temperature: b.temperature } : {}),
      ...(b.contextTokens !== undefined ? { contextTokens: b.contextTokens } : {}),
      ...(b.planningModel !== undefined ? { planningModel: b.planningModel } : {}),
      ...(b.codingModel !== undefined ? { codingModel: b.codingModel } : {}),
      ...(b.utilityModel !== undefined ? { utilityModel: b.utilityModel } : {}),
      ...(b.title ? { title: b.title } : {}),
    }).where(eq(conversations.id, b.conversationId));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "delete") {
    if (!b.conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    await db.delete(messages).where(eq(messages.conversationId, b.conversationId));
    await db.delete(conversations).where(eq(conversations.id, b.conversationId));
    return NextResponse.json({ ok: true });
  }
  // send message
  if (!b.conversationId || !b.prompt) return NextResponse.json({ error: "conversationId and prompt required" }, { status: 400 });
  const convs = await db.select().from(conversations).where(eq(conversations.id, b.conversationId));
  const conv = convs[0];
  if (!conv) return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  let fullPrompt = b.attachment ? `${b.prompt}\n\n[attached file context]\n${String(b.attachment).slice(0, 6000)}` : b.prompt;
  const history = await db.select().from(messages).where(eq(messages.conversationId, b.conversationId)).orderBy(messages.createdAt);
  const contextBudget = Math.max(1024, Math.min(8192, conv.contextTokens || 4096)) * 2;
  const previous = history.slice(-12).map((m) => `${m.role}: ${m.content}`).join("\n").slice(-contextBudget);
  if (previous) fullPrompt = `[Previous conversation]\n${previous}\n[Current user message]\n${fullPrompt}`;
  await db.insert(messages).values({ conversationId: b.conversationId, role: "user", content: b.prompt, tokens: Math.ceil(b.prompt.length / 4) });
  // Resolve model: multi-model routing
  let activeModel = b.modelId || conv.modelId;
  if (!activeModel) {
    if (conv.mode === "code" && conv.codingModel) activeModel = conv.codingModel;
    else if (conv.mode === "agent" && conv.planningModel) activeModel = conv.planningModel;
    else activeModel = conv.utilityModel || conv.codingModel || conv.planningModel || "";
  }
  // Check installed models
  const installed = await db.select().from(models);
  const selectedLocalModel = installed.find((model) => model.id === activeModel || model.name === activeModel) || (!activeModel ? installed.find((model) => model.status === "running") || installed.find((model) => model.format === "GGUF") : undefined);
  let text = "", ms = 0, tps = 0, engine = "local-fallback";
  const oc = await checkOllama();
  const targetName = selectedLocalModel?.installPath.startsWith("ollama:") ? selectedLocalModel.installPath.slice(7) : selectedLocalModel?.name || activeModel;
  const ollamaTarget = targetName ? oc.models.find((name) => name === targetName || name === `${targetName}:latest`) || "" : oc.models[0] || "";
  try {
    if (selectedLocalModel?.format === "GGUF" && selectedLocalModel.activeRuntime !== "ollama" && selectedLocalModel.installPath && !selectedLocalModel.installPath.startsWith("ollama:")) {
      const llamaRows = await db.select().from(runtimes).where(eq(runtimes.name, "llama.cpp"));
      const llamaConfig = (llamaRows[0]?.config || {}) as { cpuThreads?: number; gpuLayers?: number | string; ctxSize?: number };
      const r = await llamaCppGenerate(selectedLocalModel.installPath, fullPrompt, conv.systemPrompt || "", {
        temperature: conv.temperature,
        contextTokens: conv.contextTokens || llamaConfig.ctxSize || 4096,
        cpuThreads: llamaConfig.cpuThreads || 8,
        gpuLayers: llamaConfig.gpuLayers ?? "auto",
      });
      text = r.text; ms = r.ms; tps = r.tps; engine = `llama.cpp:${selectedLocalModel.name}`;
    } else if (oc.available && ollamaTarget) {
      const r = await ollamaGenerate(ollamaTarget, fullPrompt, conv.systemPrompt || undefined, { temperature: conv.temperature, num_ctx: conv.contextTokens });
      text = r.text; ms = r.ms; tps = r.tps; engine = `ollama:${ollamaTarget}`;
    } else {
      throw new Error(`Selected model/runtime is unavailable: ${activeModel || "no model selected"}. Import a GGUF in My Models or start the matching Ollama model.`);
    }
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Inference failed" }, { status: 502 });

  }
  const tokens = Math.ceil(text.length / 4);
  const [msg] = await db.insert(messages).values({ conversationId: b.conversationId, role: "assistant", content: text, tokens, genMs: ms, tokensPerSec: tps }).returning();
  if (convs[0].title === "New conversation") {
    await db.update(conversations).set({ title: b.prompt.slice(0, 48) }).where(eq(conversations.id, b.conversationId));
  }
  return NextResponse.json({ message: msg, engine, ollama: oc });
}

