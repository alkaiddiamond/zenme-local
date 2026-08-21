import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createModelOption,
  orderModelOptionsByPreference,
  rememberTextGenerationPreferences,
  resolveAiModelOptionId,
} from "./use-ai-model-options";
import { createProviderModelReference } from "@/lib/ai/model-reference";

describe("AI model option preferences", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const models = [
    createModelOption("glm-4.5"),
    createModelOption("gpt-5.6-sol", "GPT-5.6-Sol"),
  ];

  it("moves the remembered model to the first position", () => {
    expect(
      orderModelOptionsByPreference(models, "gpt-5.6-sol").map(
        (model) => model.id,
      ),
    ).toEqual(["gpt-5.6-sol", "glm-4.5"]);
  });

  it("keeps configured order when the remembered model is unavailable", () => {
    expect(orderModelOptionsByPreference(models, "missing-model")).toEqual(
      models,
    );
  });

  it("uses a readable provider and model tooltip", () => {
    expect(
      createModelOption(
        "provider-model:volcengine-agent-plan:ark-code-latest",
        "Ark Code Latest",
        "火山方舟 Agent Plan · ark-code-latest",
      ),
    ).toMatchObject({
      tooltip: "火山方舟 Agent Plan · ark-code-latest",
    });
  });

  it("keeps the configured context window with the model option", () => {
    expect(
      createModelOption("model", "Model", "Provider · Model", 200_000),
    ).toMatchObject({ contextWindow: 200_000 });
  });

  it("keeps model capability metadata for client-side capability filtering", () => {
    expect(
      createModelOption(
        "seedream",
        "Seedream",
        "Agent Plan · Seedream",
        undefined,
        ["vision", "image"],
      ),
    ).toMatchObject({ modalities: ["vision", "image"] });
  });

  it("initializes new selectors from the shared model cache", () => {
    const source = readFileSync(
      new URL("./use-ai-model-options.ts", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n");

    expect(source).not.toContain("fallbackModelOptions");
    expect(source).toContain(
      "() => modelOptionsCache[modality] ?? []",
    );
    expect(source).toContain("modelOptionsCache[modality] = orderedModels");
    expect(source).toContain(
      "window.addEventListener(MODEL_OPTIONS_EVENT, handleModelOptionsChange)",
    );
    expect(source).toContain("new CustomEvent(MODEL_OPTIONS_EVENT");
  });

  it("maps a legacy bare model id to the first provider-scoped option", () => {
    const agentPlanModel = createProviderModelReference(
      "volcengine-agent-plan",
      "glm-5.2",
    );
    const zhipuModel = createProviderModelReference("zhipu-glm", "glm-5.2");

    expect(
      resolveAiModelOptionId(
        [
          createModelOption("glm-5.2"),
          createModelOption(agentPlanModel, "GLM 5.2（Agent Plan）"),
          createModelOption(zhipuModel, "GLM 5.2（Zhipu GLM）"),
        ],
        "glm-5.2",
      ),
    ).toBe(agentPlanModel);
  });

  it("persists reasoning and speed changes independently", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await rememberTextGenerationPreferences({
      reasoningEffort: "xhigh",
    });
    await rememberTextGenerationPreferences({ modelSpeed: "fast" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaultReasoningEffort: "xhigh",
        thinkingEnabled: true,
      }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultModelSpeed: "fast" }),
    });
  });
});
