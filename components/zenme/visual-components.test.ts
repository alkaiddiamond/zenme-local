import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const visualComponentsSource = readFileSync(
  new URL("./visual-components.tsx", import.meta.url),
  "utf8",
);

describe("Zenme control button styles", () => {
  it("uses the outline variant instead of inheriting the primary gradient", () => {
    expect(visualComponentsSource).toContain('variant = "outline"');
    expect(visualComponentsSource).toContain("variant={variant}");
  });
});
