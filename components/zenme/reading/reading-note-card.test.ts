import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./reading-note-card.tsx", import.meta.url),
  "utf8",
);

describe("reading note card typography", () => {
  it("keeps excerpts and comments compact in the annotation sidebar", () => {
    expect(source).toContain('className="text-xs leading-[1.6] text-zinc-800"');
    expect(source).toContain('text-[11px] leading-4 text-zinc-500');
  });

  it("sizes editing fields from their content instead of fixed heights", () => {
    expect(source).toContain("resizeTextareaToContent");
    expect(source).toContain("min-h-24 w-full");
    expect(source).toContain("min-h-16 w-full");
    expect(source).not.toContain('className="h-24 w-full');
    expect(source).not.toContain('className="mt-2 h-16 w-full');
  });
});
