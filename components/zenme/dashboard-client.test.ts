import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./dashboard-client.tsx", import.meta.url),
  "utf8",
);

describe("dashboard project composer", () => {
  it("uses the shared text model picker and remembers model preference", () => {
    expect(source).toContain("<ZenmeModelPicker");
    expect(source).toContain('useAiModelOptions()');
    expect(source).toContain('rememberAiModelPreference("text", nextModel)');
  });

  it("has no input placeholder and follows the text composer keyboard behavior", () => {
    expect(source).not.toMatch(/\bplaceholder=/);
    expect(source).toContain('event.key !== "Enter"');
    expect(source).toContain("event.shiftKey");
    expect(source).toContain("requestSubmit()");
  });
});
