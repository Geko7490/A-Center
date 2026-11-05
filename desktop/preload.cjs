const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vexDesktop", {
  isDesktop: true,
  platform: process.platform,
  getApiToken: () => ipcRenderer.invoke("vex:get-api-token"),
  chooseStorageDirectory: () => ipcRenderer.invoke("vex:choose-storage-directory"),
  getStoragePresets: () => ipcRenderer.invoke("vex:get-storage-presets"),
  restartApp: () => ipcRenderer.invoke("vex:restart-app"),
});

