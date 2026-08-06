/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("zenmeDesktop", {
  closeWindow: () => ipcRenderer.invoke("zenme:close-window"),
  getDataDir: () => ipcRenderer.invoke("zenme:get-data-dir"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  inspectMusicFolderForFile: (file) =>
    ipcRenderer.invoke("zenme:inspect-music-folder", webUtils.getPathForFile(file)),
  getServerUrl: () => ipcRenderer.invoke("zenme:get-server-url"),
  minimizeWindow: () => ipcRenderer.invoke("zenme:minimize-window"),
  openDataDir: () => ipcRenderer.invoke("zenme:open-data-dir"),
  openExternal: (url) => ipcRenderer.invoke("zenme:open-external", url),
  selectDataDir: () => ipcRenderer.invoke("zenme:select-data-dir"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("zenme:toggle-maximize-window"),
  writeClipboardText: (text) => ipcRenderer.invoke("zenme:write-clipboard-text", text),
});
