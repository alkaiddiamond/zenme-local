import { describe, expect, it } from "vitest";

import { getReadingNoteEditorMaxHeight } from "./auto-size-textarea";

describe("reading note editor height", () => {
  it("allows note content to use most of the visible sidebar height", () => {
    expect(getReadingNoteEditorMaxHeight(800)).toBe(440);
  });

  it("keeps a usable cap in a short viewport", () => {
    expect(getReadingNoteEditorMaxHeight(200)).toBe(160);
  });
});
