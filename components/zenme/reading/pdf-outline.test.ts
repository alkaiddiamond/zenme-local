import { describe, expect, it } from "vitest";

import { resolvePdfOutlineSections } from "./pdf-outline";
import type { PdfDocumentProxyLike } from "./types";

describe("resolvePdfOutlineSections", () => {
  it("resolves named and direct destinations while preserving outline order", async () => {
    const pdf = {
      getDestination: async (id: string) =>
        id === "chapter-one" ? [{ num: 17 }] : null,
      getOutline: async () => [
        { dest: [{ num: 1 }], items: [], title: "封面" },
        {
          dest: "chapter-one",
          items: [
            { dest: [{ num: 51 }], items: [], title: "三国志玉玺传卷二" },
          ],
          title: "三国志玉玺传卷一",
        },
      ],
      getPageIndex: async (reference: unknown) =>
        (reference as { num: number }).num - 1,
    } as PdfDocumentProxyLike;

    await expect(resolvePdfOutlineSections(pdf)).resolves.toEqual([
      { index: 0, title: "封面" },
      { index: 16, title: "三国志玉玺传卷一" },
      { index: 50, title: "三国志玉玺传卷二" },
    ]);
  });
});
