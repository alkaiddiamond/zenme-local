import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { getProviderModelSelections } from "@/lib/ai/provider-model-resolution";
import { createVolcengineAgentPlanProvider } from "@/lib/ai/provider-presets";
import {
  createProviderEmbeddingProvider,
  EmbeddingProviderError,
  listEmbeddingProviderOptions,
} from "@/lib/knowledge/embeddings";
import { updateLocalSettings } from "@/lib/local/settings";

describe("configured embedding providers", () => {
  const selection = getProviderModelSelections(
    [createVolcengineAgentPlanProvider()],
    "embedding",
  )[0];

  it("calls the OpenAI-compatible embeddings endpoint and restores response order", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toBe("https://ark.cn-beijing.volces.com/api/plan/v3/embeddings");
      expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({
        input: ["first", "second"],
        model: "doubao-embedding-vision",
        encoding_format: "float",
      });
      return new Response(JSON.stringify({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      }), { status: 200 });
    });
    const provider = createProviderEmbeddingProvider(selection, fetchImpl as typeof fetch);

    await expect(provider.embed(["first", "second"])).resolves.toEqual([[1, 0], [0, 1]]);
    expect(provider.descriptor).toMatchObject({
      id: selection.id,
      kind: "cloud",
      dimension: 2,
    });
  });

  it("rejects malformed vectors without exposing the upstream response body", async () => {
    const provider = createProviderEmbeddingProvider(
      selection,
      vi.fn(async () => new Response(JSON.stringify({
        data: [{ index: 0, embedding: [Number.NaN] }],
      }), { status: 200 })) as typeof fetch,
    );

    await expect(provider.embed(["secret input"])).rejects.toEqual(
      expect.objectContaining<Partial<EmbeddingProviderError>>({
        name: "EmbeddingProviderError",
        message: "Embedding 服务返回了无效向量",
      }),
    );
  });

  it("only offers configured providers whose endpoint and required credential are ready", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-embedding-options-"));
    try {
      const provider = createVolcengineAgentPlanProvider();
      await updateLocalSettings({ modelProviders: [provider] }, dataDir);
      await expect(listEmbeddingProviderOptions(dataDir)).resolves.toHaveLength(1);

      provider.apiKey = "configured-secret";
      await updateLocalSettings({ modelProviders: [provider] }, dataDir);
      const options = await listEmbeddingProviderOptions(dataDir);
      expect(options).toHaveLength(2);
      expect(options[1]).toMatchObject({ id: selection.id, kind: "cloud" });
      expect(JSON.stringify(options)).not.toContain("configured-secret");
    } finally {
      await fs.rm(dataDir, { force: true, recursive: true });
    }
  });
});
