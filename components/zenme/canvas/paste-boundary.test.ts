import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const canvasSource = readFileSync(
  new URL("../canvas-client.tsx", import.meta.url),
  "utf8",
);

describe("canvas paste boundary", () => {
  it("returns for editable content before inspecting files or creating nodes", () => {
    const handler = canvasSource.slice(
      canvasSource.indexOf("async function handlePaste"),
      canvasSource.indexOf('window.addEventListener("copy"'),
    );
    const editableGuard = handler.indexOf("isEditableClipboardEvent");
    const imageInspection = handler.indexOf("getClipboardImageFiles");
    const textNodeCreation = handler.indexOf("createTextCanvasNode");

    expect(editableGuard).toBeGreaterThanOrEqual(0);
    expect(editableGuard).toBeLessThan(imageInspection);
    expect(editableGuard).toBeLessThan(textNodeCreation);
  });
});
