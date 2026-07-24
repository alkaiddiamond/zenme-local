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

  it("uses the circular arrow treatment for the submit button", () => {
    expect(source).toContain(
      'aria-label={isSubmitting ? "正在创建本地项目" : "创建本地项目"}',
    );
    expect(source).toContain("size-9");
    expect(source).toContain("rounded-full bg-zinc-950 text-white");
    expect(source).toContain(
      '<ArrowUp className="size-5" strokeWidth={1.75} />',
    );
    expect(source).toContain("focus-visible:shadow-[var(--shadow-focus-ring)]");
    expect(source).toContain('className="size-4 rounded-[2px] bg-white"');
    expect(source).not.toContain("disabled:bg-zinc-300");
  });
});
