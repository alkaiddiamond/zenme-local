import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./epub-paged-scroll-view.tsx", import.meta.url),
  "utf8",
);

describe("paged reading scroll performance", () => {
  it("creates React elements only for the current virtualized range", () => {
    expect(source).toContain(
      "sections.slice(firstVisibleIndex, visibleRange[1] + 1)",
    );
    expect(source).toContain("visibleSections.map");
    expect(source).not.toContain("sections.map");
    expect(source).not.toContain("READING_PAGE_PLACEHOLDER_CLASSNAME");
    expect(source).toContain("getReadingTextSample(sections)");
    expect(source).not.toContain("sections.map((section) => section.text)");
  });

  it("shows the chapter title in the header and page number in the footer", () => {
    expect(source).toContain(
      'const pageTitle = section.title.replace(/\\s·\\s\\d+$/, "")',
    );
    expect(source).toContain("{pageTitle}</span>");
    expect(source).toContain(
      "`${READING_PAGE_FOOTER_CLASSNAME} justify-center`",
    );
    expect(source).toContain("第 {section.index + 1} 页</span>");
  });
});
