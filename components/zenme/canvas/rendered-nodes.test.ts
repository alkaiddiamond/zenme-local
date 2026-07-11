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
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
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

  it("derives image-generation references from incoming image edges", () => {
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [
        { source: "image-a", target: "generation" },
        { source: "image-b", target: "generation" },
      ],
      nodes: [
        node({
          data: { kind: "image", previewUrl: "/a.webp", title: "参考 A" },
          id: "image-a",
          type: "image",
        }),
        node({
          data: { kind: "image", originalUrl: "/b.png", title: "参考 B" },
          id: "image-b",
          type: "image",
        }),
        node({
          data: { kind: "imageGeneration", title: "图片生成" },
          id: "generation",
          type: "imageGeneration",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    expect(renderedNodes.find((item) => item.id === "generation")?.data.imageReferences)
      .toEqual([
        { nodeId: "image-a", title: "参考 A", url: "/a.webp" },
        { nodeId: "image-b", title: "参考 B", url: "/b.png" },
      ]);
  });

  it("shows only explicitly selected reference candidates", () => {
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [
        { source: "image-a", target: "generation" },
        { source: "image-b", target: "generation" },
      ],
      nodes: [
        node({ data: { kind: "image", previewUrl: "/a.webp" }, id: "image-a", type: "image" }),
        node({ data: { kind: "image", previewUrl: "/b.webp" }, id: "image-b", type: "image" }),
        node({
          data: {
            imageReferenceNodeIds: ["image-b"],
            kind: "imageGeneration",
          },
          id: "generation",
          type: "imageGeneration",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });
    const generation = renderedNodes.find((item) => item.id === "generation");
    expect(generation?.data.imageReferenceCandidates).toHaveLength(2);
    expect(generation?.data.imageReferences?.map((item) => item.nodeId)).toEqual(["image-b"]);
  });

});
