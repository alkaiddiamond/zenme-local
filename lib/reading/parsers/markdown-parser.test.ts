import { describe, expect, it } from "vitest";

import { parseMarkdownSections } from "./markdown-parser";

describe("parseMarkdownSections", () => {
  it("renders Markdown structure and splits navigation chapters by headings", () => {
    const sections = parseMarkdownSections(String.raw`# 第一章

这是 **重点** 和 [链接](https://example.com)。

- 条目一
- 条目二

## 第二章

| 名称 | 数值 |
| --- | --- |
| A | 1 |

\[x^2+y^2=z^2\]`);

    expect(sections[0]).toMatchObject({ index: 0, title: "第一章" });
    expect(sections.at(-1)?.title).toMatch(/^第二章/);
    expect(sections.map((section) => section.html).join("\n")).toContain(
      "<strong>重点</strong>",
    );
    expect(sections.map((section) => section.html).join("\n")).toContain(
      '<a href="https://example.com">链接</a>',
    );
    expect(sections.map((section) => section.html).join("\n")).toContain("<table>");
    expect(sections.map((section) => section.html).join("\n")).toContain("class=\"katex");
  });

  it("escapes raw HTML and rejects unsafe link protocols", () => {
    const [section] = parseMarkdownSections(
      `[危险](javascript:alert(1)) <script>alert(1)</script>`,
    );

    expect(section.html).not.toContain("href=");
    expect(section.html).not.toContain("<script>");
    expect(section.html).toContain("&lt;script&gt;");
  });

  it("preserves fenced code whitespace in rendered pages", () => {
    const [section] = parseMarkdownSections("```ts\nconst answer = 42;\n  return answer;\n```");

    expect(section.html).toContain("<pre><code>");
    expect(section.html).toContain("  return answer;");
    expect(section.text).toContain("const answer = 42;");
  });
});
