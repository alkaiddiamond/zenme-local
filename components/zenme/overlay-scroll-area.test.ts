import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = new URL("../../", import.meta.url);
const scrollClassPattern = /overflow-(?:auto|scroll|x-auto|y-auto|x-scroll|y-scroll)/;

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectSourceFiles(path);
    }

    return extname(entry.name) === ".tsx" && !entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });
}

describe("system scroll containers", () => {
  it("uses overlay scrollbars for every explicit application scroll container", () => {
    const roots = ["app", "components"].map(
      (directory) => fileURLToPath(new URL(`${directory}/`, sourceRoot)),
    );
    const unmanagedScrollContainers = roots
      .flatMap(collectSourceFiles)
      .flatMap((path) =>
        readFileSync(path, "utf8")
          .split(/\r?\n/)
          .map((line, index) => ({ line, lineNumber: index + 1, path }))
          .filter(({ line }) => scrollClassPattern.test(line))
          .filter(
            ({ line }) =>
              !line.includes("zenme-overlay-scroll-container") &&
              !line.includes("viewportClassName="),
          ),
      )
      .map(({ line, lineNumber, path }) => `${path}:${lineNumber}: ${line.trim()}`);

    expect(unmanagedScrollContainers).toEqual([]);
  });

  it("hides native scrollbars globally instead of only inside the canvas", () => {
    const globalStyles = readFileSync(
      new URL("../../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(globalStyles).toContain(".zenme-overlay-scroll-container {");
    expect(globalStyles).toContain(
      ".zenme-overlay-scroll-container::-webkit-scrollbar",
    );
    expect(globalStyles).not.toContain(
      ".zenme-canvas .zenme-overlay-scroll-container",
    );
  });
});
