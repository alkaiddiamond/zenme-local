/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createBrowserController,
  isLoopbackPreviewUrl,
  startBrowserControlServer,
  validElementRef,
  validSessionId,
} = require("./browser-control.cjs");

test("browser controller accepts only loopback preview URLs", () => {
  assert.equal(isLoopbackPreviewUrl("http://127.0.0.1:5173/"), true);
  assert.equal(isLoopbackPreviewUrl("https://localhost:3000/app"), true);
  assert.equal(isLoopbackPreviewUrl("http://[::1]:4173/"), true);
  assert.equal(isLoopbackPreviewUrl("https://example.com/"), false);
  assert.equal(isLoopbackPreviewUrl("http://192.168.1.2:3000/"), false);
  assert.equal(isLoopbackPreviewUrl("file:///tmp/index.html"), false);
  assert.equal(isLoopbackPreviewUrl("http://user:pass@127.0.0.1:3000/"), false);
});

test("browser controller validates opaque sessions and generated element references", () => {
  assert.equal(validSessionId("project-1:execution_2"), true);
  assert.equal(validSessionId("../escape"), false);
  assert.equal(validElementRef("e1"), true);
  assert.equal(validElementRef("e999"), true);
  assert.equal(validElementRef("#submit"), false);
  assert.equal(validElementRef("e0"), false);
});

test("browser controller keeps local preview actions inside an isolated session", async () => {
  const windows = [];
  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.loadedUrl = "";
      this.scripts = [];
      this.webContents = {
        session: { setPermissionRequestHandler: () => {} },
        setWindowOpenHandler: () => {},
        on: () => {},
        executeJavaScript: async (script) => {
          this.scripts.push(script);
          if (script.includes("document.querySelectorAll('a,button")) {
            return { url: this.loadedUrl, title: "Preview", text: "Save", elements: [{ ref: "e1", tag: "button", name: "Save" }] };
          }
          return true;
        },
        capturePage: async () => ({
          getSize: () => ({ width: 1280, height: 800 }),
          toDataURL: () => "data:image/png;base64,cHJldmlldw==",
        }),
      };
      windows.push(this);
    }
    async loadURL(url) { this.loadedUrl = url; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const controller = createBrowserController({ BrowserWindow: FakeBrowserWindow });
  const navigated = await controller.execute({
    sessionId: "project:execution",
    operation: "navigate",
    url: "http://127.0.0.1:5173/",
    includeScreenshot: true,
  });
  assert.equal(navigated.title, "Preview");
  assert.equal(navigated.screenshot.dataUrl, "data:image/png;base64,cHJldmlldw==");
  assert.equal(windows[0].options.show, false);
  assert.equal(windows[0].options.webPreferences.partition, "zenme-agent-preview-project-execution");

  await controller.execute({ sessionId: "project:execution", operation: "click", ref: "e1" });
  assert.equal(windows[0].scripts.some((script) => script.includes("element.click()")), true);
  await assert.rejects(
    controller.execute({ sessionId: "project:execution", operation: "click", ref: "#save" }),
    /页面元素引用无效/,
  );
  await assert.rejects(
    controller.execute({ sessionId: "other", operation: "navigate", url: "https://example.com/" }),
    /只允许访问本机 loopback/,
  );
  await controller.execute({ sessionId: "project:execution", operation: "close" });
  assert.equal(windows[0].destroyed, true);
});

test("browser control server requires its desktop bearer token", async () => {
  class FakeBrowserWindow {
    constructor() {
      this.destroyed = false;
      this.webContents = {
        session: { setPermissionRequestHandler: () => {} },
        setWindowOpenHandler: () => {},
        on: () => {},
        executeJavaScript: async () => ({ url: "http://127.0.0.1:5173/", title: "Preview", text: "", elements: [] }),
        capturePage: async () => ({ getSize: () => ({ width: 1, height: 1 }), toDataURL: () => "data:image/png;base64,AA==" }),
      };
    }
    async loadURL() {}
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const server = await startBrowserControlServer({ BrowserWindow: FakeBrowserWindow, token: "secret" });
  try {
    const unauthorized = await fetch(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "p:e", operation: "navigate", url: "http://127.0.0.1:5173/" }),
    });
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(server.url, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "p:e", operation: "navigate", url: "http://127.0.0.1:5173/", includeScreenshot: false }),
    });
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).title, "Preview");
  } finally {
    await server.close();
  }
});
