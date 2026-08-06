import { describe, expect, it, vi } from "vitest";

import type { ReadingNote } from "@/lib/reading/types";

import {
  getReadingSectionIndexNearViewportTop,
  getReadingTextSample,
  indexReadingNotesBySection,
} from "./utils";

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

describe("reading note section index", () => {
  it("indexes a cross-page note only into the pages it touches", () => {
    const note = {
      id: "note",
      ranges: [
        { sectionIndex: 4, offset: 10, length: 3 },
        { sectionIndex: 5, offset: 0, length: 8 },
      ],
      sectionIndex: 4,
    } as ReadingNote;

    const result = indexReadingNotesBySection([note]);

    expect(result.get(4)).toEqual([note]);
    expect(result.get(5)).toEqual([note]);
    expect(result.has(3)).toBe(false);
  });
});

describe("reading text sampling", () => {
  it("stops reading sections after collecting the language sample", () => {
    const sections = [
      { index: 0, title: "一", html: "", text: "中文".repeat(4_000) },
      {
        index: 1,
        title: "二",
        html: "",
        get text(): string {
          throw new Error("the rest of a long book must not be scanned");
        },
      },
    ];

    expect(getReadingTextSample(sections)).toHaveLength(8_000);
  });
});
