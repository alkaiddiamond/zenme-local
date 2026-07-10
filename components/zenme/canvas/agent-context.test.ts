import { describe, expect, it } from "vitest";

import { createAgentContextFromActionNode } from "./agent-context";
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

  it("returns undefined when there is no action node", () => {
    expect(createAgentContextFromActionNode(undefined)).toBeUndefined();
  });
});
