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

  it("marks the text generation target dot as connected when incoming edges exist", () => {
    const source = readFileSync(
      new URL("./nodes/text-generation-node.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "<NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />",
    );
    expect(source).not.toContain("visible={false}");
  });

  it("keeps connected endpoint dots hidden until the node is interactive", () => {
    const source = readFileSync(new URL("./node-ui.tsx", import.meta.url), "utf8");

    expect(source).toContain(
      "zenme-connected-source-handle !border-zinc-300 !bg-white !opacity-0",
    );
    expect(source).toContain(
      "zenme-connected-target-handle-dot opacity-0",
    );
    expect(source).not.toContain(
      '!border-zinc-300 !bg-white !opacity-100',
    );
  });

  it("provides dedicated forward-connection targets on managed content nodes", () => {
    for (const fileName of [
      "./nodes/text-node.tsx",
      "./nodes/managed-text-node.tsx",
      "./nodes/task-node.tsx",
    ]) {
      const source = readFileSync(new URL(fileName, import.meta.url), "utf8");
      expect(source).toContain("<NodeContextTargetHandle />");
    }
  });

  it("uses the same standard incoming handle style for task and text nodes", () => {
    const taskSource = readFileSync(
      new URL("./nodes/task-node.tsx", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n");

    expect(taskSource).toContain(
      '<NodeTargetHandle\n        id={STANDARD_NODE_TARGET_HANDLE_ID}\n        revealOnHover={false}\n        visible={Boolean(nodeData.hasIncomingEdge)}',
    );
    expect(taskSource).not.toContain("largeHitArea");
  });
});
