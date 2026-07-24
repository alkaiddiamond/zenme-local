import { describe, expect, it } from "vitest";

import { shouldPreventNativeCanvasAuxClick } from "./pointer";

describe("canvas pointer behavior", () => {
  it("prevents native middle-click autoscroll without blocking other buttons", () => {
    expect(shouldPreventNativeCanvasAuxClick({ button: 1 })).toBe(true);
    expect(shouldPreventNativeCanvasAuxClick({ button: 0 })).toBe(false);
    expect(shouldPreventNativeCanvasAuxClick({ button: 2 })).toBe(false);
  });
});
