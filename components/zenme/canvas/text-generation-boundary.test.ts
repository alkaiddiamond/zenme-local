import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();

function readProjectFile(filePath: string) {
  return readFileSync(path.join(ROOT_DIR, filePath), "utf8");
}

describe("text generation request boundary", () => {
  it("keeps CanvasClient from owning AI chat request details", () => {
    const source = readProjectFile("components/zenme/canvas-client.tsx");

    expect(source).toContain("requestTextGenerationResponse");
    expect(source).not.toContain('fetch("/api/ai/chat"');
    expect(source).not.toContain("readAiChatStream(");
    expect(source).not.toContain("没有可用的上游上下文。");
  });

  it("allows the text node composer to submit an empty prompt", () => {
    const source = readProjectFile(
      "components/zenme/nodes/text-node-composer.tsx",
    );

    expect(source).toContain(
      "!configuredModels.some((option) => option.id === model)",
    );
    expect(source).not.toContain("!prompt.trim()");
    expect(source).not.toContain("!nextPrompt || isGenerating");
  });

  it("does not write implicit source text back into the composer", () => {
    const source = readProjectFile("components/zenme/canvas-client.tsx");

    expect(source).toContain("prompt: input?.prompt");
    expect(source).not.toContain("prompt: preflight.prompt");
  });

  it("does not paint an empty composer placeholder as selected", () => {
    const source = readProjectFile("app/globals.css");

    expect(source).toContain(
      ".zenme-text-ai-input:placeholder-shown::selection",
    );
    expect(source).toContain(
      ".zenme-text-ai-input:placeholder-shown::-moz-selection",
    );
    expect(source).toContain("background-color: transparent");
  });

  it("uses the same compact model picker as image nodes", () => {
    for (const filePath of [
      "components/zenme/nodes/text-generation-node.tsx",
      "components/zenme/nodes/text-node-composer.tsx",
    ]) {
      const source = readProjectFile(filePath);

      expect(source).toMatch(/<ZenmeModelPicker\s+compact/);
      expect(source).toContain('<Sparkles className="size-3.5" />');
    }
  });

  it("uses matching arrow and pending-square submit buttons across nodes", () => {
    for (const filePath of [
      "components/zenme/nodes/text-generation-node.tsx",
      "components/zenme/nodes/text-node-composer.tsx",
      "components/zenme/nodes/image-edit-node.tsx",
      "components/zenme/nodes/image-node.tsx",
    ]) {
      const source = readProjectFile(filePath);

      expect(source).toContain(
        '<ArrowUp className="size-5" strokeWidth={1.75} />',
      );
      expect(source).toContain('className="size-4 rounded-[2px] bg-white"');
      expect(source).toContain("focus-visible:shadow-[var(--shadow-focus-ring)]");
    }
  });
});
