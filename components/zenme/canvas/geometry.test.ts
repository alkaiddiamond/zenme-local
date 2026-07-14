import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  collectReaderChildNodeIds,
  createCanvasHistoryEntry,
  getAbsoluteNodePosition,
  getNodeBounds,
  isNodeCenterInsideBounds,
  normalizeGroupNodeRelations,
  numericSize,
  readNodeSize,
  removeLegacyWelcomeNodes,
  recoverInterruptedImageTasks,
  shouldHideReaderChildEdge,
} from "./geometry";
import type { CanvasNode } from "./types";

function node(input: {
  data?: Partial<CanvasNode["data"]>;
  height?: number;
  id: string;
  measured?: { height?: number; width?: number };
  parentId?: string;
  position?: { x: number; y: number };
  style?: CanvasNode["style"];
  type?: string;
  width?: number;
}): CanvasNode {
  return {
    id: input.id,
    parentId: input.parentId,
    position: input.position ?? { x: 0, y: 0 },
    style: input.style,
    type: input.type ?? "text",
    data: {
      kind: "text",
      title: input.id,
      ...input.data,
    },
    ...(input.height !== undefined ? { height: input.height } : {}),
    ...(input.width !== undefined ? { width: input.width } : {}),
    ...(input.measured ? { measured: input.measured } : {}),
  } as CanvasNode;
}

describe("canvas geometry helpers", () => {
  it("parses numeric sizes and ignores invalid values", () => {
    expect(numericSize(120)).toBe(120);
    expect(numericSize("48px")).toBe(48);
    expect(numericSize("bad")).toBeUndefined();
    expect(numericSize(Number.NaN)).toBeUndefined();
  });

  it("reads node size by measured, explicit, style and fallback priority", () => {
    expect(
      readNodeSize(
        node({
          height: 90,
          id: "n1",
          measured: { height: 120, width: 240 },
          style: { height: 80, width: 160 },
          width: 180,
        }),
        { height: 10, width: 20 },
      ),
    ).toEqual({ height: 120, width: 240 });
    expect(
      readNodeSize(
        node({
          height: 90,
          id: "n2",
          style: { height: "80px", width: "160px" },
          width: 180,
        }),
        { height: 10, width: 20 },
      ),
    ).toEqual({ height: 90, width: 180 });
    expect(readNodeSize(undefined, { height: 10, width: 20 })).toEqual({
      height: 10,
      width: 20,
    });
  });

  it("resolves absolute positions through parent chains", () => {
    const nodes = [
      node({ id: "group-a", position: { x: 100, y: 200 } }),
      node({
        id: "group-b",
        parentId: "group-a",
        position: { x: 20, y: 30 },
      }),
      node({
        id: "child",
        parentId: "group-b",
        position: { x: 3, y: 4 },
      }),
    ];

    expect(getAbsoluteNodePosition(nodes[2], nodes)).toEqual({ x: 123, y: 234 });
  });

  it("computes bounds and center containment", () => {
    const parent = node({
      data: { kind: "group" },
      id: "group",
      position: { x: 0, y: 0 },
      style: { height: 200, width: 200 },
    });
    const child = node({
      id: "child",
      position: { x: 150, y: 150 },
      style: { height: 80, width: 80 },
    });

    expect(getNodeBounds(parent, [parent, child])).toEqual({
      height: 200,
      width: 200,
      x: 0,
      y: 0,
    });
    expect(
      isNodeCenterInsideBounds(
        getNodeBounds(child, [parent, child]),
        getNodeBounds(parent, [parent, child]),
      ),
    ).toBe(true);
  });

  it("normalizes legacy parent relations into groupId data", () => {
    const group = node({
      data: { kind: "group" },
      id: "group",
      position: { x: 100, y: 100 },
    });
    const child = node({
      id: "child",
      parentId: "group",
      position: { x: 20, y: 30 },
    });

    expect(normalizeGroupNodeRelations([group, child])[1]).toMatchObject({
      parentId: undefined,
      position: { x: 120, y: 130 },
      data: { groupId: "group" },
    });
  });

  it("collects reader descendants and hides their internal edges", () => {
    const edges: Edge[] = [
      { id: "r-a", source: "reader", target: "a" },
      { id: "a-b", source: "a", target: "b" },
      { id: "b-reader", source: "b", target: "reader" },
      { id: "x-y", source: "x", target: "y" },
    ];
    const childIds = collectReaderChildNodeIds("reader", edges);

    expect([...childIds]).toEqual(["a", "b"]);
    expect(shouldHideReaderChildEdge("reader", childIds, edges[0])).toBe(true);
    expect(shouldHideReaderChildEdge("reader", childIds, edges[1])).toBe(true);
    expect(shouldHideReaderChildEdge("reader", childIds, edges[3])).toBe(false);
  });

  it("removes legacy welcome nodes and dangling edges", () => {
    const welcome = node({ id: "welcome" });
    const real = node({ id: "real" });
    const result = removeLegacyWelcomeNodes([welcome, real], [
      { id: "welcome-real", source: "welcome", target: "real" },
      { id: "real-real", source: "real", target: "real" },
    ]);

    expect(result.nodes.map((item) => item.id)).toEqual(["real"]);
    expect(result.edges.map((item) => item.id)).toEqual(["real-real"]);
  });

  it("marks persisted image tasks as interrupted after a reload", () => {
    const interrupted = node({
      data: {
        imageStatus: "editing",
        kind: "imageGeneration",
        title: "图片生成",
      },
      id: "image-editing",
    });
    const done = node({
      data: { imageStatus: "done", kind: "image", title: "图片生成" },
      id: "image-done",
    });

    const recovered = recoverInterruptedImageTasks([interrupted, done]);

    expect(recovered[0].data).toMatchObject({
      imageError: "任务因页面刷新或应用重启而中断，请重新提交",
      imageStatus: "failed",
    });
    expect(recovered[1]).toBe(done);
  });

  it("marks persisted AI tasks as interrupted after a reload", () => {
    const interrupted = node({
      data: { aiStatus: "generating", kind: "agent", title: "AI 回复" },
      id: "agent-generating",
    });

    const [recovered] = recoverInterruptedImageTasks([interrupted]);

    expect(recovered.data).toMatchObject({
      aiError: "任务因页面刷新或应用重启而中断，请重新提交",
      aiStatus: "failed",
    });
  });

  it("creates serializable history entries without runtime-only fields", () => {
    const update = () => undefined;
    const runtimeNode = {
      ...node({
        data: {
          hasIncomingEdge: true,
          onUpdateTextNode: update,
          plainText: "正文",
        },
        id: "node-1",
      }),
      dragging: true,
      measured: { height: 100, width: 200 },
      selected: true,
    } as CanvasNode & {
      dragging: boolean;
      measured: { height: number; width: number };
      selected: boolean;
    };
    const runtimeEdge = {
      id: "edge-1",
      source: "node-1",
      target: "node-1",
      selected: true,
    } as Edge & { selected: boolean };

    const { entry, signature } = createCanvasHistoryEntry(
      [runtimeNode],
      [runtimeEdge],
    );

    expect(signature).not.toContain("hasIncomingEdge");
    expect(signature).not.toContain("measured");
    expect(entry.nodes[0]).not.toHaveProperty("dragging");
    expect(entry.nodes[0].data).toEqual({
      kind: "text",
      plainText: "正文",
      title: "node-1",
    });
    expect(entry.edges[0]).not.toHaveProperty("selected");
  });
});
