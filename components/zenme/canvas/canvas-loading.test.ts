import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const canvasClientSource = readFileSync(
  new URL("../canvas-client.tsx", import.meta.url),
  "utf8",
);

describe("canvas loading boundary", () => {
  it("does not expose or save an initial canvas before the snapshot is loaded", () => {
    expect(canvasClientSource).toContain("useNodesState<CanvasNode>([])");
    expect(canvasClientSource).toContain("setCanvasLoaded(false)");
    expect(canvasClientSource).toContain("setCanvasHydrated(false)");
  });

  it("keeps load failures out of the hydrated canvas and offers retry", () => {
    expect(canvasClientSource).toContain('setCanvasLoadError(');
    expect(canvasClientSource).toContain("setCanvasLoaded(false)");
    expect(canvasClientSource).toContain("setCanvasHydrated(false)");
    expect(canvasClientSource).toContain('role="alert"');
    expect(canvasClientSource).toContain("重新加载");
    expect(canvasClientSource).toContain(
      "setCanvasLoadAttempt((attempt) => attempt + 1)",
    );
  });
});
