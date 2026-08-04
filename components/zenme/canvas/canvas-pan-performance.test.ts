import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const canvasClientSource = readFileSync(
  new URL("../canvas-client.tsx", import.meta.url),
  "utf8",
);

describe("canvas pan performance", () => {
  it("keeps viewport state updates out of the per-frame move handler", () => {
    const moveHandler = canvasClientSource.slice(
      canvasClientSource.indexOf("onMove={"),
      canvasClientSource.indexOf("onMoveEnd={"),
    );
    const moveEndHandler = canvasClientSource.slice(
      canvasClientSource.indexOf("onMoveEnd={"),
      canvasClientSource.indexOf("minZoom="),
    );

    expect(moveHandler).toContain("canvasViewportStateRef.current = viewport");
    expect(moveHandler).not.toContain("setCanvasViewport");
    expect(moveEndHandler).toContain("setCanvasViewport");
  });

  it("suspends secondary canvas overlays while the viewport is moving", () => {
    expect(canvasClientSource).toContain("setIsMiniMapSuspended(true)");
    expect(canvasClientSource).toContain("setIsViewportMoving(true)");
    expect(canvasClientSource).toContain(
      "selectionToolbarPosition && !isNodeDragging && !isViewportMoving",
    );
  });
});
