import { describe, expect, it } from "vitest";

import {
  decodeTxtBytes,
  parseTxtSections,
  shouldRebuildTxtSections,
} from "./txt-parser";

describe("parseTxtSections", () => {
  it("decodes UTF-8 and legacy GB18030 Chinese text", () => {
    expect(decodeTxtBytes(new TextEncoder().encode("中文正文"))).toBe(
      "中文正文",
    );
    expect(decodeTxtBytes(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))).toBe(
      "中文",
    );
  });

  it("splits sections by Chinese chapter headings", () => {
    const sections = parseTxtSections(
      "序言\n\n第一章 开始\n正文一\n第二章 继续\n正文二",
    );

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
    const sections = parseTxtSections(
      '第一章 <script>alert("x")</script>\nA&B',
    );

    expect(sections[0].html).toBe(
      "<p>第一章 &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>\n<p>A&amp;B</p>",
    );
  });

  it("returns a fallback empty section for blank input", () => {
    expect(parseTxtSections(" \n\n ")).toEqual([
      expect.objectContaining({ index: 0, title: "正文", html: "", text: "" }),
    ]);
  });

  it("paginates heading-free text into the same bounded pages as EPUB", () => {
    const sections = parseTxtSections(
      Array.from({ length: 181 }, (_, index) => `第 ${index + 1} 段`).join(
        "\n",
      ),
    );

    expect(sections.length).toBeGreaterThan(2);
    expect(sections.every((section, index) => section.index === index)).toBe(
      true,
    );
    expect(sections[0].title).toBe("正文");
    expect(sections[1].title).toBe("正文 · 2");
    expect(sections.map((section) => section.text).join("\n")).toContain(
      "第 181 段",
    );
  });

  it("detects sections corrupted by the wrong text encoding", () => {
    expect(
      shouldRebuildTxtSections([
        {
          index: 0,
          title: "正文",
          html: "<p>���乱码���</p>",
          text: "���乱码���",
        },
      ]),
    ).toBe(true);
    expect(shouldRebuildTxtSections(parseTxtSections("正常正文"))).toBe(false);
  });

  it("rebuilds legacy variable-height TXT sections that exceed one page", () => {
    const paragraphs = Array.from(
      { length: 30 },
      (_, index) => `<p>第 ${index + 1} 段正文</p>`,
    ).join("");

    expect(
      shouldRebuildTxtSections([
        { index: 0, title: "正文", html: paragraphs, text: "旧版长章节" },
      ]),
    ).toBe(true);
  });

  it("rebuilds legacy TXT pages that leave a large gap before a continuation", () => {
    expect(
      shouldRebuildTxtSections([
        {
          index: 0,
          title: "第八章",
          html: `<p>${"上一页内容。".repeat(30)}</p>`,
          text: "上一页内容",
        },
        {
          index: 1,
          title: "第八章 · 2",
          html: `<p>${"同一章的长段落。".repeat(30)}</p>`,
          text: "同一章的长段落",
        },
      ]),
    ).toBe(true);
  });

  it("does not repeatedly rebuild freshly paginated underfilled pages", () => {
    const sections = parseTxtSections(
      ["第八章", "短段落。", "另一个短段落。"].join("\n"),
    );

    expect(shouldRebuildTxtSections(sections)).toBe(false);
  });
});
