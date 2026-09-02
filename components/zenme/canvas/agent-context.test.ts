import { describe, expect, it } from "vitest";

import {
  collectAgentTurnReferences,
  createAgentContextFromActionNode,
} from "./agent-context";
import type { CanvasNode } from "./types";

function node(input: {
  data?: Partial<CanvasNode["data"]>;
  id: string;
  type?: string;
}): CanvasNode {
  return {
    id: input.id,
    position: { x: 0, y: 0 },
    type: input.type ?? "text",
    data: {
      kind: "text",
      title: input.id,
      ...input.data,
    },
  } as CanvasNode;
}

describe("agent context helpers", () => {
  it("builds note-specific context from action nodes", () => {
    expect(
      createAgentContextFromActionNode(
        node({
          data: {
            chapterTitle: "第一章",
            comment: "这里可以展开",
            kind: "note",
            selectedText: "这是一段摘录",
            sourceBookTitle: "地师",
            title: "阅读笔记",
          },
          id: "note-1",
          type: "note",
        }),
      ),
    ).toBe(
      "阅读笔记：阅读笔记\n来源：地师\n原文：这是一段摘录\n备注：这里可以展开",
    );
  });

  it("builds generic context for non-note nodes", () => {
    expect(
      createAgentContextFromActionNode(
        node({
          data: { kind: "code", title: "代码片段" },
          id: "code-1",
          type: "code",
        }),
      ),
    ).toBe("节点「代码片段」（类型：code）");
  });

  it("includes the stable root identity for Workspace file nodes", () => {
    expect(createAgentContextFromActionNode(node({
      data: {
        kind: "workspaceFile",
        title: "config.ts",
        workspaceRootId: "root-additional",
        workspaceRelativePath: "src/config.ts",
      },
      id: "workspace-file-1",
      type: "workspaceFile",
    }))).toBe("Workspace 文件节点「config.ts」\nRoot ID：root-additional\n相对路径：src/config.ts");
  });

  it("returns undefined when there is no action node", () => {
    expect(createAgentContextFromActionNode(undefined)).toBeUndefined();
  });

  it("collects every upstream node and deduplicates Workspace file documents", () => {
    const prompt = node({
      data: { kind: "textGeneration", title: "Agent 输入" },
      id: "prompt",
      type: "textGeneration",
    });
    const fileA = node({
      data: {
        kind: "workspaceFile",
        title: "a.ts",
        workspaceFileDocumentId: "document-a",
      },
      id: "file-a",
      type: "workspaceFile",
    });
    const fileAlias = node({
      data: {
        kind: "workspaceFile",
        title: "a.ts 的另一个视图",
        workspaceFileDocumentId: "document-a",
      },
      id: "file-alias",
      type: "workspaceFile",
    });
    const note = node({ id: "note" });

    expect(collectAgentTurnReferences({
      edges: [
        { id: "file-a-note", source: "file-a", target: "note" },
        { id: "note-prompt", source: "note", target: "prompt" },
        { id: "file-alias-prompt", source: "file-alias", target: "prompt" },
      ],
      nodeId: "prompt",
      nodes: [prompt, fileA, fileAlias, note],
    })).toEqual({
      fileDocumentIds: ["document-a"],
      readingAssetIds: [],
      selectedNodeIds: ["prompt", "file-a", "file-alias", "note"],
    });
  });

  it("does not submit archived upstream nodes as active Agent references", () => {
    const prompt = node({
      data: { kind: "textGeneration", title: "Agent 输入" },
      id: "prompt",
      type: "textGeneration",
    });
    const archived = node({
      data: {
        kind: "workspaceFile",
        nodeLifecycle: "archived",
        title: "old.ts",
        workspaceFileDocumentId: "document-old",
      },
      id: "archived",
      type: "workspaceFile",
    });

    expect(collectAgentTurnReferences({
      edges: [{ id: "archived-prompt", source: "archived", target: "prompt" }],
      nodeId: "prompt",
      nodes: [prompt, archived],
    })).toEqual({
      fileDocumentIds: [],
      readingAssetIds: [],
      selectedNodeIds: ["prompt"],
    });
  });

  it("collects original reading assets from connected notes and readers", () => {
    const prompt = node({ id: "prompt" });
    const note = node({
      data: { kind: "note", readingAssetId: "asset-pdf" },
      id: "note",
      type: "note",
    });
    const reader = node({
      data: { kind: "reader", readingAssetId: "asset-pdf" },
      id: "reader",
      type: "reader",
    });

    expect(collectAgentTurnReferences({
      edges: [
        { id: "reader-note", source: "reader", target: "note" },
        { id: "note-prompt", source: "note", target: "prompt" },
      ],
      nodeId: "prompt",
      nodes: [prompt, note, reader],
    })).toEqual({
      fileDocumentIds: [],
      readingAssetIds: ["asset-pdf"],
      selectedNodeIds: ["prompt", "note", "reader"],
    });
  });
});
