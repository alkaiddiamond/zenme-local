import { describe, expect, it } from "vitest";

import { tokenizeCodeLine } from "./code-highlight";

describe("tokenizeCodeLine", () => {
  it("classifies keywords, numbers, strings and line comments", () => {
    expect(tokenizeCodeLine('const answer = 42 // ok', "typescript")).toEqual([
      { kind: "keyword", text: "const" },
      { kind: "plain", text: " " },
      { kind: "plain", text: "answer" },
      { kind: "plain", text: " = " },
      { kind: "number", text: "42" },
      { kind: "plain", text: " " },
      { kind: "comment", text: "// ok" },
    ]);

    expect(tokenizeCodeLine('return "zenme"', "typescript")).toEqual([
      { kind: "keyword", text: "return" },
      { kind: "plain", text: " " },
      { kind: "string", text: '"zenme"' },
    ]);
  });

  it("uses language-specific comment markers", () => {
    expect(tokenizeCodeLine("print(value) # note", "python").at(-1)).toEqual({
      kind: "comment",
      text: "# note",
    });
    expect(tokenizeCodeLine("select 1 -- note", "sql").at(-1)).toEqual({
      kind: "comment",
      text: "-- note",
    });
  });

  it("keeps empty lines visually selectable", () => {
    expect(tokenizeCodeLine("", "text")).toEqual([{ kind: "plain", text: " " }]);
  });
});
