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

  it("shares project tag options across managed text nodes", () => {
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [],
      nodes: [
        node({
          data: {
            kind: "managedText",
            tagColors: { 产品: "blue" },
            tags: ["产品", "灵感"],
          },
          id: "managed-a",
          type: "managedText",
        }),
        node({
          data: { kind: "managedText", tags: ["产品", "待办"] },
          id: "managed-b",
          type: "managedText",
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

    expect(renderedNodes[0].data.projectTags).toEqual(["产品", "待办", "灵感"]);
    expect(renderedNodes[1].data.projectTags).toEqual(["产品", "待办", "灵感"]);
    expect(renderedNodes[0].data.projectTagColors).toEqual({ 产品: "blue" });
    expect(renderedNodes[1].data.projectTagColors).toEqual({ 产品: "blue" });
  });

  it("derives direct task children, progress and shared project tags", () => {
    const onUpdateTaskNode = vi.fn();
    const onToggleTaskChildren = vi.fn();
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [
        { source: "parent", target: "done-child" },
        { source: "parent", target: "active-child" },
        { source: "parent", target: "plain-text" },
        { source: "parent", target: "image" },
        { source: "parent", target: "managed-text" },
      ],
      nodes: [
        node({
          data: { kind: "task", tags: ["迭代"], taskStatus: "inProgress" },
          id: "parent",
          type: "task",
        }),
        node({
          data: {
            kind: "task",
            name: "完成项",
            taskStatus: "completed",
          },
          id: "done-child",
          type: "task",
        }),
        node({
          data: {
            kind: "task",
            name: "进行项",
            taskStatus: "inProgress",
          },
          id: "active-child",
          type: "task",
        }),
        node({ id: "plain-text" }),
        node({
          data: { kind: "image", title: "任务参考图" },
          id: "image",
          type: "image",
        }),
        node({
          data: { kind: "managedText", name: "任务说明" },
          id: "managed-text",
          type: "managedText",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTaskNode,
      onToggleTaskChildren,
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    const parent = renderedNodes.find((item) => item.id === "parent");
    expect(parent?.data.taskChildren).toEqual([
      { id: "done-child", name: "完成项", status: "completed" },
      { id: "active-child", name: "进行项", status: "inProgress" },
    ]);
    expect(parent?.data.taskProgress).toBe(0.5);
    expect(parent?.data.projectTags).toEqual(["迭代"]);
    expect(parent?.data.onUpdateTaskNode).toBe(onUpdateTaskNode);
    expect(parent?.data.onToggleTaskChildren).toBe(onToggleTaskChildren);
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

  it("locks a source while one of its generation children is running", () => {
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [
        { source: "text", target: "agent-running" },
        { source: "image", target: "image-running" },
      ],
      nodes: [
        node({ id: "text" }),
        node({ data: { kind: "agent", aiStatus: "generating" }, id: "agent-running", type: "agent" }),
        node({ data: { kind: "image", imageGenerated: true }, id: "image", type: "image" }),
        node({
          data: { kind: "imageGeneration", imageGenerationResult: true, imageStatus: "editing" },
          id: "image-running",
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

    expect(renderedNodes.find((item) => item.id === "text")?.data.hasRunningGenerationChild).toBe(true);
    expect(renderedNodes.find((item) => item.id === "image")?.data.hasRunningGenerationChild).toBe(true);
  });

});
