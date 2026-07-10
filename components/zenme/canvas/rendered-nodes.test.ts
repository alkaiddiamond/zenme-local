import { describe, expect, it, vi } from "vitest";

import { getRenderedCanvasNodes } from "./rendered-nodes";
import type { CanvasNode } from "./types";

function node(input: {
  data?: Partial<CanvasNode["data"]>;
  id: string;
  type?: string;
}): CanvasNode {
  return {
    data: {
      kind: "text",
      title: input.id,
      ...input.data,
    },
    id: input.id,
    position: { x: 0, y: 0 },
    type: input.type ?? "text",
  } as CanvasNode;
}

describe("rendered canvas nodes", () => {
  it("injects text composer update handlers into text-like nodes", () => {
    const onUpdateTextGenerationNode = vi.fn();
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [],
      nodes: [
        node({ id: "text" }),
        node({
          data: { comment: "note", kind: "note" },
          id: "note",
          type: "note",
        }),
        node({
          data: { aiResponse: "answer", kind: "agent" },
          id: "agent",
          type: "agent",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageEditNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageEditNode: vi.fn(),
      onUpdateTextGenerationNode,
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    expect(renderedNodes.find((item) => item.id === "text")?.data)
      .toMatchObject({
        onUpdateTextGenerationNode,
      });
    expect(renderedNodes.find((item) => item.id === "note")?.data)
      .toMatchObject({
        onUpdateTextGenerationNode,
      });
    expect(renderedNodes.find((item) => item.id === "agent")?.data)
      .toMatchObject({
        onUpdateTextGenerationNode,
      });
  });
});
