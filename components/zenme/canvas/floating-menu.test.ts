import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();

function readProjectFile(filePath: string) {
  return readFileSync(path.join(ROOT_DIR, filePath), "utf8");
}

describe("canvas floating menus", () => {
  it("keeps shared floating menu structure outside of canvas menu variants", () => {
    const menuSource = readProjectFile("components/zenme/canvas/menus.tsx");
    const sharedSource = readProjectFile(
      "components/zenme/canvas/floating-menu.tsx",
    );

    expect(menuSource).toContain("FloatingMenu");
    expect(menuSource).toContain("FloatingMenuHeader");
    expect(menuSource).toContain("FloatingMenuItem");
    expect(sharedSource).toContain("data-thumbnail-hidden");
    expect(menuSource).not.toContain("shadow-2xl backdrop-blur");
  });

  it("uses the upload-free child-node menu for text, AI response, managed text, and task nodes", () => {
    const menuSource = readProjectFile("components/zenme/canvas/menus.tsx");

    expect(menuSource).toContain('actionNode?.data.kind === "text" ||');
    expect(menuSource).toContain('actionNode?.data.kind === "agent"');
    expect(menuSource).toContain('actionNode?.data.kind === "managedText"');
    expect(menuSource).toContain('actionNode?.data.kind === "task"');
    expect(menuSource).toContain("includeUpload={false}");
    expect(menuSource).toContain('title="文本"');
    expect(menuSource).toContain('title="图片"');
    expect(menuSource).toContain('title="管理"');
    expect(menuSource).toContain('title="任务"');
  });
});
