import { describe, expect, it } from "vitest";

import { parseMarkdownBlocks } from "./markdown";

describe("parseMarkdownBlocks", () => {
  it("parses headings, quotes, list items and paragraphs", () => {
    expect(parseMarkdownBlocks("# 标题\n> 引用\n- 条目\n正文")).toEqual([
      { content: "标题", key: "heading-0", type: "h1" },
      { content: "引用", key: "quote-1", type: "quote" },
      { content: "条目", key: "list-2", type: "list" },
      { content: "正文", key: "p-3", type: "p" },
    ]);
  });

  it("keeps fenced code blocks together", () => {
    expect(parseMarkdownBlocks("```ts\nconst a = 1\n```\n\nnext")).toEqual([
      { content: "const a = 1", key: "code-0", type: "code" },
      { content: "", key: "p-3", type: "blank" },
      { content: "next", key: "p-4", type: "p" },
    ]);
  });

  it("flushes an unclosed fenced code block", () => {
    expect(parseMarkdownBlocks("before\n```\nopen")).toEqual([
      { content: "before", key: "p-0", type: "p" },
      { content: "open", key: "code-0", type: "code" },
    ]);
  });

  it("parses GFM pipe tables and column alignments", () => {
    expect(parseMarkdownBlocks(
      "| 项目 | 输出 | 备注 |\n|:---|:---:|---:|\n| Essentia | JSON | **推荐** |\n| Demucs | 音轨 | 分离 |",
    )).toEqual([
      {
        alignments: ["left", "center", "right"],
        content: "",
        headers: ["项目", "输出", "备注"],
        key: "table-0",
        rows: [
          ["Essentia", "JSON", "**推荐**"],
          ["Demucs", "音轨", "分离"],
        ],
        type: "table",
      },
    ]);
  });

  it("does not treat an isolated pipe row as a table", () => {
    expect(parseMarkdownBlocks("| 只是 | 普通文本 |")[0]).toMatchObject({
      type: "p",
    });
  });
});
