import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const managedTextNodeSource = readFileSync(
  new URL("./managed-text-node.tsx", import.meta.url),
  "utf8",
);

describe("managed text node editing", () => {
  it("keeps the main textarea uncontrolled while typing", () => {
    const editor = managedTextNodeSource.slice(
      managedTextNodeSource.indexOf('aria-label="强管理节点内容"'),
      managedTextNodeSource.indexOf("</textarea>"),
    );

    expect(editor).toContain('defaultValue={nodeData.plainText ?? ""}');
    expect(editor).toContain("ref={contentEditorRef}");
    expect(editor).toContain("zenme-overlay-scroll-container");
    expect(managedTextNodeSource).toContain(
      "<OverlayScrollbars\n            contentKey={nodeData.plainText}",
    );
    expect(editor).not.toContain("value={content}");
    expect(editor).not.toContain("setContent(nextContent)");
  });

  it("disables browser writing assistance in the long-form editor", () => {
    const editor = managedTextNodeSource.slice(
      managedTextNodeSource.indexOf('aria-label="强管理节点内容"'),
      managedTextNodeSource.indexOf("</textarea>"),
    );

    expect(editor).toContain("spellCheck={false}");
    expect(editor).toContain('autoCorrect="off"');
    expect(editor).toContain('autoCapitalize="off"');
  });
});
