/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zenmeDesktop", {
  closeWindow: () => ipcRenderer.invoke("zenme:close-window"),
  getDataDir: () => ipcRenderer.invoke("zenme:get-data-dir"),
  getServerUrl: () => ipcRenderer.invoke("zenme:get-server-url"),
  minimizeWindow: () => ipcRenderer.invoke("zenme:minimize-window"),
  openDataDir: () => ipcRenderer.invoke("zenme:open-data-dir"),
  selectDataDir: () => ipcRenderer.invoke("zenme:select-data-dir"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("zenme:toggle-maximize-window"),
});
