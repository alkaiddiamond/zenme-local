import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { CanvasNode } from "./types";
import {
  canSetTaskParent,
  createTaskConnectionNodeUpdate,
  createTaskParentSelectionUpdate,
  deriveTaskRelationships,
  getTaskParentOptions,
} from "./task-relationships";

function task(
  id: string,
  name: string,
  taskParentId?: string,
): CanvasNode {
  return {
    data: {
      kind: "task",
      name,
      taskParentId,
      taskStatus: "inProgress",
      title: "任务",
    },
    id,
    position: { x: 0, y: 0 },
    type: "task",
  };
}

describe("task relationships", () => {
  it("derives children from persisted parent ids without requiring edges", () => {
    const relationships = deriveTaskRelationships(
      [task("parent", "父任务"), task("child", "子任务", "parent")],
      [],
    );

    expect(relationships.parentIdByChildId.get("child")).toBe("parent");
    expect(relationships.childrenByParentId.get("parent")).toEqual([
      { id: "child", name: "子任务", status: "inProgress" },
    ]);
  });

  it("uses task edges as a legacy relationship fallback", () => {
    const relationships = deriveTaskRelationships(
      [task("parent", "父任务"), task("child", "子任务")],
      [{ source: "parent", target: "child" }],
    );

    expect(relationships.parentIdByChildId.get("child")).toBe("parent");
  });

  it("excludes the current task and all descendants from parent options", () => {
    const nodes = [
      task("root", "根任务"),
      task("child", "子任务", "root"),
      task("grandchild", "孙任务", "child"),
      task("other", "其他任务"),
    ];

    expect(getTaskParentOptions({
      edges: [],
      nodeId: "root",
      nodes,
    })).toEqual([{ id: "other", name: "其他任务" }]);
    expect(canSetTaskParent({
      childId: "root",
      edges: [],
      nodes,
      parentId: "grandchild",
    })).toBe(false);
  });

  it("clears the parent and removes incoming task edges", () => {
    const nodes = [
      task("parent", "父任务"),
      task("child", "子任务", "parent"),
    ];
    const edges: Edge[] = [
      { id: "task-edge", source: "parent", target: "child" },
      { id: "other-edge", source: "child", target: "note" },
    ];
    const update = createTaskParentSelectionUpdate({
      edges,
      nodeId: "child",
      nodes,
      now: "2026-07-20T10:00:00.000Z",
    });

    expect(update?.nextNodes[1].data.taskParentId).toBeUndefined();
    expect(update?.nextNodes[1].data.updatedAt).toBe(
      "2026-07-20T10:00:00.000Z",
    );
    expect(update?.nextEdges).toEqual([edges[1]]);
    expect(update?.deletedEdges).toEqual([edges[0]]);
  });

  it("selects a parent without creating a visual edge", () => {
    const nodes = [task("parent", "父任务"), task("child", "子任务")];
    const update = createTaskParentSelectionUpdate({
      edges: [],
      nodeId: "child",
      nodes,
      parentId: "parent",
    });

    expect(update?.nextNodes[1].data.taskParentId).toBe("parent");
    expect(update?.nextEdges).toEqual([]);
  });

  it("syncs a connected task parent into the child node", () => {
    const nodes = [task("parent", "父任务"), task("child", "子任务")];
    const update = createTaskConnectionNodeUpdate({
      childId: "child",
      nodes,
      parentId: "parent",
    });

    expect(update.nextNodes[1].data.taskParentId).toBe("parent");
    expect(update.nodeUpdates).toHaveLength(1);
  });
});
