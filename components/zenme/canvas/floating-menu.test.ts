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
});
