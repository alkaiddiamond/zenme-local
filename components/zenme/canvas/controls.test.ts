import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("canvas side toolbar", () => {
  const source = readFileSync(
    new URL("./controls.tsx", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const canvasClientSource = readFileSync(
    new URL("../canvas-client.tsx", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");

  it("keeps only working actions and exposes quick arrange", () => {
    expect(source).toContain('title="搜索画布"');
    expect(source).toContain('title="快速整理画布"');
    expect(source).toContain('title="开启 Agent 对话"');
    expect(source).toContain('title="手动保存"');
    expect(source).not.toContain('title="项目文件"');
    expect(source).not.toContain('title="项目侧栏占位"');
    expect(source).not.toContain('title="放大画布"');
    expect(source).not.toContain(">A</button>");
  });

  it("renders a full-text search panel with accessible controls", () => {
    expect(source).toContain('aria-label="画布全文搜索"');
    expect(source).toContain('aria-label="搜索画布内容"');
    expect(source).toContain("找到 {results.length} 个节点");
    expect(source).toContain("onFocusNode(result.id)");
  });

  it("closes search after choosing a result or clicking outside", () => {
    expect(source).toContain('document.addEventListener("pointerdown", closeOnOutsidePointerDown)');
    expect(source).toContain('target.closest("[data-canvas-search-trigger]")');
    expect(source).toContain("onFocusNode(result.id);\n                      onClose();");
  });

  it("clears the query whenever search closes", () => {
    expect(canvasClientSource).toContain(
      'setIsCanvasSearchOpen(false);\n    setCanvasSearchQuery("");',
    );
    expect(canvasClientSource).toContain("onClose={closeCanvasSearch}");
    expect(canvasClientSource).toContain("onToggleSearch={toggleCanvasSearch}");
  });

  it("automatically dismisses canvas notices while keeping manual close", () => {
    expect(source).toContain("const CANVAS_NOTICE_AUTO_DISMISS_MS = 5_000;");
    expect(source).toContain("window.setTimeout(() => {");
    expect(source).toContain("onCloseRef.current();");
    expect(source).toContain("}, CANVAS_NOTICE_AUTO_DISMISS_MS);");
    expect(source).toContain('aria-label="关闭通知"');
    expect(source).toContain('role="alert"');
  });
});
