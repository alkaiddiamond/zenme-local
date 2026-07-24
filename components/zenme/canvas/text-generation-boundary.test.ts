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

    expect(source).toContain("disabled={isGenerating}");
    expect(source).not.toContain("!prompt.trim()");
    expect(source).not.toContain("!nextPrompt || isGenerating");
  });
});
