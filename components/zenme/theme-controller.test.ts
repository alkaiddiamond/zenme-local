import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const controllerSource = readFileSync(
  new URL("./theme-controller.tsx", import.meta.url),
  "utf8",
);
const layoutSource = readFileSync(
  new URL("../../app/layout.tsx", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);
const readingTocSource = readFileSync(
  new URL("./reading/reading-toc-sidebar.tsx", import.meta.url),
  "utf8",
);

describe("theme controller", () => {
  it("restores and applies the persisted warm eye-care theme before hydration", () => {
    expect(controllerSource).toContain('cachedTheme === "warm"');
    expect(controllerSource).toContain('persistedTheme !== "warm"');
    expect(layoutSource).toContain("s==='warm'");
    expect(globalStyles).toContain(':root[data-theme="warm"]');
    expect(globalStyles).toContain('.zenme-theme-preview[data-preview-theme="warm"]');
    expect(globalStyles).toContain(
      'html[data-theme="warm"] .zenme-reading-toc-item[data-active="true"]',
    );
    expect(globalStyles).toContain("color: var(--color-text-primary) !important;");
    expect(readingTocSource).toContain("zenme-reading-toc-item");
    expect(readingTocSource).toContain('data-active={isActive ? "true" : undefined}');
    expect(readingTocSource).toContain(
      "{isActive ? activeSection + 1 : section.pageNumber}",
    );
  });
});
