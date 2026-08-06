import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bookNodeSource = readFileSync(
  new URL("./book-node.tsx", import.meta.url),
  "utf8",
);
const musicNodeSource = readFileSync(
  new URL("./music-node.tsx", import.meta.url),
  "utf8",
);

describe("music node layout", () => {
  it("uses the same compact frame and leading icon size as book nodes", () => {
    expect(bookNodeSource).toContain('className="w-72 p-4"');
    expect(bookNodeSource).toContain('className="flex size-12');
    expect(musicNodeSource).toContain("className={`w-72 p-4");
    expect(musicNodeSource).toContain('className="flex size-12');
    expect(musicNodeSource).not.toContain("h-28");
    expect(musicNodeSource).not.toContain("w-[360px]");
  });
});
