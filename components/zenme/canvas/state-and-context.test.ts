import type { Connection, Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  NODE_ACTION_HANDLE_ID,
  NODE_CONTEXT_HANDLE_ID,
  NODE_RIGHT_HANDLE_ID,
} from "@/components/zenme/node-types";

import {
  createNodeActionMenuFromConnectEnd,
  normalizeCanvasConnection,
} from "./connections";
import {
  createCanvasItemsHistoryEntry,
  createDeletedCanvasItemsHistoryEntry,
  createMutateCanvasItemsHistoryEntry,
  createNodeUpdateHistoryEntry,
  getCanvasHistoryState,
  getCanvasPersistableSignature,
} from "./history-state";
import { collectTextGenerationContext } from "./text-generation-context";
import type { CanvasHistoryEntry, CanvasNode } from "./types";

function canvasNode(input: {
  data?: Partial<CanvasNode["data"]>;
  id: string;
  position?: { x: number; y: number };
  type?: string;
}): CanvasNode {
  return {
    id: input.id,
    position: input.position ?? { x: 0, y: 0 },
    type: input.type ?? "text",
    data: {
      kind: "text",
      title: input.id,
      ...input.data,
    },
  } as CanvasNode;
}

function edge(source: string, target: string): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
  };
}

describe("canvas state and context helpers", () => {
  it("folds canvas history command entries into the latest snapshot state", () => {
    const nodeA = canvasNode({ id: "a" });
    const nodeB = canvasNode({ id: "b" });
    const nodeC = canvasNode({ id: "c" });
    const updatedB = canvasNode({
      data: { plainText: "updated" },
      id: "b",
    });
    const history: CanvasHistoryEntry[] = [
      { type: "snapshot", edges: [edge("a", "b")], nodes: [nodeA, nodeB] },
      { type: "createCanvasItems", edges: [edge("b", "c")], nodes: [nodeC] },
      {
        type: "mutateCanvasItems",
        createdEdges: [],
        createdNodes: [],
        deletedEdges: [edge("a", "b")],
        deletedNodes: [nodeA],
        edgeUpdates: [],
        nodeUpdates: [{ after: updatedB, before: nodeB, id: "b" }],
      },
    ];

    expect(getCanvasHistoryState(history)).toEqual({
      type: "snapshot",
      edges: [edge("b", "c")],
      nodes: [updatedB, nodeC],
    });
  });

  it("builds compact history entries and skips empty operations", () => {
    const nodeA = canvasNode({ id: "a" });
    const edgeAB = edge("a", "b");

    expect(createCanvasItemsHistoryEntry({})).toBeNull();
    expect(createCanvasItemsHistoryEntry({ edges: [edgeAB], nodes: [nodeA] }))
      .toEqual({
        type: "createCanvasItems",
        edges: [edgeAB],
        nodes: [nodeA],
      });

    expect(
      createDeletedCanvasItemsHistoryEntry({ edges: [], nodes: [] }),
    ).toBeNull();
    expect(
      createDeletedCanvasItemsHistoryEntry({ edges: [edgeAB], nodes: [nodeA] }),
    ).toEqual({
      type: "deleteCanvasItems",
      edges: [edgeAB],
      nodes: [nodeA],
    });
  });

  it("builds node update history entries only when snapshots change", () => {
    const before = canvasNode({ id: "a" });
    const after = canvasNode({ data: { plainText: "updated" }, id: "a" });
    const snapshots = new Map([[before.id, before]]);

    expect(createNodeUpdateHistoryEntry(snapshots, [before])).toBeNull();
    expect(createNodeUpdateHistoryEntry(snapshots, [after])).toEqual({
      type: "updateNodes",
      updates: [{ id: "a", before, after }],
    });
  });

  it("builds mutate history entries while dropping unchanged updates", () => {
    const before = canvasNode({ id: "a" });
    const after = canvasNode({ data: { plainText: "updated" }, id: "a" });
    const created = canvasNode({ id: "created" });

    expect(createMutateCanvasItemsHistoryEntry({})).toBeNull();
    expect(
      createMutateCanvasItemsHistoryEntry({
        createdNodes: [created],
        nodeUpdates: [
          { id: "a", before, after },
          { id: "same", before: created, after: created },
        ],
      }),
    ).toEqual({
      type: "mutateCanvasItems",
      createdEdges: [],
      createdNodes: [created],
      deletedEdges: [],
      deletedNodes: [],
      edgeUpdates: [],
      nodeUpdates: [{ id: "a", before, after }],
    });
  });

  it("rounds viewport values in the persistable signature", () => {
    const node = canvasNode({ id: "a", position: { x: 1, y: 2 } });
    const signature = JSON.parse(
      getCanvasPersistableSignature([node], [], {
        x: 1.234,
        y: 2.345,
        zoom: 0.98765,
      }),
    );

    expect(signature.viewport).toEqual({
      x: 1.23,
      y: 2.35,
      zoom: 0.9877,
    });
  });

  it("collects upstream context for text generation nodes with depth labels", () => {
    const source = canvasNode({
      data: {
        kind: "code",
        codeLanguage: "typescript",
        richTextHtml: "<p>const value = 1 &amp;&amp; 2</p>",
        title: "片段",
      },
      id: "source",
      type: "code",
    });
    const middle = canvasNode({
      data: { kind: "text", plainText: "总结这段代码", title: "说明" },
      id: "middle",
    });
    const generator = canvasNode({
      data: { kind: "textGeneration", title: "生成" },
      id: "generator",
      type: "textGeneration",
    });

    expect(
      collectTextGenerationContext({
        edges: [edge("source", "middle"), edge("middle", "generator")],
        nodeId: "generator",
        nodes: [source, middle, generator],
      }),
    ).toContain("上游上下文 L2\n代码节点「片段」\n语言：typescript\nconst value = 1 && 2");
  });

  it("normalizes text generation context handles into readable edge direction", () => {
    const source = canvasNode({ id: "source" });
    const generator = canvasNode({
      data: { kind: "textGeneration", title: "生成" },
      id: "generator",
      type: "textGeneration",
    });
    const connection: Connection = {
      source: "generator",
      sourceHandle: NODE_CONTEXT_HANDLE_ID,
      target: "source",
      targetHandle: null,
    };

    expect(normalizeCanvasConnection(connection, [source, generator])).toEqual({
      ...connection,
      source: "source",
      sourceHandle: NODE_RIGHT_HANDLE_ID,
      target: "generator",
      targetHandle: null,
    });
  });

  it("normalizes text node context handles into readable edge direction", () => {
    const source = canvasNode({
      data: { kind: "note", title: "笔记", comment: "上游内容" },
      id: "source",
      type: "note",
    });
    const text = canvasNode({
      data: { kind: "text", plainText: "继续生成", title: "文本" },
      id: "text",
      type: "text",
    });
    const connection: Connection = {
      source: "text",
      sourceHandle: NODE_CONTEXT_HANDLE_ID,
      target: "source",
      targetHandle: null,
    };

    expect(normalizeCanvasConnection(connection, [source, text])).toEqual({
      ...connection,
      source: "source",
      sourceHandle: NODE_RIGHT_HANDLE_ID,
      target: "text",
      targetHandle: null,
    });
  });

  it("rejects self connections and normalizes action handles", () => {
    const source = canvasNode({ id: "source" });
    const target = canvasNode({ id: "target" });

    expect(
      normalizeCanvasConnection(
        { source: "source", target: "source" },
        [source],
      ),
    ).toBeNull();
    expect(
      normalizeCanvasConnection(
        {
          source: "source",
          sourceHandle: NODE_ACTION_HANDLE_ID,
          target: "target",
          targetHandle: null,
        },
        [source, target],
      ),
    ).toMatchObject({ sourceHandle: NODE_RIGHT_HANDLE_ID });
  });

  it("creates node action menus only for unfinished non-context connections", () => {
    expect(
      createNodeActionMenuFromConnectEnd({
        didConnectToNode: false,
        flowPosition: { x: 10, y: 20 },
        point: { x: 100, y: 200 },
        sourceHandleId: NODE_ACTION_HANDLE_ID,
        sourceNodeId: "source",
      }),
    ).toEqual({
      flowPosition: { x: 10, y: 20 },
      nodeId: "source",
      x: 100,
      y: 200,
    });

    expect(
      createNodeActionMenuFromConnectEnd({
        didConnectToNode: true,
        flowPosition: { x: 10, y: 20 },
        point: { x: 100, y: 200 },
        sourceHandleId: NODE_ACTION_HANDLE_ID,
        sourceNodeId: "source",
      }),
    ).toBeNull();
    expect(
      createNodeActionMenuFromConnectEnd({
        didConnectToNode: false,
        flowPosition: { x: 10, y: 20 },
        point: { x: 100, y: 200 },
        sourceHandleId: NODE_CONTEXT_HANDLE_ID,
        sourceNodeId: "source",
      }),
    ).toBeNull();
    expect(
      createNodeActionMenuFromConnectEnd({
        didConnectToNode: false,
        flowPosition: { x: 10, y: 20 },
        point: { x: 100, y: 200 },
        sourceHandleId: NODE_ACTION_HANDLE_ID,
        sourceNodeId: null,
      }),
    ).toBeNull();
  });
});
