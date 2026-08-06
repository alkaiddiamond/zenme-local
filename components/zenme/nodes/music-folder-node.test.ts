import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./music-folder-node.tsx", import.meta.url),
  "utf8",
);

describe("music folder node", () => {
  it("behaves like a compact folder that opens into a file list", () => {
    expect(source).toContain("onDoubleClick");
    expect(source).toContain("zenme-text-node-floating-actions");
    expect(source).toContain('className="zenme-node-drag-surface flex items-center');
    expect(source).toContain('className="zenme-node-drag-surface flex h-12');
    expect(source).toContain('className="zenme-node-drag-surface nowheel"');
    expect(source).toContain('expanded ? "right-3 top-2.5" : "right-3 top-1/2 -translate-y-1/2"');
    expect(source).toContain('className="flex size-7 shrink-0');
    expect(source).toContain('<Maximize2 className="size-4" />');
    expect(source).toContain('<Minimize2 className="size-4" />');
    expect(source).toContain('role="listbox"');
    expect(source).toContain("名称");
    expect(source).toContain("类型");
    expect(source).toContain("大小");
    expect(source).toContain("musicFolderPath");
    expect(source).toContain("此文件夹为空");
  });

  it("uses empty list space as a drag surface while keeping file rows interactive", () => {
    expect(source).toContain('className="zenme-node-drag-surface nowheel"');
    expect(source).toContain('className={`nodrag flex h-9');
    expect(source).not.toContain('className="nodrag nowheel"\n            contentKey');
  });

  it("keeps the outward connection handle outside the clipped content area", () => {
    expect(source).toContain('<NodeEdgeSourceHandle');
    expect(source).toContain('revealOnHover');
    expect(source).toContain('visible={Boolean(node.hasOutgoingEdge)}');
    expect(source).toContain('<NodeActionHandle selected={Boolean(selected)} />');
    expect(source).not.toContain('expanded ? "w-[460px] overflow-hidden"');
    expect(source).toContain('className="nowheel overflow-hidden rounded-xl"');
  });
});
