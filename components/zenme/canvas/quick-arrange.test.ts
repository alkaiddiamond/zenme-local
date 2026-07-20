import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { CanvasNode } from "./types";
import {
  arrangeCanvasNodes,
  createQuickArrangeUpdate,
} from "./quick-arrange";

function node(input: {
  createdAt?: string;
  height?: number;
  id: string;
  kind?: CanvasNode["data"]["kind"];
  width?: number;
  x?: number;
  y?: number;
}): CanvasNode {
  const width = input.width ?? 200;
  const height = input.height ?? 100;
  return {
    data: {
      createdAt: input.createdAt,
      kind: input.kind ?? "text",
      title: input.id,
    },
    height,
    id: input.id,
    position: { x: input.x ?? 0, y: input.y ?? 0 },
    style: { height, width },
    type: input.kind ?? "text",
    width,
  };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

describe("quick canvas arrange", () => {
  it("left-aligns roots by creation time and places children to the right", () => {
    const nodes = [
      node({
        createdAt: "2026-07-20T02:00:00.000Z",
        id: "late-root",
        x: 900,
        y: 800,
      }),
      node({ id: "late-child", x: 100, y: 100 }),
      node({
        createdAt: "2026-07-20T01:00:00.000Z",
        id: "early-root",
        x: 500,
        y: 500,
      }),
      node({ id: "early-child", x: 200, y: 900 }),
    ];
    const arranged = arrangeCanvasNodes(nodes, [
      edge("late", "late-root", "late-child"),
      edge("early", "early-root", "early-child"),
    ]);
    const byId = new Map(arranged.map((item) => [item.id, item]));

    expect(byId.get("early-root")?.position.x).toBe(
      byId.get("late-root")?.position.x,
    );
    expect(byId.get("early-root")!.position.y).toBeLessThan(
      byId.get("late-root")!.position.y,
    );
    expect(byId.get("early-child")!.position.x).toBeGreaterThan(
      byId.get("early-root")!.position.x,
    );
    expect(byId.get("early-child")!.position.y).toBe(
      byId.get("early-root")!.position.y,
    );
  });

  it("collapses every expanded node before arranging", () => {
    const nodes: CanvasNode[] = [
      {
        ...node({ id: "task", kind: "task", height: 500, width: 600 }),
        data: {
          kind: "task",
          taskChildrenExpanded: true,
          title: "任务",
        },
      },
      {
        ...node({ id: "text", height: 1123, width: 794 }),
        data: { kind: "text", textExpanded: false, title: "文本" },
      },
      {
        ...node({ id: "agent", kind: "agent", height: 1123, width: 794 }),
        data: {
          aiPrompt: "问题",
          aiResponseExpanded: false,
          kind: "agent",
          title: "AI 回复",
        },
      },
      {
        ...node({
          id: "analysis",
          kind: "musicAnalysis",
          height: 1123,
          width: 794,
        }),
        data: {
          kind: "musicAnalysis",
          musicChildExpanded: false,
          title: "分析",
        },
      },
    ];
    const update = createQuickArrangeUpdate({ edges: [], nodes });
    const byId = new Map(update?.nextNodes.map((item) => [item.id, item]));

    expect(byId.get("task")).toMatchObject({
      height: 176,
      width: 560,
      data: { taskChildrenExpanded: false },
    });
    expect(byId.get("text")).toMatchObject({
      height: 176,
      width: 560,
      data: { textExpanded: false },
    });
    expect(byId.get("agent")).toMatchObject({
      height: 260,
      width: 620,
      data: { aiResponseExpanded: false },
    });
    expect(byId.get("analysis")).toMatchObject({
      height: 176,
      width: 560,
      data: { musicChildExpanded: false },
    });
  });

  it("keeps group frames wrapped around their arranged members", () => {
    const memberA = {
      ...node({ id: "a" }),
      data: { groupId: "group", kind: "text" as const, title: "A" },
    };
    const memberB = {
      ...node({ id: "b" }),
      data: { groupId: "group", kind: "text" as const, title: "B" },
    };
    const group = {
      ...node({ id: "group", kind: "group" }),
      data: { kind: "group" as const, title: "组" },
    };
    const arranged = arrangeCanvasNodes(
      [group, memberA, memberB],
      [edge("ab", "a", "b")],
    );
    const byId = new Map(arranged.map((item) => [item.id, item]));

    expect(byId.get("group")!.position.x).toBeLessThan(
      byId.get("a")!.position.x,
    );
    expect(byId.get("group")!.position.y).toBeLessThan(
      byId.get("a")!.position.y,
    );
    expect(byId.get("group")!.width).toBeGreaterThan(400);
  });

  it("collapses readers and keeps their child visibility consistent", () => {
    const reader = {
      ...node({ id: "reader", kind: "reader", height: 620, width: 960 }),
      data: { kind: "reader" as const, title: "阅读器" },
    };
    const note = node({ id: "note", kind: "note" });
    const update = createQuickArrangeUpdate({
      edges: [edge("reader-note", "reader", "note")],
      nodes: [reader, note],
    });
    const byId = new Map(update?.nextNodes.map((item) => [item.id, item]));

    expect(byId.get("reader")).toMatchObject({
      height: 110,
      width: 288,
      data: { readerCollapsed: true },
    });
    expect(byId.get("note")?.hidden).toBe(true);
    expect(update?.nextEdges[0].hidden).toBe(true);
  });
});
