import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("node handle visual boundaries", () => {
  it("keeps target handle geometry aligned with the visible dot", () => {
    const source = readFileSync(new URL("./node-ui.tsx", import.meta.url), "utf8");

    expect(source).toContain("zenme-target-handle");
    expect(source).toContain("!-left-1.5");
    expect(source).toContain("!size-3");
    expect(source).not.toContain("zenme-target-handle !absolute !-left-4");
  });

  it("shows the text generation target dot when the node has incoming edges", () => {
    const source = readFileSync(
      new URL("./nodes/text-generation-node.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "<NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />",
    );
    expect(source).not.toContain("visible={false}");
  });
});
