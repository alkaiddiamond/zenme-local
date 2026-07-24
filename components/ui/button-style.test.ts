import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalStyles = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

describe("primary button styles", () => {
  it("defines visible primary gradients in light and dark themes", () => {
    expect(
      globalStyles.match(/--gradient-btn-primary:/g),
    ).toHaveLength(2);
    expect(
      globalStyles.match(/--gradient-btn-primary-hover:/g),
    ).toHaveLength(2);
  });
});
