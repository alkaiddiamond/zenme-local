import { describe, expect, it } from "vitest";

import {
  getFixedReadingPageEstimatedHeight,
  paginateFixedReadingHtml,
} from "./fixed-page-paginator";

describe("fixed reading pagination", () => {
  it("fills the current page with the leading fragment of a long paragraph", () => {
    const lead = `<p>${"前页内容。".repeat(45)}</p>`;
    const longParagraph = `<p>${"这是同一个逻辑段落，需要跨页连续显示。".repeat(100)}</p>`;
    const pages = paginateFixedReadingHtml({
      html: `${lead}${longParagraph}`,
      pageStartIndex: 0,
      title: "第八章",
    });

    expect(pages.length).toBeGreaterThan(2);
    expect(pages[0].text).toContain("这是同一个逻辑段落");
    expect(getFixedReadingPageEstimatedHeight(pages[0].html)).toBeGreaterThan(
      560,
    );
    expect(pages[1].html).toContain("reading-paragraph-continuation");
  });

  it("keeps continuation fragments under the same chapter title", () => {
    const pages = paginateFixedReadingHtml({
      html: `<p>${"连续正文。".repeat(500)}</p>`,
      pageStartIndex: 8,
      title: "第八章",
    });

    expect(pages[0]).toMatchObject({ index: 8, title: "第八章" });
    expect(pages[1]).toMatchObject({ index: 9, title: "第八章 · 2" });
  });
});
