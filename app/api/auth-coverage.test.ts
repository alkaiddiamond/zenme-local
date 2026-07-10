import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();
const API_DIR = path.join(ROOT_DIR, "app", "api");
const SENSITIVE_API_DIRS = ["ai", "reading"];
const AUTH_HELPER_PATTERN =
  /\b(requireUser|requireProjectAccess|requireReadingAssetAccess|requireReadingNoteAccess)\b/;
const AUTH_ERROR_RESPONSE_PATTERN = /\bauthErrorResponse\b/;

function sourceFilesUnder(relativeDir: string): string[] {
  const absoluteDir = path.join(ROOT_DIR, relativeDir);

  return readdirSync(absoluteDir).flatMap((entry) => {
    const absolutePath = path.join(absoluteDir, entry);
    const relativePath = path.relative(ROOT_DIR, absolutePath).replace(/\\/g, "/");

    if (statSync(absolutePath).isDirectory()) {
      return sourceFilesUnder(relativePath);
    }

    return entry === "route.ts" ? [relativePath] : [];
  });
}

function sensitiveApiRouteFiles() {
  return SENSITIVE_API_DIRS.flatMap((dirName) =>
    sourceFilesUnder(path.relative(ROOT_DIR, path.join(API_DIR, dirName))),
  );
}

describe("sensitive API auth coverage", () => {
  it("requires every AI and reading route to call a Supabase auth helper", () => {
    const missingAuthHelpers = sensitiveApiRouteFiles().filter((filePath) => {
      const source = readFileSync(path.join(ROOT_DIR, filePath), "utf8");

      return !AUTH_HELPER_PATTERN.test(source);
    });

    expect(missingAuthHelpers).toEqual([]);
  });

  it("maps auth helper errors through authErrorResponse in every sensitive route", () => {
    const missingAuthErrorHandling = sensitiveApiRouteFiles().filter((filePath) => {
      const source = readFileSync(path.join(ROOT_DIR, filePath), "utf8");

      return !AUTH_ERROR_RESPONSE_PATTERN.test(source);
    });

    expect(missingAuthErrorHandling).toEqual([]);
  });
});
