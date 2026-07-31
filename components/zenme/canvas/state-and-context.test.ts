import type { Connection, Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  NODE_ACTION_HANDLE_ID,
  NODE_CONTEXT_HANDLE_ID,
  NODE_CONTEXT_TARGET_HANDLE_ID,
  NODE_RIGHT_HANDLE_ID,
} from "@/components/zenme/node-types";

import {
  createNodeActionMenuFromConnectEnd,
  isCanvasConnectionValid,
  normalizeCanvasConnection,
  normalizePersistedCanvasEdges,
} from "./connections";
import {
  createCanvasItemsHistoryEntry,
  createDeletedCanvasItemsHistoryEntry,
  createMutateCanvasItemsHistoryEntry,
  createNodeUpdateHistoryEntry,
  getCanvasHistoryState,
  getCanvasPersistableSignature,
  preserveCanvasHistoryTransientData,
} from "./history-state";
import {
  collectTextGenerationContext,
  isTextGenerationContextNode,
} from "./text-generation-context";
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

  it("preserves live music playback data when restoring canvas history", () => {
    const historicalPlayer = canvasNode({
      data: {
        kind: "musicPlayer",
        musicLoopMode: "off",
        musicSourceNodeId: "music-1",
        musicVolume: 1,
        title: "历史播放器名称",
      },
      id: "player-1",
      type: "musicPlayer",
    });
    const currentPlayer = canvasNode({
      data: {
        kind: "musicPlayer",
        musicCurrentTime: 42,
        musicIsPlaying: true,
        musicLoopMode: "all",
        musicSourceNodeId: "music-2",
        musicVolume: 0.4,
        title: "当前播放器名称",
      },
      id: "player-1",
      type: "musicPlayer",
    });

    const [restored] = preserveCanvasHistoryTransientData(
      [historicalPlayer],
      [currentPlayer],
    );

    expect(restored.data).toMatchObject({
      musicCurrentTime: 42,
      musicIsPlaying: true,
      musicLoopMode: "all",
      musicSourceNodeId: "music-2",
      musicVolume: 0.4,
      title: "历史播放器名称",
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

  it("only lets forward context connections snap to dedicated context targets", () => {
    expect(
      isCanvasConnectionValid({
        source: "text-a",
        sourceHandle: NODE_CONTEXT_HANDLE_ID,
        target: "text-b",
        targetHandle: NODE_CONTEXT_TARGET_HANDLE_ID,
      }),
    ).toBe(true);
    expect(
      isCanvasConnectionValid({
        source: "text-a",
        sourceHandle: NODE_CONTEXT_HANDLE_ID,
        target: "text-b",
        targetHandle: null,
      }),
    ).toBe(false);
    expect(
      isCanvasConnectionValid({
        source: "text-a",
        sourceHandle: NODE_RIGHT_HANDLE_ID,
        target: "text-b",
        targetHandle: NODE_CONTEXT_TARGET_HANDLE_ID,
      }),
    ).toBe(false);
  });

  it("includes managed text names and tags in generation context", () => {
    const managedText = canvasNode({
      data: {
        kind: "managedText",
        name: "世界杯选题",
        plainText: "整理可能的冷门故事",
        tags: ["体育", "采访"],
        title: "强管理节点",
      },
      id: "managed-text",
      type: "managedText",
    });
    const generator = canvasNode({
      data: { kind: "textGeneration", title: "生成" },
      id: "generator",
      type: "textGeneration",
    });

    expect(
      collectTextGenerationContext({
        edges: [edge("managed-text", "generator")],
        nodeId: "generator",
        nodes: [managedText, generator],
      }),
    ).toContain(
      "强管理节点「世界杯选题」\n标签：体育、采访\n整理可能的冷门故事",
    );
  });

  it("includes a connected image-generation prompt as text context", () => {
    const promptNode = canvasNode({
      data: {
        imagePrompt: "生成角色头部和全身三视图，画布比例 3:4",
        kind: "imageGeneration",
        title: "角色提示词",
      },
      id: "image-prompt",
      type: "imageGeneration",
    });
    const generator = canvasNode({
      data: { kind: "imageGeneration", title: "图片生成" },
      id: "generator",
      type: "imageGeneration",
    });

    expect(
      collectTextGenerationContext({
        edges: [edge("image-prompt", "generator")],
        nodeId: "generator",
        nodes: [promptNode, generator],
      }),
    ).toContain(
      "图片提示词节点「角色提示词」\n生成角色头部和全身三视图，画布比例 3:4",
    );
  });

  it("includes every timestamped lyric line in text generation context", () => {
    const lyrics = canvasNode({
      data: {
        kind: "lyrics",
        musicLyrics: [
          { start: 55, text: "第一句" },
          { start: 61.8, text: "第二句" },
        ],
        title: "张悬 - 毕竟 · 歌词",
      },
      id: "lyrics",
      type: "lyrics",
    });
    const text = canvasNode({
      data: { kind: "text", plainText: "分析歌词", title: "文本" },
      id: "text",
    });

    expect(
      collectTextGenerationContext({
        edges: [edge("lyrics", "text")],
        nodeId: "text",
        nodes: [lyrics, text],
      }),
    ).toContain(
      "歌词节点「张悬 - 毕竟 · 歌词」\n0:55 第一句\n1:01 第二句",
    );
  });

  it("normalizes lyrics-to-text connections as readable context edges", () => {
    const lyrics = canvasNode({
      data: { kind: "lyrics", title: "歌词" },
      id: "lyrics",
      type: "lyrics",
    });
    const text = canvasNode({
      data: { kind: "text", title: "文本" },
      id: "text",
    });
    const connection: Connection = {
      source: "lyrics",
      sourceHandle: null,
      target: "text",
      targetHandle: null,
    };

    expect(isTextGenerationContextNode(lyrics)).toBe(true);
    expect(normalizeCanvasConnection(connection, [lyrics, text])).toEqual({
      ...connection,
      sourceHandle: NODE_RIGHT_HANDLE_ID,
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

  it("keeps task connections to arbitrary node kinds as task relations", () => {
    const task = canvasNode({
      data: { kind: "task", name: "发布任务" },
      id: "task",
      type: "task",
    });
    const image = canvasNode({
      data: { kind: "image", title: "发布素材" },
      id: "image",
      type: "image",
    });
    const connection: Connection = {
      source: "task",
      sourceHandle: NODE_ACTION_HANDLE_ID,
      target: "image",
      targetHandle: null,
    };

    expect(normalizeCanvasConnection(connection, [task, image])).toEqual({
      ...connection,
      sourceHandle: NODE_RIGHT_HANDLE_ID,
    });
  });

  it("treats a task selected from a text node's forward handle as its parent", () => {
    const text = canvasNode({
      data: { kind: "text", plainText: "任务输入", title: "文本" },
      id: "text",
      type: "text",
    });
    const task = canvasNode({
      data: { kind: "task", name: "发布任务" },
      id: "task",
      type: "task",
    });
    const connection: Connection = {
      source: "text",
      sourceHandle: NODE_CONTEXT_HANDLE_ID,
      target: "task",
      targetHandle: null,
    };

    expect(normalizeCanvasConnection(connection, [text, task])).toEqual({
      source: "task",
      sourceHandle: NODE_RIGHT_HANDLE_ID,
      target: "text",
      targetHandle: null,
    });
  });

  it("uses task borders after connecting a task to its parent through the forward plus", () => {
    const childTask = canvasNode({
      data: { kind: "task", name: "子任务" },
      id: "child-task",
      type: "task",
    });
    const parentTask = canvasNode({
      data: { kind: "task", name: "父任务" },
      id: "parent-task",
      type: "task",
    });
    const connection: Connection = {
      source: "child-task",
      sourceHandle: NODE_CONTEXT_HANDLE_ID,
      target: "parent-task",
      targetHandle: NODE_CONTEXT_TARGET_HANDLE_ID,
    };

    expect(
      normalizeCanvasConnection(connection, [childTask, parentTask]),
    ).toEqual({
      source: "parent-task",
      sourceHandle: NODE_RIGHT_HANDLE_ID,
      target: "child-task",
      targetHandle: null,
    });
  });

  it("migrates persisted plus-to-plus task edges onto node borders", () => {
    const childTask = canvasNode({
      data: { kind: "task", name: "子任务" },
      id: "child-task",
      type: "task",
    });
    const parentTask = canvasNode({
      data: { kind: "task", name: "父任务" },
      id: "parent-task",
      type: "task",
    });

    expect(
      normalizePersistedCanvasEdges(
        [
          {
            id: "legacy-task-edge",
            source: "child-task",
            sourceHandle: NODE_CONTEXT_HANDLE_ID,
            target: "parent-task",
            targetHandle: NODE_CONTEXT_TARGET_HANDLE_ID,
          },
        ],
        [childTask, parentTask],
      ),
    ).toEqual([
      {
        id: "legacy-task-edge",
        source: "parent-task",
        sourceHandle: NODE_RIGHT_HANDLE_ID,
        target: "child-task",
        targetHandle: null,
      },
    ]);
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
