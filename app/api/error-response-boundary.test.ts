import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();
const API_ROOT = path.join(ROOT_DIR, "app/api");
const FORBIDDEN_ERROR_RESPONSE_SNIPPETS = [
  "error.message",
  "payload?.error?.message",
  "payload?.message",
];

function listApiRouteFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      return listApiRouteFiles(fullPath);
    }

    return entry === "route.ts" ? [fullPath] : [];
  });
}

function toProjectPath(filePath: string) {
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, "/");
}

describe("API error response boundary", () => {
  it("does not echo raw provider or Error.message values from API routes", () => {
    const offenders = listApiRouteFiles(API_ROOT)
      .map((filePath) => ({
        filePath: toProjectPath(filePath),
        source: readFileSync(filePath, "utf8"),
      }))
      .flatMap(({ filePath, source }) =>
        FORBIDDEN_ERROR_RESPONSE_SNIPPETS.filter((snippet) =>
          source.includes(snippet),
        ).map((snippet) => `${filePath}: ${snippet}`),
      );

    expect(offenders).toEqual([]);
  });
});
