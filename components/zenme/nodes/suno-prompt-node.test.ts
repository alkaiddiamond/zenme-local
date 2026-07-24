import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalStyles = readFileSync(
  new URL("../../../app/globals.css", import.meta.url),
  "utf8",
);
const sunoPromptNodeSource = readFileSync(
  new URL("./suno-prompt-node.tsx", import.meta.url),
  "utf8",
);

describe("Suno prompt text selection", () => {
  it("keeps both prompt bodies selectable without dragging the node", () => {
    expect(
      sunoPromptNodeSource.match(/zenme-suno-prompt-text/g),
    ).toHaveLength(2);
    expect(sunoPromptNodeSource).toContain(
      'className="nodrag nowheel mt-3',
    );
    expect(globalStyles).toContain(
      ".zenme-canvas .zenme-suno-prompt-text",
    );
    expect(globalStyles).toContain("-webkit-user-select: text !important;");
    expect(globalStyles).toContain("user-select: text !important;");
  });
});
