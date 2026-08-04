import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const textNodeSource = readFileSync(
  new URL("./text-node.tsx", import.meta.url),
  "utf8",
);
const globalStylesSource = readFileSync(
  new URL("../../../app/globals.css", import.meta.url),
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

  it("does not serialize the complete rich text document on every keystroke", () => {
    const inputHandler = textNodeSource.slice(
      textNodeSource.indexOf("function handlePlainTextInput"),
      textNodeSource.indexOf("function applyTextCommand"),
    );

    expect(inputHandler).toContain("scheduleEditorContentSync()");
    expect(inputHandler).not.toContain("readEditorContent()");
  });

  it("disables browser writing assistance in the long-form editor", () => {
    const editor = textNodeSource.slice(
      textNodeSource.indexOf('autoCapitalize="off"'),
      textNodeSource.indexOf("suppressContentEditableWarning"),
    );

    expect(editor).toContain("spellCheck={false}");
    expect(editor).toContain('autoCorrect="off"');
    expect(editor).toContain('autoCapitalize="off"');
  });

  it("treats the AI response header as a drag surface except for its actions", () => {
    expect(textNodeSource).toContain(
      'className="zenme-node-drag-surface flex items-center justify-between',
    );
    expect(textNodeSource).toContain(
      'className="nodrag flex shrink-0 items-center gap-1"',
    );
  });

  it("uses non-layout overlay scrollbars for every text viewport", () => {
    expect(textNodeSource.match(/<OverlayScrollbars/g)).toHaveLength(4);
    expect(textNodeSource).toContain(
      "zenme-overlay-scroll-container zenme-text-node-editor",
    );
    expect(textNodeSource).toContain(
      "zenme-overlay-scroll-container zenme-markdown-editor",
    );
    expect(textNodeSource).toContain(
      "zenme-overlay-scroll-container zenme-code-editor",
    );
    expect(textNodeSource).toContain(
      "zenme-overlay-scroll-container nodrag nowheel absolute inset-0",
    );
    expect(globalStylesSource).toContain("scrollbar-width: none");
    expect(globalStylesSource).toContain(
      ".zenme-overlay-scroll-container::-webkit-scrollbar",
    );
    expect(globalStylesSource).toContain("display: none");
  });
});
