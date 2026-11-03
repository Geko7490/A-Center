# A-Center

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

