import { afterEach, describe, expect, it, vi } from "vitest";

import { writeImageToClipboard, writeTextToClipboard } from "./clipboard";

describe("writeTextToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the Electron bridge when available", async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(true);
    const browserWriteText = vi.fn();
    vi.stubGlobal("window", { zenmeDesktop: { writeClipboardText } });
    vi.stubGlobal("navigator", { clipboard: { writeText: browserWriteText } });

    await expect(writeTextToClipboard("desktop text")).resolves.toBe(true);
    expect(writeClipboardText).toHaveBeenCalledWith("desktop text");
    expect(browserWriteText).not.toHaveBeenCalled();
  });

  it("uses the web clipboard outside Electron", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(writeTextToClipboard("web text")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("web text");
  });

  it.each([false, new Error("stale preload")])(
    "falls back to the web clipboard when the Electron bridge returns or throws %s",
    async (desktopResult) => {
      const writeClipboardText = desktopResult instanceof Error
        ? vi.fn().mockRejectedValue(desktopResult)
        : vi.fn().mockResolvedValue(desktopResult);
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("window", { zenmeDesktop: { writeClipboardText } });
      vi.stubGlobal("navigator", { clipboard: { writeText } });

      await expect(writeTextToClipboard("fallback text")).resolves.toBe(true);
      expect(writeText).toHaveBeenCalledWith("fallback text");
    },
  );

  it("does not attempt clipboard access during server rendering", async () => {
    vi.stubGlobal("window", undefined);

    await expect(writeTextToClipboard("server text")).resolves.toBe(false);
  });
});

describe("writeImageToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes image bytes and the Zenme fallback marker through Electron", async () => {
    const writeClipboardImage = vi.fn().mockResolvedValue(true);
    const browserWrite = vi.fn();
    vi.stubGlobal("window", { zenmeDesktop: { writeClipboardImage } });
    vi.stubGlobal("navigator", { clipboard: { write: browserWrite } });
    const image = new Blob(["png"], { type: "image/png" });

    await expect(writeImageToClipboard(image, "zenme-node-clipboard:id"))
      .resolves.toBe(true);
    expect(writeClipboardImage).toHaveBeenCalledWith({
      bytes: expect.any(ArrayBuffer),
      fallbackText: "zenme-node-clipboard:id",
    });
    expect(browserWrite).not.toHaveBeenCalled();
  });

  it("writes both image and text representations in a browser", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    class ClipboardItemStub {
      constructor(readonly data: Record<string, Blob>) {}
    }
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal("ClipboardItem", ClipboardItemStub);

    await expect(writeImageToClipboard(
      new Blob(["png"], { type: "image/png" }),
      "zenme-node-clipboard:id",
    )).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0][0][0] as ClipboardItemStub;
    expect(Object.keys(item.data)).toEqual(["image/png", "text/plain"]);
  });
});
