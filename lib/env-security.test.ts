import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();
const PUBLIC_SECRET_NAME_PATTERN =
  /^NEXT_PUBLIC_.*(?:SERVICE_ROLE|SECRET|TOKEN|PASSWORD|PRIVATE|ADMIN)/i;

function readProjectFile(filePath: string) {
  return readFileSync(path.join(ROOT_DIR, filePath), "utf8");
}

function publicEnvNamesFromSource(source: string) {
  return Array.from(source.matchAll(/\bNEXT_PUBLIC_[A-Z0-9_]+\b/g)).map(
    ([name]) => name,
  );
}

function sourceFilesUnder(relativeDir: string): string[] {
  const absoluteDir = path.join(ROOT_DIR, relativeDir);

  if (!existsSync(absoluteDir)) {
    return [];
  }

  return readdirSync(absoluteDir).flatMap((entry) => {
    const absolutePath = path.join(absoluteDir, entry);
    const relativePath = path.relative(ROOT_DIR, absolutePath).replace(/\\/g, "/");

    if (entry === "node_modules" || entry === ".next") {
      return [];
    }

    if (statSync(absolutePath).isDirectory()) {
      return sourceFilesUnder(relativePath);
    }

    return /\.(?:ts|tsx|mjs|js|jsx)$/.test(entry) ? [relativePath] : [];
  });
}

describe("environment variable security", () => {
  it("does not define sensitive values as public env vars in .env.example", () => {
    const envExample = readProjectFile(".env.example");
    const publicEnvNames = envExample
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=")[0]?.trim())
      .filter((name): name is string => Boolean(name?.startsWith("NEXT_PUBLIC_")));

    expect(publicEnvNames.filter((name) => PUBLIC_SECRET_NAME_PATTERN.test(name))).toEqual(
      [],
    );
  });

  it("does not reference sensitive public env vars from source code", () => {
    const checkedFiles = ["app", "components", "lib", "scripts"].flatMap(sourceFilesUnder);
    const unsafeNames = checkedFiles.flatMap((filePath) =>
      publicEnvNamesFromSource(readProjectFile(filePath))
        .filter((name) => PUBLIC_SECRET_NAME_PATTERN.test(name))
        .map((name) => `${filePath}: ${name}`),
    );

    expect(unsafeNames).toEqual([]);
  });
});
