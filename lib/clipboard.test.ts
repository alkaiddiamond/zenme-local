import { afterEach, describe, expect, it, vi } from "vitest";

import { writeTextToClipboard } from "./clipboard";

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

  it("does not attempt clipboard access during server rendering", async () => {
    vi.stubGlobal("window", undefined);

    await expect(writeTextToClipboard("server text")).resolves.toBe(false);
  });
});
