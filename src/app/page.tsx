"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ---------- types ---------- */
type AnyRec = Record<string, any>;
type NavKey = "dashboard" | "store" | "models" | "runtimes" | "workspace" | "projects" | "github" | "roblox" | "plugins" | "hardware" | "tasks" | "terminal" | "settings";
type DesktopBridge = { isDesktop: boolean; getApiToken: () => Promise<string>; chooseStorageDirectory?: () => Promise<string | null>; getStoragePresets?: () => Promise<{ label: string; path: string }[]>; restartApp?: () => Promise<void> };

const NAV: { key: NavKey; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "▦" },
  { key: "store", label: "Model Store", icon: "◈" },
  { key: "models", label: "My Models", icon: "⬢" },
  { key: "runtimes", label: "Runtime Manager", icon: "⚙" },
  { key: "workspace", label: "AI Workspace", icon: "✦" },
  { key: "projects", label: "Project Manager", icon: "▤" },
  { key: "github", label: "GitHub Manager", icon: "⑂" },
  { key: "roblox", label: "Roblox Integration", icon: "◉" },
  { key: "plugins", label: "Plugin Manager", icon: "⬣" },
  { key: "hardware", label: "Hardware Monitor", icon: "▣" },
  { key: "tasks", label: "Task Manager", icon: "☰" },
  { key: "terminal", label: "Terminal", icon: "›" },
  { key: "settings", label: "Settings", icon: "⚒" },
];

async function api(path: string, init?: RequestInit): Promise<any> {
  const desktop = typeof window !== "undefined" ? (window as Window & { vexDesktop?: DesktopBridge }).vexDesktop : undefined;
  const token = desktop?.isDesktop ? await desktop.getApiToken() : "";
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(token ? { "x-vex-local-token": token } : {}), ...(init?.headers || {}) } });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { _raw: text }; }
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

function fmtBytes(n: number): string {
  if (!n || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
function timeAgo(s?: string): string {
  if (!s) return "never";
  const d = new Date(s).getTime();
  if (!d) return "never";
  const sec = Math.floor((Date.now() - d) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
function StatusDot({ status }: { status: string }) {
  const c =
    status === "running" || status === "connected" || status === "completed" || status === "passed" || status === "healthy" || status === "enabled" ? "#22c55e"
    : status === "downloading" || status === "queued" || status === "waiting-for-studio" ? "#eab308"
    : status === "failed" || status === "error" || status === "broken" || status === "cancelled" ? "#ef4444"
    : status === "paused" ? "#f97316" : "#6b7280";
  return <span className="vex-dot" style={{ background: c }} title={status} />;
}

/* ================= APP ================= */
export default function VexApp() {
  const [nav, setNav] = useState<NavKey>("dashboard");
  const [dash, setDash] = useState<any>(null);
  const [online, setOnline] = useState(true);

  const loadDash = useCallback(async () => {
    try { setDash(await api("/api/dashboard")); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => loadDash(), 0);
    const onlineCheck = setTimeout(() => setOnline(navigator.onLine), 0);
    const t = setInterval(loadDash, 8000);
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    api("/api/tasks", { method: "POST", body: JSON.stringify({ action: "recover" }) }).catch(() => {});
    return () => { clearTimeout(initial); clearTimeout(onlineCheck); clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, [loadDash]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#101014" }}>
      {/* Sidebar */}
      <aside className="flex flex-col shrink-0" style={{ width: 228, background: "#16161c", borderRight: "1px solid #2e2d3a" }}>
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center gap-2">
            <div style={{ width: 30, height: 30, borderRadius: 6, background: "linear-gradient(135deg,#A855F7,#6D28D9)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16 }}>V</div>
            <div>
              <div className="font-bold text-[15px] leading-tight">Vex AI Center</div>
              <div className="text-[11px]" style={{ color: "#A1A1AA" }}>Local AI Platform · v1.0</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: "#A1A1AA" }}>
            <span className="vex-dot" style={{ background: online ? "#22c55e" : "#f97316" }} />
            {online ? "Online — downloads available" : "Offline — local ops only"}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {NAV.map((n) => (
            <button key={n.key} className={`vex-nav ${nav === n.key ? "active" : ""}`} onClick={() => setNav(n.key)}>
              <span style={{ width: 18, textAlign: "center", color: nav === n.key ? "#A855F7" : "#71717a" }}>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="p-3 text-[11px]" style={{ color: "#71717a", borderTop: "1px solid #2e2d3a" }}>
          <div className="flex justify-between"><span>Models</span><span className="text-white">{dash?.counts?.models ?? "–"}</span></div>
          <div className="flex justify-between"><span>Running</span><span className="text-white">{dash?.counts?.running ?? "–"}</span></div>
          <div className="flex justify-between"><span>Ollama</span><span style={{ color: dash?.ollama?.available ? "#22c55e" : "#f87171" }}>{dash?.ollama?.available ? "reachable" : "offline"}</span></div>
          <div className="mt-1">100% local inference · no cloud APIs</div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto p-5" style={{ minWidth: 0 }}>
        {nav === "dashboard" && <DashboardView dash={dash} reload={loadDash} go={setNav} />}
        {nav === "store" && <StoreView />}
        {nav === "models" && <ModelsView />}
        {nav === "runtimes" && <RuntimesView />}
        {nav === "workspace" && <WorkspaceView />}
        {nav === "projects" && <ProjectsView />}
        {nav === "github" && <GithubView />}
        {nav === "roblox" && <RobloxView />}
        {nav === "plugins" && <PluginsView />}
        {nav === "hardware" && <HardwareView />}
        {nav === "tasks" && <TasksView />}
        {nav === "terminal" && <TerminalView />}
        {nav === "settings" && <SettingsView />}
      </main>
    </div>
  );
}

/* ================= DASHBOARD ================= */
function DashboardView({ dash, reload, go }: { dash: any; reload: () => void; go: (n: NavKey) => void }) {
  const hw = dash?.hardware;
  const memPct = hw ? Math.round(((hw.mem.total - hw.mem.free) / Math.max(1, hw.mem.total)) * 100) : 0;
  const cards = [
    { label: "Installed Models", value: dash?.counts?.models ?? "–", sub: `${dash?.counts?.running ?? 0} running`, nav: "models" as NavKey },
    { label: "Runtimes Ready", value: dash?.counts?.runtimes ?? "–", sub: dash?.ollama?.available ? "Ollama reachable" : "Ollama offline", nav: "runtimes" as NavKey },
    { label: "Active Downloads", value: dash?.counts?.downloads ?? "–", sub: "queue + progress", nav: "store" as NavKey },
    { label: "Open Tasks", value: dash?.counts?.tasks ?? "–", sub: "persistent queue", nav: "tasks" as NavKey },
    { label: "Projects", value: dash?.counts?.projects ?? "–", sub: "sandboxed access", nav: "projects" as NavKey },
    { label: "Plugins Enabled", value: dash?.counts?.plugins ?? "–", sub: "modular integrations", nav: "plugins" as NavKey },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <button className="vex-btn-ghost" onClick={reload}>Refresh</button>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))" }}>
        {cards.map((c) => (
          <button key={c.label} className="vex-panel p-4 text-left hover:border-[#A855F7]" onClick={() => go(c.nav)}>
            <div className="text-[12px]" style={{ color: "#A1A1AA" }}>{c.label}</div>
            <div className="text-2xl font-bold mt-1">{c.value}</div>
            <div className="text-[11px] mt-1" style={{ color: "#71717a" }}>{c.sub}</div>
          </button>
        ))}
      </div>
      <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
        <div className="vex-panel p-4">
          <div className="font-semibold mb-2">Hardware Snapshot</div>
          {hw ? (
            <div className="text-[13px] space-y-2" style={{ color: "#d4d4d8" }}>
              <div><span style={{ color: "#A1A1AA" }}>CPU:</span> {hw.cpu.model} · {hw.cpu.cores} cores · {hw.cpu.usage}%</div>
              <div className="vex-bar"><div style={{ width: `${hw.cpu.usage}%` }} /></div>
              <div><span style={{ color: "#A1A1AA" }}>RAM:</span> {fmtBytes(hw.mem.total - hw.mem.free)} / {fmtBytes(hw.mem.total)} ({memPct}%)</div>
              <div className="vex-bar"><div style={{ width: `${memPct}%` }} /></div>
              <div><span style={{ color: "#A1A1AA" }}>GPU:</span> {hw.gpus?.length ? hw.gpus.map((g: any) => `${g.name} (${g.backend})`).join(", ") : "no discrete GPU detected — CPU fallback ready"}</div>
              <div><span style={{ color: "#A1A1AA" }}>Backends:</span> CUDA {hw.backends.cuda ? "✓" : "✗"} · Vulkan {hw.backends.vulkan ? "✓" : "✗"} · ROCm {hw.backends.rocm ? "✓" : "✗"} · CPU ✓</div>
            </div>
          ) : <div className="text-[13px]" style={{ color: "#A1A1AA" }}>Loading…</div>}
          <button className="vex-btn-ghost mt-3" onClick={() => go("hardware")}>Open Hardware Monitor</button>
        </div>
        <div className="vex-panel p-4">
          <div className="font-semibold mb-2">Recent Downloads</div>
          {(dash?.downloads || []).length === 0 && <div className="text-[13px]" style={{ color: "#A1A1AA" }}>No downloads yet. Visit the Model Store.</div>}
          {(dash?.downloads || []).map((d: any) => (
            <div key={d.id} className="text-[12px] py-1.5" style={{ borderBottom: "1px solid #2e2d3a" }}>
              <div className="flex justify-between"><span className="truncate">{d.modelName}</span><span style={{ color: "#A1A1AA" }}><StatusDot status={d.status} /> {d.status} {Math.round((d.progress || 0) * 100)}%</span></div>
              <div className="vex-bar mt-1"><div style={{ width: `${Math.round((d.progress || 0) * 100)}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="vex-panel p-4">
          <div className="font-semibold mb-2">Recent Tasks</div>
          {(dash?.tasks || []).length === 0 && <div className="text-[13px]" style={{ color: "#A1A1AA" }}>No tasks yet. Create one in Task Manager.</div>}
          {(dash?.tasks || []).map((t: any) => (
            <div key={t.id} className="text-[12px] py-1.5 flex justify-between" style={{ borderBottom: "1px solid #2e2d3a" }}>
              <span className="truncate">{t.title}</span>
              <span style={{ color: "#A1A1AA" }}><StatusDot status={t.status} /> {t.status} {Math.round((t.progress || 0) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="vex-panel p-4 mt-4">
        <div className="font-semibold mb-1">Offline-first guarantee</div>
        <div className="text-[13px]" style={{ color: "#A1A1AA" }}>
          Internet is used <b className="text-white">only</b> for downloads (models, runtimes, plugins, git sync). Inference, chat, project editing, Roblox bridge, tasks and hardware monitoring run fully offline. No telemetry, no cloud AI APIs, no mandatory online checks.
        </div>
      </div>
    </div>
  );
}

/* ================= MODEL STORE ================= */
function StoreView() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [format, setFormat] = useState("all");
  const [quant, setQuant] = useState("all");
  const [source, setSource] = useState("all");
  const [results, setResults] = useState<any[]>([]);
  const [hfError, setHfError] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloads, setDownloads] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [repoInput, setRepoInput] = useState("mradermacher/Luau-Devstral-24B-Instruct-v0.2-GGUF");
  const [repoFiles, setRepoFiles] = useState<any[]>([]);
  const [repoLoaded, setRepoLoaded] = useState("");
  const [repoLoading, setRepoLoading] = useState(false);

  const search = useCallback(async () => {
    setLoading(true); setMsg("");
    try {
      const r = await api(`/api/store/search?q=${encodeURIComponent(q)}&category=${category}&format=${format}&quant=${quant}&source=${source}`);
      setResults(r.results || []); setHfError(r.hfError || "");
    } catch (e: any) { setMsg(e.message); }
    setLoading(false);
  }, [q, category, format, quant, source]);

  const loadDl = useCallback(async () => {
    try { const r = await api("/api/downloads"); setDownloads(r.downloads || []); } catch {}
  }, []);
  useEffect(() => { search(); loadDl(); const t = setInterval(loadDl, 2000); return () => clearInterval(t); }, [loadDl]); // eslint-disable-line

  async function startDownload(m: any) {
    setMsg("");
    try {
      if (m.source === "ollama") {
        // Ollama models install via `ollama pull` — register as managed model instead of HTTP download
        const r = await api("/api/models", { method: "POST", body: JSON.stringify({ name: m.name, repo: m.repo, format: "Ollama", quantization: quant === "all" ? "Q4_K_M" : quant, description: m.description, category: m.category, installPath: `ollama:${m.name}` }) });
        setMsg(`Registered ${r.model.name}. Run: ollama pull ${m.name}  — then Start it from My Models.`);
        return;
      }
      openFiles(m.repo);
    } catch (e: any) { setMsg(e.message); }
  }
  async function loadRepoFiles(repo = repoInput) {
    setRepoLoading(true); setRepoLoaded(""); setRepoFiles([]); setMsg("");
    try {
      const r = await api(`/api/store/files?repo=${encodeURIComponent(repo)}`);
      setRepoInput(r.repo); setRepoLoaded(r.repo); setRepoFiles(r.files || []);
      if (!r.files?.length) setMsg("This Hugging Face repo has no GGUF files.");
    } catch (e: any) { setMsg(e.message); }
    finally { setRepoLoading(false); }
  }
  async function downloadRepoFile(repo: string, file: any) {
    try {
      const encodedFile = file.name.split("/").map(encodeURIComponent).join("/");
      const url = `https://huggingface.co/${repo}/resolve/main/${encodedFile}`;
      const modelName = `${repo.split("/").pop()}-${file.name.split("/").pop()?.replace(/\.gguf$/i, "")}`;
      await api("/api/downloads", { method: "POST", body: JSON.stringify({ url, modelName, repo, quantization: file.quantization }) });
      setMsg(`Download queued: ${repo}/${file.name}`); loadDl();
    } catch (e: any) { setMsg(e.message); }
  }
  function downloadLuauPreset() {
    const repo = "mradermacher/Luau-Devstral-24B-Instruct-v0.2-GGUF";
    void downloadRepoFile(repo, { name: "Luau-Devstral-24B-Instruct-v0.2.Q2_K.gguf", sizeBytes: 8.89 * 1024 ** 3, quantization: "Q2_K" });
  }
  function openFiles(repo: string) { setRepoInput(repo); void loadRepoFiles(repo); }
  async function dlAction(id: string, action: string) {
    try { await api("/api/downloads", { method: "POST", body: JSON.stringify({ id, action }) }); loadDl(); } catch (e: any) { setMsg(e.message); }
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Model Store</h1>
      <p className="text-[13px] mb-4" style={{ color: "#A1A1AA" }}>Search Ollama Library + Hugging Face. Downloads are real HTTP transfers with pause/resume, disk checks and checksums. Nothing is marked installed until verified.</p>
      <div className="vex-panel p-3 mb-3">
        <div className="grid gap-2" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto" }}>
          <input className="vex-input" placeholder="Search models… (e.g. llama, coder, mistral)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <select className="vex-input" value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">All categories</option><option value="chat">Chat</option><option value="code">Code</option><option value="vision">Vision</option><option value="agent">Agent</option><option value="embedding">Embedding</option></select>
          <select className="vex-input" value={format} onChange={(e) => setFormat(e.target.value)}><option value="all">All formats</option><option>GGUF</option><option>Safetensors</option><option>ONNX</option><option>Ollama</option></select>
          <select className="vex-input" value={quant} onChange={(e) => setQuant(e.target.value)}><option value="all">All quants</option>{["Q2_K", "Q3_K_M", "Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "F16"].map((x) => <option key={x}>{x}</option>)}</select>
          <select className="vex-input" value={source} onChange={(e) => setSource(e.target.value)}><option value="all">All sources</option><option value="ollama">Ollama Library</option><option value="huggingface">Hugging Face</option></select>
          <button className="vex-btn" onClick={search} disabled={loading}>{loading ? "…" : "Search"}</button>
        </div>
        {hfError && <div className="text-[12px] mt-2" style={{ color: "#fbbf24" }}>Hugging Face: {hfError} — showing Ollama catalog (offline-capable).</div>}
        {msg && <div className="text-[12px] mt-2" style={{ color: "#A855F7" }}>{msg}</div>}
      </div>

      <div className="vex-panel p-3 mb-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div><div className="font-semibold text-[14px]">Hardware quick pick · RX 6700M</div><div className="text-[11px]" style={{ color: "#A1A1AA" }}>Luau coding · Q2_K · about 8.89 GB. 10 GB VRAM means keep context modest; full GPU offload is not guaranteed.</div></div>
          <div className="flex flex-wrap gap-2"><button className="vex-btn" onClick={downloadLuauPreset}>Download Luau Devstral Q2_K</button><button className="vex-btn-ghost" onClick={() => openFiles("mradermacher/Luau-Devstral-24B-Instruct-v0.2-GGUF")}>Browse files</button></div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input className="vex-input" style={{ minWidth: 320, flex: 1 }} value={repoInput} onChange={(e) => setRepoInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadRepoFiles()} placeholder="Hugging Face repo: owner/name or URL" />
          <button className="vex-btn" onClick={() => loadRepoFiles()} disabled={repoLoading}>{repoLoading ? "Loading…" : "Load repository files"}</button>
        </div>
        {repoLoaded && <div className="mt-3">
          <div className="text-[12px] mb-2" style={{ color: "#A1A1AA" }}>{repoLoaded} · {repoFiles.length} GGUF files</div>
          <div className="grid gap-2" style={{ maxHeight: 280, overflowY: "auto" }}>
            {repoFiles.map((file) => <div key={file.name} className="vex-panel2 p-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0"><div className="text-[12px] vex-code break-all">{file.name}</div><div className="text-[11px]" style={{ color: "#71717a" }}>{file.quantization} · {file.sizeBytes ? fmtBytes(file.sizeBytes) : "size unavailable"}</div></div>
              <button className="vex-btn-ghost" onClick={() => downloadRepoFile(repoLoaded, file)}>Download</button>
            </div>)}
          </div>
        </div>}
      </div>

      {downloads.length > 0 && (
        <div className="vex-panel p-3 mb-3">
          <div className="font-semibold text-[14px] mb-2">Download Manager</div>
          {downloads.map((d) => (
            <div key={d.id} className="vex-panel2 p-2.5 mb-2">
              <div className="flex justify-between items-center text-[13px]">
                <span className="font-semibold truncate">{d.modelName} <span style={{ color: "#A1A1AA" }}>· {d.quantization}</span></span>
                <span className="flex items-center gap-2 text-[12px]" style={{ color: "#A1A1AA" }}>
                  <StatusDot status={d.status} /> {d.status} · {fmtBytes(d.bytesDownloaded)} / {d.totalBytes ? fmtBytes(d.totalBytes) : "?"} · {d.speedBps ? `${fmtBytes(d.speedBps)}/s` : ""}
                </span>
              </div>
              <div className="vex-bar my-2"><div style={{ width: `${Math.round((d.progress || 0) * 100)}%` }} /></div>
              {d.error && <div className="text-[12px] mb-1" style={{ color: "#f87171" }}>{d.error}</div>}
              <div className="flex gap-2">
                {(d.status === "downloading" || d.status === "queued") && <button className="vex-btn-ghost" onClick={() => dlAction(d.id, "pause")}>Pause</button>}
                {d.status === "paused" && <button className="vex-btn" onClick={() => dlAction(d.id, "resume")}>Resume</button>}
                {d.status === "failed" && <button className="vex-btn" onClick={() => dlAction(d.id, "retry")}>Retry</button>}
                {(d.status === "downloading" || d.status === "queued" || d.status === "paused") && <button className="vex-btn-danger" onClick={() => dlAction(d.id, "cancel")}>Cancel</button>}
                {(d.status === "completed" || d.status === "cancelled" || d.status === "failed") && <button className="vex-btn-ghost" onClick={() => dlAction(d.id, "delete")}>Remove</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))" }}>
        {results.map((m) => (
          <div key={m.id} className="vex-panel p-3">
            <div className="flex justify-between items-start gap-2">
              <div className="font-semibold text-[14px] truncate">{m.name}</div>
              <span className="vex-badge" style={{ background: m.source === "ollama" ? "rgba(34,197,94,.15)" : "rgba(234,179,8,.15)", color: m.source === "ollama" ? "#4ade80" : "#fbbf24" }}>{m.source}</span>
            </div>
            <div className="text-[12px] truncate" style={{ color: "#A855F7" }}>{m.repo}</div>
            <div className="text-[12px] mt-1" style={{ color: "#A1A1AA", minHeight: 32 }}>{m.description}</div>
            <div className="flex flex-wrap gap-1 mt-2">
              {(m.formats || []).map((f: string) => <span key={f} className="vex-badge" style={{ background: "#2e2d3a" }}>{f}</span>)}
              <span className="vex-badge" style={{ background: "#2e2d3a" }}>{m.category}</span>
              <span className="vex-badge" style={{ background: "#2e2d3a" }}>↓ {m.pulls}</span>
            </div>
            <div className="text-[11px] mt-1" style={{ color: "#71717a" }}>Runtimes: {(m.runtimes || []).join(", ")} · Quants: {(m.quants || []).slice(0, 5).join(", ")}</div>
            {m.source === "huggingface" && (
              <button className="vex-btn-ghost mt-2 w-full" onClick={() => openFiles(m.repo)}>Browse files in this Hugging Face repo</button>
            )}
            <button className="vex-btn mt-2 w-full" onClick={() => m.source === "ollama" ? startDownload(m) : openFiles(m.repo)}>{m.source === "ollama" ? "Register + Pull via Ollama" : "Browse and download GGUF files"}</button>
          </div>
        ))}
      </div>
      {results.length === 0 && !loading && <div className="text-[13px] mt-4" style={{ color: "#A1A1AA" }}>No results. Try another query or check your connection.</div>}
    </div>
  );
}

/* ================= MY MODELS ================= */
function ModelsView() {
  const [models, setModels] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [testReport, setTestReport] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [importForm, setImportForm] = useState({ name: "", path: "", format: "GGUF", quantization: "Q4_K_M" });
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try { const r = await api("/api/models"); setModels(r.models || []); } catch (e: any) { setMsg(e.message); }
  }, []);
  useEffect(() => { const initial = setTimeout(() => load(), 0); const t = setInterval(load, 5000); return () => { clearTimeout(initial); clearInterval(t); }; }, [load]);

  async function act(id: string, action: string, extra?: any) {
    setBusy(id + action); setMsg("");
    try {
      const r = await api(`/api/models/${id}`, { method: "PATCH", body: JSON.stringify({ action, ...extra }) });
      setMsg(r.note || r.output || `${action} ok`);
      load();
    } catch (e: any) { setMsg(e.message); }
    setBusy("");
  }
  async function del(id: string) {
    if (!confirm("Delete this model (file removed from disk)?")) return;
    try { await api(`/api/models/${id}`, { method: "DELETE" }); load(); } catch (e: any) { setMsg(e.message); }
  }
  async function checkAll() {
    setTesting(true); setMsg("");
    try { const r = await api("/api/test-models", { method: "POST" }); setTestReport(r); load(); }
    catch (e: any) { setMsg(e.message); }
    setTesting(false);
  }
  async function importLocal() {
    setMsg("");
    try {
      await api("/api/models", { method: "POST", body: JSON.stringify({ name: importForm.name || importForm.path.split(/[\\/]/).pop(), repo: "local", format: importForm.format, quantization: importForm.quantization, installPath: importForm.path, description: "Imported local file", checkFile: true }) });
      setMsg("Import attempted — file validated, never auto-marked working.");
      setImportForm({ name: "", path: "", format: "GGUF", quantization: "Q4_K_M" });
      load();
    } catch (e: any) { setMsg(e.message); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">My Models</h1>
        <button className="vex-btn" onClick={checkAll} disabled={testing}>{testing ? "Testing…" : "✓ Check Models"}</button>
      </div>
      <p className="text-[13px] mb-3" style={{ color: "#A1A1AA" }}>A model is <b className="text-white">working</b> only after files validate, runtime + hardware checks pass, and a real prompt returns output. Multiple versions supported.</p>
      {msg && <div className="vex-panel p-2.5 mb-3 text-[13px] vex-pre" style={{ borderColor: "#A855F7" }}>{msg}</div>}
      {testReport && (
        <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
          <div className="vex-panel p-3"><div className="font-semibold text-[14px]" style={{ color: "#4ade80" }}>Working Models ({testReport.working?.length || 0})</div>{(testReport.working || []).map((w: string) => <div key={w} className="text-[12px]">✓ {w}</div>)}{(testReport.working || []).length === 0 && <div className="text-[12px]" style={{ color: "#71717a" }}>none yet</div>}</div>
          <div className="vex-panel p-3"><div className="font-semibold text-[14px]" style={{ color: "#f87171" }}>Models With Errors ({testReport.errors?.length || 0})</div>{(testReport.errors || []).map((e: any) => <div key={e.id} className="text-[12px]">✗ <b>{e.name}</b>: {e.error}</div>)}{(testReport.errors || []).length === 0 && <div className="text-[12px]" style={{ color: "#71717a" }}>none</div>}</div>
          <div className="vex-panel p-3"><div className="font-semibold text-[14px]" style={{ color: "#fbbf24" }}>Unsupported ({testReport.unsupported?.length || 0})</div>{(testReport.unsupported || []).map((u: any) => <div key={u.id} className="text-[12px]">⊘ <b>{u.name}</b>: {u.reason}</div>)}{(testReport.unsupported || []).length === 0 && <div className="text-[12px]" style={{ color: "#71717a" }}>none</div>}</div>
        </div>
      )}
      <div className="vex-panel p-3 mb-3">
        <div className="font-semibold text-[14px] mb-2">Import existing local model</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 2fr 1fr 1fr auto" }}>
          <input className="vex-input" placeholder="Display name" value={importForm.name} onChange={(e) => setImportForm({ ...importForm, name: e.target.value })} />
          <input className="vex-input" placeholder="Absolute file path, e.g. D:/Models/llama.Q4_K_M.gguf" value={importForm.path} onChange={(e) => setImportForm({ ...importForm, path: e.target.value })} />
          <select className="vex-input" value={importForm.format} onChange={(e) => setImportForm({ ...importForm, format: e.target.value })}><option>GGUF</option><option>Safetensors</option><option>ONNX</option><option>Ollama</option></select>
          <select className="vex-input" value={importForm.quantization} onChange={(e) => setImportForm({ ...importForm, quantization: e.target.value })}>{["Q2_K", "Q3_K_M", "Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "F16"].map((x) => <option key={x}>{x}</option>)}</select>
          <button className="vex-btn" onClick={importLocal}>Import</button>
        </div>
      </div>
      {models.length === 0 && <div className="text-[13px]" style={{ color: "#A1A1AA" }}>No models installed. Download one from the Model Store or import a local file.</div>}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))" }}>
        {models.map((m) => (
          <div key={m.id} className="vex-panel p-3">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-[14px] truncate">{m.name}</span>
              <span className="text-[11px] flex items-center gap-1" style={{ color: "#A1A1AA" }}><StatusDot status={m.status} />{m.status} · <StatusDot status={m.testStatus === "passed" ? "passed" : m.testStatus === "failed" ? "failed" : "unknown"} />{m.testStatus}</span>
            </div>
            <div className="text-[12px]" style={{ color: "#A855F7" }}>{m.repo} · v{m.version}</div>
            <div className="text-[12px] mt-1 vex-code" style={{ color: "#A1A1AA" }}>{m.format} · {m.quantization} · {m.sizeBytes ? fmtBytes(m.sizeBytes) : "size unknown"}</div>
            <div className="text-[11px] vex-code truncate" style={{ color: "#71717a" }} title={m.installPath}>{m.installPath || "(no path)"}</div>
            <div className="text-[11px] mt-1" style={{ color: "#71717a" }}>Runtimes: {(m.runtimes || []).join(", ")} · active: <b className="text-white">{m.activeRuntime}</b> · compat: {m.compatibilityStatus} · used: {timeAgo(m.lastUsedAt)}</div>
            <div className="text-[12px] mt-1" style={{ color: "#A1A1AA" }}>{m.description}</div>
            <div className="flex flex-wrap gap-2 mt-2">
              {m.status !== "running" ? <button className="vex-btn" disabled={!!busy} onClick={() => act(m.id, "start")}>Start</button>
                : <button className="vex-btn-ghost" disabled={!!busy} onClick={() => act(m.id, "stop")}>Stop</button>}
              <button className="vex-btn-ghost" disabled={!!busy} onClick={() => act(m.id, "test")}>Test</button>
              <select className="vex-input" style={{ width: 130 }} value={m.activeRuntime} onChange={(e) => act(m.id, "set-runtime", { runtime: e.target.value })}>
                {(m.runtimes || []).map((r: string) => <option key={r}>{r}</option>)}
              </select>
              <button className="vex-btn-danger" onClick={() => del(m.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= RUNTIMES ================= */
function RuntimesView() {
  const [runtimes, setRuntimes] = useState<any[]>([]);
  const [ollama, setOllama] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [cfg, setCfg] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    try { const r = await api("/api/runtimes"); setRuntimes(r.runtimes || []); setOllama(r.ollama); } catch (e: any) { setMsg(e.message); }
  }, []);
  useEffect(() => { const initial = setTimeout(() => load(), 0); return () => clearTimeout(initial); }, [load]);
  async function act(name: string, action: string, extra?: any) {
    setMsg("");
    try { await api("/api/runtimes", { method: "POST", body: JSON.stringify({ name, action, ...extra }) }); load(); }
    catch (e: any) { setMsg(e.message); }
  }
  async function applyHybridPreset() {
    const config = { cpuThreads: 8, gpuLayers: "auto", ctxSize: 4096 };
    setCfg((current) => ({ ...current, "llama.cpp": config }));
    await act("llama.cpp", "config", { config });
    setMsg("RX 6700M + 32 GB RAM profile saved: 8 CPU threads, automatic VRAM fit, 4K context.");
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-1"><h1 className="text-xl font-bold">Runtime Manager</h1><button className="vex-btn-ghost" onClick={load}>Re-detect</button></div>
      <p className="text-[13px] mb-3" style={{ color: "#A1A1AA" }}>Modular adapters: llama.cpp · Ollama · ONNX · Transformers. Auto-selection inspects format → hardware → memory before loading. CUDA never required.</p>
      <div className="vex-panel p-3 mb-3 text-[12px]" style={{ color: "#A1A1AA" }}>RX 6700M + 32 GB RAM: llama.cpp hybrid mode uses GPU layers that fit VRAM and keeps remaining layers in system RAM/CPU. Select a GGUF model in AI Workspace; install a Vulkan-enabled llama-cli.exe into the llama.cpp runtime folder first. <button className="vex-btn-ghost mt-2" onClick={applyHybridPreset}>Apply hybrid profile (8 threads · auto VRAM · 4K)</button></div>
      {msg && <div className="vex-panel p-2.5 mb-3 text-[13px]" style={{ borderColor: "#A855F7" }}>{msg}</div>}
      <div className="vex-panel p-3 mb-3 text-[13px]">
        <b>Ollama live probe:</b> {ollama?.available ? <span style={{ color: "#4ade80" }}>reachable — {ollama.models.length} models: {(ollama.models || []).join(", ") || "(none pulled)"}</span> : <span style={{ color: "#f87171" }}>offline ({ollama?.error || "not running"}) — start `ollama serve` for real inference</span>}
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(380px,1fr))" }}>
        {runtimes.map((r) => (
          <div key={r.name} className="vex-panel p-3">
            <div className="flex justify-between items-center">
              <span className="font-semibold">{r.displayName || r.name}</span>
              <span className="text-[11px] flex items-center gap-1" style={{ color: "#A1A1AA" }}><StatusDot status={r.installed ? (r.status === "running" ? "running" : "enabled") : "unknown"} />{r.installed ? `${r.status} · ${r.version || "installed"}` : "not installed"}</span>
            </div>
            <div className="text-[12px] mt-1 vex-code" style={{ color: "#A1A1AA" }}>detect: {r.detected}</div>
            <div className="text-[11px] vex-code truncate" style={{ color: "#71717a" }}>{r.installPath}</div>
            <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <label className="text-[11px]" style={{ color: "#A1A1AA" }}>CPU threads<input className="vex-input mt-1" type="number" defaultValue={r.config?.cpuThreads ?? 8} onChange={(e) => setCfg({ ...cfg, [r.name]: { ...(cfg[r.name] || {}), cpuThreads: Number(e.target.value) } })} /></label>
              <label className="text-[11px]" style={{ color: "#A1A1AA" }}>GPU layers (auto/number)<input className="vex-input mt-1" type="text" defaultValue={r.config?.gpuLayers ?? "auto"} onChange={(e) => { const raw = e.target.value; setCfg({ ...cfg, [r.name]: { ...(cfg[r.name] || {}), gpuLayers: /^\d+$/.test(raw) ? Number(raw) : raw } }); }} /></label>
              <label className="text-[11px]" style={{ color: "#A1A1AA" }}>Ctx size<input className="vex-input mt-1" type="number" defaultValue={r.config?.ctxSize ?? 4096} onChange={(e) => setCfg({ ...cfg, [r.name]: { ...(cfg[r.name] || {}), ctxSize: Number(e.target.value) } })} /></label>
              <label className="text-[11px]" style={{ color: "#A1A1AA" }}>Ctx size<input className="vex-input mt-1" type="number" defaultValue={r.config?.ctxSize ?? 4096} onChange={(e) => setCfg({ ...cfg, [r.name]: { ...(cfg[r.name] || {}), ctxSize: Number(e.target.value) } })} /></label>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {!r.installed ? <button className="vex-btn" onClick={() => act(r.name, "install")}>Install</button>
                : <><button className="vex-btn-ghost" onClick={() => act(r.name, r.status === "running" ? "stop" : "start")}>{r.status === "running" ? "Stop" : "Start"}</button>
                <button className="vex-btn-ghost" onClick={() => act(r.name, "update")}>Update</button>
                <button className="vex-btn-ghost" onClick={() => act(r.name, "config", { config: cfg[r.name] || {} })}>Save config</button>
                <button className="vex-btn-danger" onClick={() => act(r.name, "uninstall")}>Uninstall</button></>}
            </div>
            {r.logs && <details className="mt-2"><summary className="text-[12px] cursor-pointer" style={{ color: "#A1A1AA" }}>Runtime logs</summary><pre className="vex-code vex-pre mt-1 p-2" style={{ background: "#131318", borderRadius: 6, maxHeight: 160, overflow: "auto" }}>{r.logs.slice(-2000)}</pre><button className="vex-btn-ghost mt-1" onClick={() => act(r.name, "clear-logs")}>Clear</button></details>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= AI WORKSPACE ================= */
function WorkspaceView() {
  const [convs, setConvs] = useState<any[]>([]);
  const [cid, setCid] = useState("");
  const [msgs, setMsgs] = useState<any[]>([]);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState("chat");
  const [models, setModels] = useState<any[]>([]);
  const [modelId, setModelId] = useState("");
  const [planning, setPlanning] = useState("");
  const [coding, setCoding] = useState("");
  const [utility, setUtility] = useState("");
  const [sys, setSys] = useState("");
  const [temp, setTemp] = useState(0.7);
  const [ctx, setCtx] = useState(4096);
  const [engine, setEngine] = useState("");
  const [sending, setSending] = useState(false);
  const [attach, setAttach] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConvs = useCallback(async (id?: string) => {
    const r = await api(id ? `/api/chat?conversationId=${id}` : "/api/chat");
    setConvs(r.conversations || []);
    if (id && r.messages) setMsgs(r.messages);
    return r;
  }, []);
  useEffect(() => {
    loadConvs().then((r) => {
      if (r.conversations?.[0]) { setCid(r.conversations[0].id); loadConvs(r.conversations[0].id); const c = r.conversations[0]; setMode(c.mode); setSys(c.systemPrompt || ""); setTemp(c.temperature); setCtx(c.contextTokens); setModelId(c.modelId || ""); setPlanning(c.planningModel || ""); setCoding(c.codingModel || ""); setUtility(c.utilityModel || ""); }
    });
    api("/api/models").then((r) => setModels(r.models || [])).catch(() => {});
  }, [loadConvs]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function createConv() {
    const r = await api("/api/chat", { method: "POST", body: JSON.stringify({ action: "create", mode, title: "New conversation" }) });
    setCid(r.conversation.id); setMsgs([]); loadConvs(r.conversation.id);
  }
  async function saveSettings() {
    if (!cid) return;
    await api("/api/chat", { method: "POST", body: JSON.stringify({ action: "update", conversationId: cid, mode, modelId, systemPrompt: sys, temperature: temp, contextTokens: ctx, planningModel: planning, codingModel: coding, utilityModel: utility }) });
  }
  async function send() {
    if (!cid || !prompt.trim() || sending) return;
    setSending(true);
    const p = prompt; setPrompt("");
    setMsgs((m) => [...m, { role: "user", content: p, createdAt: new Date().toISOString() }]);
    try {
      await saveSettings();
      const r = await api("/api/chat", { method: "POST", body: JSON.stringify({ conversationId: cid, prompt: p, modelId, attachment: attach }) });
      setEngine(r.engine || "");
      // streaming effect: reveal progressively
      const full: string = r.message.content;
      let shown = "";
      setMsgs((m) => [...m, { ...r.message, content: "" }]);
      const chunks = full.match(/[\s\S]{1,120}/g) || [full];
      for (const c of chunks) {
        shown += c;
        const s = shown;
        setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, content: s } : x)));
        await new Promise((res) => setTimeout(res, 30));
      }
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: `Error: ${e.message}`, createdAt: new Date().toISOString() }]);
    }
    setSending(false);
  }

  const cur = convs.find((c) => c.id === cid);
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">AI Workspace</h1>
      <p className="text-[13px] mb-3" style={{ color: "#A1A1AA" }}>Local chat + coding + agent. Engine: <b className="text-white">{engine || "—"}</b> {engine.includes("fallback") && "(Ollama unreachable — start a runtime for real tokens)"}</p>
      <div className="grid gap-3" style={{ gridTemplateColumns: "250px 1fr 260px" }}>
        <div className="vex-panel p-2">
          <button className="vex-btn w-full mb-2" onClick={createConv}>+ New chat</button>
          {(convs || []).map((c) => (
            <div key={c.id} className={`vex-nav ${cid === c.id ? "active" : ""}`} style={{ cursor: "pointer" }} onClick={async () => { setCid(c.id); const r = await loadConvs(c.id); setMode(c.mode); setSys(c.systemPrompt || ""); setTemp(c.temperature); setCtx(c.contextTokens); setModelId(c.modelId || ""); setPlanning(c.planningModel || ""); setCoding(c.codingModel || ""); setUtility(c.utilityModel || ""); void r; }}>
              <span className="truncate flex-1">{c.title}</span>
              <button className="text-[11px]" style={{ color: "#71717a" }} onClick={async (e) => { e.stopPropagation(); if (confirm("Delete conversation?")) { await api("/api/chat", { method: "POST", body: JSON.stringify({ action: "delete", conversationId: c.id }) }); setCid(""); setMsgs([]); loadConvs(); } }}>✕</button>
            </div>
          ))}
        </div>
        <div className="vex-panel p-3 flex flex-col" style={{ minHeight: 560 }}>
          <div className="flex-1 overflow-y-auto space-y-2 mb-2" style={{ maxHeight: 440 }}>
            {msgs.map((m, i) => (
              <div key={i} className="p-2.5" style={{ background: m.role === "user" ? "rgba(168,85,247,.12)" : "#131318", borderRadius: 6 }}>
                <div className="text-[11px] mb-1" style={{ color: m.role === "user" ? "#A855F7" : "#71717a" }}>{m.role === "user" ? "YOU" : `VEX · ${m.tokens || 0} tok${m.genMs ? ` · ${m.genMs}ms · ${m.tokensPerSec || 0} t/s` : ""}`}</div>
                <pre className="vex-pre text-[13px]">{m.content}</pre>
              </div>
            ))}
            {msgs.length === 0 && <div className="text-[13px]" style={{ color: "#71717a" }}>{cid ? "No messages yet. Set your models on the right, then ask anything — inference stays on this machine." : "Create or select a conversation."}</div>}
            <div ref={bottomRef} />
          </div>
          <input className="vex-input mb-2" placeholder="Optional: paste file/error context to attach" value={attach} onChange={(e) => setAttach(e.target.value)} />
          <div className="flex gap-2">
            <input className="vex-input" placeholder={cur ? `Message (${cur.mode})… Enter to send` : "Select a conversation"} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} disabled={!cid || sending} />
            <button className="vex-btn" onClick={send} disabled={!cid || sending}>{sending ? "…" : "Send"}</button>
          </div>
        </div>
        <div className="vex-panel p-3 text-[13px] space-y-2">
          <div className="font-semibold">Session config</div>
          <label style={{ color: "#A1A1AA" }} className="text-[12px]">Mode<select className="vex-input mt-1" value={mode} onChange={(e) => setMode(e.target.value)}><option value="chat">General chat</option><option value="code">Coding</option><option value="agent">Agent</option><option value="vision">Vision</option></select></label>
          <label style={{ color: "#A1A1AA" }} className="text-[12px]">Primary model<select className="vex-input mt-1" value={modelId} onChange={(e) => setModelId(e.target.value)}><option value="">(auto by mode)</option>{models.map((m) => <option key={m.id} value={m.name}>{m.name} [{m.status}]</option>)}</select></label>
          <label style={{ color: "#A1A1AA" }} className="text-[12px]">Planning model<select className="vex-input mt-1" value={planning} onChange={(e) => setPlanning(e.target.value)}><option value="">—</option>{models.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}</select></label>
          <label style={{ color: "#A1A1AA" }} className="text-[12px]">Coding model<select className="vex-input mt-1" value={coding} onChange={(e) => setCoding(e.target.value)}><option value="">—</option>{models.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}</select></label>
          <label style={{ color: "#A1A1AA" }} className="text-[12px]">Utility model<select className="vex-input mt-1" value={utility} onChange={(e) => setUtility(e.target.value)}><option value="">—</option>{models.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}</select></label>
          <label style={{ color: "#A1A1AA" }} className="text-[12px]">System prompt<textarea className="vex-input mt-1" rows={3} value={sys} onChange={(e) => setSys(e.target.value)} placeholder="You are a senior engineer…" /></label>
          <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label style={{ color: "#A1A1AA" }} className="text-[12px]">Temp<input className="vex-input mt-1" type="number" step={0.1} min={0} max={2} value={temp} onChange={(e) => setTemp(Number(e.target.value))} /></label>
            <label style={{ color: "#A1A1AA" }} className="text-[12px]">Context<input className="vex-input mt-1" type="number" value={ctx} onChange={(e) => setCtx(Number(e.target.value))} /></label>
          </div>
          <button className="vex-btn-ghost w-full" onClick={saveSettings}>Save session</button>
        </div>
      </div>
    </div>
  );
}

/* ================= PROJECTS ================= */
function ProjectsView() {
  const [projects, setProjects] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [file, setFile] = useState("");
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", path: "", permissionMode: "approval" });
  const [perm, setPerm] = useState({ permissionMode: "approval", protectedFiles: "", terminalAllowed: false, fileSizeLimitKb: 1024 });

  const load = useCallback(async () => {
    const r = await api("/api/projects");
    setProjects(r.projects || []);
  }, []);
  const loadDetail = useCallback(async (id: string) => {
    const r = await api(`/api/projects?id=${id}`);
    setDetail(r); setSel(r.project);
    setPerm({ permissionMode: r.project.permissionMode, protectedFiles: ((r.project.protectedFiles as string[]) || []).join(", "), terminalAllowed: r.project.terminalAllowed, fileSizeLimitKb: r.project.fileSizeLimitKb });
    const p = await api(`/api/projects/files?projectId=${id}&pending=1`);
    setPending(p.pending || []);
  }, []);
  useEffect(() => { const initial = setTimeout(() => load(), 0); return () => clearTimeout(initial); }, [load]);

  async function register() {
    setMsg("");
    try {
      const r = await api("/api/projects", { method: "POST", body: JSON.stringify(form) });
      setMsg(`Registered: ${r.project.path}`); setForm({ name: "", path: "", permissionMode: "approval" }); load();
    } catch (e: any) { setMsg(e.message); }
  }
  async function openFile(f: string) {
    setFile(f); setMsg("");
    try { const r = await api(`/api/projects/files?projectId=${sel.id}&file=${encodeURIComponent(f)}`); setContent(r.content ?? ""); }
    catch (e: any) { setMsg(e.message); setContent(""); }
  }
  async function save(action = "write") {
    if (!sel || !file) return;
    setMsg("");
    try {
      const r = await api("/api/projects/files", { method: "POST", body: JSON.stringify({ projectId: sel.id, file, content, action, reason: "manual edit" }) });
      setMsg(r.queued ? `Queued for approval (mode: approval). Review in Pending Changes.` : `Saved. Diff:\n${(r.diff || "").slice(0, 800)}`);
      loadDetail(sel.id);
    } catch (e: any) { setMsg(e.message); }
  }
  async function approve(id: string, ok: boolean) {
    try { await api("/api/projects/files", { method: "POST", body: JSON.stringify({ projectId: sel.id, action: ok ? "approve" : "reject", id }) }); loadDetail(sel.id); } catch (e: any) { setMsg(e.message); }
  }
  async function rollback(id: string) {
    if (!confirm("Rollback this change?")) return;
    try { await api("/api/projects/files", { method: "POST", body: JSON.stringify({ projectId: sel.id, action: "rollback", id }) }); setMsg("Rolled back."); loadDetail(sel.id); } catch (e: any) { setMsg(e.message); }
  }
  async function savePerm() {
    try {
      await api("/api/projects", { method: "POST", body: JSON.stringify({ action: "update", id: sel.id, permissionMode: perm.permissionMode, protectedFiles: perm.protectedFiles.split(",").map((s) => s.trim()).filter(Boolean), terminalAllowed: perm.terminalAllowed, fileSizeLimitKb: perm.fileSizeLimitKb }) });
      setMsg("Permissions saved."); loadDetail(sel.id);
    } catch (e: any) { setMsg(e.message); }
  }

  const files = (detail?.files || []).filter((f: any) => !filter || f.path.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Project Manager</h1>
      <p className="text-[13px] mb-3" style={{ color: "#A1A1AA" }}>Real filesystem access, jailed to the project dir. Read-only · Approval (diffs) · Auto (backups + rollback). Path traversal blocked, protected files enforced.</p>
      {msg && <pre className="vex-panel p-2.5 mb-3 text-[12px] vex-pre" style={{ borderColor: "#A855F7" }}>{msg}</pre>}
      <div className="grid gap-3" style={{ gridTemplateColumns: "280px 1fr" }}>
        <div>
          <div className="vex-panel p-3 mb-3">
            <div className="font-semibold text-[14px] mb-2">Connect folder</div>
            <input className="vex-input mb-2" placeholder="Project name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="vex-input mb-2" placeholder="Subfolder (blank = from name)" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
            <select className="vex-input mb-2" value={form.permissionMode} onChange={(e) => setForm({ ...form, permissionMode: e.target.value })}><option value="read-only">Read Only</option><option value="approval">Approval Mode</option><option value="auto">Auto Mode</option></select>
            <button className="vex-btn w-full" onClick={register}>Register project</button>
          </div>
          <div className="vex-panel p-2">
            {(projects || []).map((p) => (
              <div key={p.id} className={`vex-nav ${sel?.id === p.id ? "active" : ""}`} style={{ cursor: "pointer" }} onClick={() => loadDetail(p.id)}>
                <span className="flex-1 truncate">{p.name}<br /><span className="text-[11px]" style={{ color: "#71717a" }}>{p.permissionMode}</span></span>
                <button className="text-[11px]" style={{ color: "#71717a" }} onClick={async (e) => { e.stopPropagation(); if (confirm("Unregister project (files kept)?")) { await api("/api/projects", { method: "POST", body: JSON.stringify({ action: "delete", id: p.id }) }); setSel(null); setDetail(null); load(); } }}>✕</button>
              </div>
            ))}
            {projects.length === 0 && <div className="text-[12px] p-2" style={{ color: "#71717a" }}>No projects yet.</div>}
          </div>
        </div>
        <div>
          {!sel && <div className="vex-panel p-4 text-[13px]" style={{ color: "#A1A1AA" }}>Select or register a project to scan its structure, read files and apply AI edits.</div>}
          {sel && detail && (
            <>
              <div className="vex-panel p-3 mb-3">
                <div className="flex justify-between items-center flex-wrap gap-2">
                  <div><b>{sel.name}</b> <span className="vex-code text-[12px]" style={{ color: "#A1A1AA" }}>{sel.path}</span></div>
                  <button className="vex-btn-ghost" onClick={() => loadDetail(sel.id)}>Re-scan</button>
                </div>
                <div className="text-[12px] mt-1" style={{ color: "#A1A1AA" }}>{detail.fileCount} files · {fmtBytes(detail.totalSize)} · {Object.entries(detail.langs || {}).map(([k, v]) => `${k}×${v}`).join(" · ")}</div>
                {detail.deps && Object.keys(detail.deps).length > 0 && <div className="text-[12px] vex-code" style={{ color: "#71717a" }}>deps: {JSON.stringify(detail.deps).slice(0, 300)}</div>}
                <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "1fr 2fr 1fr 1fr auto" }}>
                  <select className="vex-input" value={perm.permissionMode} onChange={(e) => setPerm({ ...perm, permissionMode: e.target.value })}><option value="read-only">Read Only</option><option value="approval">Approval</option><option value="auto">Auto</option></select>
                  <input className="vex-input" placeholder="Protected: .env, *.pem" value={perm.protectedFiles} onChange={(e) => setPerm({ ...perm, protectedFiles: e.target.value })} />
                  <label className="text-[12px] flex items-center gap-1" style={{ color: "#A1A1AA" }}><input type="checkbox" checked={perm.terminalAllowed} onChange={(e) => setPerm({ ...perm, terminalAllowed: e.target.checked })} /> terminal</label>
                  <input className="vex-input" type="number" title="KB limit" value={perm.fileSizeLimitKb} onChange={(e) => setPerm({ ...perm, fileSizeLimitKb: Number(e.target.value) })} />
                  <button className="vex-btn" onClick={savePerm}>Save</button>
                </div>
              </div>
              {pending.length > 0 && (
                <div className="vex-panel p-3 mb-3">
                  <div className="font-semibold text-[14px] mb-2">Pending Changes ({pending.length}) — review diffs</div>
                  {pending.map((p) => (
                    <div key={p.id} className="vex-panel2 p-2 mb-2">
                      <div className="text-[13px]"><b>{p.action}</b> {p.filePath} {p.reason && <span style={{ color: "#71717a" }}>· {p.reason}</span>}</div>
                      <pre className="vex-code vex-pre mt-1 p-2 text-[11px]" style={{ background: "#131318", borderRadius: 6, maxHeight: 180, overflow: "auto" }}>{p.diff}</pre>
                      <div className="flex gap-2 mt-1"><button className="vex-btn" onClick={() => approve(p.id, true)}>Approve + Apply</button><button className="vex-btn-danger" onClick={() => approve(p.id, false)}>Reject</button></div>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid gap-3" style={{ gridTemplateColumns: "260px 1fr" }}>
                <div className="vex-panel p-2">
                  <input className="vex-input mb-2" placeholder="Filter files…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  <div style={{ maxHeight: 380, overflow: "auto" }}>
                    {files.slice(0, 400).map((f: any) => (
                      <div key={f.path} className={`vex-nav ${file === f.path ? "active" : ""}`} style={{ cursor: "pointer", fontSize: 12 }} onClick={() => openFile(f.path)}>
                        <span className="truncate">{f.path}</span>
                      </div>
                    ))}
                  </div>
                  <div className="p-2 text-[11px]" style={{ color: "#71717a" }}>+ new file: type path in editor header</div>
                  <div className="flex gap-1 p-1"><input className="vex-input" placeholder="src/new.ts" id="newfile" /><button className="vex-btn-ghost" onClick={() => { const v = (document.getElementById("newfile") as HTMLInputElement)?.value || ""; if (v) { setFile(v); setContent(""); } }}>+</button></div>
                </div>
                <div className="vex-panel p-3">
                  <div className="flex gap-2 mb-2">
                    <input className="vex-input vex-code" value={file} onChange={(e) => setFile(e.target.value)} placeholder="path/inside/project.ext" />
                    <button className="vex-btn" onClick={() => save("write")}>Save</button>
                    <button className="vex-btn-danger" onClick={async () => { if (!file || !confirm(`Delete ${file}?`)) return; try { await api("/api/projects/files", { method: "POST", body: JSON.stringify({ projectId: sel.id, file, action: "delete" }) }); setMsg("Delete requested (approval mode queues it)."); setFile(""); setContent(""); loadDetail(sel.id); } catch (e: any) { setMsg(e.message); } }}>Delete</button>
                  </div>
                  <textarea className="vex-input vex-code" rows={20} value={content} onChange={(e) => setContent(e.target.value)} placeholder={file ? "file content…" : "Open a file from the tree"} spellCheck={false} />
                  <div className="text-[11px] mt-1" style={{ color: "#71717a" }}>Mode: {sel.permissionMode} · auto-backups on · path-traversal protection on</div>
                </div>
              </div>
              <div className="vex-panel p-3 mt-3">
                <div className="font-semibold text-[14px] mb-2">Change history + one-click rollback</div>
                <div style={{ maxHeight: 220, overflow: "auto" }}>
                  {(detail.history || []).map((h: any) => (
                    <div key={h.id} className="text-[12px] py-1 flex justify-between gap-2" style={{ borderBottom: "1px solid #2e2d3a" }}>
                      <span className="truncate"><b>{h.action}</b> {h.filePath} <span style={{ color: "#71717a" }}>{timeAgo(h.createdAt)}</span></span>
                      <button className="vex-btn-ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => rollback(h.id)}>Rollback</button>
                    </div>
                  ))}
                  {(detail.history || []).length === 0 && <div className="text-[12px]" style={{ color: "#71717a" }}>No changes recorded yet.</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================= GITHUB ================= */
function GithubView() {
  const [repos, setRepos] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ url: "", branch: "main", localDir: "", permission: "read-write" });
  const [out, setOut] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [newBranch, setNewBranch] = useState("");

  const load = useCallback(async () => { try { const r = await api("/api/git"); setRepos(r.repos || []); } catch (e: any) { setMsg(e.message); } }, []);
  useEffect(() => { const initial = setTimeout(() => load(), 0); return () => clearTimeout(initial); }, [load]);
  async function run(body: any) {
    setMsg(""); setOut("");
    try { const r = await api("/api/git", { method: "POST", body: JSON.stringify(body) }); setOut(r.out || r.output || JSON.stringify(r).slice(0, 2000)); load(); }
    catch (e: any) { setMsg(e.message); }
  }
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">GitHub Manager</h1>
      <p className="text-[13px] mb-3" style={{ color: "#A1A1AA" }}>Native Git. Clone stays local until you approve commit/push. Auth via your local Git credential helper — secrets never stored in Vex.</p>
      {msg && <div className="vex-panel p-2.5 mb-3 text-[13px]" style={{ borderColor: "#ef4444" }}>{msg}</div>}
      <div className="vex-panel p-3 mb-3">
        <div className="grid gap-2" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
          <input className="vex-input" placeholder="https://github.com/Geko7490/VexCenter.git" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <input className="vex-input" placeholder="branch: main" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
          <input className="vex-input" placeholder="local dir (optional)" value={form.localDir} onChange={(e) => setForm({ ...form, localDir: e.target.value })} />
          <select className="vex-input" value={form.permission} onChange={(e) => setForm({ ...form, permission: e.target.value })}><option value="read-write">Read + Write</option><option value="read-only">Read only</option></select>
        </div>
        <div className="flex gap-2 mt-2">
          <button className="vex-btn" onClick={() => run({ action: "clone", ...form })}>Clone repository</button>
          <button className="vex-btn-ghost" onClick={() => run({ action: "connect", url: form.url, localDir: form.localDir, branch: form.branch })}>Connect existing local repo</button>
        </div>
        <div className="text-[11px] mt-2" style={{ color: "#71717a" }}>Example: Geko7490/VexCenter · branch main · path /src/ · permission Read+Write · push = manual approval (the Push button itself).</div>
      </div>
      {repos.map((r) => (
        <div key={r.id} className="vex-panel p-3 mb-3">
          <div className="flex justify-between flex-wrap gap-2">
            <div><b className="text-[14px]">{r.url}</b><div className="vex-code text-[12px]" style={{ color: "#A1A1AA" }}>{r.localPath} · {r.branch} · {r.permission}</div></div>
            <button className="vex-btn-ghost" onClick={() => run({ action: "delete", id: r.id })}>Unregister</button>
          </div>
          <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
            <pre className="vex-code vex-pre p-2 text-[11px]" style={{ background: "#131318", borderRadius: 6, maxHeight: 150, overflow: "auto" }}>[status]{`\n`}{r.liveStatus || "—"}</pre>
            <pre className="vex-code vex-pre p-2 text-[11px]" style={{ background: "#131318", borderRadius: 6, maxHeight: 150, overflow: "auto" }}>[branches]{`\n`}{r.liveBranches || "—"}</pre>
            <pre className="vex-code vex-pre p-2 text-[11px]" style={{ background: "#131318", borderRadius: 6, maxHeight: 150, overflow: "auto" }}>[log]{`\n`}{r.liveLog || "—"}</pre>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <button className="vex-btn-ghost" onClick={() => run({ action: "status", id: r.id })}>Status</button>
            <button className="vex-btn-ghost" onClick={() => run({ action: "diff", id: r.id })}>Diff</button>
            <button className="vex-btn-ghost" onClick={() => run({ action: "fetch", id: r.id })}>Fetch</button>
            <button className="vex-btn-ghost" onClick={() => run({ action: "pull", id: r.id })}>Pull</button>
            <input className="vex-input" style={{ maxWidth: 220 }} placeholder="commit message" value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} />
            <button className="vex-btn" onClick={() => run({ action: "commit", id: r.id, message: commitMsg })}>Commit</button>
            <button className="vex-btn" onClick={() => { if (confirm(`Push ${r.branch} to origin? (manual approval)`)) run({ action: "push", id: r.id }); }}>Push ⬆ (approval)</button>
            <input className="vex-input" style={{ maxWidth: 160 }} placeholder="new branch" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
            <button className="vex-btn-ghost" onClick={() => run({ action: "branch-create", id: r.id, newBranch })}>Create</button>
            <button className="vex-btn-ghost" onClick={() => { const b = prompt("Checkout branch:", r.branch); if (b) run({ action: "checkout", id: r.id, branch: b }); }}>Switch</button>
          </div>
        </div>
      ))}
      {out && <pre className="vex-panel p-3 vex-code vex-pre text-[12px]" style={{ maxHeight: 300, overflow: "auto" }}>{out}</pre>}
    </div>
  );
}

/* ================= ROBLOX ================= */
function RobloxView() {
  const [bridge, setBridge] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [cmd, setCmd] = useState("inspect");
  const [args, setArgs] = useState('{"service":"Workspace"}');

  const load = useCallback(async () => { try { const r = await api("/api/roblox"); setBridge(r.bridge); } catch (e: any) { setMsg(e.message); } }, []);
  useEffect(() => { const initial = setTimeout(() => load(), 0); const t = setInterval(load, 4000); return () => { clearTimeout(initial); clearInterval(t); }; }, [load]);
  async function run(action: string, extra?: any) {
    setMsg("");
    try {
      const r = await api("/api/roblox", { method: "POST", body: JSON.stringify({ action, ...extra }) });
      if (action === "send-command" && r.commandId) {
        setMsg("Command queued; waiting for Roblox Studio…");
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          const state = await api(`/api/roblox/commands/${r.commandId}`);
          if (state.command.status === "completed") { setMsg(JSON.stringify(state.command.result, null, 2)); break; }
          if (state.command.status === "failed") { setMsg(state.command.error || "Studio command failed."); break; }
        }
        if (Date.now() >= deadline) setMsg("Timed out waiting for Studio. Check that the plugin is connected and HTTP requests are enabled.");
      } else setMsg(r.note || r.result ? JSON.stringify(r.result || r.note) : "ok");
      load();
    }
    catch (e: any) { setMsg(e.message); }
  }
  async function downloadPlugin() {
    try {
      const desktop = (window as Window & { vexDesktop?: { isDesktop: boolean; getApiToken: () => Promise<string> } }).vexDesktop;
      const token = desktop?.isDesktop ? await desktop.getApiToken() : "";
      const response = await fetch("/api/roblox?download=plugin", { headers: token ? { "x-vex-local-token": token } : {} });
      if (!response.ok) throw new Error(`Plugin download failed (${response.status}).`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "VexBridge.luau";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setMsg(e.message); }
  }
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Roblox Integration</h1>
      <p className="text-[13px] mb-3" style={{ color: "#A1A1AA" }}>A-Center on this PC → authenticated HTTP polling over loopback → Roblox Studio plugin. Enable Studio HTTP requests and keep A-Center open while connected.</p>
      {msg && <pre className="vex-panel p-2.5 mb-3 text-[12px] vex-pre" style={{ borderColor: "#A855F7" }}>{msg}</pre>}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
        <div className="vex-panel p-3">
          <div className="font-semibold mb-2">Connection</div>
          <div className="text-[13px] flex items-center gap-2"><StatusDot status={bridge?.status || "unknown"} /><b>{bridge?.status || "—"}</b><span style={{ color: "#71717a" }}>· last seen {timeAgo(bridge?.lastSeenAt)}</span></div>
          <div className="text-[12px] mt-1" style={{ color: "#A1A1AA" }}>Plugin v{bridge?.pluginVersion} · Bridge v{bridge?.bridgeVersion}</div>
          <div className="text-[12px] mt-1 vex-code" style={{ color: "#A1A1AA" }}>token: {(bridge?.token || "").slice(0, 18)}… <button className="vex-btn-ghost ml-1" style={{ padding: "1px 8px", fontSize: 11 }} onClick={() => { navigator.clipboard?.writeText(bridge?.token || ""); setMsg("Token copied."); }}>copy</button></div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button className="vex-btn" onClick={downloadPlugin}>Download Plugin (.luau)</button>
            <button className="vex-btn" onClick={() => run("connect")}>Connect to Studio</button>
            <button className="vex-btn-ghost" onClick={() => run("simulate-studio", { token: bridge?.token })}>Self-test handshake</button>
            <button className="vex-btn-ghost" onClick={() => run("check-install")}>Check Installation</button>
            <button className="vex-btn-ghost" onClick={() => run("regenerate-token")}>New token</button>
            <button className="vex-btn-danger" onClick={() => run("disconnect")}>Disconnect</button>
          </div>
          <div className="text-[11px] mt-2" style={{ color: "#71717a" }}>Install: copy VexBridge.luau to %LOCALAPPDATA%/Roblox/Plugins/ (manual). Vex never overwrites an existing plugin silently — compare first.</div>
        </div>
        <div className="vex-panel p-3">
          <div className="font-semibold mb-2">Send Studio command</div>
          <select className="vex-input mb-2" value={cmd} onChange={(e) => setCmd(e.target.value)}>
            <option value="inspect">inspect — Explorer hierarchy</option>
            <option value="read-script">read-script — {`{"name":"Main"}`}</option>
            <option value="write-script">write-script — create/modify Luau</option>
            <option value="create-instance">create-instance — Part/UI/NPC</option>
            <option value="set-property">set-property — edit instance</option>
          </select>
          <textarea className="vex-input vex-code mb-2" rows={4} value={args} onChange={(e) => setArgs(e.target.value)} />
          <button className="vex-btn w-full" onClick={() => { let a = {}; try { a = JSON.parse(args); } catch { setMsg("Invalid JSON args"); return; } run("send-command", { command: cmd, args: a }); }}>Queue command</button>
          <div className="text-[11px] mt-2" style={{ color: "#71717a" }}>Example NPC task: inspect → write-script (enemy follow/attack, 100 HP, coin drop) → Studio Play test → read Output → fix. Queued commands are picked up by the plugin poll loop.</div>
        </div>
      </div>
      <div className="vex-panel p-3 mt-3">
        <div className="flex justify-between items-center mb-1"><div className="font-semibold text-[14px]">Bridge logs</div><button className="vex-btn-ghost" onClick={() => run("clear-logs")}>Clear</button></div>
        <pre className="vex-code vex-pre p-2 text-[12px]" style={{ background: "#131318", borderRadius: 6, maxHeight: 260, overflow: "auto" }}>{bridge?.logs || "(empty)"}</pre>
      </div>
    </div>
  );
}

/* ================= PLUGINS ================= */
function PluginsView() {
  const [plugins, setPlugins] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => { try { const r = await api("/api/plugins"); setPlugins(r.plugins || []); } catch (e: any) { setMsg(e.message); } }, []);
  useEffect(() => { const initial = setTimeout(() => load(), 0); return () => clearTimeout(initial); }, [load]);
  async function act(key: string, action: string) {
    setMsg("");
    try { const r = await api("/api/plugins", { method: "POST", body: JSON.stringify({ key, action }) }); if (r.detail) setMsg(`${key}: ${r.detail}`); load(); }
    catch (e: any) { setMsg(e.message); }
  }
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Plugin Manager</h1>
      <p className="text-[13px] mb-3" style={{ color: "#A1A1AA" }}>Sandboxes integrations to declared permissions. No arbitrary filesystem access.</p>
      {msg && <div className="vex-panel p-2.5 mb-3 text-[13px]">{msg}</div>}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))" }}>
        {plugins.map((p) => (
          <div key={p.key} className="vex-panel p-3">
            <div className="flex justify-between items-center"><b>{p.name}</b><span className="text-[11px] flex items-center gap-1" style={{ color: "#A1A1AA" }}><StatusDot status={p.enabled ? "enabled" : p.installed ? "unknown" : "unknown"} />{p.installed ? (p.enabled ? "enabled" : "disabled") : "available"} · v{p.version} · <StatusDot status={p.health === "healthy" ? "healthy" : p.health === "broken" ? "failed" : "unknown"} />{p.health}</span></div>
            <div className="text-[12px] mt-1" style={{ color: "#A1A1AA" }}>{p.description}</div>
            <div className="text-[11px] vex-code mt-1" style={{ color: "#71717a" }}>perms: {(p.permissions || []).join(", ")}</div>
            <details className="mt-1"><summary className="text-[12px] cursor-pointer" style={{ color: "#A1A1AA" }}>Changelog</summary><pre className="text-[11px] vex-pre">{p.changelog}</pre></details>
            <div className="flex flex-wrap gap-2 mt-2">
              {!p.installed ? <button className="vex-btn" onClick={() => act(p.key, "install")}>Install</button>
                : <><button className="vex-btn-ghost" onClick={() => act(p.key, p.enabled ? "disable" : "enable")}>{p.enabled ? "Disable" : "Enable"}</button>
                <button className="vex-btn-ghost" onClick={() => act(p.key, "update")}>Update</button>
                <button className="vex-btn-ghost" onClick={() => act(p.key, "health")}>Health test</button>
                <button className="vex-btn-danger" onClick={() => act(p.key, "uninstall")}>Uninstall</button></>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= HARDWARE ================= */
function HardwareView() {
  const [hw, setHw] = useState<any>(null);
  const [est, setEst] = useState({ sizeGb: "4.7", quant: "Q4_K_M", ctx: "4096" });
  const load = useCallback(async (withEst = false) => {
    const url = withEst ? `/api/hardware?sizeGb=${est.sizeGb}&quant=${est.quant}&ctx=${est.ctx}` : "/api/hardware";
    const r = await api(url);
    setHw(r);
  }, [est]);
  useEffect(() => { load(); const t = setInterval(() => load(), 5000); return () => clearInterval(t); }, []); // eslint-disable-line
  if (!hw) return <div className="text-[13px]" style={{ color: "#A1A1AA" }}>Probing hardware…</div>;
  const memPct = Math.round(((hw.mem.total - hw.mem.free) / Math.max(1, hw.mem.total)) * 100);
  const diskPct = hw.disk.total ? Math.round(((hw.disk.total - hw.disk.free) / hw.disk.total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-3"><h1 className="text-xl font-bold">Hardware Monitor</h1><button className="vex-btn-ghost" onClick={() => load(true)}>Refresh + estimate</button></div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
        <div className="vex-panel p-4"><div className="font-semibold mb-2">CPU</div><div className="text-[13px]">{hw.cpu.model}</div><div className="text-[12px]" style={{ color: "#A1A1AA" }}>{hw.cpu.cores} cores · {hw.cpu.arch} · load {hw.cpu.load1?.toFixed?.(1)} · {hw.cpu.usage}%</div><div className="vex-bar mt-2"><div style={{ width: `${hw.cpu.usage}%` }} /></div></div>
        <div className="vex-panel p-4"><div className="font-semibold mb-2">RAM</div><div className="text-[13px]">{fmtBytes(hw.mem.total - hw.mem.free)} / {fmtBytes(hw.mem.total)} ({memPct}%)</div><div className="vex-bar mt-2"><div style={{ width: `${memPct}%` }} /></div><div className="text-[12px] mt-1" style={{ color: "#A1A1AA" }}>Free {fmtBytes(hw.mem.free)} for model + KV cache</div></div>
        <div className="vex-panel p-4"><div className="font-semibold mb-2">Disk</div><div className="text-[13px]">{hw.disk.total ? `${fmtBytes(hw.disk.total - hw.disk.free)} / ${fmtBytes(hw.disk.total)} (${diskPct}%)` : "n/a on this host"}</div><div className="vex-bar mt-2"><div style={{ width: `${diskPct}%` }} /></div></div>
        <div className="vex-panel p-4"><div className="font-semibold mb-2">GPU backends</div>
          {(hw.gpus || []).map((g: any, i: number) => <div key={i} className="text-[13px]">{g.name} · {g.backend} · VRAM {fmtBytes(g.vramUsed)}/{fmtBytes(g.vramTotal)} · {g.util}%</div>)}
          {(hw.gpus || []).length === 0 && <div className="text-[13px]" style={{ color: "#A1A1AA" }}>No discrete GPU detected here.</div>}
          <div className="text-[12px] mt-2 space-y-1" style={{ color: "#A1A1AA" }}>
            <div>CUDA (NVIDIA): <b className="text-white">{hw.backends.cuda ? "available" : "not detected"}</b></div>
            <div>Vulkan (AMD/Intel path, RX 6000-friendly): <b className="text-white">{hw.backends.vulkan ? "available" : "not detected"}</b></div>
            <div>ROCm: <b className="text-white">{hw.backends.rocm ? "available" : "not detected"}</b></div>
            <div>CPU fallback: <b className="text-white">always available</b></div>
          </div>
          <div className="text-[11px] mt-1" style={{ color: "#71717a" }}>RX 6000 series: prefer Vulkan llama.cpp builds — CUDA is never mandatory.</div>
        </div>
        <div className="vex-panel p-4"><div className="font-semibold mb-2">Toolchain</div><div className="text-[12px] vex-code space-y-1" style={{ color: "#A1A1AA" }}><div>git: {hw.tools.git}</div><div>node: {hw.tools.node}</div><div>python: {hw.tools.python}</div><div>ollama: {hw.ollama.available ? `reachable (${hw.ollama.models.length})` : hw.ollama.error}</div><div>os: {hw.os.platform} {hw.os.release} · up {Math.round(hw.os.uptimeSec / 3600)}h</div></div></div>
        <div className="vex-panel p-4"><div className="font-semibold mb-2">Compatibility checker</div>
          <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <label className="text-[11px]" style={{ color: "#A1A1AA" }}>Size GB<input className="vex-input mt-1" value={est.sizeGb} onChange={(e) => setEst({ ...est, sizeGb: e.target.value })} /></label>
            <label className="text-[11px]" style={{ color: "#A1A1AA" }}>Quant<select className="vex-input mt-1" value={est.quant} onChange={(e) => setEst({ ...est, quant: e.target.value })}>{["Q2_K", "Q3_K_M", "Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "F16"].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="text-[11px]" style={{ color: "#A1A1AA" }}>Ctx<input className="vex-input mt-1" value={est.ctx} onChange={(e) => setEst({ ...est, ctx: e.target.value })} /></label>
          </div>
          <button className="vex-btn mt-2" onClick={() => load(true)}>Estimate fit</button>
          {hw.estimate && <div className="text-[12px] mt-2" style={{ color: "#A1A1AA" }}>Model {fmtBytes(hw.estimate.modelMem)} + KV {fmtBytes(hw.estimate.kvCache)} + overhead {fmtBytes(hw.estimate.overhead)} = <b className="text-white">{fmtBytes(hw.estimate.total)}</b><br />Verdict: <b className="text-white">{hw.estimate.verdict}</b><br /><span className="text-[11px]" style={{ color: "#71717a" }}>{hw.estimate.note}</span></div>}
        </div>
      </div>
    </div>
  );
}

/* ================= TASKS ================= */
function TasksView() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ title: "", kind: "general", assignedModel: "" });
  const [models, setModels] = useState<any[]>([]);
  const [auto, setAuto] = useState(true);
  const load = useCallback(async () => { try { const r = await api("/api/tasks"); setTasks(r.tasks || []); } catch (e: any) { setMsg(e.message); } }, []);
  useEffect(() => {
    const initial = setTimeout(() => {
      load(); api("/api/models").then((r) => setModels(r.models || [])).catch(() => {});
    }, 0);
    const t = setInterval(load, 2500); return () => clearInterval(t);
  }, [load]);
  // auto-advance running tasks step by step
  useEffect(() => {
    if (!auto) return;
    const running = tasks.find((t) => t.status === "running");
    if (!running) return;
    const t = setTimeout(async () => {
      try { await api("/api/tasks", { method: "POST", body: JSON.stringify({ action: "step", id: running.id }) }); load(); } catch {}
    }, 1200);
    return () => clearTimeout(t);
  }, [tasks, auto, load]);
  async function run(action: string, id?: string) {
    try {
      if (action === "create") {
        if (!form.title) { setMsg("Title required"); return; }
        await api("/api/tasks", { method: "POST", body: JSON.stringify({ action: "create", ...form }) });
        setForm({ title: "", kind: "general", assignedModel: "" });
      } else await api("/api/tasks", { method: "POST", body: JSON.stringify({ action, id }) });
      load();
    } catch (e: any) { setMsg(e.message); }
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-1"><h1 className="text-xl font-bold">Task Manager</h1><label className="text-[12px] flex items-center gap-1" style={{ color: "#A1A1AA" }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto-advance</label></div>
      <p className="text-[13px] mb-3" style={{ color: "#A1A1AA" }}>Persistent multi-step AI jobs. State survives restarts — recovery never blindly repeats completed steps.</p>
      {msg && <div className="vex-panel p-2.5 mb-3 text-[13px]">{msg}</div>}
      <div className="vex-panel p-3 mb-3">
        <div className="grid gap-2" style={{ gridTemplateColumns: "2fr 1fr 1fr auto" }}>
          <input className="vex-input" placeholder="Task: Build a complete Roblox weapon system…" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="vex-input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="general">general</option><option value="roblox">roblox</option><option value="code">code</option><option value="docs">docs</option></select>
          <select className="vex-input" value={form.assignedModel} onChange={(e) => setForm({ ...form, assignedModel: e.target.value })}><option value="">no model (planner)</option>{models.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}</select>
          <button className="vex-btn" onClick={() => run("create")}>Create task</button>
        </div>
      </div>
      {tasks.map((t) => (
        <div key={t.id} className="vex-panel p-3 mb-3">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div><b>{t.title}</b> <span className="text-[11px]" style={{ color: "#71717a" }}>· {t.kind} · {t.assignedModel || "planner"} · {timeAgo(t.updatedAt)}</span></div>
            <span className="text-[12px] flex items-center gap-1" style={{ color: "#A1A1AA" }}><StatusDot status={t.status} />{t.status} · {Math.round((t.progress || 0) * 100)}%</span>
          </div>
          <div className="vex-bar my-2"><div style={{ width: `${Math.round((t.progress || 0) * 100)}%` }} /></div>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div>
              {(t.steps || []).map((s: any, i: number) => (
                <div key={i} className="text-[12px] py-0.5 flex gap-2"><StatusDot status={s.status === "done" ? "completed" : s.status === "running" ? "running" : s.status === "failed" ? "failed" : "unknown"} /><span style={{ color: i === t.currentStep && t.status === "running" ? "#fff" : "#A1A1AA" }}>{i + 1}. {s.title}</span></div>
              ))}
            </div>
            <pre className="vex-code vex-pre p-2 text-[11px]" style={{ background: "#131318", borderRadius: 6, maxHeight: 160, overflow: "auto" }}>{t.logs || "(no logs)"}{t.error ? `\nERROR: ${t.error}` : ""}</pre>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {(t.status === "queued" || t.status === "paused") && <button className="vex-btn" onClick={() => run(t.status === "paused" ? "resume" : "start", t.id)}>{t.status === "paused" ? "Resume" : "Start"}</button>}
            {t.status === "running" && <button className="vex-btn-ghost" onClick={() => run("pause", t.id)}>Pause</button>}
            {t.status === "running" && <button className="vex-btn-ghost" onClick={() => run("step", t.id)}>Step once</button>}
            {(t.status === "failed" || t.status === "paused") && <button className="vex-btn-ghost" onClick={() => run("retry", t.id)}>Retry</button>}
            {t.status !== "completed" && t.status !== "cancelled" && <button className="vex-btn-danger" onClick={() => run("cancel", t.id)}>Cancel</button>}
            <button className="vex-btn-ghost" onClick={() => run("delete", t.id)}>Delete</button>
          </div>
        </div>
      ))}
      {tasks.length === 0 && <div className="text-[13px]" style={{ color: "#A1A1AA" }}>No tasks. Example: “Build a complete Roblox weapon system” auto-plans 8 steps (analyze → design → scripts → mechanics → UI → test → fix → report).</div>}
    </div>
  );
}

/* ================= TERMINAL ================= */
function TerminalView() {
  const [hist, setHist] = useState<any[]>([]);
  const [cmd, setCmd] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { const r = await api("/api/terminal"); setHist(r.history || []); } catch {} }, []);
  useEffect(() => { const initial = setTimeout(() => load(), 0); return () => clearTimeout(initial); }, [load]);
  async function execCmd(approve = false) {
    if (!cmd.trim() || busy) return;
    setBusy(true); setMsg("");
    try { await api("/api/terminal", { method: "POST", body: JSON.stringify({ command: cmd, approveDangerous: approve }) }); setCmd(""); load(); }
    catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Terminal</h1>
      <p className="text-[13px] mb-3" style={{ color: "#A1A1AA" }}>Permission-controlled shell (workspace cwd). PowerShell on Windows, sh elsewhere. Dangerous commands require explicit opt-in + approval. Exit codes + history recorded.</p>
      {msg && <div className="vex-panel p-2.5 mb-3 text-[13px]" style={{ borderColor: "#ef4444" }}>{msg}</div>}
      <div className="flex gap-2 mb-3">
        <input className="vex-input vex-code" placeholder="git status · npm test · ollama list · python3 --version" value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && execCmd()} />
        <button className="vex-btn" onClick={() => execCmd()} disabled={busy}>{busy ? "…" : "Run"}</button>
      </div>
      <div className="space-y-2">
        {hist.map((h) => (
          <div key={h.id} className="vex-panel p-3">
            <div className="text-[11px] flex justify-between" style={{ color: "#71717a" }}><span className="vex-code">{h.cwd}</span><span>{timeAgo(h.createdAt)} · {h.durationMs}ms · exit {h.exitCode}</span></div>
            <pre className="vex-code vex-pre text-[12px] mt-1" style={{ maxHeight: 240, overflow: "auto" }}>{h.output}</pre>
          </div>
        ))}
        {hist.length === 0 && <div className="text-[13px]" style={{ color: "#71717a" }}>No commands yet.</div>}
      </div>
    </div>
  );
}

/* ================= SETTINGS ================= */
function SettingsView() {
  const [s, setS] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [drivePresets, setDrivePresets] = useState<{ label: string; path: string }[]>([]);
  const load = useCallback(async () => { try { const r = await api("/api/settings"); setS(r.settings || {}); } catch (e: any) { setMsg(e.message); } }, []);
  useEffect(() => { const initial = setTimeout(() => load(), 0); return () => clearTimeout(initial); }, [load]);
  useEffect(() => {
    let active = true;
    const desktop = (window as Window & { vexDesktop?: DesktopBridge }).vexDesktop;
    void desktop?.getStoragePresets?.().then((presets) => { if (active) setDrivePresets(presets); });
    return () => { active = false; };
  }, []);
  async function chooseStorageDirectory() {
    const desktop = (window as Window & { vexDesktop?: DesktopBridge }).vexDesktop;
    if (!desktop?.chooseStorageDirectory) { setMsg("Folder selection is available in the installed desktop app."); return; }
    const selected = await desktop.chooseStorageDirectory();
    if (selected) setS((current) => ({ ...current, "storage.root": selected }));
  }
  async function save() {
    setMsg("");
    setSaving(true);
    try {
      setMsg("Saving settings and moving local data if the storage folder changed…");
      const result = await api("/api/settings", { method: "POST", body: JSON.stringify({ values: s }) });
      if (result.restartRequired) {
        setMsg("Storage moved. A-Center will restart now.");
        const desktop = (window as Window & { vexDesktop?: DesktopBridge }).vexDesktop;
        setTimeout(() => desktop?.restartApp?.(), 1200);
      } else setMsg("Settings saved.");
    } catch (e: any) { setMsg(e.message); }
    finally { setSaving(false); }
  }
  const row = (key: string, label: string, type = "text", opts?: string[]) => (
    <div className="grid gap-2 items-center" style={{ gridTemplateColumns: "220px 1fr" }}>
      <span className="text-[13px]" style={{ color: "#A1A1AA" }}>{label}<br /><span className="vex-code text-[11px]" style={{ color: "#71717a" }}>{key}</span></span>
      {type === "select" ? (
        <select className="vex-input" value={s[key] || ""} onChange={(e) => setS({ ...s, [key]: e.target.value })}>{(opts || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
      ) : <input className="vex-input" type={type} value={s[key] || ""} onChange={(e) => setS({ ...s, [key]: e.target.value })} />}
    </div>
  );
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Settings</h1>
      <p className="text-[13px] mb-3" style={{ color: "#A1A1AA" }}>Choose where local models, downloads, projects and app files live. Storage changes move existing files and restart A-Center.</p>
      {msg && <div className="vex-panel p-2.5 mb-3 text-[13px]">{msg}</div>}
      <div className="vex-panel p-4 space-y-3" style={{ maxWidth: 760 }}>
        <div className="grid gap-2 items-center" style={{ gridTemplateColumns: "220px 1fr auto" }}>
          <span className="text-[13px]" style={{ color: "#A1A1AA" }}>Storage folder<br /><span className="vex-code text-[11px]" style={{ color: "#71717a" }}>storage.root</span></span>
          <input className="vex-input" value={s["storage.root"] || ""} onChange={(e) => setS({ ...s, "storage.root": e.target.value })} placeholder="D:\\A-Center" />
          <button className="vex-btn-ghost" onClick={chooseStorageDirectory}>Browse…</button>
        </div>
        {drivePresets.length > 0 && <div className="flex flex-wrap gap-2" style={{ paddingLeft: 228 }}>{drivePresets.map((drive) => <button key={drive.path} className="vex-btn-ghost" onClick={() => setS({ ...s, "storage.root": drive.path })}>{drive.label} → {drive.path}</button>)}</div>}
        <div className="text-[11px] vex-code" style={{ color: "#71717a", paddingLeft: 228 }}>Models: {s["storage.root"] ? `${s["storage.root"]}\\models` : "—"} · Workspace: {s["storage.root"] ? `${s["storage.root"]}\\workspace` : "—"}</div>
        {row("models.autoRuntime", "Automatic runtime selection", "select", ["1", "0"])}
        {row("chat.defaultTemp", "Default temperature")}
        {row("chat.defaultCtx", "Default context tokens")}
        {row("terminal.defaultCwd", "Terminal default cwd")}
        {row("terminal.allowDangerous", "Allow dangerous commands (still needs per-command approval)", "select", ["0", "1"])}
        {row("roblox.port", "Roblox bridge port")}
        {row("updates.check", "Check for runtime/plugin updates", "select", ["1", "0"])}
        <button className="vex-btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
      </div>
      <div className="vex-panel p-4 mt-3" style={{ maxWidth: 760 }}>
        <div className="font-semibold text-[14px] mb-1">Offline operations matrix</div>
        <div className="text-[12px]" style={{ color: "#A1A1AA" }}>
          <div><b className="text-white">Online only:</b> model downloads · runtime downloads · plugin downloads · git sync · update checks</div>
          <div><b className="text-white">Offline:</b> inference · chat · coding · project editing · Roblox bridge · tasks · plugins · hardware · terminal</div>
          <div className="mt-1">Test: disconnect after setup — everything installed keeps working. No telemetry, no license phone-home.</div>
        </div>
      </div>
    </div>
  );
}

