import { describe, expect, it } from "vitest";

import {
  createVolcengineAgentPlanProvider,
  createZhipuProvider,
  VOLCENGINE_AGENT_PLAN_PROVIDER_ID,
} from "@/lib/ai/provider-presets";
import {
  getProviderModelSelections,
  resolveProviderModelSelection,
} from "@/lib/ai/provider-model-resolution";

describe("provider-scoped model resolution", () => {
  const providers = [
    createZhipuProvider("zhipu-key"),
    createVolcengineAgentPlanProvider(),
  ];

  it("keeps duplicate model ids as separate selectable options", () => {
    const glmOptions = getProviderModelSelections(providers, "text").filter(
      (selection) => selection.modelId === "glm-5.2",
    );

    expect(glmOptions).toHaveLength(2);
    expect(new Set(glmOptions.map((selection) => selection.id)).size).toBe(2);
    expect(glmOptions.map((selection) => selection.provider.id)).toEqual([
      "zhipu-glm",
      VOLCENGINE_AGENT_PLAN_PROVIDER_ID,
    ]);
    expect(glmOptions.map((selection) => selection.label)).toEqual([
      "GLM 5.2（Zhipu GLM）",
      "GLM 5.2（Agent Plan）",
    ]);
  });

  it("routes an Agent Plan selection to Agent Plan with the upstream model id", () => {
    const agentPlanOption = getProviderModelSelections(
      providers,
      "text",
    ).find(
      (selection) =>
        selection.provider.id === VOLCENGINE_AGENT_PLAN_PROVIDER_ID &&
        selection.modelId === "glm-5.2",
    );

    expect(agentPlanOption).toBeDefined();
    expect(
      resolveProviderModelSelection(agentPlanOption!.id, providers, "text"),
    ).toMatchObject({
      modelId: "glm-5.2",
      provider: {
        apiFormat: "volcengine_agent_plan",
        id: VOLCENGINE_AGENT_PLAN_PROVIDER_ID,
      },
    });
  });

  it("routes legacy duplicate ids consistently with the old displayed option", () => {
    expect(
      resolveProviderModelSelection("glm-5.2", providers, "text"),
    ).toMatchObject({
      modelId: "glm-5.2",
      provider: { id: VOLCENGINE_AGENT_PLAN_PROVIDER_ID },
    });
  });
});
