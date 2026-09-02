import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { CanvasNode } from "./types";
import {
  createArchiveCanvasSelectionUpdate,
  createRestoreCanvasSelectionUpdate,
  getCanvasArchiveView,
  resolveCanvasArchiveViewportTransition,
} from "./archive";

function node(
  id: string,
  data: Partial<CanvasNode["data"]> = {},
): CanvasNode {
  return {
    data: { kind: "text", title: id, ...data },
    id,
    position: { x: 0, y: 0 },
    type: data.kind ?? "text",
  } as CanvasNode;
}

describe("canvas archive updates", () => {
  it("restores the cached viewport for each view and only fits a new archive view", () => {
    const activeViewport = { x: 120, y: -80, zoom: 1.25 };
    const archivedViewport = { x: -20, y: 40, zoom: 0.7 };

    expect(resolveCanvasArchiveViewportTransition({
      activeViewport,
      archivedViewport,
      hasVisibleNodes: true,
      nextMode: "active",
    })).toEqual({ shouldFitView: false, targetViewport: activeViewport });
    expect(resolveCanvasArchiveViewportTransition({
      activeViewport,
      archivedViewport,
      hasVisibleNodes: true,
      nextMode: "archived",
    })).toEqual({ shouldFitView: false, targetViewport: archivedViewport });
    expect(resolveCanvasArchiveViewportTransition({
      activeViewport,
      archivedViewport: null,
      hasVisibleNodes: true,
      nextMode: "archived",
    })).toEqual({ shouldFitView: true, targetViewport: null });
  });

  it("archives every downstream child and disconnects only outside parents", () => {
    const nodes = [
      node("outside"),
      node("root", { nodeLifecycle: "pinned", taskParentId: "outside" }),
      node("child", { kind: "file" }),
      node("grandchild", { kind: "image", taskParentId: "child" }),
    ];
    const edges: Edge[] = [
      { id: "outside-root", source: "outside", target: "root" },
      { id: "root-child", source: "root", target: "child" },
    ];

    const update = createArchiveCanvasSelectionUpdate({
      edges,
      nodeIds: ["root"],
      nodes,
    });

    expect(Array.from(update?.affectedNodeIds ?? [])).toEqual([
      "root",
      "child",
      "grandchild",
    ]);
    expect(update?.deletedEdges).toEqual([edges[0]]);
    expect(update?.nextEdges).toEqual([edges[1]]);
    expect(update?.nextNodes.slice(1).map((item) => item.data.nodeLifecycle)).toEqual([
      "archived",
      "archived",
      "archived",
    ]);
    expect(update?.nextNodes[1].data).toMatchObject({
      nodeLifecycleBeforeArchive: "pinned",
      taskParentId: undefined,
    });
    expect(update?.nextNodes[3].data.taskParentId).toBe("child");
  });

  it("includes grouped content and detaches a selected member from an active group", () => {
    const group = node("group", { kind: "group" });
    const groupedChild = node("grouped", { groupId: "group" });
    const nestedChild = node("nested", { groupId: "group" });
    const nodes = [group, groupedChild, nestedChild];

    const groupUpdate = createArchiveCanvasSelectionUpdate({
      edges: [],
      nodeIds: ["group"],
      nodes,
    });
    expect(Array.from(groupUpdate?.affectedNodeIds ?? [])).toEqual([
      "group",
      "grouped",
      "nested",
    ]);

    const childUpdate = createArchiveCanvasSelectionUpdate({
      edges: [],
      nodeIds: ["grouped"],
      nodes,
    });
    expect(childUpdate?.nextNodes[1].data.groupId).toBeUndefined();
    expect(childUpdate?.nextNodes[0].data.nodeLifecycle).toBeUndefined();
  });

  it("restores an archived subtree to each node's previous lifecycle", () => {
    const nodes = [
      node("archived-parent", { nodeLifecycle: "archived" }),
      node("root", {
        nodeLifecycle: "archived",
        nodeLifecycleBeforeArchive: "knowledge",
      }),
      node("child", {
        nodeLifecycle: "archived",
        nodeLifecycleBeforeArchive: "working",
      }),
      node("active-child"),
    ];
    const edges: Edge[] = [
      { id: "parent-root", source: "archived-parent", target: "root" },
      { id: "root-child", source: "root", target: "child" },
      { id: "child-active", source: "child", target: "active-child" },
    ];

    const update = createRestoreCanvasSelectionUpdate({
      edges,
      nodeIds: ["root"],
      nodes,
    });

    expect(update?.nextNodes.map((item) => item.data.nodeLifecycle)).toEqual([
      "archived",
      "knowledge",
      "working",
      undefined,
    ]);
    expect(update?.deletedEdges).toEqual([edges[0]]);
    expect(update?.nextEdges).toEqual(edges.slice(1));
  });

  it("returns only the nodes and internal edges for the selected view", () => {
    const active = node("active");
    const archivedA = node("archived-a", { nodeLifecycle: "archived" });
    const archivedB = node("archived-b", { nodeLifecycle: "archived" });
    const edges: Edge[] = [
      { id: "archive-internal", source: "archived-a", target: "archived-b" },
      { id: "cross-view", source: "active", target: "archived-a" },
    ];

    const view = getCanvasArchiveView({
      edges,
      mode: "archived",
      nodes: [active, archivedA, archivedB],
    });
    expect(view.nodes.map((item) => item.id)).toEqual(["archived-a", "archived-b"]);
    expect(view.edges).toEqual([edges[0]]);
  });
});
