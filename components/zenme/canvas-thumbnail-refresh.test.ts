import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./canvas-client.tsx", import.meta.url),
  "utf8",
);

describe("canvas thumbnail refresh scheduling", () => {
  it("uses a short debounce after canvas changes without changing the periodic refresh", () => {
    expect(source).toContain(
      "const THUMBNAIL_PERIODIC_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;",
    );
    expect(source).toContain(
      "const THUMBNAIL_CHANGE_REFRESH_DELAY_MS = 1200;",
    );
    expect(source).toContain(
      "}, THUMBNAIL_PERIODIC_REFRESH_INTERVAL_MS);",
    );
    expect(source).toContain("}, THUMBNAIL_CHANGE_REFRESH_DELAY_MS);");
    expect(source).not.toContain(
      "? THUMBNAIL_PERIODIC_REFRESH_INTERVAL_MS",
    );
  });
});
