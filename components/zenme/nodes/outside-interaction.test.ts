import { describe, expect, it } from "vitest";

import {
  createOutsidePointerHandler,
  isEventInsideTarget,
} from "./outside-interaction";

describe("outside interaction", () => {
  it("recognizes events whose composed path contains the target", () => {
    const target = new EventTarget();

    expect(isEventInsideTarget({ composedPath: () => [target] }, target)).toBe(true);
    expect(isEventInsideTarget({ composedPath: () => [] }, target)).toBe(false);
    expect(isEventInsideTarget({ composedPath: () => [target] }, null)).toBe(false);
  });

  it("calls the outside callback only for pointer events outside the target", () => {
    const target = new EventTarget();
    let outsideCalls = 0;
    const handler = createOutsidePointerHandler(
      () => target,
      () => {
        outsideCalls += 1;
      },
    );

    handler({ composedPath: () => [target] } as PointerEvent);
    handler({ composedPath: () => [] } as PointerEvent);

    expect(outsideCalls).toBe(1);
  });
});
