import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { parseMarkdownBlocks, renderMarkdown } from "./markdown";

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

  it("parses bracketed and dollar-delimited block formulas", () => {
    expect(parseMarkdownBlocks(
      "之前\n\\[\nA=\\begin{bmatrix}\n1&2\\\\\n3&4\n\\end{bmatrix}\n\\]\n$$x^2$$",
    )).toEqual([
      { content: "之前", key: "p-0", type: "p" },
      {
        content: "A=\\begin{bmatrix}\n1&2\\\\\n3&4\n\\end{bmatrix}",
        key: "math-1",
        type: "math",
      },
      { content: "x^2", key: "math-7", type: "math" },
    ]);
  });

  it("renders block matrices and inline formulas with KaTeX", () => {
    const html = renderToStaticMarkup(renderMarkdown(
      "\\[A=\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}\\]\n行内公式 \\(x^2+y^2\\) 和 $E=mc^2$",
    ));

    expect(html).toContain("katex-display");
    expect(html).toContain("mtable");
    expect(html.match(/class=\"katex\"/g)).toHaveLength(3);
  });

  it("keeps rendered tables within the node and wraps long cell content", () => {
    const html = renderToStaticMarkup(
      renderMarkdown("| 名词 | 文稿对应实例 |\n|---|---|\n| 示例 | 一段很长的单元格内容 |"),
    );

    expect(html).toContain("w-full table-fixed");
    expect(html).not.toContain("min-w-max");
    expect(html.match(/\[overflow-wrap:anywhere\]/g)).toHaveLength(4);
  });
});
