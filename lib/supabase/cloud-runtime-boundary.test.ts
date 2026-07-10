import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();
const CHECKED_DIRS = ["app", "components", "lib", "scripts"];
const CLOUD_RUNTIME_FORBIDDEN_PATTERNS = [
  /\bsqlite\b/i,
  /\bsqlite-repository\b/i,
  /\bbetter-sqlite\b/i,
  /\bzenme\.project\.local\b/i,
  /\bzenme\.canvas\.local\b/i,
  /\bzenme-project-snapshot\b/i,
];

function sourceFilesUnder(relativeDir: string): string[] {
  const absoluteDir = path.join(ROOT_DIR, relativeDir);

  return readdirSync(absoluteDir).flatMap((entry) => {
    const absolutePath = path.join(absoluteDir, entry);
    const relativePath = path.relative(ROOT_DIR, absolutePath).replace(/\\/g, "/");

    if (statSync(absolutePath).isDirectory()) {
      return sourceFilesUnder(relativePath);
    }

    if (!/\.(?:ts|tsx|mjs|js|jsx)$/.test(entry)) {
      return [];
    }

    return /\.(?:test|spec)\.(?:ts|tsx|mjs|js|jsx)$/.test(entry) ? [] : [relativePath];
  });
}

describe("Supabase cloud runtime boundary", () => {
  it("does not reintroduce SQLite or local project snapshot fallbacks", () => {
    const violations = CHECKED_DIRS.flatMap(sourceFilesUnder).flatMap((filePath) => {
      const source = readFileSync(path.join(ROOT_DIR, filePath), "utf8");
      const matchedPattern = CLOUD_RUNTIME_FORBIDDEN_PATTERNS.find((pattern) =>
        pattern.test(source),
      );

      return matchedPattern ? [`${filePath}: ${matchedPattern}`] : [];
    });

    expect(violations).toEqual([]);
  });
});
