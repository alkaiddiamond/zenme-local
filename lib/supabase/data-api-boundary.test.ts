import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();
const CHECKED_DIRS = ["app", "components", "lib", "scripts"];
const RAW_DATA_API_PATTERNS = [
  /\/rest\/v1(?:[/'"`\s?#]|$)/i,
  /\bswagger\b/i,
  /\bopenapi\b/i,
];

function sourceFilesUnder(relativeDir: string): string[] {
  const absoluteDir = path.join(ROOT_DIR, relativeDir);

  return readdirSync(absoluteDir).flatMap((entry) => {
    const absolutePath = path.join(absoluteDir, entry);
    const relativePath = path.relative(ROOT_DIR, absolutePath).replace(/\\/g, "/");

    if (statSync(absolutePath).isDirectory()) {
      return sourceFilesUnder(relativePath);
    }

    return /\.(?:ts|tsx|mjs|js|jsx)$/.test(entry) ? [relativePath] : [];
  });
}

describe("Supabase Data API boundary", () => {
  it("does not hand-roll REST root/schema requests from source code", () => {
    const directDataApiRequests = CHECKED_DIRS.flatMap(sourceFilesUnder).flatMap(
      (filePath) => {
        const source = readFileSync(path.join(ROOT_DIR, filePath), "utf8");

        return RAW_DATA_API_PATTERNS.some((pattern) => pattern.test(source))
          ? [filePath]
          : [];
      },
    );

    expect(directDataApiRequests).toEqual([]);
  });
});
