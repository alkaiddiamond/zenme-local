import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getImageEditPreferences,
  rememberImageEditPreferences,
} from "./image-edit-preferences";

function installWindowMock() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    },
  });
  return store;
}

describe("image edit preferences", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers the latest model, aspect ratio and quality immediately", async () => {
    installWindowMock();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await rememberImageEditPreferences({
      aspectRatio: "auto",
      modelId: "custom-image-model",
      quality: "1K",
    });

    expect(getImageEditPreferences()).toEqual({
      aspectRatio: "auto",
      modelId: "custom-image-model",
      quality: "1K",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("falls back safely when persisted options are invalid", () => {
    const store = installWindowMock();
    store.set(
      "zenme.imageEditPreferences.v1",
      JSON.stringify({ aspectRatio: "invalid", quality: "invalid" }),
    );

    expect(getImageEditPreferences()).toEqual({
      aspectRatio: "16:9",
      modelId: undefined,
      quality: "1K",
    });
  });
});
