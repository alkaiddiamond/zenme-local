import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("task node metadata controls", () => {
  const source = readFileSync(
    new URL("./nodes/task-node.tsx", import.meta.url),
    "utf8",
  );

  it("uses compact option menus instead of select controls", () => {
    expect(source).toContain("TaskOptionMenu");
    expect(source).not.toContain("<select");
  });

  it("keeps only the three supported task statuses", () => {
    expect(source).toContain('label: "进行中"');
    expect(source).toContain('label: "暂停"');
    expect(source).toContain('label: "完成"');
    expect(source).not.toContain('label: "放弃"');
    expect(source).not.toContain('label: "归档"');
  });

  it("keeps all priority, complexity, and urgency choices in horizontal icon menus", () => {
    expect(source).toContain("<DropdownMenuContent");
    expect(source).toContain("PriorityIcon");
    expect(source).toContain('"1": "bg-red-500"');
    expect(source).toContain('"2": "bg-amber-400"');
    expect(source).toContain('"3": "bg-blue-500"');
    expect(source).toContain("UrgencyIcon");
    expect(source).not.toContain('<span className="text-sm">{option.label}</span>');
    for (const content of ["中", "简", "繁"]) {
      expect(source).toContain(`content: "${content}"`);
    }
    for (const symbol of ["🧍", "🚶", "🏃"]) {
      expect(source).toContain(`symbol="${symbol}"`);
    }
  });

  it("renders progress as an unlabeled circular indicator", () => {
    expect(source).toContain("TaskProgressRing");
    expect(source).toContain('role="progressbar"');
    expect(source).toContain("stroke-emerald-500");
    expect(source).toContain("text-emerald-700");
    expect(source).not.toContain(">执行进度<");
  });

  it("shows completed child count and supports collapsing the child list", () => {
    expect(source).toContain("completedChildrenCount");
    expect(source).toContain("{completedChildrenCount}/{children.length}");
    expect(source).toContain("isChildrenExpanded");
    expect(source).toContain('aria-label={isChildrenExpanded ? "收起子任务" : "展开子任务"}');
    expect(source).toContain("<ChevronUp");
    expect(source).toContain("<ChevronDown");
    expect(source).toContain("headerRef.current?.getBoundingClientRect().height");
    expect(source).toContain("nodeData.onToggleTaskChildren");
    expect(source).toContain("getBoundingClientRect().height ?? 0) + 36");
    expect(source).toContain('isVisible={Boolean(selected)}');
    expect(source).toContain("minHeight={isChildrenExpanded ? 360 : 176}");
  });

  it("uses the same inset header surface as managed nodes", () => {
    expect(source).toContain(
      'className={`m-3 shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 ${',
    );
    expect(source).toContain('isChildrenExpanded ? "mb-0" : ""');
  });

  it("keeps only one metadata option menu open and closes it on deselect", () => {
    expect(source).toContain("activeOptionMenu");
    expect(source).toContain("if (!selected) setActiveOptionMenu(null)");
    expect(source).toContain("<DropdownMenu onOpenChange={onOpenChange} open={open}>");
  });
});
