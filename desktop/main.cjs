/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const SERVER_HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 45_000;
const APP_NAME = "Zenme";
const APP_ID = "local.zenme.desktop";
const IS_SMOKE_TEST = process.argv.includes("--smoke-test");

let mainWindow = null;
let serverProcess = null;
let serverUrl = null;

app.setName(APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

async function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, SERVER_HOST, () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Unable to reserve local server port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function getDesktopConfigPath() {
  return path.join(app.getPath("userData"), "desktop-config.json");
}

function getDefaultDataDir() {
  return path.join(app.getPath("userData"), "data");
}

function getLegacyElectronDataDir() {
  return path.join(app.getPath("appData"), "Electron", "data");
}

function configureApplicationMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "editMenu" }]));
    return;
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "显示",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ]));
}

function hasLocalProjects(dataDir) {
  try {
    const projectsDir = path.join(dataDir, "projects");
    if (!fs.existsSync(projectsDir)) {
      return false;
    }

    return fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .some((entry) => {
        if (!entry.isDirectory()) {
          return false;
        }

        return fs.existsSync(path.join(projectsDir, entry.name, "project.json"));
      });
  } catch {
    return false;
  }
}

function migrateLegacyDefaultDataDirIfNeeded() {
  const defaultDataDir = getDefaultDataDir();
  const legacyDataDir = getLegacyElectronDataDir();

  if (hasLocalProjects(defaultDataDir) || !hasLocalProjects(legacyDataDir)) {
    return;
  }

  fs.mkdirSync(defaultDataDir, { recursive: true });
  fs.cpSync(legacyDataDir, defaultDataDir, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
}

function readDesktopConfig() {
  try {
    return JSON.parse(fs.readFileSync(getDesktopConfigPath(), "utf-8"));
  } catch {
    return {};
  }
}

function writeDesktopConfig(config) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(
    getDesktopConfigPath(),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf-8",
  );
}

function removeLegacyMusicServiceConfiguration() {
  const config = readDesktopConfig();
  if (!("musicService" in config)) return;
  delete config.musicService;
  writeDesktopConfig(config);
}

function getDataDir() {
  const configured = readDesktopConfig().dataDir;
  if (configured && typeof configured === "string") {
    return configured;
  }

  migrateLegacyDefaultDataDirIfNeeded();
  return getDefaultDataDir();
}

function getAppIconPath() {
  return path.resolve(
    __dirname,
    "..",
    "public",
    "brand",
    "icons",
    "zenme-logo-256.png",
  );
}

async function startLocalServer() {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  removeLegacyMusicServiceConfiguration();

  const port = await findAvailablePort();
  const nextServerUrl = `http://${SERVER_HOST}:${port}`;
  spawnNextServer(port, dataDir);
  await waitForServer(nextServerUrl);
  serverUrl = nextServerUrl;
  return nextServerUrl;
}

function spawnNextServer(port, dataDir) {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked")
    : path.resolve(__dirname, "..");
  const nextCli = require.resolve("next/dist/bin/next");
  const nodeRuntime = app.isPackaged
    ? process.execPath
    : (process.env.npm_node_execpath || "node");
  const env = {
    ...process.env,
    ZENME_DATA_DIR: dataDir,
    ZENME_DESKTOP: "1",
  };
  if (app.isPackaged) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }

  serverProcess = spawn(
    nodeRuntime,
    [
      nextCli,
      app.isPackaged ? "start" : "dev",
      "--hostname",
      SERVER_HOST,
      "--port",
      String(port),
    ],
    {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  serverProcess.stdout.on("data", (chunk) => {
    console.log(`[zenme-server] ${String(chunk).trimEnd()}`);
  });
  serverProcess.stderr.on("data", (chunk) => {
    console.error(`[zenme-server] ${String(chunk).trimEnd()}`);
  });
  const child = serverProcess;
  child.once("exit", (code, signal) => {
    console.log(`[zenme-server] exited code=${code} signal=${signal}`);
    if (serverProcess === child) {
      serverProcess = null;
    }
  });
}

function stopLocalServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  child.kill();
}

async function restartLocalServer() {
  stopLocalServer();
  const nextServerUrl = await startLocalServer();
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(nextServerUrl);
  }
  return nextServerUrl;
}

async function waitForServer(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    try {
      const response = await fetch(`${url}/api/settings`);
      if (response.ok) return;
    } catch {
      // Server is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Zenme local server did not become ready in time");
}

async function createWindow() {
  const nextServerUrl = await startLocalServer();
  const trustedOrigin = new URL(nextServerUrl).origin;

  mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    frame: false,
    height: 900,
    icon: getAppIconPath(),
    minHeight: 700,
    minWidth: 1100,
    title: APP_NAME,
    titleBarStyle: "hidden",
    width: 1440,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });

  mainWindow.webContents.on("console-message", (details) => {
    console.log(
      `[zenme-renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`,
    );
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[zenme-window] did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[zenme-renderer] gone reason=${details.reason} exitCode=${details.exitCode}`);
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      event.preventDefault();
      return;
    }
    if (target.origin !== trustedOrigin) {
      event.preventDefault();
      if (target.protocol === "https:" || target.protocol === "http:") {
        void shell.openExternal(target.toString());
      }
    }
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === "https:" || target.protocol === "http:") {
        void shell.openExternal(target.toString());
      }
    } catch {
      // Ignore malformed or unsupported external URLs.
    }
    return { action: "deny" };
  });

  await mainWindow.loadURL(nextServerUrl);

  if (IS_SMOKE_TEST) {
    setTimeout(() => app.quit(), 1_000);
  }
}

function registerIpcHandlers() {
  ipcMain.handle("zenme:get-data-dir", () => getDataDir());
  ipcMain.handle("zenme:write-clipboard-text", (_event, value) => {
    if (typeof value !== "string") {
      throw new TypeError("Clipboard text must be a string");
    }
    clipboard.writeText(value);
    return true;
  });
  ipcMain.handle("zenme:open-external", async (_event, rawUrl) => {
    const target = new URL(String(rawUrl));
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      throw new Error("Unsupported external URL protocol");
    }
    await shell.openExternal(target.toString());
    return true;
  });
  ipcMain.handle("zenme:minimize-window", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.minimize();
  });

  ipcMain.handle("zenme:toggle-maximize-window", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle("zenme:close-window", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.close();
  });

  ipcMain.handle("zenme:open-data-dir", async () => {
    const dataDir = getDataDir();
    fs.mkdirSync(dataDir, { recursive: true });
    await shell.openPath(dataDir);
    return dataDir;
  });

  ipcMain.handle("zenme:select-data-dir", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      buttonLabel: "选择数据目录",
      defaultPath: getDataDir(),
      properties: ["openDirectory", "createDirectory"],
      title: "选择 Zenme 数据目录",
    });

    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true, dataDir: getDataDir(), restarted: false };
    }

    const dataDir = result.filePaths[0];
    fs.mkdirSync(dataDir, { recursive: true });
    writeDesktopConfig({ ...readDesktopConfig(), dataDir });
    await restartLocalServer();
    return { canceled: false, dataDir, restarted: true };
  });

  ipcMain.handle("zenme:inspect-music-folder", async (_event, rawPath) => {
    if (typeof rawPath !== "string" || !path.isAbsolute(rawPath)) return null;
    const directoryPath = path.resolve(rawPath);
    let directoryStat;
    try {
      directoryStat = fs.statSync(directoryPath);
    } catch {
      return null;
    }
    if (!directoryStat.isDirectory()) return null;
    const audioExtensions = new Set([
      ".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".webm", ".wma",
    ]);
    const mimeTypes = {
      ".aac": "audio/aac", ".flac": "audio/flac", ".m4a": "audio/mp4",
      ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".opus": "audio/opus",
      ".wav": "audio/wav", ".webm": "audio/webm", ".wma": "audio/x-ms-wma",
    };
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    const files = entries.flatMap((entry) => {
      const extension = path.extname(entry.name).toLowerCase();
      if (!entry.isFile() || !audioExtensions.has(extension)) return [];
      const filePath = path.join(directoryPath, entry.name);
      const stat = fs.statSync(filePath);
      return [{
        name: entry.name,
        path: filePath,
        size: stat.size,
        type: mimeTypes[extension] || "audio/*",
      }];
    });
    return {
      files,
      name: path.basename(directoryPath),
      path: directoryPath,
    };
  });

  ipcMain.handle("zenme:get-server-url", () => serverUrl);
}

app.whenReady().then(async () => {
  try {
    configureApplicationMenu();
    registerIpcHandlers();
    await createWindow();
  } catch (error) {
    dialog.showErrorBox(
      "Zenme 启动失败",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopLocalServer();
});
