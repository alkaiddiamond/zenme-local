import { describe, expect, it } from "vitest";

import { buildReadingNavigationSections } from "./navigation";

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
});
