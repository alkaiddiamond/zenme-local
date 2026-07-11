import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getTokenUsageStats, recordTokenUsage } from "@/lib/local/token-usage";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-token-usage-"));
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("token usage repository", () => {
  it("records local usage and aggregates models, providers and modalities", async () => {
    await recordTokenUsage({
      providerId: "zhipu",
      providerName: "Zhipu GLM",
      modelId: "glm-5.2",
      modality: "text",
      inputTokens: 100,
      outputTokens: 40,
      durationMs: 1_500,
      messageCount: 2,
    }, dataDir);
    await recordTokenUsage({
      providerId: "openrouter",
      providerName: "OpenRouter",
      modelId: "image-model",
      modality: "image",
      totalTokens: 20,
      durationMs: 2_000,
    }, dataDir);

    const stats = await getTokenUsageStats(dataDir);
    expect(stats.summary).toMatchObject({
      totalTokens: 160,
      totalRequests: 2,
      textRequests: 1,
      imageRequests: 1,
      trackedDays: 1,
      longestRequestMs: 2_000,
    });
    expect(stats.models).toHaveLength(2);
    expect(stats.providers).toHaveLength(2);
    expect(stats.daily[0]).toMatchObject({ totalTokens: 160, requests: 2 });
  });
});
