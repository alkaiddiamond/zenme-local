import { describe, expect, it } from "vitest";

import { getUpwardExpansionScrollDelta } from "./note-card-layout";

describe("reading note card expansion", () => {
  it("keeps the card bottom anchored when there is room above", () => {
    expect(getUpwardExpansionScrollDelta({
      afterBottom: 520,
      beforeBottom: 400,
      beforeTop: 220,
      containerTop: 80,
    })).toBe(120);
  });

  it("limits upward expansion so the card header stays visible", () => {
    expect(getUpwardExpansionScrollDelta({
      afterBottom: 520,
      beforeBottom: 400,
      beforeTop: 110,
      containerTop: 80,
    })).toBe(30);
  });
});
