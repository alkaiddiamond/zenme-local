import { describe, expect, it } from "vitest";

import {
  createModelOption,
  orderModelOptionsByPreference,
} from "./use-ai-model-options";

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
});
