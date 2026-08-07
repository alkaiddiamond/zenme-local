import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const nodesSource = readFileSync(
  new URL("../nodes.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const renderedNodesSource = readFileSync(
  new URL("../canvas/rendered-nodes.ts", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const globalStyles = readFileSync(
  new URL("../../../app/globals.css", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");

describe("node border drag areas", () => {
  it("adds narrow drag targets along every edge without covering node content", () => {
    expect(nodesSource).toContain("function NodeDragBorder()");
    expect(nodesSource).toContain("absolute inset-x-2 top-0 h-2");
    expect(nodesSource).toContain("absolute inset-x-2 bottom-0 h-2");
    expect(nodesSource).toContain(
      "zenme-node-drag-border-side pointer-events-auto absolute inset-y-2 left-0 w-2",
    );
    expect(nodesSource).toContain(
      "zenme-node-drag-border-side pointer-events-auto absolute inset-y-2 right-0 w-2",
    );
    expect(nodesSource).toContain("pointer-events-none absolute inset-0");
  });

  it("wraps regular nodes while leaving group interaction unchanged", () => {
    expect(nodesSource).toContain('<div className="contents">');
    expect(nodesSource).toContain("group: withCanvasContentBoundary(GroupNode)");
    expect(nodesSource).toContain("text: withCanvasContentBoundary(TextNode");
    expect(nodesSource).toContain("image: withNodeDragBorder(ImageNode)");
    expect(nodesSource).toContain("task: withCanvasContentBoundary(TaskNode");
  });

  it("keeps node chrome on lightweight content shells", () => {
    expect(nodesSource).toContain("zenme-shadow-node group relative");
    expect(nodesSource).toContain(
      "data-canvas-shell-floating-handle={side}",
    );
    expect(nodesSource).toContain(
      '<CanvasNodeShellFloatingHandle\n              selected={Boolean(selected)}\n              side="left"',
    );
    expect(nodesSource).toContain(
      '<CanvasNodeShellFloatingHandle\n              selected={Boolean(selected)}\n              side="right"',
    );
    expect(nodesSource).toContain('isGroup ? "-top-7" : "-top-8"');
    expect(nodesSource).toContain("nodeData.title || nodeData.name");
    expect(nodesSource).not.toContain('overflow-hidden shadow-sm"}`');
  });

  it("keeps title-only note nodes draggable from their new border areas", () => {
    expect(renderedNodesSource).toContain(
      'dragHandle: ".zenme-node-title-bar, .zenme-node-drag-border"',
    );
  });

  it("uses grab cursors on the border targets", () => {
    expect(globalStyles).toContain(".zenme-canvas .zenme-node-drag-border");
    expect(globalStyles).toContain("cursor: grab !important;");
    expect(globalStyles).toContain("cursor: grabbing !important;");
  });

  it("shows grab cursors on draggable root gaps while preserving child cursors", () => {
    expect(globalStyles).toMatch(
      /\.react-flow__node-text,[\s\S]*?\.react-flow__node-textGeneration \{\s+cursor: grab !important;/,
    );
    expect(globalStyles).toContain(
      ".zenme-canvas .react-flow__node-text.dragging,",
    );
    expect(globalStyles).toContain(
      ".zenme-canvas .react-flow__node-note {\n  cursor: grab !important;",
    );
    expect(globalStyles).toContain(
      ".zenme-canvas .react-flow__node-note * {\n  cursor: default !important;",
    );
  });

  it("matches side drag areas to each node family's visual padding", () => {
    expect(globalStyles).toContain(
      "width: var(--zenme-node-side-drag-width, 0.5rem) !important;",
    );
    expect(globalStyles).toMatch(
      /\.react-flow__node-text,[\s\S]*?\.react-flow__node-markdown \{\s+--zenme-node-side-drag-width: 1\.5rem;/,
    );
    expect(globalStyles).toContain(
      ".zenme-canvas .react-flow__node-agent {\n  --zenme-node-side-drag-width: 1.25rem;",
    );
    expect(globalStyles).toMatch(
      /\.react-flow__node-code,[\s\S]*?\.react-flow__node-reader \{\s+--zenme-node-side-drag-width: 1rem;/,
    );
    expect(globalStyles).toMatch(
      /\.react-flow__node-file,[\s\S]*?\.react-flow__node-videoGeneration \{\s+--zenme-node-side-drag-width: 0\.75rem;/,
    );
  });
});
