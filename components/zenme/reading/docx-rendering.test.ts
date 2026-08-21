import { describe, expect, it, vi } from "vitest";

import {
  buildDocxOutline,
  DOCX_PAGE_SELECTOR,
  DOCX_RENDER_OPTIONS,
  indexRenderedDocxPages,
} from "./docx-rendering";

describe("DOCX rendering", () => {
  it("keeps Word page dimensions, fonts, headers and footers", () => {
    expect(DOCX_RENDER_OPTIONS).toMatchObject({
      breakPages: true,
      ignoreFonts: false,
      ignoreHeight: false,
      ignoreLastRenderedPageBreak: false,
      ignoreWidth: false,
      renderFooters: true,
      renderHeaders: true,
    });
  });

  it("indexes rendered Word pages for scrolling and text selection", () => {
    const first = {
      classList: { add: vi.fn() },
      dataset: {},
    } as unknown as HTMLElement;
    const second = {
      classList: { add: vi.fn() },
      dataset: {},
    } as unknown as HTMLElement;
    const container = {
      querySelectorAll: vi.fn(() => [first, second]),
    } as unknown as HTMLElement;
    const pageRefs = { current: {} };

    expect(indexRenderedDocxPages(container, pageRefs)).toBe(2);
    expect(container.querySelectorAll).toHaveBeenCalledWith(DOCX_PAGE_SELECTOR);
    expect(first.dataset.readingSectionIndex).toBe("0");
    expect(second.dataset.readingSectionIndex).toBe("1");
    expect(first.classList.add).toHaveBeenCalledWith(
      "reading-prose",
      "zenme-docx-page",
    );
    expect(pageRefs.current).toEqual({ 0: first, 1: second });
  });

  it("maps parsed DOCX headings to their rendered pages", () => {
    const pages = [
      { textContent: "封面 第一章 产品概述" },
      { textContent: "第一章的正文" },
      { textContent: "第二章 实施方案" },
    ] as HTMLElement[];
    const sections = [
      { index: 0, title: "正文", html: "", text: "" },
      { index: 1, title: "第一章 产品概述", html: "", text: "" },
      { index: 2, title: "第一章 产品概述 · 2", html: "", text: "" },
      { index: 3, title: "第二章 实施方案", html: "", text: "" },
    ];

    expect(buildDocxOutline(pages, sections)).toEqual([
      { index: 0, title: "第一章 产品概述" },
      { index: 2, title: "第二章 实施方案" },
    ]);
  });
});
