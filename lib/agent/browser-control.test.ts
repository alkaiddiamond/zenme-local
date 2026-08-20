import { afterEach, describe, expect, it, vi } from "vitest";

import { controlBrowserPreview } from "@/lib/agent/browser-control";

const originalUrl = process.env.ZENME_BROWSER_CONTROL_URL;
const originalToken = process.env.ZENME_DESKTOP_TOKEN;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl === undefined) delete process.env.ZENME_BROWSER_CONTROL_URL;
  else process.env.ZENME_BROWSER_CONTROL_URL = originalUrl;
  if (originalToken === undefined) delete process.env.ZENME_DESKTOP_TOKEN;
  else process.env.ZENME_DESKTOP_TOKEN = originalToken;
});

describe("desktop browser control client", () => {
  it("rejects use outside the desktop runtime", async () => {
    delete process.env.ZENME_BROWSER_CONTROL_URL;
    delete process.env.ZENME_DESKTOP_TOKEN;
    await expect(controlBrowserPreview({ sessionId: "p:e", operation: "snapshot" }))
      .rejects.toThrow("仅在 Zenme 桌面应用中可用");
  });

  it("sends an authenticated bounded operation and returns its snapshot", async () => {
    process.env.ZENME_BROWSER_CONTROL_URL = "http://127.0.0.1:4567/browser";
    process.env.ZENME_DESKTOP_TOKEN = "secret";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      url: "http://127.0.0.1:5173/",
      title: "Preview",
      elements: [{ ref: "e1", tag: "button", name: "Save", bounds: { x: 1, y: 2, width: 3, height: 4 } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(controlBrowserPreview({ sessionId: "project:execution", operation: "click", ref: "e1" }))
      .resolves.toMatchObject({ title: "Preview", elements: [{ ref: "e1" }] });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4567/browser", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer secret" }),
      body: JSON.stringify({ sessionId: "project:execution", operation: "click", ref: "e1" }),
    }));
  });

  it("surfaces controller failures without exposing the token", async () => {
    process.env.ZENME_BROWSER_CONTROL_URL = "http://127.0.0.1:4567/browser";
    process.env.ZENME_DESKTOP_TOKEN = "secret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "页面元素引用已失效" }), { status: 400 })));
    await expect(controlBrowserPreview({ sessionId: "project:execution", operation: "click", ref: "e1" }))
      .rejects.toThrow("页面元素引用已失效");
  });
});
