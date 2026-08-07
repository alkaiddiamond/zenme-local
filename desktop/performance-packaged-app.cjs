/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const profiles = {
  daily: { edgeCount: 150, nodeCount: 100 },
  large: { edgeCount: 750, nodeCount: 500 },
  pressure: { edgeCount: 2_000, nodeCount: 1_000 },
};
const SIXTY_HZ_FRAME_BUDGET_MS = 17;
const PROFILE_TIMEOUT_MS = 5 * 60_000;

function packagedExecutable() {
  if (process.env.ZENME_PACKAGED_APP) {
    return path.resolve(process.env.ZENME_PACKAGED_APP);
  }
  if (process.platform === "win32") {
    return path.join(projectRoot, "dist-desktop", "win-unpacked", "Zenme.exe");
  }
  if (process.platform === "darwin") {
    const candidates = ["mac", "mac-x64"].map((directory) =>
      path.join(
        projectRoot,
        "dist-desktop",
        directory,
        "Zenme.app",
        "Contents",
        "MacOS",
        "Zenme",
      ),
    );
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
  }
  return path.join(projectRoot, "dist-desktop", "linux-unpacked", "zenme-local");
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Unable to reserve a debugging port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

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

async function findPageTarget(debuggingPort) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const targets = await requestJson(
        `http://127.0.0.1:${debuggingPort}/json/list`,
      );
      const page = targets.find(
        (target) =>
          target.type === "page" && /^http:\/\/127\.0\.0\.1:/.test(target.url),
      );
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Electron and its local server are still starting.
    }
    await delay(500);
  }
  throw new Error("Timed out waiting for the packaged renderer target");
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
      clearTimeout(pending.timeoutId);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}, timeoutMs = 15_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { reject, resolve, timeoutId });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        "Renderer evaluation failed",
    );
  }
  return response.result.value;
}

async function waitFor(client, expression, message, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, expression)) return;
    } catch {
      // Navigation can replace the renderer execution context.
    }
    await delay(250);
  }
  throw new Error(message);
}

function fixtureExpression(origin, profileName, profile) {
  return `(${async function createFixture(input) {
    const now = new Date().toISOString();
    const imageUrl =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='480' height='280'%3E%3Crect width='100%25' height='100%25' fill='%23ddd6c7'/%3E%3C/svg%3E";
    const kinds = [
      "managedText",
      "task",
      "image",
      "reader",
      "music",
      "textGeneration",
    ];
    const columns = Math.ceil(Math.sqrt(input.nodeCount * 1.6));
    const nodes = Array.from({ length: input.nodeCount }, (_, index) => {
      const kind = kinds[index % kinds.length];
      const position = {
        x: (index % columns) * 580,
        y: Math.floor(index / columns) * 380,
      };
      const common = {
        id: `perf-node-${index}`,
        position,
        style: { height: 260, width: 520 },
        type: kind,
      };
      if (kind === "managedText") {
        return {
          ...common,
          data: {
            createdAt: now,
            kind,
            name: `富文本资料 ${index}`,
            plainText: `用于性能验证的富文本内容 ${index}。包含足够的中文段落，以模拟视觉行测量、编辑和历史记录压力。`,
            richTextHtml: `<p><strong>性能资料 ${index}</strong></p><p>固定场景内容，用于验证大画布平移与缩放。</p>`,
            tags: ["性能", `批次-${index % 8}`],
            textMode: "plain",
            title: `富文本资料 ${index}`,
          },
        };
      }
      if (kind === "task") {
        return {
          ...common,
          style: { height: 176, width: 520 },
          data: {
            createdAt: now,
            kind,
            name: `性能任务 ${index}`,
            tags: ["性能"],
            taskComplexity: "medium",
            taskPriority: index % 3 === 0 ? "P1" : "P3",
            taskStatus: index % 5 === 0 ? "completed" : "inProgress",
            taskUrgency: "walk",
            title: `性能任务 ${index}`,
            updatedAt: now,
          },
        };
      }
      if (kind === "image") {
        return {
          ...common,
          data: {
            imageAspectRatio: 12 / 7,
            imageHeight: 280,
            imageWidth: 480,
            kind,
            originalUrl: imageUrl,
            previewUrl: imageUrl,
            title: `性能图片 ${index}`,
          },
        };
      }
      if (kind === "reader") {
        return {
          ...common,
          style: { height: 360, width: 560 },
          data: {
            kind,
            readerCollapsed: false,
            readingError: "性能场景阅读器占位内容",
            sourceBookTitle: `性能读物 ${index}`,
            title: `阅读器 ${index}`,
          },
        };
      }
      if (kind === "music") {
        return {
          ...common,
          style: { height: 180, width: 480 },
          data: {
            kind,
            musicDuration: 240,
            musicWaveform: Array.from({ length: 160 }, (_, item) =>
              ((item * 17 + index * 11) % 100) / 100,
            ),
            title: `性能音乐 ${index}`,
          },
        };
      }
      return {
        ...common,
        data: {
          kind,
          textGenerationPrompt: `根据节点 ${index} 生成性能测试内容`,
          title: `文本生成 ${index}`,
        },
      };
    });
    const edges = Array.from({ length: input.edgeCount }, (_, index) => {
      const sourceIndex = index % input.nodeCount;
      const stride = 1 + Math.floor(index / input.nodeCount);
      return {
        id: `perf-edge-${index}`,
        source: `perf-node-${sourceIndex}`,
        target: `perf-node-${(sourceIndex + stride) % input.nodeCount}`,
        type: "default",
      };
    });
    const snapshot = {
      edges,
      nodes,
      updatedAt: now,
      version: 3,
      viewport: { x: 310, y: 160, zoom: 0.62 },
    };
    const projectResponse = await fetch(input.origin + "/api/projects", {
      body: JSON.stringify({
        initialCanvas: snapshot,
        model: "local-performance",
        name: `画布性能-${input.profileName}`,
        prompt: "Packaged Electron canvas performance fixture",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!projectResponse.ok) throw new Error("Unable to create performance project");
    const project = await projectResponse.json();
    return project.id;
  }})(${JSON.stringify({ origin, profileName, ...profile })})`;
}

const installSamplerExpression = `(() => {
  window.__ZENME_CANVAS_RUNTIME_COMMIT_COUNT__ = 0;
  window.__ZENME_ELECTRON_PERF_SAMPLE__?.mutationObserver?.disconnect();
  window.__ZENME_ELECTRON_PERF_SAMPLE__?.longTaskObserver?.disconnect();
  if (window.__ZENME_ELECTRON_PERF_SAMPLE__?.frameHandle) {
    cancelAnimationFrame(window.__ZENME_ELECTRON_PERF_SAMPLE__.frameHandle);
  }
  const sample = {
    active: false,
    frameDurations: [],
    frameHandle: 0,
    lastFrameAt: performance.now(),
    longTasks: [],
    nodeMounts: 0,
    nodeUnmounts: 0,
  };
  const countFlowNodes = (node) => {
    if (!(node instanceof Element)) return 0;
    return Number(node.matches('.react-flow__node')) +
      node.querySelectorAll('.react-flow__node').length;
  };
  sample.mutationObserver = new MutationObserver((records) => {
    if (!sample.active) return;
    for (const record of records) {
      for (const node of record.addedNodes) sample.nodeMounts += countFlowNodes(node);
      for (const node of record.removedNodes) sample.nodeUnmounts += countFlowNodes(node);
    }
  });
  const nodeLayer = document.querySelector('.react-flow__nodes');
  if (nodeLayer) sample.mutationObserver.observe(nodeLayer, { childList: true, subtree: true });
  if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    sample.longTaskObserver = new PerformanceObserver((list) => {
      if (!sample.active) return;
      for (const entry of list.getEntries()) sample.longTasks.push(entry.duration);
    });
    sample.longTaskObserver.observe({ type: 'longtask' });
  }
  const captureFrame = (now) => {
    if (sample.active) sample.frameDurations.push(now - sample.lastFrameAt);
    sample.lastFrameAt = now;
    sample.frameHandle = requestAnimationFrame(captureFrame);
  };
  sample.frameHandle = requestAnimationFrame(captureFrame);
  window.__ZENME_ELECTRON_PERF_SAMPLE__ = sample;
  return true;
})()`;

function samplerControlExpression(action) {
  if (action === "start") {
    return `(() => {
      const sample = window.__ZENME_ELECTRON_PERF_SAMPLE__;
      sample.active = false;
      sample.frameDurations = [];
      sample.longTasks = [];
      sample.nodeMounts = 0;
      sample.nodeUnmounts = 0;
      sample.lastFrameAt = performance.now();
      window.__ZENME_CANVAS_RUNTIME_COMMIT_COUNT__ = 0;
      window.__ZENME_CANVAS_PERF__ = [];
      sample.active = true;
      return true;
    })()`;
  }
  return `(() => {
    const sample = window.__ZENME_ELECTRON_PERF_SAMPLE__;
    sample.active = false;
    return {
      canvasCommits: window.__ZENME_CANVAS_RUNTIME_COMMIT_COUNT__ || 0,
      canvasMetrics: window.__ZENME_CANVAS_PERF__ || [],
      frameDurations: sample.frameDurations,
      longTasks: sample.longTasks,
      nodeMounts: sample.nodeMounts,
      nodeUnmounts: sample.nodeUnmounts,
    };
  })()`;
}

function summarizeCanvasMetrics(metrics) {
  const summary = {};
  for (const metric of metrics) {
    const current = summary[metric.label] ?? { count: 0, maxMs: 0, totalMs: 0 };
    current.count += 1;
    current.maxMs = Math.max(current.maxMs, metric.duration);
    current.totalMs += metric.duration;
    summary[metric.label] = current;
  }
  for (const item of Object.values(summary)) {
    item.averageMs = item.totalMs / item.count;
    delete item.totalMs;
  }
  return summary;
}

function summarizeDurations(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  const percentile = (ratio) =>
    sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
  return {
    averageMs: sorted.length
      ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length
      : 0,
    frames: sorted.length,
    maxMs: sorted.at(-1) ?? 0,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
  };
}

async function runWheelScenario(client, options) {
  await evaluate(client, samplerControlExpression("start"));
  const before = await client.send("Performance.getMetrics");
  const batchCount = 12;
  const batchSize = Math.max(1, Math.ceil(options.steps / batchCount));
  for (let batch = 0; batch < batchCount; batch += 1) {
    await evaluate(
      client,
      `(${function dispatchWheelBatch(input) {
        const target = document.querySelector(".react-flow");
        if (!target) throw new Error("Unable to find the React Flow surface");
        for (let index = 0; index < input.batchSize; index += 1) {
          target.dispatchEvent(new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            clientX: 1_050,
            clientY: 520,
            ctrlKey: input.ctrlKey,
            deltaX: input.deltaX,
            deltaY: input.deltaY,
          }));
        }
      }})(${JSON.stringify({
        batchSize,
        ctrlKey: options.modifiers === 2,
        deltaX: options.deltaX,
        deltaY: options.deltaY,
      })})`,
    );
    await delay(8);
  }
  await delay(240);
  const after = await client.send("Performance.getMetrics");
  const sample = await evaluate(client, samplerControlExpression("stop"));
  const beforeMap = Object.fromEntries(before.metrics.map((item) => [item.name, item.value]));
  const afterMap = Object.fromEntries(after.metrics.map((item) => [item.name, item.value]));
  return {
    ...summarizeDurations(sample.frameDurations),
    canvasCommits: sample.canvasCommits,
    canvasMetrics: summarizeCanvasMetrics(sample.canvasMetrics),
    heapDeltaMb:
      ((afterMap.JSHeapUsedSize ?? 0) - (beforeMap.JSHeapUsedSize ?? 0)) /
      1_048_576,
    layoutMs: ((afterMap.LayoutDuration ?? 0) - (beforeMap.LayoutDuration ?? 0)) * 1_000,
    longTaskCount: sample.longTasks.length,
    longTaskMaxMs: Math.max(0, ...sample.longTasks),
    nodeMounts: sample.nodeMounts,
    nodeUnmounts: sample.nodeUnmounts,
    scriptMs: ((afterMap.ScriptDuration ?? 0) - (beforeMap.ScriptDuration ?? 0)) * 1_000,
    taskMs: ((afterMap.TaskDuration ?? 0) - (beforeMap.TaskDuration ?? 0)) * 1_000,
  };
}

async function runPointerScenario(client, pointsExpression, options = {}) {
  const points = await evaluate(client, pointsExpression);
  if (!points?.start || !points?.end) {
    throw new Error("Unable to resolve pointer scenario coordinates");
  }
  if (options.debugName) {
    const hit = await evaluate(
      client,
      `(() => {
        const target = document.elementFromPoint(${points.start.x}, ${points.start.y});
        return target ? {
          className: String(target.className),
          nodeId: target.closest('.react-flow__node')?.getAttribute('data-id'),
          tagName: target.tagName,
        } : null;
      })()`,
    );
    console.log(`${options.debugName}: start hit ${JSON.stringify(hit)}`);
  }
  await evaluate(client, samplerControlExpression("start"));
  const before = await client.send("Performance.getMetrics");
  const button = options.button ?? "left";
  const buttons = button === "middle" ? 4 : 1;
  if (options.domMouseDown) {
    const targetExpression = options.domMouseDownTarget === "source-action"
      ? `document.querySelector('.react-flow__node[data-id="${points.sourceNodeId}"] .zenme-node-action-handle')`
      : `document.elementFromPoint(${points.start.x}, ${points.start.y})`;
    await evaluate(
      client,
      `(() => {
        const target = ${targetExpression};
        if (!target) throw new Error('Unable to hit pointer scenario target');
        target.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          button: ${button === "middle" ? 1 : 0},
          buttons: ${buttons},
          clientX: ${points.start.x},
          clientY: ${points.start.y},
          view: window,
        }));
      })()`,
    );
  } else {
    await client.send("Input.dispatchMouseEvent", {
      button,
      buttons,
      clickCount: 1,
      modifiers: options.modifiers ?? 0,
      type: "mousePressed",
      ...points.start,
    });
  }
  const steps = options.steps ?? 36;
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps;
    await client.send("Input.dispatchMouseEvent", {
      button,
      buttons,
      modifiers: options.modifiers ?? 0,
      type: "mouseMoved",
      x: points.start.x + (points.end.x - points.start.x) * ratio,
      y: points.start.y + (points.end.y - points.start.y) * ratio,
    });
    // Match a 60Hz pointer stream. CDP does not coalesce mouse events the way
    // Chromium coalesces real hardware pointer input.
    await delay(16);
  }
  if (options.domMouseUpTarget === "target-handle") {
    await evaluate(
      client,
      `(() => {
        const target = document.querySelector('.react-flow__node[data-id="${points.targetNodeId}"] .zenme-target-handle');
        if (!target) throw new Error('Unable to resolve pointer scenario release target');
        target.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true,
          button: ${button === "middle" ? 1 : 0},
          buttons: 0,
          clientX: ${points.end.x},
          clientY: ${points.end.y},
          view: window,
        }));
      })()`,
    );
  } else {
    await client.send("Input.dispatchMouseEvent", {
      button,
      buttons: 0,
      clickCount: 1,
      modifiers: options.modifiers ?? 0,
      type: "mouseReleased",
      ...points.end,
    });
  }
  await delay(240);
  const after = await client.send("Performance.getMetrics");
  const sample = await evaluate(client, samplerControlExpression("stop"));
  const beforeMap = Object.fromEntries(before.metrics.map((item) => [item.name, item.value]));
  const afterMap = Object.fromEntries(after.metrics.map((item) => [item.name, item.value]));
  return {
    ...summarizeDurations(sample.frameDurations),
    canvasCommits: sample.canvasCommits,
    canvasMetrics: summarizeCanvasMetrics(sample.canvasMetrics),
    heapDeltaMb:
      ((afterMap.JSHeapUsedSize ?? 0) - (beforeMap.JSHeapUsedSize ?? 0)) /
      1_048_576,
    layoutMs: ((afterMap.LayoutDuration ?? 0) - (beforeMap.LayoutDuration ?? 0)) * 1_000,
    longTaskCount: sample.longTasks.length,
    longTaskMaxMs: Math.max(0, ...sample.longTasks),
    nodeMounts: sample.nodeMounts,
    nodeUnmounts: sample.nodeUnmounts,
    scriptMs: ((afterMap.ScriptDuration ?? 0) - (beforeMap.ScriptDuration ?? 0)) * 1_000,
    taskMs: ((afterMap.TaskDuration ?? 0) - (beforeMap.TaskDuration ?? 0)) * 1_000,
  };
}

const visibleNodeDragPointsExpression = `(() => {
  const nodes = Array.from(document.querySelectorAll('.react-flow__node'));
  const node = nodes.find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return candidate.matches(
        '.react-flow__node-managedText, .react-flow__node-task, .react-flow__node-reader, .react-flow__node-textGeneration'
      ) && !candidate.querySelector('[data-canvas-content-shell]') &&
      rect.left >= 280 && rect.right <= innerWidth - 120 &&
      rect.top >= 40 && rect.bottom <= innerHeight;
  });
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  return {
    start: { x: rect.left + rect.width / 2, y: rect.top + 4 },
    end: { x: rect.left + rect.width / 2 + 140, y: rect.top + 84 },
  };
})()`;

const visibleNodeResizePointsExpression = `(() => {
  const handle = Array.from(document.querySelectorAll(
    '.react-flow__node.selected .react-flow__resize-control.handle.bottom.right'
  )).find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left > 0 && rect.right < innerWidth &&
      rect.top > 0 && rect.bottom < innerHeight;
  });
  if (!handle) return null;
  const rect = handle.getBoundingClientRect();
  const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  return {
    start,
    end: { x: start.x + 120, y: start.y + 80 },
  };
})()`;

const visibleNodeConnectPointsExpression = `(() => {
  const source = Array.from(document.querySelectorAll(
    '.react-flow__node:not(:has([data-canvas-content-shell])) .zenme-node-action-handle'
  )).find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return x > 0 && x < innerWidth && y > 0 && y < innerHeight;
  });
  const sourceNode = source?.closest('.react-flow__node');
  const sourceIndex = Number(sourceNode?.getAttribute('data-id')?.split('-').at(-1));
  const sourceRect = source?.getBoundingClientRect();
  const sourceCenter = sourceRect ? {
    x: sourceRect.left + sourceRect.width / 2,
    y: sourceRect.top + sourceRect.height / 2,
  } : null;
  const targets = Array.from(document.querySelectorAll(
    '.react-flow__node:not(.selected):not(:has([data-canvas-content-shell])) .zenme-target-handle'
  ));
  const target = targets.filter((candidate) => {
    const node = candidate.closest('.react-flow__node');
    const rect = candidate.getBoundingClientRect();
    const targetIndex = Number(node?.getAttribute('data-id')?.split('-').at(-1));
    return node !== sourceNode && Math.abs(targetIndex - sourceIndex) > 3 &&
      rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
  }).sort((left, right) => {
    if (!sourceCenter) return 0;
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    return Math.hypot(
      leftRect.left + leftRect.width / 2 - sourceCenter.x,
      leftRect.top + leftRect.height / 2 - sourceCenter.y,
    ) - Math.hypot(
      rightRect.left + rightRect.width / 2 - sourceCenter.x,
      rightRect.top + rightRect.height / 2 - sourceCenter.y,
    );
  })[0];
  if (!source || !target) return null;
  const targetRect = target.getBoundingClientRect();
  return {
    sourceNodeId: sourceNode.getAttribute('data-id'),
    targetNodeId: target.closest('.react-flow__node').getAttribute('data-id'),
    start: {
      x: sourceRect.left + sourceRect.width / 2,
      y: sourceRect.top + sourceRect.height / 2,
    },
    end: {
      x: targetRect.left + targetRect.width / 2,
      y: targetRect.top + targetRect.height / 2,
    },
  };
})()`;

const selectionDragPointsExpression = `(() => {
  const pane = document.querySelector('.react-flow__pane');
  if (!pane) return null;
  const rect = pane.getBoundingClientRect();
  const points = [];
  for (const xRatio of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    for (const yRatio of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const point = {
        x: rect.left + rect.width * xRatio,
        y: rect.top + rect.height * yRatio,
      };
      if (document.elementFromPoint(point.x, point.y) === pane) points.push(point);
    }
  }
  let pair = null;
  for (const start of points) {
    for (const end of points) {
      const distance = Math.hypot(start.x - end.x, start.y - end.y);
      if (!pair || distance > pair.distance) pair = { distance, end, start };
    }
  }
  if (!pair || pair.distance < 240) return null;
  return {
    start: pair.start,
    end: pair.end,
  };
})()`;

const panDragPointsExpression = `(() => {
  const pane = document.querySelector('.react-flow__pane');
  if (!pane) return null;
  const rect = pane.getBoundingClientRect();
  return {
    start: { x: rect.left + rect.width * 0.55, y: rect.top + rect.height * 0.5 },
    end: { x: rect.left + rect.width * 0.75, y: rect.top + rect.height * 0.68 },
  };
})()`;

async function runProfile(client, origin, profileName, profile) {
  console.log(`${profileName}: creating fixture`);
  const projectId = await evaluate(
    client,
    fixtureExpression(origin, profileName, profile),
  );
  await client.send("Page.navigate", {
    url: `${origin}/projects/${projectId}`,
  });
  try {
    await waitFor(
      client,
      `document.querySelectorAll('.react-flow__node').length === ${profile.nodeCount}`,
      `Timed out rendering the ${profileName} performance canvas`,
      90_000,
    );
  } catch (error) {
    const diagnostic = await evaluate(
      client,
      `(() => ({
        body: document.body?.innerText?.slice(0, 800),
        nodeCount: document.querySelectorAll('.react-flow__node').length,
        readyState: document.readyState,
        shells: document.querySelectorAll('[data-canvas-content-shell]').length,
        title: document.title,
        url: location.href,
      }))()`,
    ).catch((diagnosticError) => ({
      diagnosticError:
        diagnosticError instanceof Error
          ? diagnosticError.message
          : String(diagnosticError),
    }));
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}: ${JSON.stringify(diagnostic)}`,
    );
  }
  await delay(1_000);
  console.log(`${profileName}: canvas ready`);
  await evaluate(
    client,
    `history.replaceState(history.state, '', location.pathname + '?zenmePerfRuntime=1')`,
  );
  await evaluate(client, installSamplerExpression);
  await client.send("Performance.enable");
  await client.send("HeapProfiler.enable");
  await client.send("HeapProfiler.collectGarbage");
  await delay(200);
  const dom = await evaluate(
    client,
    `(() => ({
      fullContent: document.querySelectorAll('.react-flow__node:not(:has([data-canvas-content-shell]))').length,
      edges: document.querySelectorAll('.react-flow__edge').length,
      nodes: document.querySelectorAll('.react-flow__node').length,
      shells: document.querySelectorAll('[data-canvas-content-shell]').length,
    }))()`,
  );
  const pan = await runPointerScenario(client, panDragPointsExpression, {
    button: "middle",
    steps: 12,
  });
  console.log(`${profileName}: pan complete`);
  const zoom = await runWheelScenario(client, {
    deltaX: 0,
    deltaY: -6,
    modifiers: 2,
    steps: 36,
  });
  console.log(`${profileName}: zoom complete`);
  const nodeDrag = await runPointerScenario(
    client,
    visibleNodeDragPointsExpression,
    { steps: 12 },
  );
  console.log(`${profileName}: node drag complete`);
  const resize = await runPointerScenario(
    client,
    visibleNodeResizePointsExpression,
    { debugName: `${profileName}: resize`, domMouseDown: true, steps: 12 },
  );
  if (!resize.canvasMetrics["interaction resize"]) {
    throw new Error("Resize scenario did not exercise the resize lifecycle");
  }
  console.log(`${profileName}: resize complete ${JSON.stringify(resize)}`);
  const edgeCountBeforeConnect = await evaluate(
    client,
    `document.querySelectorAll('.react-flow__edge').length`,
  );
  const connect = await runPointerScenario(
    client,
    visibleNodeConnectPointsExpression,
    {
      debugName: `${profileName}: connect`,
      domMouseDown: true,
      domMouseDownTarget: "source-action",
      domMouseUpTarget: "target-handle",
      steps: 12,
    },
  );
  const edgeCountAfterConnect = await evaluate(
    client,
    `document.querySelectorAll('.react-flow__edge').length`,
  );
  if (edgeCountAfterConnect <= edgeCountBeforeConnect) {
    throw new Error("Connect scenario did not create an edge");
  }
  console.log(`${profileName}: connect complete ${JSON.stringify(connect)}`);
  console.log(`${profileName}: selection starting`);
  const selection = await runPointerScenario(
    client,
    selectionDragPointsExpression,
    { steps: 12 },
  );
  if (!selection.canvasMetrics["interaction selection"]) {
    throw new Error("Selection scenario did not exercise the selection lifecycle");
  }
  console.log(`${profileName}: selection complete ${JSON.stringify(selection)}`);
  const memoryStart = await client.send("Performance.getMetrics");
  await delay(30_000);
  console.log(`${profileName}: memory observation complete`);
  const memoryEnd = await client.send("Performance.getMetrics");
  const persistedBeforeReload = await evaluate(
    client,
    `(async () => {
      const response = await fetch('/api/projects/${projectId}/canvas', { cache: 'no-store' });
      const record = await response.json();
      const snapshot = record?.snapshot;
      return snapshot ? {
        edgeCount: snapshot.edges.length,
        nodeCount: snapshot.nodes.length,
        signature: JSON.stringify({
          edges: snapshot.edges,
          nodes: snapshot.nodes,
          viewport: snapshot.viewport,
        }),
      } : null;
    })()`,
  );
  if (
    !persistedBeforeReload ||
    persistedBeforeReload.nodeCount !== profile.nodeCount ||
    persistedBeforeReload.edgeCount < profile.edgeCount + 1
  ) {
    throw new Error(
      `${profileName} did not autosave the latest nodes and connected edge`,
    );
  }
  await client.send("Page.reload");
  await waitFor(
    client,
    `document.querySelectorAll('.react-flow__node').length === ${profile.nodeCount}`,
    `Timed out restoring the ${profileName} canvas after reload`,
    90_000,
  );
  const persistedAfterReload = await evaluate(
    client,
    `(async () => {
      const response = await fetch('/api/projects/${projectId}/canvas', { cache: 'no-store' });
      const record = await response.json();
      const snapshot = record?.snapshot;
      return snapshot ? JSON.stringify({
        edges: snapshot.edges,
        nodes: snapshot.nodes,
        viewport: snapshot.viewport,
      }) : null;
    })()`,
  );
  if (persistedAfterReload !== persistedBeforeReload.signature) {
    throw new Error(`${profileName} changed persistent canvas state after reload`);
  }
  console.log(`${profileName}: persistence reload complete`);
  const memoryStartMap = Object.fromEntries(
    memoryStart.metrics.map((item) => [item.name, item.value]),
  );
  const memoryEndMap = Object.fromEntries(
    memoryEnd.metrics.map((item) => [item.name, item.value]),
  );
  return {
    dom,
    edges: profile.edgeCount,
    memory30sDeltaMb:
      ((memoryEndMap.JSHeapUsedSize ?? 0) - (memoryStartMap.JSHeapUsedSize ?? 0)) /
      1_048_576,
    nodes: profile.nodeCount,
    persistence: {
      edgeCount: persistedBeforeReload.edgeCount,
      nodeCount: persistedBeforeReload.nodeCount,
      reloadMatched: true,
    },
    connect,
    nodeDrag,
    pan,
    profile: profileName,
    resize,
    selection,
    zoom,
  };
}

function selectedProfiles() {
  const requested = process.argv
    .find((argument) => argument.startsWith("--profile="))
    ?.slice("--profile=".length);
  if (!requested || requested === "all") return Object.entries(profiles);
  if (!profiles[requested]) throw new Error(`Unknown performance profile: ${requested}`);
  return [[requested, profiles[requested]]];
}

function assertTargets(results) {
  const large = results.find((result) => result.profile === "large");
  if (!large) return;
  for (const [name, scenario] of [
    ["pan", large.pan],
    ["zoom", large.zoom],
    ["nodeDrag", large.nodeDrag],
    ["resize", large.resize],
    ["connect", large.connect],
    ["selection", large.selection],
  ]) {
    if (scenario.p95Ms > SIXTY_HZ_FRAME_BUDGET_MS) {
      throw new Error(
        `Large canvas ${name} P95 ${scenario.p95Ms.toFixed(2)}ms exceeds ${SIXTY_HZ_FRAME_BUDGET_MS.toFixed(1)}ms`,
      );
    }
    if (scenario.longTaskCount > 0 || scenario.longTaskMaxMs > 50) {
      throw new Error(`Large canvas ${name} produced a >50ms long task`);
    }
    if (scenario.nodeMounts !== 0 || scenario.nodeUnmounts !== 0) {
      throw new Error(`Large canvas ${name} mounted or unmounted React Flow nodes`);
    }
  }
}

async function main() {
  const executable = packagedExecutable();
  if (!fs.existsSync(executable)) {
    throw new Error(`Packaged application not found: ${executable}`);
  }
  const temporaryRoot = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "zenme-canvas-performance-"),
  );
  const appDataDir = path.join(temporaryRoot, "app-data");
  const userDataDir = path.join(appDataDir, "Zenme");
  const dataDir = path.join(temporaryRoot, "data");
  const debuggingPort = await reservePort();
  await fsPromises.mkdir(userDataDir, { recursive: true });
  await fsPromises.mkdir(dataDir, { recursive: true });
  await fsPromises.writeFile(
    path.join(userDataDir, "desktop-config.json"),
    `${JSON.stringify({ dataDir }, null, 2)}\n`,
    "utf8",
  );
  const electron = spawn(
    executable,
    [
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${userDataDir}`,
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
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
  let output = "";
  electron.stdout.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-16_000);
  });
  electron.stderr.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-16_000);
  });
  let client;
  try {
    const target = await findPageTarget(debuggingPort);
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    const origin = new URL(target.url).origin;
    await waitFor(
      client,
      `location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`,
      "Timed out waiting for the packaged renderer",
    );
    const results = [];
    for (const [profileName, profile] of selectedProfiles()) {
      console.log(`Running ${profileName}: ${profile.nodeCount} nodes / ${profile.edgeCount} edges`);
      results.push(await Promise.race([
        runProfile(client, origin, profileName, profile),
        new Promise((_, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error(`${profileName} profile exceeded ${PROFILE_TIMEOUT_MS / 1000}s`));
          }, PROFILE_TIMEOUT_MS);
          timeoutId.unref?.();
        }),
      ]));
    }
    const report = {
      createdAt: new Date().toISOString(),
      executable,
      platform: `${process.platform}-${process.arch}`,
      results,
    };
    const reportDir = path.join(projectRoot, ".logs");
    await fsPromises.mkdir(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, "canvas-performance-latest.json");
    await fsPromises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    console.log(`Canvas performance report: ${reportPath}`);
    if (process.argv.includes("--assert")) assertTargets(results);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`);
  } finally {
    client?.close();
    if (process.platform === "win32" && electron.pid) {
      await new Promise((resolve) => {
        const cleanup = spawn(
          "taskkill",
          ["/PID", String(electron.pid), "/T", "/F"],
          { stdio: "ignore", windowsHide: true },
        );
        cleanup.once("error", resolve);
        cleanup.once("exit", resolve);
      });
    } else {
      electron.kill("SIGTERM");
    }
    await delay(250);
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    if (!resolvedTemporaryRoot.startsWith(path.resolve(os.tmpdir()))) {
      throw new Error(`Refusing to remove unexpected temporary path: ${resolvedTemporaryRoot}`);
    }
    await fsPromises.rm(resolvedTemporaryRoot, { force: true, recursive: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  assertTargets,
  profiles,
  SIXTY_HZ_FRAME_BUDGET_MS,
  summarizeDurations,
};
