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
const nodeTypesSource = readFileSync(
  new URL("../nodes.tsx", import.meta.url),
  "utf8",
);

describe("canvas pan performance", () => {
  it("does not depend on a visible animation frame to finish hydration", () => {
    const loadCanvas = canvasClientSource.slice(
      canvasClientSource.indexOf("async function loadCanvas"),
      canvasClientSource.indexOf("void loadCanvas()"),
    );
    expect(loadCanvas).toContain("hydrationTimer = window.setTimeout");
    expect(loadCanvas).not.toContain("hydrationTimer = requestAnimationFrame");
  });

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
    expect(moveHandler).not.toContain("setZoomLevel");
    expect(moveEndHandler).toContain("commitCanvasViewport(viewport)");
  });

  it("keeps nodes mounted while the viewport moves", () => {
    expect(canvasClientSource).not.toContain("onlyRenderVisibleElements");
    expect(globalStyles).not.toContain("content-visibility: auto");
    expect(globalStyles).not.toContain("contain-intrinsic-size:");
  });

  it("switches heavy node content only after viewport movement settles", () => {
    const moveHandler = canvasClientSource.slice(
      canvasClientSource.indexOf("onMove={"),
      canvasClientSource.indexOf("onMoveEnd={"),
    );
    const moveEndHandler = canvasClientSource.slice(
      canvasClientSource.indexOf("onMoveEnd={"),
      canvasClientSource.indexOf("minZoom="),
    );

    expect(moveHandler).not.toContain("refreshCanvasContentWorkset");
    expect(moveEndHandler).toContain("refreshCanvasContentWorkset");
    expect(nodeTypesSource).toContain("data-canvas-content-shell");
    expect(nodeTypesSource).toContain("canvasContentActive === false");
  });

  it("supports direct trackpad panning without remounting nodes", () => {
    expect(canvasClientSource).toContain("panOnScroll");
    expect(canvasClientSource).toContain('panActivationKeyCode="Space"');
    expect(canvasClientSource).not.toContain("panOnScroll={false}");
  });

  it("respects reduced-motion preferences for viewport animations", () => {
    expect(canvasClientSource).toContain("getCanvasMotionDuration(");
    expect(canvasClientSource).not.toContain("duration: 300,");
  });

  it("coalesces continuous wheel zoom without writing root state per event", () => {
    const wheelHandler = canvasClientSource.slice(
      canvasClientSource.indexOf("function handleCanvasWheelCapture"),
      canvasClientSource.indexOf("async function handleUploadInputChange"),
    );

    expect(wheelHandler).toContain("window.requestAnimationFrame");
    expect(wheelHandler).toContain("canvasWheelZoomDelta.current +=");
    expect(wheelHandler).toContain("getCanvasWheelZoom(");
    expect(wheelHandler).not.toContain("setCanvasViewport");
    expect(wheelHandler).not.toContain("setZoomLevel");
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
    expect(connectStartHandler).toContain(
      'classList.add(\n              "zenme-canvas-node-connecting"',
    );
    expect(connectStartHandler).toContain(
      'classList.toggle(\n                "zenme-context-connecting"',
    );
    expect(connectStartHandler).not.toContain("setIsMiniMapSuspended");
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

  it("keeps edge derivation independent from node position updates", () => {
    const renderedEdges = canvasClientSource.slice(
      canvasClientSource.indexOf("const renderableEdges"),
      canvasClientSource.indexOf("const resetCanvasHistory"),
    );

    expect(renderedEdges).toContain(
      "[edgeNodeKindById, edges.length, nodes.length, renderableEdges, selectedNodeIds]",
    );
    expect(renderedEdges).not.toContain(
      "[edgeNodeKindById, edges, nodes]",
    );
    expect(renderedEdges).toContain("getCanvasEdgeWorkset({");
  });

  it("snapshots only nodes participating in a resize", () => {
    const resizeStart = canvasClientSource.slice(
      canvasClientSource.indexOf("if (hasActiveResizeChange"),
      canvasClientSource.indexOf("if (hasActiveResizeChange && !resizeInteractionSample"),
    );

    expect(resizeStart).toContain("createResizeStartNodeSnapshots(");
    expect(resizeStart).not.toContain("nodes.map(");
  });

  it("reuses rendered nodes when Alt-drag previews are inactive", () => {
    const displayedNodesStart = canvasClientSource.indexOf("const displayedNodes");
    const displayedNodes = canvasClientSource.slice(
      displayedNodesStart,
      canvasClientSource.indexOf("if (!canvasHydrated)", displayedNodesStart),
    );

    expect(displayedNodes).toContain("return renderedNodes");
    expect(displayedNodes).toContain("altDragPreviewNodes.length === 0");
  });
});
