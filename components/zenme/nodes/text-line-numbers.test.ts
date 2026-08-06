import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  getTextLineNumbers,
  getVisibleTextOffsets,
  normalizeVisualLineRects,
} from "./text-line-numbers";

const textNodeSource = readFileSync(
  new URL("./text-node.tsx", import.meta.url),
  "utf8",
);

describe("text node line numbers", () => {
  it("numbers empty, Unix, and Windows text consistently", () => {
    expect(getTextLineNumbers("")).toBe("1");
    expect(getTextLineNumbers("第一行\n第二行\n")).toBe("1\n2\n3");
    expect(getTextLineNumbers("a\r\nb\r\nc")).toBe("1\n2\n3");
  });

  it("measures visible text while merging styled fragments on one line", () => {
    expect(getVisibleTextOffsets("  正文\n ")).toEqual({ end: 4, start: 2 });
    expect(
      normalizeVisualLineRects([
        { top: 20, bottom: 39 },
        { top: 23, bottom: 40 },
        { top: 48, bottom: 67 },
      ]),
    ).toEqual([
      { bottom: 40, top: 20 },
      { bottom: 67, top: 48 },
    ]);
  });

  it("keeps line numbers outside the editable content and synchronizes scrolling", () => {
    expect(textNodeSource).toContain("textLineNumbers: !lineNumbersVisible");
    expect(textNodeSource).toContain("syncLineNumberScroll(event.currentTarget.scrollTop)");
    expect(textNodeSource.match(/wrap="soft"/g)).toHaveLength(2);
    expect(textNodeSource).toContain("whitespace-pre-wrap break-words");
    expect(textNodeSource).toContain('<span className="invisible">');
    expect(textNodeSource).toContain("measureRenderedMarkdownReadingNumbers");
    expect(textNodeSource).toContain("height: line.bottom - line.top");
    expect(textNodeSource).toContain("number.style.height");
    expect(textNodeSource).toContain("number: lineIndex + 1");
    expect(textNodeSource).toContain('"[data-markdown-block]"');
  });
});
