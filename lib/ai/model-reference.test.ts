import { describe, expect, it } from "vitest";

import {
  createProviderModelReference,
  getModelIdFromReference,
  parseProviderModelReference,
} from "@/lib/ai/model-reference";

describe("provider model reference", () => {
  it("round-trips provider and model identifiers safely", () => {
    const reference = createProviderModelReference(
      "custom:provider/local",
      "vendor/model:latest",
    );

    expect(parseProviderModelReference(reference)).toEqual({
      modelId: "vendor/model:latest",
      providerId: "custom:provider/local",
    });
    expect(getModelIdFromReference(reference)).toBe("vendor/model:latest");
  });

  it("keeps legacy unscoped model identifiers readable", () => {
    expect(parseProviderModelReference("glm-5.2")).toBeNull();
    expect(getModelIdFromReference("glm-5.2")).toBe("glm-5.2");
  });
});
