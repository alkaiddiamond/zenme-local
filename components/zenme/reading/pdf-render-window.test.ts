import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getPdfOutputScale } from "./pdf-page-geometry";

const lazyRenderSource = readFileSync(
  new URL("./use-lazy-pdf-page-render.ts", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("./pdf-page-view.tsx", import.meta.url),
  "utf8",
);
const readingViewSource = readFileSync(
  new URL("./pdf-reading-view.tsx", import.meta.url),
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

  it("marks every PDF page for shared current-page tracking", () => {
    expect(pageSource).toContain("data-reading-section-index={pageIndex}");
  });

  it("passes the display pixel ratio into PDF.js rendering", () => {
    expect(pageSource).toContain(
      "window.devicePixelRatio,\n        canvasScale",
    );
    expect(pageSource).toContain(
      "[outputScale, 0, 0, outputScale, 0, 0]",
    );
    expect(pageSource).not.toContain("context.setTransform(outputScale");
  });

  it("renders PDF pages at no less than 2x while preserving denser displays", () => {
    expect(getPdfOutputScale(1)).toBe(2);
    expect(getPdfOutputScale(1.5)).toBe(2);
    expect(getPdfOutputScale(2.5)).toBe(2.5);
    expect(getPdfOutputScale(undefined)).toBe(2);
  });

  it("rerenders visible PDF pages after the canvas zoom settles", () => {
    expect(readingViewSource).toContain("canvasStore.subscribe((state)");
    expect(readingViewSource).toContain("setCanvasScale(observedScale)");
    expect(readingViewSource).toContain("canvasScale={canvasScale}");
    expect(getPdfOutputScale(1.5, 2)).toBe(3);
    expect(getPdfOutputScale(2, 0.5)).toBe(2);
  });
});
