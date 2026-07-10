import { describe, expect, it } from "vitest";

import { createCanvasAddMenuFromPaneDoubleClick } from "./pane-menu";

const baseInput = {
  flowPosition: { x: 10, y: 20 },
  isEditableTarget: false,
  isInteractiveCanvasTarget: false,
  isPaneTarget: true,
  point: { x: 100, y: 200 },
};

describe("canvas pane menu helpers", () => {
  it("creates an add menu from plain pane double clicks", () => {
    expect(createCanvasAddMenuFromPaneDoubleClick(baseInput)).toEqual({
      flowPosition: { x: 10, y: 20 },
      x: 100,
      y: 200,
    });
  });

  it("ignores double clicks from editable, non-pane or interactive canvas targets", () => {
    expect(
      createCanvasAddMenuFromPaneDoubleClick({
        ...baseInput,
        isEditableTarget: true,
      }),
    ).toBeNull();
    expect(
      createCanvasAddMenuFromPaneDoubleClick({
        ...baseInput,
        isPaneTarget: false,
      }),
    ).toBeNull();
    expect(
      createCanvasAddMenuFromPaneDoubleClick({
        ...baseInput,
        isInteractiveCanvasTarget: true,
      }),
    ).toBeNull();
  });
});
