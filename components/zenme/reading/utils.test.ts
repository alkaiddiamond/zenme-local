import { describe, expect, it, vi } from "vitest";

import { getReadingSectionIndexNearViewportTop } from "./utils";

describe("reading viewport helpers", () => {
  it("finds the current section with viewport hit testing", () => {
    const section = {
      dataset: { readingSectionIndex: "12" },
    } as unknown as HTMLElement;
    const closest = vi.fn().mockReturnValue(section);
    const elementFromPoint = vi.fn().mockReturnValue({ closest });
    const container = {
      clientHeight: 600,
      contains: (value: unknown) => value === section,
      getBoundingClientRect: () => ({
        height: 600,
        left: 100,
        top: 50,
        width: 800,
      }),
      ownerDocument: { elementFromPoint },
    } as unknown as HTMLElement;

    expect(getReadingSectionIndexNearViewportTop(container, 3)).toBe(12);
    expect(elementFromPoint).toHaveBeenCalledTimes(1);
    expect(closest).toHaveBeenCalledWith("[data-reading-section-index]");
  });

  it("keeps the current section when the viewport point hits no section", () => {
    const container = {
      clientHeight: 600,
      contains: () => false,
      getBoundingClientRect: () => ({
        height: 600,
        left: 0,
        top: 0,
        width: 800,
      }),
      ownerDocument: { elementFromPoint: () => null },
    } as unknown as HTMLElement;

    expect(getReadingSectionIndexNearViewportTop(container, 7)).toBe(7);
  });
});
