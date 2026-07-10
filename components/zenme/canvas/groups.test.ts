import { describe, expect, it } from "vitest";

import {
  createGroupSelectionUpdate,
  getGroupFrameDragMove,
  releaseGroupedNodeDragExtent,
} from "./groups";
import type { CanvasNode } from "./types";

function node(input: {
  data?: Partial<CanvasNode["data"]>;
  extent?: CanvasNode["extent"];
  id: string;
  parentId?: string;
  position?: { x: number; y: number };
  style?: CanvasNode["style"];
}): CanvasNode {
  return {
    id: input.id,
    extent: input.extent,
    parentId: input.parentId,
    position: input.position ?? { x: 0, y: 0 },
    style: input.style,
    type: input.data?.kind ?? "text",
    data: {
      kind: "text",
      title: input.id,
      ...input.data,
    },
  } as CanvasNode;
}

describe("canvas group helpers", () => {
  it("returns null when fewer than two nodes are selected", () => {
    const selected = node({ id: "a" });

    expect(
      createGroupSelectionUpdate({
        allNodes: [selected],
        groupId: "group",
        selectedNodes: [selected],
      }),
    ).toBeNull();
  });

  it("creates a group node and update records for selected nodes", () => {
    const a = node({
      id: "a",
      position: { x: 100, y: 100 },
      style: { height: 120, width: 200 },
    });
    const b = node({
      id: "b",
      position: { x: 360, y: 140 },
      style: { height: 80, width: 160 },
    });
    const outside = node({ id: "outside", position: { x: 0, y: 0 } });

    const update = createGroupSelectionUpdate({
      allNodes: [outside, a, b],
      groupId: "group",
      selectedNodes: [a, b],
    });

    expect(update?.createdGroupNode).toMatchObject({
      id: "group",
      type: "group",
      data: { kind: "group", title: "新建组" },
    });
    expect(update?.nextNodes.map((item) => item.id)).toEqual([
      "outside",
      "group",
      "a",
      "b",
    ]);
    expect(update?.nextNodes.find((item) => item.id === "a")).toMatchObject({
      data: { groupId: "group" },
      selected: false,
    });
    expect(update?.nodeUpdates.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("releases legacy parent extent before dragging a grouped child", () => {
    const dragged = node({
      extent: "parent",
      id: "child",
      parentId: "group",
    });
    const other = node({ id: "other" });

    expect(releaseGroupedNodeDragExtent([dragged, other], dragged)).toEqual([
      {
        ...dragged,
        extent: undefined,
      },
      other,
    ]);
    expect(releaseGroupedNodeDragExtent([other], other)).toBeInstanceOf(Array);
    expect(releaseGroupedNodeDragExtent([other], other)).toEqual([other]);
  });

  it("derives group frame drag deltas from the previous drag state", () => {
    const group = node({
      data: { kind: "group" },
      id: "group",
      position: { x: 100, y: 120 },
    });

    expect(
      getGroupFrameDragMove({
        draggedNode: node({ id: "plain", position: { x: 1, y: 2 } }),
        previous: { id: "group", position: { x: 0, y: 0 } },
      }),
    ).toEqual({
      delta: null,
      next: null,
    });

    expect(getGroupFrameDragMove({ draggedNode: group, previous: null })).toEqual(
      {
        delta: null,
        next: { id: "group", position: { x: 100, y: 120 } },
      },
    );

    expect(
      getGroupFrameDragMove({
        draggedNode: group,
        previous: { id: "group", position: { x: 100, y: 120 } },
      }),
    ).toEqual({
      delta: null,
      next: { id: "group", position: { x: 100, y: 120 } },
    });

    expect(
      getGroupFrameDragMove({
        draggedNode: group,
        previous: { id: "group", position: { x: 80, y: 90 } },
      }),
    ).toEqual({
      delta: { x: 20, y: 30 },
      next: { id: "group", position: { x: 100, y: 120 } },
    });
  });
});
