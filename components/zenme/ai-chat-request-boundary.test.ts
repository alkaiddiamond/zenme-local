import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();
const SEARCH_ROOT = path.join(ROOT_DIR, "components/zenme");
const ALLOWED_FILES = new Set([
  "components/zenme/ai-chat-request.ts",
  "components/zenme/ai-chat-request.test.ts",
]);

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      return listSourceFiles(fullPath);
    }

    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) {
      return [];
    }

    return [fullPath];
  });
}

function toProjectPath(filePath: string) {
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, "/");
}

describe("AI chat request boundary", () => {
  it("keeps direct AI chat endpoint usage inside the shared request helper", () => {
    const offenders = listSourceFiles(SEARCH_ROOT)
      .map((filePath) => ({
        filePath: toProjectPath(filePath),
        source: readFileSync(filePath, "utf8"),
      }))
      .filter(
        ({ filePath, source }) =>
          source.includes("/api/ai/chat") && !ALLOWED_FILES.has(filePath),
      )
      .map(({ filePath }) => filePath);

    expect(offenders).toEqual([]);
  });
});
