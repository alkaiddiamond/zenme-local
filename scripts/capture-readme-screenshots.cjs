/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const electronExecutable = path.join(
  projectRoot,
  "dist-desktop",
  "win-unpacked",
  "Zenme.exe",
);
const outputDir = path.join(projectRoot, ".github", "assets");
const debuggingPort = 9_223;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
}

async function findPageTarget() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const targets = await requestJson(`http://127.0.0.1:${debuggingPort}/json/list`);
      const page = targets.find(
        (target) => target.type === "page" && /^http:\/\/127\.0\.0\.1:/.test(target.url),
      );
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Electron or the local Next.js server is still starting.
    }
    await delay(500);
  }
  throw new Error("Timed out waiting for the Zenme renderer debug target");
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Renderer evaluation failed");
  }
  return result.result.value;
}

async function waitForRenderer(client, origin) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const ready = await evaluate(
        client,
        `location.origin === ${JSON.stringify(origin)} && document.readyState === "complete"`,
      );
      if (ready) return;
    } catch {
      // The execution context can be replaced while the first page is loading.
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for the Zenme renderer to finish loading");
}

async function capture(client, fileName) {
  const result = await client.send("Page.captureScreenshot", {
    captureBeyondViewport: false,
    format: "png",
    fromSurface: true,
  });
  await fs.writeFile(path.join(outputDir, fileName), Buffer.from(result.data, "base64"));
}

const demoSetupExpression = String.raw`(async () => {
  const origin = __ZENME_ORIGIN__;
  const createProject = async (name, prompt) => {
    const response = await fetch(origin + '/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, prompt, model: 'glm-4.5' }),
    });
    if (!response.ok) throw new Error('Unable to create screenshot project');
    return response.json();
  };

  const primary = await createProject('品牌短片策划', '整理创意、脚本与制作任务');
  await createProject('本地知识库整理', '将研究资料沉淀为可检索的项目画布');
  await createProject('播客内容工作流', '从选题研究推进到节目发布');

  const now = new Date().toISOString();
  const snapshot = {
    version: 3,
    updatedAt: now,
    viewport: { x: 220, y: 105, zoom: 0.72 },
    nodes: [
      {
        id: 'insight',
        type: 'managedText',
        position: { x: 40, y: 30 },
        style: { width: 500, height: 330 },
        data: {
          kind: 'managedText',
          title: '强管理节点',
          name: '核心创意与受众洞察',
          tags: ['创意', '研究'],
          createdAt: now,
          plainText: '用真实人物的一天串联产品价值。画面保持克制，让本地优先与专注创作成为叙事核心。',
          richTextHtml: '',
          textMode: 'plain',
        },
      },
      {
        id: 'task',
        type: 'task',
        position: { x: 650, y: 45 },
        style: { width: 520, height: 176 },
        data: {
          kind: 'task',
          title: '任务',
          name: '完成 60 秒脚本初稿',
          tags: ['脚本', '本周'],
          createdAt: now,
          updatedAt: now,
          taskStatus: 'inProgress',
          taskPriority: 'P1',
          taskComplexity: 'medium',
          taskUrgency: 'urgent',
          taskChildrenExpanded: false,
          taskExpandedHeight: 460,
        },
      },
      {
        id: 'outline',
        type: 'text',
        position: { x: 40, y: 440 },
        style: { width: 560, height: 260 },
        data: {
          kind: 'text',
          title: '分镜提纲',
          plainText: '## 开场\n\n桌面、画布与资料自然展开。\n\n## 推进\n\n从灵感节点连接到脚本和执行任务。',
          richTextHtml: '',
          textMode: 'markdown',
        },
      },
      {
        id: 'generation',
        type: 'textGeneration',
        position: { x: 690, y: 350 },
        style: { width: 520, height: 220 },
        data: {
          kind: 'textGeneration',
          title: '文本生成',
          textGenerationModel: 'glm-4.5',
          textGenerationPrompt: '根据洞察与分镜提纲，生成自然、克制的旁白初稿。',
        },
      },
    ],
    edges: [
      { id: 'insight-task', source: 'insight', target: 'task', type: 'default' },
      { id: 'insight-outline', source: 'insight', target: 'outline', type: 'default' },
      { id: 'outline-generation', source: 'outline', target: 'generation', type: 'default' },
    ],
  };
  const formData = new FormData();
  formData.set('snapshot', JSON.stringify(snapshot));
  const canvasResponse = await fetch(origin + '/api/projects/' + primary.id + '/canvas', {
    method: 'PUT',
    body: formData,
  });
  if (!canvasResponse.ok) throw new Error('Unable to save screenshot canvas');
  return primary.id;
})()`;

async function main() {
  if (process.platform !== "win32") {
    throw new Error("README desktop screenshots currently require Windows");
  }
  await fs.access(electronExecutable);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-readme-capture-"));
  const appDataDir = path.join(temporaryRoot, "app-data");
  const userDataDir = path.join(appDataDir, "Zenme");
  const dataDir = path.join(temporaryRoot, "data");
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    path.join(userDataDir, "desktop-config.json"),
    `${JSON.stringify({ dataDir }, null, 2)}\n`,
    "utf8",
  );
  await fs.mkdir(outputDir, { recursive: true });

  const electron = spawn(
    electronExecutable,
    [
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${userDataDir}`,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        APPDATA: appDataDir,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  electron.stdout.on("data", (chunk) => process.stdout.write(chunk));
  electron.stderr.on("data", (chunk) => process.stderr.write(chunk));

  let client;
  try {
    const target = await findPageTarget();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");

    const origin = new URL(target.url).origin;
    await waitForRenderer(client, origin);
    const projectId = await evaluate(
      client,
      demoSetupExpression.replace("__ZENME_ORIGIN__", JSON.stringify(origin)),
    );
    await client.send("Page.navigate", { url: `${origin}/projects/${projectId}` });
    await delay(3_500);
    await capture(client, "canvas-nodes.png");

    await client.send("Page.navigate", { url: origin });
    await delay(2_500);
    await capture(client, "dashboard.png");
  } finally {
    client?.close();
    electron.kill();
    await delay(500);
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    if (!resolvedTemporaryRoot.startsWith(path.resolve(os.tmpdir()))) {
      throw new Error(`Refusing to remove unexpected temporary path: ${resolvedTemporaryRoot}`);
    }
    await fs.rm(resolvedTemporaryRoot, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
