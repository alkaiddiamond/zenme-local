import { describe, expect, it } from "vitest";

import { parseTxtSections } from "./txt-parser";

describe("parseTxtSections", () => {
  it("splits sections by Chinese chapter headings", () => {
    const sections = parseTxtSections("序言\n\n第一章 开始\n正文一\n第二章 继续\n正文二");

    expect(sections).toHaveLength(3);
    expect(sections.map((section) => section.title)).toEqual([
      "正文",
      "第一章 开始",
      "第二章 继续",
    ]);
    expect(sections[1].text).toBe("第一章 开始\n正文一");
  });

  it("normalizes CRLF and CR line endings", () => {
    const sections = parseTxtSections("第一章 开始\r\n第一段\r第二段");

    expect(sections).toHaveLength(1);
    expect(sections[0].text).toBe("第一章 开始\n第一段\n第二段");
  });

  it("escapes plain text before turning it into HTML paragraphs", () => {
    const sections = parseTxtSections('第一章 <script>alert("x")</script>\nA&B');

    expect(sections[0].html).toBe(
      "<p>第一章 &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p><p>A&amp;B</p>",
    );
  });

  it("returns a fallback empty section for blank input", () => {
    expect(parseTxtSections(" \n\n ")).toEqual([
      { index: 0, title: "正文", html: "", text: "" },
    ]);
  });
});
