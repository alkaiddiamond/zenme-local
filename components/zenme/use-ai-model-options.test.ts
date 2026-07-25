import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  createModelOption,
  orderModelOptionsByPreference,
  resolveAiModelOptionId,
} from "./use-ai-model-options";
import { createProviderModelReference } from "@/lib/ai/model-reference";

describe("AI model option preferences", () => {
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

  it("does not initialize selectors from static fallback models", () => {
    const source = readFileSync(
      new URL("./use-ai-model-options.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("fallbackModelOptions");
    expect(source).toContain("useState<AiModelOption[]>(\n    [],");
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
});
