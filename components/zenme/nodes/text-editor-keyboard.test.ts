import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  insertTabSpaces,
  TEXT_EDITOR_TAB_SPACES,
} from "./text-editor-keyboard";

const textNodeSource = readFileSync(
  new URL("./text-node.tsx", import.meta.url),
  "utf8",
);

describe("text editor keyboard", () => {
  it("inserts four spaces at the caret", () => {
    expect(TEXT_EDITOR_TAB_SPACES).toBe("    ");
    expect(insertTabSpaces("前后", 1, 1)).toEqual({
      cursor: 5,
      value: "前    后",
    });
  });

  it("replaces a selected range and places the caret after the spaces", () => {
    expect(insertTabSpaces("abcdef", 2, 5)).toEqual({
      cursor: 6,
      value: "ab    f",
    });
  });

  it("prevents focus navigation in rich text, Markdown, and code editors", () => {
    expect(textNodeSource).toContain("event.preventDefault()");
    expect(textNodeSource).toContain("document.execCommand(\"insertText\", false, TEXT_EDITOR_TAB_SPACES)");
    expect(textNodeSource).toContain("onKeyDown={handleRichTextKeyDown}");
    expect(textNodeSource.match(/onKeyDown=\{handleTextareaKeyDown\}/g)).toHaveLength(2);
  });
});
