import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lazyRenderSource = readFileSync(
  new URL("./use-lazy-pdf-page-render.ts", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("./pdf-page-view.tsx", import.meta.url),
  "utf8",
);

describe("PDF render window", () => {
  it("releases canvases and text layers after pages leave the render margin", () => {
    expect(lazyRenderSource).toContain(
      "setShouldRender(entries.some((entry) => entry.isIntersecting))",
    );
    expect(lazyRenderSource).not.toContain("if (!element || shouldRender)");
    expect(pageSource).toContain("textLayerRef.current?.replaceChildren() ".trim());
    expect(pageSource).toContain("{shouldRender ? (");
  });
});
