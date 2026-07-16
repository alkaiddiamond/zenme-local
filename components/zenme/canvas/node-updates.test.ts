import { describe, expect, it } from "vitest";

import {
  createCodeNodeDataUpdate,
  createProjectTagUpdate,
  createTaskChildrenVisibilityUpdate,
  createTextGenerationNodeDataUpdate,
  createTextNodeDataUpdate,
  createTaskNodeDataUpdate,
} from "./node-updates";
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

describe("canvas node data update helpers", () => {
  it("updates text and markdown nodes while preserving history snapshots", () => {
    const text = node({
      data: { kind: "text", plainText: "old", richTextHtml: "<p>old</p>" },
      id: "text",
    });

    const update = createTextNodeDataUpdate({
      nodeId: "text",
      nodes: [text],
      updates: { plainText: "new", richTextHtml: "<p>new</p>" },
    });

    expect(update?.nextNodes[0].data).toMatchObject({
      plainText: "new",
      richTextHtml: "<p>new</p>",
    });
    expect(update?.beforeNodeSnapshots.get("text")?.data).toMatchObject({
      plainText: "old",
      richTextHtml: "<p>old</p>",
    });
  });

  it("returns null for unchanged text updates and updates legacy code nodes", () => {
    const code = node({
      data: { codeContent: "print(1)", kind: "code" },
      id: "code",
      type: "code",
    });
    const text = node({ data: { kind: "text", plainText: "same" }, id: "text" });

    expect(
      createTextNodeDataUpdate({
        nodeId: "text",
        nodes: [text],
        updates: { plainText: "same" },
      }),
    ).toBeNull();
    expect(
      createTextNodeDataUpdate({
        nodeId: "code",
        nodes: [code],
        updates: { plainText: "new" },
      })?.nextNodes[0].data,
    ).toMatchObject({
      codeContent: "print(1)",
      kind: "code",
      plainText: "new",
    });
  });

  it("updates managed text names and tags", () => {
    const managedText = node({
      data: {
        createdAt: "2026-07-15T02:30:00.000Z",
        kind: "managedText",
        name: "",
        tags: [],
      },
      id: "managed-text",
      type: "managedText",
    });

    expect(
      createTextNodeDataUpdate({
        nodeId: "managed-text",
        nodes: [managedText],
        updates: { name: "研究资料", tags: ["世界杯", "选题"] },
      })?.nextNodes[0].data,
    ).toMatchObject({
      createdAt: "2026-07-15T02:30:00.000Z",
      name: "研究资料",
      tags: ["世界杯", "选题"],
    });
  });

  it("updates project tag colors across all references", () => {
    const first = node({
      data: { kind: "managedText", tags: ["产品"] },
      id: "first",
      type: "managedText",
    });
    const second = node({
      data: { kind: "managedText", tags: ["产品", "待办"] },
      id: "second",
      type: "managedText",
    });

    const update = createProjectTagUpdate({
      action: { type: "color", tag: "产品", color: "blue" },
      nodes: [first, second],
    });

    expect(update?.nextNodes.map((item) => item.data.tagColors)).toEqual([
      { 产品: "blue" },
      { 产品: "blue" },
    ]);
    expect(update?.beforeNodeSnapshots.size).toBe(2);
  });

  it("shares project tag changes between managed text and task nodes", () => {
    const managed = node({
      data: { kind: "managedText", tags: ["项目"] },
      id: "managed",
      type: "managedText",
    });
    const task = node({
      data: { kind: "task", tags: ["项目"], taskStatus: "inProgress" },
      id: "task",
      type: "task",
    });

    const update = createProjectTagUpdate({
      action: { type: "color", tag: "项目", color: "green" },
      nodes: [managed, task],
    });

    expect(update?.nextNodes.map((item) => item.data.tagColors)).toEqual([
      { 项目: "green" },
      { 项目: "green" },
    ]);
  });

  it("updates task metadata and manages completion timestamps", () => {
    const task = node({
      data: {
        createdAt: "2026-07-16T01:00:00.000Z",
        kind: "task",
        name: "整理需求",
        taskStatus: "inProgress",
        updatedAt: "2026-07-16T01:00:00.000Z",
      },
      id: "task",
      type: "task",
    });

    const completed = createTaskNodeDataUpdate({
      nodeId: "task",
      nodes: [task],
      now: "2026-07-16T02:00:00.000Z",
      updates: { taskPriority: "P1", taskStatus: "completed" },
    });
    expect(completed?.nextNodes[0].data).toMatchObject({
      completedAt: "2026-07-16T02:00:00.000Z",
      taskPriority: "P1",
      taskStatus: "completed",
      updatedAt: "2026-07-16T02:00:00.000Z",
    });

    const reopened = createTaskNodeDataUpdate({
      nodeId: "task",
      nodes: completed?.nextNodes ?? [],
      now: "2026-07-16T03:00:00.000Z",
      updates: { taskStatus: "inProgress" },
    });
    expect(reopened?.nextNodes[0].data.completedAt).toBeUndefined();
    expect(reopened?.nextNodes[0].data.updatedAt).toBe(
      "2026-07-16T03:00:00.000Z",
    );
  });

  it("synchronizes every React Flow size field when task children collapse", () => {
    const task: CanvasNode = {
      ...node({
        data: {
          kind: "task",
          taskChildrenExpanded: true,
          taskStatus: "inProgress",
        },
        id: "task",
        type: "task",
      }),
      height: 720,
      measured: { height: 720, width: 640 },
      style: { height: 720, width: 640 },
      width: 640,
    };

    const collapsed = createTaskChildrenVisibilityUpdate({
      collapsedHeight: 236,
      expanded: false,
      nodeId: "task",
      nodes: [task],
    });
    expect(collapsed?.nextNodes[0]).toMatchObject({
      height: 236,
      measured: { height: 236, width: 640 },
      style: { height: 236, width: 640 },
      width: 640,
      data: {
        taskChildrenExpanded: false,
        taskExpandedHeight: 720,
      },
    });

    const expanded = createTaskChildrenVisibilityUpdate({
      collapsedHeight: 236,
      expanded: true,
      nodeId: "task",
      nodes: collapsed?.nextNodes ?? [],
    });
    expect(expanded?.nextNodes[0]).toMatchObject({
      height: 720,
      measured: { height: 720, width: 640 },
      style: { height: 720, width: 640 },
      width: 640,
      data: {
        taskChildrenExpanded: true,
        taskExpandedHeight: 720,
      },
    });
  });

  it("deletes a project tag and its color from all references", () => {
    const first = node({
      data: {
        kind: "managedText",
        tagColors: { 产品: "green" },
        tags: ["产品"],
      },
      id: "first",
      type: "managedText",
    });
    const second = node({
      data: {
        kind: "managedText",
        tagColors: { 产品: "green" },
        tags: ["产品", "待办"],
      },
      id: "second",
      type: "managedText",
    });

    const update = createProjectTagUpdate({
      action: { type: "delete", tag: "产品" },
      nodes: [first, second],
    });

    expect(update?.nextNodes.map((item) => item.data.tags)).toEqual([[], ["待办"]]);
    expect(update?.nextNodes.map((item) => item.data.tagColors)).toEqual([{}, {}]);
  });

  it("updates code nodes", () => {
    const code = node({
      data: { codeContent: "print(1)", codeLanguage: "python", kind: "code" },
      id: "code",
      type: "code",
    });

    expect(
      createCodeNodeDataUpdate({
        nodeId: "code",
        nodes: [code],
        updates: { codeContent: "console.log(1)", codeLanguage: "javascript" },
      })?.nextNodes[0].data,
    ).toMatchObject({
      codeContent: "console.log(1)",
      codeLanguage: "javascript",
    });
  });

  it("updates text generation nodes", () => {
    const textGeneration = node({
      data: {
        kind: "textGeneration",
        textGenerationModel: "glm-4.5",
        textGenerationPrompt: "old",
      },
      id: "generator",
      type: "textGeneration",
    });

    expect(
      createTextGenerationNodeDataUpdate({
        nodeId: "generator",
        nodes: [textGeneration],
        updates: { textGenerationPrompt: "new" },
      })?.nextNodes[0].data,
    ).toMatchObject({
      textGenerationModel: "glm-4.5",
      textGenerationPrompt: "new",
    });
  });

  it("updates text generation composer state on merged text-like nodes", () => {
    const text = node({
      data: {
        kind: "text",
        plainText: "正文",
        textGenerationModel: "glm-4.5",
        textGenerationPrompt: "old prompt",
      },
      id: "text",
      type: "text",
    });
    const note = node({
      data: {
        comment: "笔记",
        kind: "note",
        textGenerationModel: "glm-4.5",
      },
      id: "note",
      type: "note",
    });

    expect(
      createTextGenerationNodeDataUpdate({
        nodeId: "text",
        nodes: [text],
        updates: {
          textGenerationModel: "glm-5.2",
          textGenerationPrompt: "next prompt",
        },
      })?.nextNodes[0].data,
    ).toMatchObject({
      plainText: "正文",
      textGenerationModel: "glm-5.2",
      textGenerationPrompt: "next prompt",
    });

    expect(
      createTextGenerationNodeDataUpdate({
        nodeId: "note",
        nodes: [note],
        updates: {
          textGenerationModel: "glm-5.2",
          textGenerationPrompt: "基于笔记继续",
        },
      })?.nextNodes[0].data,
    ).toMatchObject({
      comment: "笔记",
      textGenerationModel: "glm-5.2",
      textGenerationPrompt: "基于笔记继续",
    });
  });
});
