import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createChatGptProvider, getLocalSettings, updateLocalSettings } from "@/lib/local/settings";
import { getProviderModelSelections } from "@/lib/ai/provider-model-resolution";

import {
  createOpenAiAuthHeaders,
  retryOpenAiModelSync,
  syncOpenAiModels,
} from "./openai-oauth";

describe("OpenAI OAuth model synchronization", () => {
  it("discovers Astra with the current client version and preserves local model preferences", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-astra-sync-"));
    vi.stubEnv("ZENME_DATA_DIR", dataDir);
    const provider = createChatGptProvider();
    provider.networkProxy = { mode: "direct", url: "", noProxy: "" };
    provider.models = [{ id: "gpt-5.6-sol", alias: "My Sol", enabled: false, modalities: ["text"] }];
    const fetchMock = vi.fn(async () => Response.json({ models: [
      { slug: "gpt-6-astra", display_name: "GPT-6 Astra", visibility: "list", context_window: 272_000, input_modalities: ["text", "image"] },
      { slug: "gpt-5.6-sol", display_name: "GPT-5.6 Sol", visibility: "list" },
      { slug: "internal-model", visibility: "hide" },
    ] }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await updateLocalSettings({ modelProviders: [provider], lastTextModelId: "gpt-5.6-sol" }, dataDir);
      await fs.writeFile(path.join(dataDir, "openai-oauth.json"), JSON.stringify({
        accessToken: "test-token", refreshToken: "test-refresh-token", expiresAt: Date.now() + 3_600_000,
      }));
      const models = await syncOpenAiModels();
      expect(fetchMock).toHaveBeenCalledWith(
        "https://chatgpt.com/backend-api/codex/models?client_version=0.153.4",
        expect.any(Object),
      );
      expect(models).toEqual([
        expect.objectContaining({ id: "gpt-6-astra", alias: "GPT-6 Astra", contextWindow: 272_000, enabled: true, modalities: ["text", "vision", "image", "tool"] }),
        expect.objectContaining({ id: "gpt-5.6-sol", alias: "My Sol", enabled: false }),
      ]);
      const settings = await getLocalSettings(dataDir);
      expect(settings.lastTextModelId).toBe("gpt-5.6-sol");
      for (const modality of ["text", "image"] as const) {
        expect(getProviderModelSelections(settings.modelProviders, modality).map(model => model.modelId)).toEqual(["gpt-6-astra"]);
      }
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await fs.rm(dataDir, { force: true, recursive: true });
    }
  });

  it("retries a transient model fetch failure after login", async () => {
    const sync = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce([{ id: "gpt-test" }]);
    const delay = vi.fn(async () => undefined);

    await expect(retryOpenAiModelSync({ delay, sync })).resolves.toEqual([
      { id: "gpt-test" },
    ]);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(1_200);
  });

  it("reports failure only after all automatic retries are exhausted", async () => {
    const sync = vi.fn(async () => { throw new Error("still unavailable"); });

    await expect(retryOpenAiModelSync({
      attempts: 3,
      delay: async () => undefined,
      sync,
    })).rejects.toThrow("still unavailable");
    expect(sync).toHaveBeenCalledTimes(3);
  });
});

describe("OpenAI OAuth request identity", () => {
  it("matches the verified Codex 0.153.4 runtime identity", () => {
    expect(createOpenAiAuthHeaders({
      accessToken: "test-token",
      refreshToken: "test-refresh-token",
      expiresAt: Date.now() + 60_000,
      accountId: "account-test",
    })).toEqual({
      Authorization: "Bearer test-token",
      originator: "codex_exec",
      "User-Agent": "codex_exec/0.153.4",
      "ChatGPT-Account-Id": "account-test",
    });
  });
});
