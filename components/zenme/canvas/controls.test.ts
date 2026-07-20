import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("canvas side toolbar", () => {
  const source = readFileSync(
    new URL("./controls.tsx", import.meta.url),
    "utf8",
  );

  it("keeps only working actions and exposes quick arrange", () => {
    expect(source).toContain('title="快速整理画布"');
    expect(source).toContain('title="开启 Agent 对话"');
    expect(source).toContain('title="手动保存"');
    expect(source).not.toContain('title="项目文件"');
    expect(source).not.toContain('title="项目侧栏占位"');
    expect(source).not.toContain('title="放大画布"');
    expect(source).not.toContain(">A</button>");
  });
});
