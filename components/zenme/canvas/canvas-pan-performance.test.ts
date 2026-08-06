import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const canvasClientSource = readFileSync(
  new URL("../canvas-client.tsx", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../../../app/globals.css", import.meta.url),
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
    expect(canvasClientSource).toContain("zenme-canvas-viewport-moving");
    expect(globalStyles).toContain(
      ".zenme-canvas-viewport-moving .zenme-reader-workspace",
    );
    const movingReaderRule = globalStyles.slice(
      globalStyles.indexOf(
        ".zenme-canvas-viewport-moving .zenme-reader-workspace",
      ),
      globalStyles.indexOf(
        "}",
        globalStyles.indexOf(
          ".zenme-canvas-viewport-moving .zenme-reader-workspace",
        ),
      ),
    );
    expect(movingReaderRule).toContain("pointer-events: none");
    expect(movingReaderRule).not.toContain("opacity");
    expect(movingReaderRule).not.toContain("content-visibility");
    expect(canvasClientSource).toContain("selectionToolbarPosition &&");
    expect(canvasClientSource).toContain("!isNodeDragging &&");
    expect(canvasClientSource).toContain("!isViewportMoving ?");
  });

  it("keeps connection dragging lightweight on dense canvases", () => {
    expect(canvasClientSource).toContain("const CANVAS_CONNECTION_RADIUS = 32");
    expect(canvasClientSource).toContain(
      "connectionRadius={CANVAS_CONNECTION_RADIUS}",
    );
    expect(canvasClientSource).not.toContain("connectionRadius={120}");

    const connectStartHandler = canvasClientSource.slice(
      canvasClientSource.indexOf("onConnectStart={"),
      canvasClientSource.indexOf("onDragOver={"),
    );
    expect(connectStartHandler).toContain("setIsMiniMapSuspended(true)");
    expect(connectStartHandler).toContain("setIsNodeConnecting(true)");
    expect(canvasClientSource).toContain("zenme-canvas-node-connecting");
    expect(globalStyles).toContain(
      ".zenme-canvas-node-connecting .zenme-reader-workspace",
    );
  });

  it("defers full canvas signatures until drag and resize interactions end", () => {
    const signatureBlock = canvasClientSource.slice(
      canvasClientSource.indexOf("const canvasItemsSignature"),
      canvasClientSource.indexOf("useEffect(() => {", canvasClientSource.indexOf("const canvasItemsSignature")),
    );

    expect(signatureBlock).toContain("isNodeDragging || isNodeResizing");
    expect(signatureBlock).toContain("lastCanvasItemsSignature.current");
    expect(canvasClientSource).toContain("setIsNodeResizing(true)");
    expect(canvasClientSource).toContain("setIsNodeResizing(false)");
  });

  it("does not snapshot every canvas node when a drag starts", () => {
    const dragStartHandler = canvasClientSource.slice(
      canvasClientSource.indexOf("const handleCanvasNodeDragStart"),
      canvasClientSource.indexOf("const moveGroupedNodesWithFrame"),
    );

    expect(dragStartHandler).toContain("createDragStartNodeSnapshots(");
    expect(dragStartHandler).not.toContain(
      "currentNodes.map((node) => [",
    );
  });
});
