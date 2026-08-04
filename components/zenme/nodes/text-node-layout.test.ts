import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const textNodeSource = readFileSync(
  new URL("./text-node.tsx", import.meta.url),
  "utf8",
);

describe("text node layout", () => {
  it("renders text actions as an overlay without reserving a right column", () => {
    expect(textNodeSource).toContain("zenme-text-node-floating-actions");
    expect(textNodeSource).toContain("absolute right-3 top-3 z-30");
    expect(textNodeSource).toContain("rounded-md bg-white/80");
    expect(textNodeSource).toContain("opacity-55");
    expect(textNodeSource).toContain("hover:opacity-100");
    expect(textNodeSource).not.toContain("rounded-lg bg-white/90 p-1 shadow-sm ring-1");
    expect(textNodeSource).not.toContain("pr-24");
  });

  it("keeps text paste events out of the canvas-level paste handler", () => {
    const pasteHandler = textNodeSource.slice(
      textNodeSource.indexOf("function handlePaste"),
      textNodeSource.indexOf("function handleRichTextKeyDown"),
    );

    expect(pasteHandler).toContain("event.stopPropagation()");
    expect(pasteHandler).toContain("event.preventDefault()");
    expect(pasteHandler).toContain('document.execCommand("insertHTML"');
    expect(pasteHandler).toContain("plainTextToRichTextFragment(text)");
    expect(pasteHandler).not.toContain('document.execCommand("insertText"');
  });

  it("treats the AI response header as a drag surface except for its actions", () => {
    expect(textNodeSource).toContain(
      'className="zenme-node-drag-surface flex items-center justify-between',
    );
    expect(textNodeSource).toContain(
      'className="nodrag flex shrink-0 items-center gap-1"',
    );
  });
});
