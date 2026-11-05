# A-Center

Version 0.5.0 adds local model file creation/editing through the existing Local Dir field. Open a folder with **Local Dir ile yerel AI**, choose a GGUF/Ollama model in Agent mode, and review/approve its file proposals. Existing files are read before editing; changes have previews, backups and conflict checks. See [Local Dir file agent setup](docs/LOCAL_FILES.md).

Version 0.4.0 adds a Roblox Studio docked request panel and real, approval-gated Roblox task execution. See [Studio panel setup, update steps and test limits](docs/ROBLOX_BRIDGE.md). Replace the old VexBridge copy once; plugin 1.4.0 is required for task edits.

Version 0.2.0 adds optional EVREN and NVIDIA Build providers with OS-encrypted API keys, real SSE/reasoning output, a unified Model Center and approval-based agent tools. See [Cloud provider setup and validation](docs/CLOUD_PROVIDERS.md). API keys are entered in API Providers after installing this version; they are not bundled with the application.

Version 0.1.1 fixes Windows storage relocation and noninteractive GGUF chat. Relocation copies data and retains the source as a backup; after confirming the new location, remove only old model/download/runtime files. Keep the original `database` folder: the database remains in Electron's user data directory.

For GGUF chat, place the complete matching Vulkan llama.cpp build (EXE and DLL files) in the runtime folder and select the imported model in AI Workspace. Version 0.3.0 keeps one private llama-server loaded across messages, streams tokens and reports separate real prompt/generation rates, TTFT, cache reuse and actual GPU offload. See [local inference setup and measured benchmarks](docs/LOCAL_INFERENCE.md). Task Manager retains manual checklists; Roblox tasks additionally execute approved Studio proposals. Remaining product work is tracked in [ROADMAP.md](ROADMAP.md).

Run `npm run build` then `npm test` for the isolated API smoke tests. Set `A_CENTER_TEST_MODEL` to a local GGUF and put its matching `llama-server` on PATH to also check real model generation.

A-Center is a Windows desktop shell around the existing Next.js local workspace. The app server binds to `127.0.0.1`, keeps its database and workspace under the current user's Electron data directory, and is stopped when the desktop app exits.

## Windows installer

On a Windows build machine with Node.js 22 or newer:

```powershell
npm ci
npm run dist:win
```

The one-click, per-user installer is written to `release/`. It creates Start Menu and Desktop shortcuts. The first build is unsigned unless a code-signing certificate is configured; Windows may show a publisher warning for unsigned builds.

## Local development

```powershell
npm ci
npm run desktop:dev
```

The desktop shell starts Next.js on a loopback-only random port, waits for the local database migration, then opens the window. `npm run dev` is also available for browser-based development on `127.0.0.1`.

## Local data

The embedded PGlite database lives below Electron's per-user application data directory. Models, downloads, projects and other managed files use the configurable Storage folder in Settings. Drive presets create an `A-Center` folder automatically. Changing the folder moves existing files, updates saved paths, and restarts the app; active downloads and runtimes must be stopped first. Model Store can search Hugging Face and browse GGUF files from a repository by owner/name or URL. There is no PostgreSQL service to install. Database migrations are generated with `npm run db:generate` and applied before the desktop window opens.

## Roblox Studio bridge

Open Roblox Integration in A-Center, download `VexBridge.luau`, and install it in Roblox Studio's local Plugins directory. In Studio, allow HTTP requests for the experience if prompted and enable the plugin toolbar button. A-Center must remain open while commands are in use. Pairing uses a random local token; requests are served by the loopback-only A-Center server.

The Studio plugin can inspect the Explorer hierarchy, read or write supported scripts, create instances, and set properties. Treat write commands as project modifications and review their arguments before queueing them.

## GitHub Actions

The Windows workflow runs lint, TypeScript, Next.js production build, and NSIS installer packaging. The produced installer is uploaded as a workflow artifact.
