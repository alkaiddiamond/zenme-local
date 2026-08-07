import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./canvas-client.tsx", import.meta.url),
  "utf8",
);

describe("canvas thumbnail refresh scheduling", () => {
  it("uses a long quiet period after canvas changes without changing the periodic refresh", () => {
    expect(source).toContain(
      "const THUMBNAIL_PERIODIC_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;",
    );
    expect(source).toContain(
      "const THUMBNAIL_CHANGE_REFRESH_DELAY_MS = 60_000;",
    );
    expect(source).toContain(
      "}, THUMBNAIL_PERIODIC_REFRESH_INTERVAL_MS);",
    );
    expect(source).toContain("}, THUMBNAIL_CHANGE_REFRESH_DELAY_MS);");
    expect(source).not.toContain(
      "? THUMBNAIL_PERIODIC_REFRESH_INTERVAL_MS",
    );
  });

  it("defers autosave and thumbnail work during active canvas interactions", () => {
    const autosaveBlock = source.slice(
      source.indexOf("const scheduleAutosave"),
      source.indexOf("useEffect(() => {", source.indexOf("const scheduleAutosave")),
    );
    const thumbnailBlock = source.slice(
      source.indexOf("const scheduleThumbnailRefresh"),
      source.indexOf("return () => {", source.indexOf("const scheduleThumbnailRefresh")),
    );

    expect(autosaveBlock).toContain("isCanvasInteractionActive.current");
    expect(autosaveBlock).toContain("scheduleAutosave()");
    expect(thumbnailBlock).toContain("isCanvasInteractionActive.current");
    expect(thumbnailBlock).toContain("scheduleThumbnailRefresh()");
    const selectionHandlers = source.slice(
      source.indexOf("onSelectionStart="),
      source.indexOf("snapGrid="),
    );
    expect(selectionHandlers).toContain(
      "isCanvasInteractionActive.current = true",
    );
    expect(selectionHandlers).toContain(
      "isCanvasInteractionActive.current = false",
    );
    expect(source).toContain("onPointerDownCapture={(event) =>");
    expect(source).toContain("canvasSelectionPointerActive.current = true");
    expect(source).toContain("onPointerCancelCapture=");
  });
});
