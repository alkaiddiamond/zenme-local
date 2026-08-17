/* eslint-disable @typescript-eslint/no-require-imports */
const http = require("node:http");

const HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_SESSIONS = 8;
const SESSION_IDLE_MS = 10 * 60 * 1000;
const NAVIGATION_TIMEOUT_MS = 30_000;

function isLoopbackPreviewUrl(value) {
  try {
    const target = new URL(String(value));
    if (target.protocol !== "http:" && target.protocol !== "https:") return false;
    if (target.username || target.password) return false;
    const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function validSessionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,200}$/.test(value);
}

function validElementRef(value) {
  return typeof value === "string" && /^e[1-9]\d{0,5}$/.test(value);
}

function browserSnapshotScript() {
  return `(() => {
    const limit = 500;
    const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,summary,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[contenteditable="true"],[tabindex]'));
    document.querySelectorAll('[data-zenme-agent-ref]').forEach((element) => element.removeAttribute('data-zenme-agent-ref'));
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const compact = (value, maximum = 500) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, maximum);
    const elements = [];
    for (const element of candidates) {
      if (elements.length >= limit || !visible(element)) continue;
      const ref = 'e' + (elements.length + 1);
      element.setAttribute('data-zenme-agent-ref', ref);
      const rect = element.getBoundingClientRect();
      elements.push({
        ref,
        tag: element.tagName.toLowerCase(),
        role: compact(element.getAttribute('role'), 80) || undefined,
        name: compact(element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.textContent, 300),
        value: 'value' in element ? compact(element.value, 300) : undefined,
        placeholder: compact(element.getAttribute('placeholder'), 200) || undefined,
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
        checked: 'checked' in element ? Boolean(element.checked) : undefined,
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      });
    }
    return {
      url: location.href,
      title: document.title,
      text: String(document.body?.innerText || '').slice(0, 40000),
      elements,
      truncated: candidates.length > elements.length,
      viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
    };
  })()`;
}

function elementActionScript(ref, action, value) {
  const serializedRef = JSON.stringify(ref);
  const serializedValue = JSON.stringify(value ?? "");
  return `(() => {
    const element = document.querySelector('[data-zenme-agent-ref="' + CSS.escape(${serializedRef}) + '"]');
    if (!element) throw new Error('页面元素引用已失效，请重新获取 snapshot');
    element.scrollIntoView({ block: 'center', inline: 'center' });
    if (${JSON.stringify(action)} === 'click') {
      element.click();
      return true;
    }
    element.focus();
    const nextValue = ${serializedValue};
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
      if (setter) setter.call(element, nextValue); else element.value = nextValue;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (element.isContentEditable) {
      element.textContent = nextValue;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nextValue }));
      return true;
    }
    throw new Error('目标元素不支持输入');
  })()`;
}

function keyEventScript(key) {
  return `(() => {
    const key = ${JSON.stringify(key)};
    const target = document.activeElement || document.body;
    for (const type of ['keydown', 'keypress', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
    if (key === 'Enter' && target instanceof HTMLInputElement && target.form) target.form.requestSubmit();
    return true;
  })()`;
}

function createBrowserController({ BrowserWindow }) {
  const sessions = new Map();

  const closeSession = (sessionId) => {
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    if (session?.window && !session.window.isDestroyed()) session.window.destroy();
  };

  const cleanup = () => {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [sessionId, session] of sessions) {
      if (session.updatedAt < cutoff || session.window.isDestroyed()) closeSession(sessionId);
    }
    while (sessions.size >= MAX_SESSIONS) closeSession(sessions.keys().next().value);
  };

  const requireSession = (sessionId) => {
    const session = sessions.get(sessionId);
    if (!session || session.window.isDestroyed()) throw new Error("浏览器会话不存在，请先执行 navigate");
    session.updatedAt = Date.now();
    return session;
  };

  const createSession = (sessionId) => {
    cleanup();
    closeSession(sessionId);
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: `zenme-agent-preview-${sessionId.replace(/[^A-Za-z0-9_-]/g, "-")}`,
      },
    });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (!isLoopbackPreviewUrl(url)) event.preventDefault();
    });
    const session = { window, updatedAt: Date.now() };
    sessions.set(sessionId, session);
    return session;
  };

  const snapshot = async (session, includeScreenshot) => {
    const result = await session.window.webContents.executeJavaScript(browserSnapshotScript(), true);
    if (!includeScreenshot) return result;
    const image = await session.window.webContents.capturePage();
    const size = image.getSize();
    return { ...result, screenshot: { dataUrl: image.toDataURL(), mimeType: "image/png", width: size.width, height: size.height } };
  };

  const execute = async (input) => {
    if (!input || typeof input !== "object" || !validSessionId(input.sessionId)) throw new Error("浏览器会话 ID 无效");
    const operation = input.operation;
    if (operation === "close") {
      closeSession(input.sessionId);
      return { closed: true };
    }
    if (operation === "navigate") {
      if (!isLoopbackPreviewUrl(input.url)) throw new Error("浏览器工具只允许访问本机 loopback 预览地址");
      const session = createSession(input.sessionId);
      await session.window.loadURL(input.url, { timeout: NAVIGATION_TIMEOUT_MS });
      return snapshot(session, input.includeScreenshot !== false);
    }
    const session = requireSession(input.sessionId);
    if (operation === "snapshot" || operation === "screenshot") {
      return snapshot(session, operation === "screenshot" || input.includeScreenshot === true);
    }
    if (operation === "click" || operation === "type") {
      if (!validElementRef(input.ref)) throw new Error("页面元素引用无效");
      if (operation === "type" && (typeof input.text !== "string" || input.text.length > 20_000)) throw new Error("浏览器输入内容无效");
      await session.window.webContents.executeJavaScript(elementActionScript(input.ref, operation, input.text), true);
      await new Promise((resolve) => setTimeout(resolve, 150));
      return snapshot(session, input.includeScreenshot === true);
    }
    if (operation === "press") {
      if (typeof input.key !== "string" || !/^(?:Enter|Escape|Tab|Arrow(?:Up|Down|Left|Right)|Backspace|Delete|Home|End|PageUp|PageDown| )$/.test(input.key)) {
        throw new Error("浏览器按键不在允许列表中");
      }
      await session.window.webContents.executeJavaScript(keyEventScript(input.key), true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return snapshot(session, input.includeScreenshot === true);
    }
    throw new Error("不支持的浏览器操作");
  };

  return { closeAll: () => [...sessions.keys()].forEach(closeSession), execute };
}

async function startBrowserControlServer({ BrowserWindow, token }) {
  const controller = createBrowserController({ BrowserWindow });
  const server = http.createServer(async (request, response) => {
    const reject = (status, message) => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: message }));
    };
    if (request.method !== "POST" || request.url !== "/browser") return reject(404, "Not found");
    if (request.headers.authorization !== `Bearer ${token}`) return reject(401, "Unauthorized");
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) return reject(413, "Request too large");
      chunks.push(chunk);
    }
    try {
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const result = await controller.execute(input);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify(result));
    } catch (error) {
      reject(400, error instanceof Error ? error.message : "Browser operation failed");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to start browser control server");
  return {
    url: `http://${HOST}:${address.port}/browser`,
    close: async () => {
      controller.closeAll();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = {
  createBrowserController,
  isLoopbackPreviewUrl,
  startBrowserControlServer,
  validElementRef,
  validSessionId,
};
