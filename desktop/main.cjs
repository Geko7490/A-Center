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
  serverProcess = spawn(process.execPath, args, {
    cwd: app.isPackaged ? app.getAppPath() : path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: app.isPackaged ? "production" : "development",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      VEX_LOCAL_TOKEN: localToken,
      VEX_STORAGE: path.join(userData, "storage"),
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
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverUrl) createWindow();
});

app.on("before-quit", () => {
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

