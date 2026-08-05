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

    expect(inputHandler).toContain("plainTextDirtyRef.current = true");
    expect(inputHandler).not.toContain("setTimeout");
    expect(inputHandler).not.toContain("readEditorContent()");
    expect(textNodeSource).toContain("if (!plainTextDirtyRef.current)");
    expect(textNodeSource).toContain("plainTextDirtyRef.current = false");
  });

  it("keeps Markdown and code typing outside the node render cycle", () => {
    const markdownEditor = textNodeSource.slice(
      textNodeSource.indexOf('aria-label="Markdown 文本"'),
      textNodeSource.indexOf('contentKey={`${isEditing ? "edit"'),
    );
    const codeEditor = textNodeSource.slice(
      textNodeSource.indexOf('aria-label="代码内容"'),
      textNodeSource.indexOf("<OverlayScrollbars", textNodeSource.indexOf('aria-label="代码内容"')),
    );

    expect(markdownEditor).toContain("defaultValue={plainText}");
    expect(markdownEditor).toContain("rememberTextInput(nextText)");
    expect(markdownEditor).not.toContain("value={plainText}");
    expect(codeEditor).toContain("defaultValue={plainText}");
    expect(codeEditor).toContain("rememberTextInput(nextText)");
    expect(codeEditor).not.toContain("value={plainText}");
    expect(textNodeSource).toContain("const markdownPreviewContent = useMemo(");
    expect(textNodeSource).toContain("const highlightedCode = useMemo(");
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

  it("restores and debounces exact scroll offsets for each text mode", () => {
    expect(textNodeSource).toContain("nodeData.textScrollState?.[displayMode]?.left");
    expect(textNodeSource).toContain("nodeData.textScrollState?.[displayMode]?.top");
    expect(textNodeSource).toContain('rememberTextScroll("plain"');
    expect(textNodeSource).toContain('rememberTextScroll("markdown"');
    expect(textNodeSource).toContain('rememberTextScroll("code"');
    expect(textNodeSource).toContain("left: Math.max(0, target.scrollLeft)");
    expect(textNodeSource).toContain("top: Math.max(0, target.scrollTop)");
    expect(textNodeSource).toContain("}, 200)");
  });

  it("keeps rendered Markdown selectable until explicit source editing", () => {
    const markdownView = textNodeSource.slice(
      textNodeSource.indexOf('{displayMode === "markdown" ? ('),
      textNodeSource.indexOf('{displayMode === "code" ? ('),
    );

    expect(markdownView).toContain("zenme-markdown-preview zenme-markdown-preview-interactive");
    expect(markdownView).toContain("select-text overflow-auto");
    expect(markdownView).toContain('isEditing ? "pointer-events-none invisible" : ""');
    expect(markdownView).not.toContain("focusPlainTextArea(markdownEditorRef.current)");
    expect(textNodeSource).toContain("onToggleMarkdownEditing={toggleMarkdownEditing}");
    expect(textNodeSource).toContain("syncScrollPositionByRatio(editor, preview)");
    expect(textNodeSource).toContain('rememberTextScroll("markdown", preview)');
    expect(globalStylesSource).toContain(
      ".zenme-markdown-preview.zenme-markdown-preview-interactive",
    );
    expect(globalStylesSource).toContain("pointer-events: auto !important");
  });
});
