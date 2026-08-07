import { describe, expect, it } from "vitest";

import { createPerformanceSeedCanvas } from "./performance-seed";

describe("canvas performance seed", () => {
  it("builds the large mixed canvas profile with an explicit edge budget", () => {
    const seed = createPerformanceSeedCanvas({
      count: 500,
      edgeCount: 750,
      kind: "mixed",
    });

    expect(seed.nodes).toHaveLength(500);
    expect(seed.edges).toHaveLength(750);
    expect(new Set(seed.nodes.map((node) => node.data.kind))).toEqual(
      new Set(["image", "task", "text"]),
    );
  });

  it("caps the stress profile at the supported node and edge limits", () => {
    const seed = createPerformanceSeedCanvas({
      count: 5_000,
      edgeCount: 5_000,
      kind: "task",
    });

    expect(seed.nodes).toHaveLength(1_000);
    expect(seed.edges).toHaveLength(2_000);
    expect(seed.nodes.every((node) => node.data.kind === "task")).toBe(true);
  });
});
