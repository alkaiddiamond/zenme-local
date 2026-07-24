import { describe, expect, it } from "vitest";

import { createCanvasHistoryNodeSnapshot } from "./geometry";
import {
  createAltDragCopyUpdate,
  createAltDragPreviewNodes,
  isAltDragPreviewNode,
} from "./alt-drag-copy";
import type { CanvasNode } from "./types";

function node(input: {
  groupId?: string;
  id: string;
  kind?: CanvasNode["data"]["kind"];
  parentId?: string;
  x: number;
  y: number;
}): CanvasNode {
  return {
    data: {
      groupId: input.groupId,
      kind: input.kind ?? "text",
      title: input.id,
    },
    id: input.id,
    parentId: input.parentId,
    position: { x: input.x, y: input.y },
    type: input.kind ?? "text",
  } as CanvasNode;
}

function snapshots(nodes: CanvasNode[]) {
  return new Map(
    nodes.map((item) => [item.id, createCanvasHistoryNodeSnapshot(item)]),
  );
}

describe("Alt-drag node copy", () => {
  it("creates a non-interactive source preview while the copy is dragged", () => {
    const before = [node({ id: "source", x: 20, y: 40 })];
    const [preview] = createAltDragPreviewNodes({
      beforeNodeSnapshots: snapshots(before),
      draggedNodeId: "source",
    });

    expect(preview).toMatchObject({
      className: "zenme-alt-drag-source-preview",
      connectable: false,
      draggable: false,
      position: { x: 20, y: 40 },
      selectable: false,
    });
    expect(isAltDragPreviewNode(preview)).toBe(true);
  });

  it("remaps grouped preview ownership", () => {
    const before = [
      node({ id: "group", kind: "group", x: 0, y: 0 }),
      node({ groupId: "group", id: "child", parentId: "group", x: 20, y: 30 }),
    ];
    const previews = createAltDragPreviewNodes({
      beforeNodeSnapshots: snapshots(before),
      draggedNodeId: "group",
    });

    expect(previews[1]).toMatchObject({
      data: { groupId: "alt-drag-preview:group" },
      parentId: "alt-drag-preview:group",
    });
  });

  it("restores the source and creates a selected copy at the drop position", () => {
    const before = [node({ id: "source", x: 20, y: 40 })];
    const update = createAltDragCopyUpdate({
      beforeNodeSnapshots: snapshots(before),
      createId: () => "copy",
      currentNodes: [node({ id: "source", x: 180, y: 220 })],
      draggedNodeId: "source",
      now: Date.parse("2026-07-22T00:00:00.000Z"),
    });

    expect(update?.nextNodes).toMatchObject([
      { id: "source", position: { x: 20, y: 40 }, selected: false },
      {
        data: { createdAt: "2026-07-22T00:00:00.000Z" },
        id: "copy",
        position: { x: 180, y: 220 },
        selected: true,
      },
    ]);
    expect(update?.createdNodes).toHaveLength(1);
  });

  it("copies grouped children while remapping group ownership", () => {
    const before = [
      node({ id: "group", kind: "group", x: 0, y: 0 }),
      node({ groupId: "group", id: "child", parentId: "group", x: 20, y: 30 }),
    ];
    let nextId = 0;
    const update = createAltDragCopyUpdate({
      beforeNodeSnapshots: snapshots(before),
      createId: () => `copy-${++nextId}`,
      currentNodes: [
        node({ id: "group", kind: "group", x: 200, y: 100 }),
        node({ groupId: "group", id: "child", x: 220, y: 130 }),
      ],
      draggedNodeId: "group",
      now: 0,
    });

    expect(update?.nextNodes.slice(0, 2)).toMatchObject([
      { id: "group", position: { x: 0, y: 0 }, selected: false },
      {
        data: { groupId: "group" },
        id: "child",
        parentId: "group",
        position: { x: 20, y: 30 },
        selected: false,
      },
    ]);
    expect(update?.createdNodes).toMatchObject([
      { id: "copy-1", position: { x: 200, y: 100 }, selected: true },
      {
        data: { groupId: "copy-1" },
        id: "copy-2",
        parentId: "copy-1",
        position: { x: 20, y: 30 },
        selected: false,
      },
    ]);
  });

  it("does not copy a node when the drag position did not change", () => {
    const before = [node({ id: "source", x: 20, y: 40 })];
    expect(
      createAltDragCopyUpdate({
        beforeNodeSnapshots: snapshots(before),
        createId: () => "copy",
        currentNodes: before,
        draggedNodeId: "source",
      }),
    ).toBeNull();
  });
});
