import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootLayoutSource = readFileSync(
  new URL("../../app/layout.tsx", import.meta.url),
  "utf8",
);

const appShellSource = readFileSync(
  new URL("./app-shell.tsx", import.meta.url),
  "utf8",
);

const pageSources = [
  "../../app/page.tsx",
  "../../app/projects/page.tsx",
  "../../app/projects/[id]/page.tsx",
  "../../app/settings/page.tsx",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

describe("persistent app shell", () => {
  it("mounts the app shell once in the root layout", () => {
    expect(rootLayoutSource).toContain("<AppShell>{children}</AppShell>");
    expect(rootLayoutSource).toContain("<Suspense fallback={null}>");
    for (const source of pageSources) {
      expect(source).not.toContain("<AppShell");
    }
  });

  it("keeps the sidebar title area draggable without swallowing its controls", () => {
    expect(appShellSource).toMatch(
      /<aside[\s\S]*?style=\{\{ width: sidebarWidth \}\}[\s\S]*?<div[\s\S]*?data-desktop-drag-region/,
    );
    expect(appShellSource).not.toMatch(
      /<aside[\s\S]*?data-desktop-no-drag[\s\S]*?style=\{\{ width: sidebarWidth \}\}/,
    );
    expect(appShellSource).toMatch(
      /<button[\s\S]*?aria-label=\{isSidebarCollapsed[\s\S]*?data-desktop-no-drag/,
    );
    expect(appShellSource).toMatch(
      /<Link[\s\S]*?data-desktop-no-drag[\s\S]*?title="Zenme"/,
    );
  });
});
