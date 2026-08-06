import { describe, expect, it } from "vitest";

import type { ReadingNote, ReadingSection } from "./types";
import { remapReadingNotesToSections } from "./remap-notes";

describe("reading note pagination remap", () => {
  it("keeps a highlight anchored when a paragraph moves across pages", () => {
    const previousSections: ReadingSection[] = [
      { index: 0, title: "第八章", html: "", text: "前文" },
      { index: 1, title: "第八章 · 2", html: "", text: "目标批注内容 后文" },
    ];
    const nextSections: ReadingSection[] = [
      { index: 0, title: "第八章", html: "", text: "前文 目标批注" },
      {
        index: 1,
        title: "第八章 · 2",
        html: '<p class="reading-paragraph-continuation">内容 后文</p>',
        text: "内容 后文",
      },
    ];
    const note = {
      id: "note-1",
      type: "highlight",
      selectedText: "目标批注内容",
      sectionIndex: 1,
      offset: 0,
      length: 6,
      ranges: null,
      chapterTitle: "第八章 · 2",
    } as ReadingNote;

    const [remapped] = remapReadingNotesToSections(
      [note],
      previousSections,
      nextSections,
    );

    expect(remapped.sectionIndex).toBe(0);
    expect(remapped.ranges).toEqual([
      { sectionIndex: 0, offset: 3, length: 4 },
      { sectionIndex: 1, offset: 0, length: 2 },
    ]);
  });

  it("leaves notes unchanged when their selected text cannot be found", () => {
    const section = { index: 0, title: "正文", html: "", text: "正文" };
    const note = {
      id: "note-1",
      type: "highlight",
      selectedText: "不存在",
      sectionIndex: 0,
    } as ReadingNote;

    expect(remapReadingNotesToSections([note], [section], [section])).toEqual([
      note,
    ]);
  });
});
