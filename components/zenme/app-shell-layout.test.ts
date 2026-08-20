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

  it("keeps the continuous global agent alive at app scope instead of canvas scope", () => {
    const canvasSource = readFileSync(
      new URL("./canvas-client.tsx", import.meta.url),
      "utf8",
    );

    expect(appShellSource).toContain("<ContinuousGlobalAgentSupervisor");
    expect(appShellSource).toContain("projects.map((project) => project.id)");
    expect(canvasSource).not.toContain("ContinuousGlobalAgentDriver");
  });

  it("places new-project creation beside the project heading and reveals it on hover", () => {
    expect(appShellSource).toContain('className="group mb-2 flex h-7 items-center justify-between');
    expect(appShellSource).toContain('aria-label="新建项目"');
    expect(appShellSource).toContain("group-hover:pointer-events-auto group-hover:opacity-100");
    expect(appShellSource).toContain('<Plus aria-hidden="true" className="size-4" strokeWidth={1.6} />');
    expect(appShellSource).not.toContain("新建项目\n          </button>");
    expect(appShellSource).toMatch(/href="\/projects"[\s\S]{0,120}>\s*全部\s*<\/Link>[\s\S]{0,220}aria-label="新建项目"/);
  });

  it("labels the project index tab as all projects and allows closing it", () => {
    expect(appShellSource).toContain('label: "全部项目"');
    expect(appShellSource).toContain('if (tab.id === "projects")');
    expect(appShellSource).toContain('aria-label={`关闭 ${tab.label}`}');
    expect(appShellSource).toContain("onClick={closeTransientTab}");
    expect(appShellSource).toMatch(
      /function closeProjectTab[\s\S]*?persistOpenProjectIds\(nextIds\);\s*router\.push\("\/"\);/,
    );
    expect(appShellSource).toMatch(
      /function closeTransientTab\(\) \{\s*router\.push\("\/"\);/,
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
