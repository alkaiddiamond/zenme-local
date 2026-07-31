import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { shouldPreventNativeCanvasAuxClick } from "./pointer";

const canvasClientSource = readFileSync(
  new URL("../canvas-client.tsx", import.meta.url),
  "utf8",
);

describe("canvas pointer behavior", () => {
  it("prevents native middle-click autoscroll without blocking other buttons", () => {
    expect(shouldPreventNativeCanvasAuxClick({ button: 1 })).toBe(true);
    expect(shouldPreventNativeCanvasAuxClick({ button: 0 })).toBe(false);
    expect(shouldPreventNativeCanvasAuxClick({ button: 2 })).toBe(false);
  });

  it("prevents autoscroll on mouse down before the browser activates it", () => {
    expect(canvasClientSource).toContain("onMouseDownCapture={(event) => {");
    expect(canvasClientSource).toContain(
      "shouldPreventNativeCanvasAuxClick(event.nativeEvent)",
    );
  });
});
