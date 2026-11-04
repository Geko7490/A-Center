const { app, BrowserWindow, ipcMain, session } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

let serverProcess;
let mainWindow;
let localToken;
let serverUrl;
let credentialBridge;

function findPort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function appServerEntry() {
  const root = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, "..");
  return path.join(root, "node_modules", "next", "dist", "bin", "next");
}

async function waitForReady(url, child) {
  const deadline = Date.now() + 90000;
  let lastError = "server did not become ready";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Local app server exited (${child.exitCode}).`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) {
        const body = await response.json();
        if (body.ok) return;
        lastError = body.error || lastError;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`A-Center startup timed out: ${lastError}`);
}

async function startLocalServer() {
  const port = await findPort();
  const entry = appServerEntry();
  const args = [entry, app.isPackaged ? "start" : "dev", "--hostname", "127.0.0.1", "--port", String(port)];
  localToken = crypto.randomBytes(32).toString("hex");
  const userData = app.getPath("userData");
  fs.mkdirSync(userData, { recursive: true });
  credentialBridge = await require("./credentials.cjs").createCredentialBridge(require("electron").safeStorage, userData);
  const defaultStorageRoot = path.join(userData, "storage");
  const configPath = path.join(userData, "settings.json");
  let storageRoot = defaultStorageRoot;
  try {
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (typeof saved.storageRoot === "string" && path.isAbsolute(saved.storageRoot)) storageRoot = path.resolve(saved.storageRoot);
  } catch {}
  for (const folder of ["models", "downloads", "workspace", "backups", "plugins", "runtimes"]) {
    fs.mkdirSync(path.join(storageRoot, folder), { recursive: true });
  }
  serverProcess = spawn(process.execPath, args, {
    cwd: app.isPackaged ? app.getAppPath() : path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: app.isPackaged ? "production" : "development",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      VEX_LOCAL_TOKEN: localToken,
      VEX_CREDENTIAL_URL: credentialBridge.url,
      VEX_CREDENTIAL_TOKEN: credentialBridge.token,
      VEX_STORAGE: storageRoot,
      VEX_DATABASE: path.join(defaultStorageRoot, "database"),
      VEX_CONFIG_PATH: configPath,
      VEX_MIGRATIONS_DIR: path.join(app.isPackaged ? app.getAppPath() : path.resolve(__dirname, ".."), "drizzle"),
    },
    stdio: "ignore",
    windowsHide: true,
  });
  serverProcess.once("error", (error) => console.error("A-Center server process error:", error));
  serverUrl = `http://127.0.0.1:${port}`;
  await waitForReady(serverUrl, serverProcess);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: "#09090b",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(`${serverUrl}/`)) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(serverUrl);
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.vex.a-center");
  ipcMain.handle("vex:get-api-token", () => localToken);
  ipcMain.handle("vex:choose-storage-directory", async () => {
    const result = await require("electron").dialog.showOpenDialog(mainWindow, {
      title: "Choose a drive or parent folder for A-Center data",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = result.filePaths[0];
    return path.basename(selected).toLowerCase() === "a-center" ? selected : path.join(selected, "A-Center");
  });
  ipcMain.handle("vex:get-storage-presets", () => {
    if (process.platform !== "win32") return [];
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
      .map((letter) => `${letter}:\\`)
      .filter((drive) => fs.existsSync(drive))
      .map((drive) => ({ label: `${drive.slice(0, 2)} drive`, path: path.join(drive, "A-Center") }));
  });
  ipcMain.handle("vex:restart-app", () => {
    app.relaunch();
    app.quit();
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": ["default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' http://127.0.0.1:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"],
      },
    });
  });
  try {
    await startLocalServer();
    createWindow();
  } catch (error) {
    console.error(error);
    require("electron").dialog.showErrorBox("A-Center could not start", String(error));
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverUrl) createWindow();
});

app.on("before-quit", () => {
  credentialBridge?.close();
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

