import { describe, expect, it } from "vitest";

import {
  createCanvasNodeClipboardPayload,
  createPastedCanvasNodes,
  getClipboardImageFiles,
  hasSelectedClipboardText,
  parseCanvasNodeClipboardPayload,
} from "./clipboard";
import type { CanvasNode } from "./types";

function node(input: Partial<CanvasNode> & Pick<CanvasNode, "id">): CanvasNode {
  return {
    data: { kind: "text", title: "文本" },
    position: { x: 0, y: 0 },
    type: "text",
    ...input,
  };
}

describe("canvas clipboard", () => {
  it("leaves copy events to the browser when text is selected", () => {
    expect(
      hasSelectedClipboardText({
        isCollapsed: false,
        toString: () => "selected prompt",
      }),
    ).toBe(true);
    expect(
      hasSelectedClipboardText({
        isCollapsed: true,
        toString: () => "",
      }),
    ).toBe(false);
    expect(hasSelectedClipboardText(null)).toBe(false);
  });

  it("copies selected nodes and pastes them without edges", () => {
    const payload = createCanvasNodeClipboardPayload([
      node({ id: "a", position: { x: 100, y: 200 }, selected: true }),
      node({ id: "b", position: { x: 300, y: 240 }, selected: true }),
      node({ id: "ignored" }),
    ]);
    expect(payload?.nodes).toHaveLength(2);

    let id = 0;
    const pasted = createPastedCanvasNodes({
      anchor: { x: 500, y: 600 },
      createId: () => `copy-${++id}`,
      payload: payload!,
    });
    expect(pasted.map((item) => item.id)).toEqual(["copy-1", "copy-2"]);
    expect(pasted.map((item) => item.position)).toEqual([
      { x: 500, y: 600 },
      { x: 700, y: 640 },
    ]);
    expect(pasted.every((item) => item.selected === false)).toBe(true);
  });

  it("preserves copied group relationships but creates new ids", () => {
    const payload = createCanvasNodeClipboardPayload([
      node({ id: "group", selected: true, data: { kind: "group", title: "组" } }),
      node({
        data: { groupId: "group", kind: "text", title: "child" },
        id: "child",
        parentId: "group",
        position: { x: 20, y: 30 },
      }),
    ]);
    let id = 0;
    const pasted = createPastedCanvasNodes({
      anchor: { x: 80, y: 90 },
      createId: () => `new-${++id}`,
      payload: payload!,
    });
    expect(pasted[1].parentId).toBe(pasted[0].id);
    expect(pasted[1].data.groupId).toBe(pasted[0].id);
    expect(pasted[1].position).toEqual({ x: 20, y: 30 });
  });

  it("remaps copied task parent ids and clears parents outside the copied set", () => {
    const parent = node({
      data: { kind: "task", name: "父任务", title: "任务" },
      id: "task-parent",
      selected: true,
      type: "task",
    });
    const child = node({
      data: {
        kind: "task",
        name: "子任务",
        taskParentId: "task-parent",
        title: "任务",
      },
      id: "task-child",
      selected: true,
      type: "task",
    });
    let id = 0;
    const payload = createCanvasNodeClipboardPayload([parent, child]);
    const pasted = createPastedCanvasNodes({
      anchor: { x: 0, y: 0 },
      createId: () => `copy-${++id}`,
      payload: payload!,
    });

    expect(pasted[1].data.taskParentId).toBe(pasted[0].id);

    const childOnlyPayload = createCanvasNodeClipboardPayload([
      { ...child, selected: true },
    ]);
    expect(childOnlyPayload?.nodes[0].data.taskParentId).toBeUndefined();
  });

  it("rejects malformed clipboard payloads", () => {
    expect(parseCanvasNodeClipboardPayload("not-json")).toBeNull();
    expect(parseCanvasNodeClipboardPayload('{"version":2,"nodes":[]}')).toBeNull();
  });

  it("reads image files from clipboard items and files without duplicates", () => {
    const image = new File(["image"], "photo.png", { type: "image/png" });
    const files = getClipboardImageFiles({
      files: [image] as unknown as FileList,
      items: [
        {
          getAsFile: () => image,
          kind: "file",
          type: "image/png",
        },
      ] as unknown as DataTransferItemList,
    });

    expect(files).toEqual([image]);
  });

  it("normalizes clipboard images that omit their MIME type and filename", () => {
    const image = new File(["image"], "", { type: "" });
    const files = getClipboardImageFiles({
      files: [] as unknown as FileList,
      items: [
        {
          getAsFile: () => image,
          kind: "file",
          type: "",
        },
      ] as unknown as DataTransferItemList,
    });

    expect(files).toHaveLength(1);
    expect(files[0].type).toBe("image/png");
    expect(files[0].name).toMatch(/^clipboard-\d+-1\.png$/);
  });

  it("ignores non-image clipboard files", () => {
    const document = new File(["text"], "notes.txt", { type: "text/plain" });
    expect(getClipboardImageFiles({
      files: [document] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
    })).toEqual([]);
  });
});
