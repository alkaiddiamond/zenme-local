import { describe, expect, it } from "vitest";

import {
  createModelProviderPreset,
  identifyModelProviderPreset,
  type ModelProviderPresetId,
} from "@/lib/ai/provider-presets";

describe("model provider presets", () => {
  it.each([
    ["zhipu", "zhipu", "bearer", "https://open.bigmodel.cn/api/paas/v4"],
    [
      "volcengine_agent_plan",
      "volcengine_agent_plan",
      "bearer",
      "https://ark.cn-beijing.volces.com/api/plan",
    ],
    [
      "volcengine_ark",
      "custom",
      "bearer",
      "https://ark.cn-beijing.volces.com/api/v3",
    ],
    ["openrouter", "openrouter", "bearer", "https://openrouter.ai/api/v1"],
    ["ollama", "ollama", "none", "http://127.0.0.1:11434/v1"],
  ] satisfies Array<
    [ModelProviderPresetId, string, string, string]
  >)(
    "creates the %s provider with its protocol defaults",
    (preset, apiFormat, authType, baseUrl) => {
      const provider = createModelProviderPreset(preset);

      expect(provider).toMatchObject({ apiFormat, authType, baseUrl });
      expect(provider.networkProxy).toEqual({
        mode: "environment",
        noProxy: "localhost,127.0.0.1,::1",
        url: "",
      });
      expect(identifyModelProviderPreset(provider)).toBe(preset);
    },
  );

  it("creates independent custom provider records", () => {
    const first = createModelProviderPreset("custom");
    const second = createModelProviderPreset("custom");

    expect(first).toMatchObject({
      apiFormat: "openai",
      authType: "bearer",
      baseUrl: "",
      name: "自定义服务商",
    });
    expect(first.id).not.toBe(second.id);
    expect(identifyModelProviderPreset(first)).toBe("custom");
  });
});
