const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vexDesktop", {
  isDesktop: true,
  platform: process.platform,
  getApiToken: () => ipcRenderer.invoke("vex:get-api-token"),
});

