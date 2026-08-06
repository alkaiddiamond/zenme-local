import { describe, expect, it } from "vitest";

import { mergeSyncedOpenAiModels } from "./openai-model-sync";

describe("OpenAI model synchronization", () => {
  it("preserves local aliases and enabled state while refreshing server model limits", () => {
    expect(
      mergeSyncedOpenAiModels(
        [
          {
            id: "gpt-image",
            alias: "Server display name",
            contextWindow: 200_000,
            enabled: true,
            modalities: ["text", "vision", "image"],
          },
        ],
        [
          {
            id: "gpt-image",
            alias: "我的生图模型",
            contextWindow: 128_000,
            enabled: false,
            modalities: ["text", "image"],
          },
        ],
      ),
    ).toEqual([
      {
        id: "gpt-image",
        alias: "我的生图模型",
        contextWindow: 200_000,
        enabled: false,
        modalities: ["text", "image", "vision"],
      },
    ]);
  });

  it("keeps the existing context window when server metadata omits it", () => {
    expect(
      mergeSyncedOpenAiModels(
        [{
          id: "gpt-model",
          alias: "Server name",
          enabled: true,
          modalities: ["text"],
        }],
        [{
          id: "gpt-model",
          alias: "Local name",
          contextWindow: 272_000,
          enabled: true,
          modalities: ["text"],
        }],
      )[0]?.contextWindow,
    ).toBe(272_000);
  });

  it("uses server metadata for newly discovered models", () => {
    const syncedModel = {
      id: "new-model",
      alias: "New model",
      enabled: true,
      modalities: ["text" as const],
    };

    expect(mergeSyncedOpenAiModels([syncedModel], [])).toEqual([
      syncedModel,
    ]);
  });
});
