/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { startBrowserControlServer } = require("./browser-control.cjs");

const SERVER_HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 45_000;
const APP_NAME = "Zenme";
const APP_ID = "local.zenme.desktop";
const IS_SMOKE_TEST = process.argv.includes("--smoke-test");
const DESKTOP_API_TOKEN = crypto.randomBytes(32).toString("hex");

let mainWindow = null;
let serverProcess = null;
let serverUrl = null;
let browserControlServer = null;
const projectWorkspaceSelections = new Map();
const PROJECT_WORKSPACE_SELECTION_TTL_MS = 30 * 60 * 1000;

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
  if (process.env.ZENME_DATA_DIR) {
    return path.resolve(process.env.ZENME_DATA_DIR);
  }
  const configured = readDesktopConfig().dataDir;
  if (configured && typeof configured === "string") {
    return configured;
  }

  migrateLegacyDefaultDataDirIfNeeded();
  return getDefaultDataDir();
}

function getAppIconPath() {
  const publicDir = app.isPackaged
    ? path.join(process.resourcesPath, "standalone", "public")
    : path.resolve(__dirname, "..", "public");
  return path.join(
    publicDir,
    "brand",
    "icons",
    "zenme-logo-256.png",
  );
}

function configureDockIcon() {
  if (process.platform !== "darwin" || !app.dock || app.isPackaged) {
    return;
  }

  app.dock.setIcon(path.resolve(__dirname, "..", "build", "icon-source-rounded.png"));
}

async function startLocalServer() {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  removeLegacyMusicServiceConfiguration();

  const port = await findAvailablePort();
  const nextServerUrl = `http://${SERVER_HOST}:${port}`;
  browserControlServer ??= await startBrowserControlServer({ BrowserWindow, token: DESKTOP_API_TOKEN });
  spawnNextServer(port, dataDir, browserControlServer.url);
  await waitForServer(nextServerUrl);
  serverUrl = nextServerUrl;
  return nextServerUrl;
}

function spawnNextServer(port, dataDir, browserControlUrl) {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "standalone")
    : path.resolve(__dirname, "..");
  const nodeRuntime = app.isPackaged
    ? process.execPath
    : (process.env.npm_node_execpath || "node");
  const env = {
    ...process.env,
    HOSTNAME: SERVER_HOST,
    LOCAL_MODEL_OCR_CACHE_PATH: path.join(dataDir, "ocr-models", "tesseract-cache-v2"),
    LOCAL_MODEL_OCR_LANG_PATH: path.join(dataDir, "ocr-models", "tessdata"),
    PORT: String(port),
    ZENME_DATA_DIR: dataDir,
    ZENME_DESKTOP: "1",
    ZENME_DESKTOP_TOKEN: DESKTOP_API_TOKEN,
    ZENME_BROWSER_CONTROL_URL: browserControlUrl,
    ZENME_SERVER_INSTANCE_ID: crypto.randomUUID(),
  };
  let serverArguments;
  if (app.isPackaged) {
    env.ELECTRON_RUN_AS_NODE = "1";
    env.NODE_ENV = "production";
    serverArguments = [path.join(root, "server.js")];
  } else {
    serverArguments = [
      require.resolve("next/dist/bin/next"),
      "dev",
      "--hostname",
      SERVER_HOST,
      "--port",
      String(port),
    ];
  }

  serverProcess = spawn(
    nodeRuntime,
    serverArguments,
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
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
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
    ...(process.platform === "darwin" ? {} : { icon: getAppIconPath() }),
    minHeight: 700,
    minWidth: 1100,
    title: APP_NAME,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 14, y: 14 },
    width: 1440,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });

  const sendWindowMaximizedState = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(
      "zenme:window-maximized-change",
      mainWindow.isMaximized(),
    );
  };
  mainWindow.on("maximize", sendWindowMaximizedState);
  mainWindow.on("unmaximize", sendWindowMaximizedState);
  mainWindow.on("closed", () => {
    mainWindow = null;
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
    await verifyPackagedBrowserController(nextServerUrl);
    setTimeout(() => app.quit(), 250);
  }
}

async function verifyPackagedBrowserController(targetUrl) {
  if (!browserControlServer) throw new Error("Browser control server is unavailable");
  const sessionId = `smoke:${crypto.randomUUID()}`;
  const request = async (body) => {
    const response = await fetch(browserControlServer.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${DESKTOP_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionId, ...body }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`Browser controller smoke failed: ${String(payload.error ?? response.status)}`);
    return payload;
  };
  const snapshot = await request({ operation: "navigate", url: targetUrl, includeScreenshot: false });
  if (snapshot.url !== targetUrl && !String(snapshot.url ?? "").startsWith(`${targetUrl}/`)) {
    throw new Error("Browser controller smoke returned an unexpected URL");
  }
  if (!Array.isArray(snapshot.elements) || typeof snapshot.text !== "string") {
    throw new Error("Browser controller smoke returned an invalid DOM snapshot");
  }
  await request({ operation: "close" });
  console.log(`[zenme-browser] smoke verified ${snapshot.url}`);
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

  ipcMain.handle("zenme:is-window-maximized", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return mainWindow.isMaximized();
  });

  ipcMain.handle("zenme:toggle-maximize-window", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
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

  ipcMain.handle("zenme:select-project-workspace", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      buttonLabel: "选择文件夹",
      properties: ["openDirectory", "createDirectory"],
      title: "选择项目源文件夹",
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };

    const now = Date.now();
    for (const [selectionId, selection] of projectWorkspaceSelections) {
      if (now - selection.createdAt > PROJECT_WORKSPACE_SELECTION_TTL_MS) {
        projectWorkspaceSelections.delete(selectionId);
      }
    }
    const rootPath = result.filePaths[0];
    const selectionId = crypto.randomUUID();
    projectWorkspaceSelections.set(selectionId, { createdAt: now, rootPath });
    return {
      canceled: false,
      selection: {
        displayName: path.basename(rootPath),
        displayPath: rootPath,
        selectionId,
      },
    };
  });

  ipcMain.handle("zenme:create-project-with-workspace", async (_event, input) => {
    const name = input && typeof input.name === "string" ? input.name.trim() : "";
    const selectionId = input && typeof input.selectionId === "string" ? input.selectionId : "";
    const selection = projectWorkspaceSelections.get(selectionId);
    projectWorkspaceSelections.delete(selectionId);
    if (!name || name.length > 200) throw new TypeError("项目名称无效");
    if (!selection || Date.now() - selection.createdAt > PROJECT_WORKSPACE_SELECTION_TTL_MS) {
      throw new Error("所选项目文件夹已失效，请重新选择");
    }
    if (!serverUrl) throw new Error("Zenme 本地服务尚未就绪");

    let project = null;
    try {
      const createResponse = await fetch(`${serverUrl}/api/projects`, {
        body: JSON.stringify({ name, prompt: "", model: "" }),
        headers: {
          "content-type": "application/json",
          "x-zenme-desktop-token": DESKTOP_API_TOKEN,
        },
        method: "POST",
      });
      const createBody = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(createBody && typeof createBody.error === "string" ? createBody.error : "项目创建失败");
      }
      project = createBody;

      const bindResponse = await fetch(
        `${serverUrl}/api/projects/${encodeURIComponent(project.id)}/workspace`,
        {
          body: JSON.stringify({ rootPath: selection.rootPath }),
          headers: {
            "content-type": "application/json",
            "x-zenme-desktop-token": DESKTOP_API_TOKEN,
          },
          method: "POST",
        },
      );
      const binding = await bindResponse.json();
      if (!bindResponse.ok) {
        throw new Error(binding && typeof binding.error === "string" ? binding.error : "Workspace 绑定失败");
      }
      return { binding, project };
    } catch (error) {
      if (project && typeof project.id === "string") {
        await fetch(`${serverUrl}/api/projects/${encodeURIComponent(project.id)}`, {
          headers: { "x-zenme-desktop-token": DESKTOP_API_TOKEN },
          method: "DELETE",
        }).catch(() => undefined);
      }
      throw error;
    }
  });

  ipcMain.handle("zenme:bind-project-workspace", async (_event, projectId) => {
    if (
      typeof projectId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(projectId)
    ) {
      throw new TypeError("Project ID is invalid");
    }
    if (!serverUrl) {
      throw new Error("Zenme local server is not ready");
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      buttonLabel: "绑定 Workspace",
      properties: ["openDirectory"],
      title: "选择项目 Workspace",
    });
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true };
    }

    const response = await fetch(
      `${serverUrl}/api/projects/${encodeURIComponent(projectId)}/workspace`,
      {
        body: JSON.stringify({ rootPath: result.filePaths[0] }),
        headers: {
          "content-type": "application/json",
          "x-zenme-desktop-token": DESKTOP_API_TOKEN,
        },
        method: "POST",
      },
    );
    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        body && typeof body.error === "string"
          ? body.error
          : "Workspace binding failed",
      );
    }
    return { binding: body, canceled: false };
  });

  ipcMain.handle(
    "zenme:set-project-workspace-write-access",
    async (_event, projectId, allowed) => {
      if (
        typeof projectId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(projectId) ||
        typeof allowed !== "boolean"
      ) {
        throw new TypeError("Workspace permission request is invalid");
      }
      if (!serverUrl) throw new Error("Zenme local server is not ready");
      const response = await fetch(
        `${serverUrl}/api/projects/${encodeURIComponent(projectId)}/workspace`,
        {
          body: JSON.stringify({ write: allowed }),
          headers: {
            "content-type": "application/json",
            "x-zenme-desktop-token": DESKTOP_API_TOKEN,
          },
          method: "PATCH",
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body && typeof body.error === "string"
            ? body.error
            : "Workspace permission update failed",
        );
      }
      return body;
    },
  );

  ipcMain.handle(
    "zenme:set-project-workspace-delete-access",
    async (_event, projectId, allowed) => {
      if (
        typeof projectId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(projectId) ||
        typeof allowed !== "boolean"
      ) {
        throw new TypeError("Workspace permission request is invalid");
      }
      if (!serverUrl) throw new Error("Zenme local server is not ready");
      const response = await fetch(
        `${serverUrl}/api/projects/${encodeURIComponent(projectId)}/workspace`,
        {
          body: JSON.stringify({ delete: allowed }),
          headers: {
            "content-type": "application/json",
            "x-zenme-desktop-token": DESKTOP_API_TOKEN,
          },
          method: "PATCH",
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error("Workspace permission update failed");
      return body;
    },
  );

  ipcMain.handle(
    "zenme:set-project-workspace-execute-access",
    async (_event, projectId, allowed) => {
      if (
        typeof projectId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(projectId) ||
        typeof allowed !== "boolean"
      ) {
        throw new TypeError("Workspace permission request is invalid");
      }
      if (!serverUrl) throw new Error("Zenme local server is not ready");
      const response = await fetch(
        `${serverUrl}/api/projects/${encodeURIComponent(projectId)}/workspace`,
        {
          body: JSON.stringify({ execute: allowed }),
          headers: {
            "content-type": "application/json",
            "x-zenme-desktop-token": DESKTOP_API_TOKEN,
          },
          method: "PATCH",
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error("Workspace permission update failed");
      return body;
    },
  );

  ipcMain.handle(
    "zenme:set-project-workspace-git-write-access",
    async (_event, projectId, allowed) => {
      if (
        typeof projectId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(projectId) ||
        typeof allowed !== "boolean"
      ) {
        throw new TypeError("Workspace permission request is invalid");
      }
      if (!serverUrl) throw new Error("Zenme local server is not ready");
      const response = await fetch(
        `${serverUrl}/api/projects/${encodeURIComponent(projectId)}/workspace`,
        {
          body: JSON.stringify({ gitWrite: allowed }),
          headers: {
            "content-type": "application/json",
            "x-zenme-desktop-token": DESKTOP_API_TOKEN,
          },
          method: "PATCH",
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error("Workspace permission update failed");
      return body;
    },
  );

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
    configureDockIcon();
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
  if (!mainWindow || mainWindow.isDestroyed()) {
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
  if (browserControlServer) {
    const controller = browserControlServer;
    browserControlServer = null;
    void controller.close();
  }
});
