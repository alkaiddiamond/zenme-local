import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const canvasClientSource = readFileSync(
  new URL("../canvas-client.tsx", import.meta.url),
  "utf8",
);

describe("node creation performance", () => {
  it("reuses the render-time canvas signature for explicit history commands", () => {
    const createHistory = canvasClientSource.slice(
      canvasClientSource.indexOf("const pushCreateHistory"),
      canvasClientSource.indexOf("const pushDeleteHistory"),
    );

    expect(createHistory).toContain(
      "shouldSyncHistorySignatureFromRender.current = true",
    );
    expect(createHistory).not.toContain("getCanvasHistorySignature(");
    expect(canvasClientSource).toContain(
      "canvasHistorySignature.current = canvasItemsSignature",
    );
  });

  it("does not replace the edge collection when creating only nodes", () => {
    const appendItems = canvasClientSource.slice(
      canvasClientSource.indexOf("const appendCanvasItems"),
      canvasClientSource.indexOf("const bringNodeToFront"),
    );

    expect(appendItems).toContain("if (createdNodes.length > 0)");
    expect(appendItems).toContain("if (createdEdges.length > 0)");
    expect(appendItems).toContain("setEdges(nextEdges)");
  });
});
