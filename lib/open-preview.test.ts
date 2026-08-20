import { afterEach, describe, expect, it, vi } from "vitest";

import { openPreviewUrl, validatePreviewUrl } from "@/lib/open-preview";

describe("openPreviewUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the Electron desktop bridge", async () => {
    const openExternal = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("window", { zenmeDesktop: { openExternal } });
    await expect(openPreviewUrl("http://localhost:5173")).resolves.toBe(true);
    expect(openExternal).toHaveBeenCalledWith("http://localhost:5173/");
  });

  it("opens IPv6 loopback previews through localhost", async () => {
    const openExternal = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("window", { zenmeDesktop: { openExternal } });
    await expect(openPreviewUrl("http://[::1]:5173/")).resolves.toBe(true);
    expect(openExternal).toHaveBeenCalledWith("http://localhost:5173/");
  });

  it("rejects unsupported protocols and embedded credentials", () => {
    expect(() => validatePreviewUrl("file:///tmp/index.html")).toThrow("HTTP(S)");
    expect(() => validatePreviewUrl("https://user:pass@example.com/")).toThrow("HTTP(S)");
  });
});
