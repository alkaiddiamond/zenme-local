import { describe, expect, it } from "vitest";

import { mergeFinalResizeNodes } from "./geometry";
import type { CanvasNode } from "./types";

function node(id: string, kind: "managedText" | "reader" = "managedText") {
  return {
    data: { kind, title: id },
    id,
    position: { x: 10, y: 20 },
    style: { height: 260, width: 360 },
    type: kind,
  } as CanvasNode;
}

describe("mergeFinalResizeNodes", () => {
  it("commits only resized nodes from the transient React Flow store", () => {
    const first = node("first");
    const second = node("second");
    const finalFirst = {
      ...first,
      measured: { height: 420, width: 680 },
      position: { x: 40, y: 60 },
    };

    const result = mergeFinalResizeNodes(
      [first, second],
      [finalFirst, second],
      ["first"],
    );

    expect(result[0]).toMatchObject({
      height: 420,
      measured: { height: 420, width: 680 },
      position: { x: 40, y: 60 },
      style: { height: 420, width: 680 },
      width: 680,
    });
    expect(result[1]).toBe(second);
  });

  it("keeps the expanded reader size compatible with persisted reader data", () => {
    const reader = node("reader", "reader");
    const result = mergeFinalResizeNodes(
      [reader],
      [{ ...reader, measured: { height: 700, width: 980 } }],
      [reader.id],
    );

    expect(result[0].data.readerExpandedSize).toEqual({
      height: 700,
      width: 980,
    });
  });
});
