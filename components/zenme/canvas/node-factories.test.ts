import type { Edge } from "@xyflow/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NODE_RIGHT_HANDLE_ID } from "@/components/zenme/node-types";
import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";

import {
  createAiResponseChildCanvasNode,
  createCodeCanvasNode,
  createConnectedPlaceholderCanvasNode,
  createDroppedReadingNoteCanvasNode,
  createReferencedImageGenerationCanvasNode,
  createImageGenerationCanvasNode,
  createPendingImageResultChildCanvasNode,
  createMarkdownCanvasNode,
  createManagedTextCanvasNode,
  createTaskCanvasNode,
  createReaderCanvasNode,
  createReadingNoteCanvasNode,
  createTextCanvasNode,
  createTextChildCanvasNode,
  createTextGenerationCanvasNode,
} from "./node-factories";
import type { CanvasNode } from "./types";

function textNode(input?: Partial<CanvasNode>): CanvasNode {
  return {
    id: "source",
    position: { x: 100, y: 200 },
    style: { height: 260, width: 520 },
    type: "text",
    data: {
      kind: "text",
      title: "源文本",
      plainText: "",
      richTextHtml: "",
    },
    ...input,
  } as CanvasNode;
}

function expectedEdge(source: string, target: string): Edge {
  return {
    id: `edge-${source}-${target}`,
    source,
    sourceHandle: NODE_RIGHT_HANDLE_ID,
    target,
    type: "default",
  };
}

const asset: ReadingAsset = {
  id: "asset-1",
  ownerId: "user-1",
  projectId: "project-1",
  nodeId: "book-1",
  title: "地师",
  format: "epub",
  fileName: "地师.epub",
  filePath: "user/project/reading/original/asset.epub",
  createdAt: "2026-06-28T01:00:00.000Z",
  updatedAt: "2026-06-28T02:00:00.000Z",
};

const note: ReadingNote = {
  id: "note-1",
  assetId: "asset-1",
  ownerId: "user-1",
  projectId: "project-1",
  selectedText: "选中文字",
  comment: "批注",
  sectionIndex: 1,
  chapterTitle: "第一章",
  color: "yellow",
  type: "highlight",
  sortOrder: 0,
  createdAt: "2026-06-28T01:00:00.000Z",
  updatedAt: "2026-06-28T02:00:00.000Z",
};

describe("canvas node factories", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("creates basic text, code and markdown nodes with defaults", () => {
    expect(
      createTextCanvasNode({ id: "text-1", position: { x: 1, y: 2 } }),
    ).toMatchObject({
      id: "text-1",
      type: "text",
      position: { x: 1, y: 2 },
      style: { height: 260, width: 520 },
      data: { kind: "text", title: "文本", plainText: "", richTextHtml: "" },
    });
    expect(
      createCodeCanvasNode({ id: "code-1", position: { x: 1, y: 2 } }),
    ).toMatchObject({
      type: "text",
      style: { height: 420, width: 720 },
      data: {
        codeContent: "",
        codeLanguage: "python",
        kind: "text",
        plainText: "",
        textMode: "code",
      },
    });
    expect(
      createTextCanvasNode({
        id: "text-with-model",
        model: "gpt-5.6-sol",
        position: { x: 1, y: 2 },
      }).data.textGenerationModel,
    ).toBe("gpt-5.6-sol");
    expect(
      createMarkdownCanvasNode({
        id: "md-1",
        markdown: "# 标题",
        position: { x: 1, y: 2 },
      }),
    ).toMatchObject({
      type: "text",
      style: { height: 320, width: 560 },
      data: {
        kind: "text",
        plainText: "# 标题",
        richTextHtml: "",
        textMode: "markdown",
      },
    });
  });

  it("creates connected text generation nodes only when a source node exists", () => {
    expect(
      createTextGenerationCanvasNode({
        id: "gen-1",
        position: { x: 10, y: 20 },
        prompt: "总结",
      }),
    ).toMatchObject({
      edge: null,
      node: {
        data: {
          kind: "textGeneration",
          textGenerationModel: "glm-4.5",
          textGenerationPrompt: "总结",
        },
      },
    });

    expect(
      createTextGenerationCanvasNode({
        id: "gen-2",
        position: { x: 10, y: 20 },
        sourceNode: textNode({ id: "source-1" }),
      }).edge,
    ).toEqual(expectedEdge("source-1", "gen-2"));
  });

  it("creates text child nodes beside the source and escapes rich text HTML", () => {
    const { edge, node } = createTextChildCanvasNode({
      id: "child-1",
      selectedText: 'A&B\n<script>"x"</script>',
      sourceNode: textNode({
        position: { x: 30, y: 40 },
        style: { height: 260, width: 400 },
      }),
    });

    expect(edge).toEqual(expectedEdge("source", "child-1"));
    expect(node.position).toEqual({ x: 510, y: 88 });
    expect(node.data.richTextHtml).toBe(
      "<p>A&amp;B<br>&lt;script&gt;&quot;x&quot;&lt;/script&gt;</p>",
    );
    expect(node.data.plainText).toBe('A&B\n<script>"x"</script>');
  });

  it("creates AI response child nodes with timestamp metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T03:00:00.000Z"));

    const { edge, node } = createAiResponseChildCanvasNode({
      id: "agent-1",
      model: "glm-5.1",
      prompt: "解释",
      response: "回答",
      sourceNode: textNode(),
    });

    expect(edge).toEqual(expectedEdge("source", "agent-1"));
    expect(node).toMatchObject({
      position: { x: 700, y: 248 },
      style: { height: 264, width: 620 },
      type: "agent",
      data: {
        aiCreatedAt: "2026-06-28T03:00:00.000Z",
        aiModel: "glm-5.1",
        aiPrompt: "解释",
        aiResponse: "回答",
        aiStatus: "done",
        kind: "agent",
        plainText: "回答",
        textGenerationModel: "glm-5.1",
      },
    });
  });

  it("creates managed text nodes with searchable metadata", () => {
    expect(
      createManagedTextCanvasNode({
        createdAt: "2026-07-15T02:30:00.000Z",
        id: "managed-text-1",
        model: "gpt-5.6-sol",
        position: { x: 12, y: 24 },
      }),
    ).toMatchObject({
      id: "managed-text-1",
      position: { x: 12, y: 24 },
      style: { height: 380, width: 560 },
      type: "managedText",
      data: {
        createdAt: "2026-07-15T02:30:00.000Z",
        kind: "managedText",
        name: "",
        plainText: "",
        tags: [],
        textGenerationModel: "gpt-5.6-sol",
        title: "强管理节点",
      },
    });
  });

  it("creates task nodes with workflow defaults", () => {
    expect(
      createTaskCanvasNode({
        createdAt: "2026-07-16T01:30:00.000Z",
        id: "task-1",
        position: { x: 12, y: 24 },
      }),
    ).toMatchObject({
      id: "task-1",
      position: { x: 12, y: 24 },
      style: { height: 176, width: 560 },
      type: "task",
      data: {
        createdAt: "2026-07-16T01:30:00.000Z",
        kind: "task",
        name: "",
        tags: [],
        taskChildrenExpanded: false,
        taskComplexity: "simple",
        taskExpandedHeight: 460,
        taskPriority: "P3",
        taskStatus: "inProgress",
        taskUrgency: "stand",
        title: "任务",
        updatedAt: "2026-07-16T01:30:00.000Z",
      },
    });
  });

  it("creates a running AI response child before content is available", () => {
    const { node } = createAiResponseChildCanvasNode({
      id: "agent-pending",
      model: "gpt-5.6-sol",
      prompt: "查询最新赛程",
      sourceNode: textNode(),
      startedAt: "2026-07-15T01:00:00.000Z",
    });

    expect(node.data).toMatchObject({
      aiPrompt: "查询最新赛程",
      aiResponse: undefined,
      aiStatus: "generating",
      aiTaskStartedAt: "2026-07-15T01:00:00.000Z",
      plainText: "",
    });
  });

  it("creates a separate pending image result child for every request", () => {
    const sourceNode = textNode({
      id: "image-source",
      type: "imageGeneration",
      data: { kind: "imageGeneration", title: "图片生成" },
    });
    const result = createPendingImageResultChildCanvasNode({
      aspectRatio: "16:9",
      id: "image-result-1",
      model: "gpt-5.6-sol",
      position: { x: 720, y: 200 },
      prompt: "生成球场全景",
      quality: "1K",
      sourceNode,
    });

    expect(result.edge).toEqual(expectedEdge("image-source", "image-result-1"));
    expect(result.node.data).toMatchObject({
      imageGenerationResult: true,
      imagePrompt: "生成球场全景",
      imageStatus: "editing",
      kind: "imageGeneration",
    });
  });

  it("creates a standalone image generation node without a source image", () => {
    expect(
      createImageGenerationCanvasNode({
        aspectRatio: "auto",
        id: "image-generation-1",
        model: "gpt-5.6-sol",
        position: { x: 40, y: 80 },
        quality: "1K",
      }),
    ).toMatchObject({
      id: "image-generation-1",
      position: { x: 40, y: 80 },
      style: { height: 260, width: 520 },
      type: "imageGeneration",
      data: {
        imageOutputAspectRatio: "auto",
        imageModel: "gpt-5.6-sol",
        imagePrompt: "",
        imageQuality: "1K",
        kind: "imageGeneration",
        title: "图片生成",
      },
    });
  });

  it("creates the same image generation node with the source selected as a reference", () => {
    const sourceNode = {
      ...textNode({ id: "image-source" }),
      type: "image",
      data: {
        kind: "image" as const,
        title: "参考图片",
        originalUrl: "/source.png",
      },
    } as CanvasNode;
    const result = createReferencedImageGenerationCanvasNode({
      id: "image-generation-2",
      position: { x: 40, y: 80 },
      sourceNode,
    });

    expect(result.node).toMatchObject({
      type: "imageGeneration",
      data: {
        imageOperation: "generate",
        imageReferenceNodeIds: ["image-source"],
        kind: "imageGeneration",
        title: "图片生成",
      },
    });
    expect(result.edge).toEqual(expectedEdge("image-source", "image-generation-2"));
  });

  it("creates reader and placeholder nodes with connected edges", () => {
    const reader = createReaderCanvasNode({
      id: "reader-1",
      readingAssetId: "asset-1",
      sourceNode: textNode({ data: { kind: "book", title: "地师" } }),
    });
    expect(reader.edge).toEqual(expectedEdge("source", "reader-1"));
    expect(reader.node).toMatchObject({
      position: { x: 460, y: 200 },
      style: { height: 620, width: 960 },
      data: { kind: "reader", readingAssetId: "asset-1", title: "阅读：地师" },
    });

    const placeholder = createConnectedPlaceholderCanvasNode({
      id: "placeholder-1",
      kind: "agent",
      sourceNode: textNode(),
    });
    expect(placeholder.edge).toEqual(expectedEdge("source", "placeholder-1"));
    expect(placeholder.node).toMatchObject({
      position: { x: 700, y: 320 },
      data: { kind: "agent", title: "Agent 输出占位", uploadStatus: "pending" },
    });

    const managedText = createConnectedPlaceholderCanvasNode({
      id: "managed-text-child",
      kind: "managedText",
      model: "gpt-5.6-sol",
      sourceNode: textNode(),
    });
    expect(managedText.edge).toEqual(
      expectedEdge("source", "managed-text-child"),
    );
    expect(managedText.node).toMatchObject({
      position: { x: 700, y: 200 },
      type: "managedText",
      data: {
        kind: "managedText",
        textGenerationModel: "gpt-5.6-sol",
      },
    });

    const task = createConnectedPlaceholderCanvasNode({
      id: "task-child",
      kind: "task",
      sourceNode: textNode(),
    });
    expect(task.edge).toEqual(expectedEdge("source", "task-child"));
    expect(task.node).toMatchObject({
      position: { x: 700, y: 200 },
      type: "task",
      data: { kind: "task", taskStatus: "inProgress" },
    });
  });

  it("places reading note nodes after existing reader children", () => {
    const reader = textNode({
      id: "reader-1",
      data: { kind: "reader", readingAssetId: "asset-1", title: "阅读：地师" },
      position: { x: 100, y: 100 },
      style: { height: 620, width: 960 },
      type: "reader",
    });
    const existingNote = textNode({
      id: "note-old",
      data: { kind: "note", title: "旧笔记" },
      position: { x: 1108, y: 220 },
      style: { height: 180, width: 320 },
      type: "note",
    });

    const { edge, node } = createReadingNoteCanvasNode({
      asset,
      edges: [expectedEdge("reader-1", "note-old")],
      fallbackPosition: { x: 0, y: 0 },
      id: "note-new",
      note,
      nodes: [reader, existingNote],
      readerNodeId: "reader-1",
    });

    expect(edge).toEqual(expectedEdge("reader-1", "note-new"));
    expect(node).toMatchObject({
      position: { x: 1108, y: 432 },
      type: "note",
      data: {
        chapterTitle: "第一章",
        comment: "批注",
        kind: "note",
        readingAssetId: "asset-1",
        readingNoteId: "note-1",
        selectedText: "选中文字",
        sourceBookTitle: "地师",
        title: "第一章",
      },
    });
  });

  it("creates dropped reading note nodes at the provided position", () => {
    const book = textNode({
      id: "book-1",
      data: { kind: "book", readingAssetId: "asset-1", title: "地师" },
      type: "book",
    });

    const { edge, node } = createDroppedReadingNoteCanvasNode({
      asset,
      id: "note-dropped",
      note: { ...note, chapterTitle: null },
      nodes: [book],
      position: { x: 10, y: 20 },
    });

    expect(edge).toEqual(expectedEdge("book-1", "note-dropped"));
    expect(node).toMatchObject({
      position: { x: 10, y: 20 },
      data: {
        chapterTitle: undefined,
        kind: "note",
        sourceBookTitle: "地师",
        title: "阅读笔记",
      },
    });
  });
});
