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
const desktopMainSource = readFileSync(
  new URL("../../desktop/main.cjs", import.meta.url),
  "utf8",
);
const desktopPreloadSource = readFileSync(
  new URL("../../desktop/preload.cjs", import.meta.url),
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

  it("centers the delete-project warning dialog in the viewport", () => {
    expect(appShellSource).toMatch(
      /\{projectPendingDeletion \? \([\s\S]*?className="fixed inset-0 z-\[90\] flex items-center justify-center bg-black\/20"/,
    );
    expect(appShellSource).not.toContain(
      'className="fixed inset-0 z-[90] flex items-start justify-center bg-black/20 pt-24"',
    );
  });

  it("shows the restore icon while the desktop window is maximized", () => {
    expect(desktopMainSource).toContain('mainWindow.on("maximize"');
    expect(desktopMainSource).toContain('mainWindow.on("unmaximize"');
    expect(desktopMainSource).toContain('"zenme:is-window-maximized"');
    expect(desktopPreloadSource).toContain("isWindowMaximized:");
    expect(desktopPreloadSource).toContain("onWindowMaximizedChange:");
    expect(appShellSource).toContain(
      'aria-label={isWindowMaximized ? "还原" : "最大化"}',
    );
    expect(appShellSource).toContain('<Copy className="size-3.5" />');
    expect(appShellSource).toContain('<Square className="size-3.5" />');
  });

  it("uses native macOS traffic light controls instead of custom window controls", () => {
    expect(desktopPreloadSource).toContain("platform: process.platform");
    expect(appShellSource).toContain(
      'const isMacDesktop = desktopPlatform === "darwin"',
    );
    expect(appShellSource).toContain("desktopPlatform !== null && !isMacDesktop");
    expect(appShellSource).toContain("{showCustomWindowControls ? (");
  });

  it("reserves titlebar space for macOS traffic light controls", () => {
    expect(appShellSource).toContain("const MAC_COLLAPSED_SIDEBAR_WIDTH = 112");
    expect(appShellSource).toContain("? MAC_COLLAPSED_SIDEBAR_WIDTH");
    expect(appShellSource).toContain('isMacDesktop && "justify-start pl-[76px]"');
  });
});
