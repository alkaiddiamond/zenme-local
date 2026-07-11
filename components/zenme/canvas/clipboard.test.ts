import { describe, expect, it } from "vitest";

import {
  createCanvasNodeClipboardPayload,
  createPastedCanvasNodes,
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
      node({ id: "child", parentId: "group", position: { x: 20, y: 30 } }),
    ]);
    let id = 0;
    const pasted = createPastedCanvasNodes({
      anchor: { x: 80, y: 90 },
      createId: () => `new-${++id}`,
      payload: payload!,
    });
    expect(pasted[1].parentId).toBe(pasted[0].id);
    expect(pasted[1].position).toEqual({ x: 20, y: 30 });
  });

  it("rejects malformed clipboard payloads", () => {
    expect(parseCanvasNodeClipboardPayload("not-json")).toBeNull();
    expect(parseCanvasNodeClipboardPayload('{"version":2,"nodes":[]}')).toBeNull();
  });
});
