import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootLayoutSource = readFileSync(
  new URL("../../app/layout.tsx", import.meta.url),
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
});
