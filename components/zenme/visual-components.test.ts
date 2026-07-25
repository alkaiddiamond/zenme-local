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

  it("disables an empty model picker and explains that no model is configured", () => {
    expect(visualComponentsSource).toContain('"未配置模型"');
    expect(visualComponentsSource).toContain("disabled={!hasModels}");
  });

  it("shows readable model metadata instead of the internal scoped id", () => {
    expect(visualComponentsSource).toContain("title={option.tooltip}");
    expect(visualComponentsSource).not.toContain("title={option.id}");
  });
});
