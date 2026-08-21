import { describe, expect, it } from "vitest";

import {
  buildReadingNavigationSections,
  findReadingNavigationIndex,
  getReadingActiveTitle,
  isVirtualizedReadingFormat,
} from "./navigation";

describe("buildReadingNavigationSections", () => {
  it("uses PDF outline entries instead of generating one entry per page", () => {
    expect(
      buildReadingNavigationSections({
        assetFormat: "pdf",
        pdfOutlineSections: [
          { index: 0, title: "封面" },
          { index: 16, title: "三国志玉玺传卷一" },
          { index: 50, title: "三国志玉玺传卷二" },
        ],
        pdfPageCount: 523,
        sections: [],
      }),
    ).toEqual([
      { endIndex: 15, index: 0, pageNumber: 1, title: "封面" },
      {
        endIndex: 49,
        index: 16,
        pageNumber: 17,
        title: "三国志玉玺传卷一",
      },
      {
        endIndex: 522,
        index: 50,
        pageNumber: 51,
        title: "三国志玉玺传卷二",
      },
    ]);
  });

  it("treats TXT pages like EPUB pages and groups continuation pages", () => {
    const sections = [
      { index: 0, title: "第一章", html: "", text: "第一页" },
      { index: 1, title: "第一章 · 2", html: "", text: "第二页" },
      { index: 2, title: "第二章", html: "", text: "第三页" },
    ];

    expect(
      buildReadingNavigationSections({
        assetFormat: "txt",
        pdfPageCount: 0,
        sections,
      }),
    ).toEqual([
      { endIndex: 1, index: 0, pageNumber: 1, title: "第一章" },
      { endIndex: 2, index: 2, pageNumber: 3, title: "第二章" },
    ]);
    expect(
      getReadingActiveTitle({
        activeSection: 1,
        assetFormat: "txt",
        assetTitle: "书籍",
        pdfPageCount: 0,
        sections,
      }),
    ).toBe("第 2 / 3 页");
  });

  it("treats rendered Markdown as a paged reading format", () => {
    const sections = [
      { index: 0, title: "第一章", html: "<h1>第一章</h1>", text: "第一章" },
      { index: 1, title: "第一章 · 2", html: "<p>正文</p>", text: "正文" },
    ];

    expect(
      buildReadingNavigationSections({
        assetFormat: "markdown",
        pdfPageCount: 0,
        sections,
      }),
    ).toEqual([
      { endIndex: 1, index: 0, pageNumber: 1, title: "第一章" },
    ]);
  });

  it("uses independently rendered DOCX pages for navigation", () => {
    const sections = [
      { index: 0, title: "第一章", html: "<h1>第一章</h1>", text: "第一章" },
      { index: 1, title: "第一章 · 2", html: "<p>正文</p>", text: "正文" },
    ];

    expect(
      buildReadingNavigationSections({
        assetFormat: "docx",
        pdfPageCount: 3,
        sections,
      }),
    ).toEqual([
      { endIndex: 0, index: 0, pageNumber: 1, title: "第 1 页" },
      { endIndex: 1, index: 1, pageNumber: 2, title: "第 2 页" },
      { endIndex: 2, index: 2, pageNumber: 3, title: "第 3 页" },
    ]);
    expect(
      getReadingActiveTitle({
        activeSection: 1,
        assetFormat: "docx",
        assetTitle: "产品方案",
        pdfPageCount: 3,
        sections,
      }),
    ).toBe("第 2 / 3 页");
  });

  it("uses mapped DOCX headings as the rendered-page directory", () => {
    expect(
      buildReadingNavigationSections({
        assetFormat: "docx",
        pdfPageCount: 5,
        pdfOutlineSections: [
          { index: 0, title: "第一章" },
          { index: 3, title: "第二章" },
        ],
        sections: [],
      }),
    ).toEqual([
      { endIndex: 2, index: 0, pageNumber: 1, title: "第一章" },
      { endIndex: 4, index: 3, pageNumber: 4, title: "第二章" },
    ]);
  });
});

describe("findReadingNavigationIndex", () => {
  it("finds a page inside grouped navigation ranges", () => {
    const sections = [
      { endIndex: 20, index: 0, title: "第一章" },
      { endIndex: 48, index: 21, title: "第二章" },
      { endIndex: 70, index: 49, title: "第三章" },
    ];

    expect(findReadingNavigationIndex(sections, 37)).toBe(1);
    expect(findReadingNavigationIndex(sections, 71)).toBe(-1);
  });
});

describe("isVirtualizedReadingFormat", () => {
  it("uses fixed virtual page slots only for EPUB-like rendered formats", () => {
    expect(isVirtualizedReadingFormat("epub")).toBe(true);
    expect(isVirtualizedReadingFormat("markdown")).toBe(true);
    expect(isVirtualizedReadingFormat("txt")).toBe(true);
    expect(isVirtualizedReadingFormat("docx")).toBe(false);
    expect(isVirtualizedReadingFormat("pdf")).toBe(false);
  });
});
