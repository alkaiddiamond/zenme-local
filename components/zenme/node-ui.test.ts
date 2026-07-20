import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nodeUiSource = readFileSync(
  new URL("./node-ui.tsx", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

describe("node plus handle motion", () => {
  it("uses a large transparent hit area with a separate visible icon", () => {
    expect(nodeUiSource).toContain("zenme-node-handle-hit-area");
    expect(nodeUiSource).toContain("!size-20");
    expect(nodeUiSource).toContain("zenme-node-handle-plus-right");
    expect(nodeUiSource).toContain("zenme-node-handle-plus-left");
    expect(nodeUiSource).toContain("size-6 rounded-full border border-zinc-400");
    expect(nodeUiSource).toContain("strokeWidth={1.5}");
  });

  it("slides and fades the icon with a spring transition", () => {
    expect(globalStyles).toContain(
      "transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)",
    );
    expect(globalStyles).toContain(
      "opacity 300ms cubic-bezier(0.34, 1.56, 0.64, 1)",
    );
    expect(globalStyles).toContain("translate3d(-24px, 0, 0)");
    expect(globalStyles).toContain("translate3d(24px, 0, 0)");
    expect(globalStyles).toContain(".zenme-node-handle-plus-visible");
  });

  it("magnetically follows the pointer without moving the connection anchor", () => {
    expect(nodeUiSource).toContain("<MagneticHandleContent side=\"right\">");
    expect(nodeUiSource).toContain("<MagneticHandleContent side=\"left\">");
    expect(nodeUiSource).toContain(
      "transform 250ms cubic-bezier(0.34, 1.8, 0.64, 1)",
    );
    expect(nodeUiSource).toContain(
      "transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)",
    );
    expect(nodeUiSource).toContain(
      "? { bottom: 40, left: 24, right: 40, top: 40 }",
    );
    expect(nodeUiSource).toContain(
      ": { bottom: 40, left: 40, right: 24, top: 40 }",
    );
    expect(nodeUiSource).toContain(
      "window.addEventListener(\"mousemove\", handleMouseMove)",
    );
    expect(nodeUiSource).toContain(
      "const offsetX = (event.clientX - center.x) / safeZoom",
    );
  });
});
