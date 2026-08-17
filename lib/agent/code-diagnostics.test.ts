import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectTypeScriptDiagnostics } from "@/lib/agent/code-diagnostics";

let rootPath: string;

beforeEach(async () => {
  rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-code-diagnostics-"));
});

afterEach(async () => {
  await fs.rm(rootPath, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
});

describe("code diagnostics", () => {
  it("returns structured TypeScript diagnostics with workspace-relative locations", async () => {
    await fs.mkdir(path.join(rootPath, "src"));
    await fs.writeFile(path.join(rootPath, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", skipLibCheck: true },
      include: ["src/**/*.ts"],
    }));
    await fs.writeFile(path.join(rootPath, "src", "index.ts"), "const count: number = 'wrong';\n");

    const result = await collectTypeScriptDiagnostics({ rootPath });

    expect(result).toMatchObject({
      available: true,
      configPath: "tsconfig.json",
      errorCount: 1,
      fileCount: 1,
    });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 2322, file: "src/index.ts", line: 1, severity: "error" }),
    ]));
  });

  it("can scope visible diagnostics to selected files without dropping project semantics", async () => {
    await fs.mkdir(path.join(rootPath, "src"));
    await fs.writeFile(path.join(rootPath, "tsconfig.json"), JSON.stringify({ include: ["src/**/*.ts"] }));
    await fs.writeFile(path.join(rootPath, "src", "a.ts"), "const a: number = 'a';\n");
    await fs.writeFile(path.join(rootPath, "src", "b.ts"), "const b: number = 'b';\n");

    const result = await collectTypeScriptDiagnostics({ rootPath, relativePaths: ["src/a.ts"] });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ file: "src/a.ts", code: 2322 }),
    ]);
    expect(result.errorCount).toBe(1);
  });

  it("checks proposed overlay content that has not been written to disk", async () => {
    await fs.mkdir(path.join(rootPath, "src"));
    await fs.writeFile(path.join(rootPath, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true },
      include: ["src/**/*.ts"],
    }));
    await fs.writeFile(path.join(rootPath, "src", "index.ts"), "export const value: number = 1;\n");

    const result = await collectTypeScriptDiagnostics({
      rootPath,
      overlays: {
        "src/index.ts": "export const value: number = 'proposed';\n",
        "src/new.ts": "export const created: boolean = 42;\n",
      },
    });

    expect(result.errorCount).toBe(2);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "src/index.ts", code: 2322 }),
      expect.objectContaining({ file: "src/new.ts", code: 2322 }),
    ]));
    await expect(fs.readFile(path.join(rootPath, "src", "index.ts"), "utf8"))
      .resolves.toContain("= 1");
    await expect(fs.stat(path.join(rootPath, "src", "new.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports unsupported projects without treating the absence as a tool failure", async () => {
    await fs.writeFile(path.join(rootPath, "README.md"), "plain workspace\n");

    await expect(collectTypeScriptDiagnostics({ rootPath })).resolves.toMatchObject({
      available: false,
      diagnostics: [],
      reason: expect.stringContaining("tsconfig.json"),
    });
  });

  it("rejects config and target paths outside the workspace", async () => {
    await expect(collectTypeScriptDiagnostics({ rootPath, configPath: "../tsconfig.json" }))
      .rejects.toThrow("Workspace");
    await expect(collectTypeScriptDiagnostics({ rootPath, relativePaths: ["../outside.ts"] }))
      .rejects.toThrow("Workspace");
  });

  it("bounds the visible problem list while preserving total counts", async () => {
    await fs.mkdir(path.join(rootPath, "src"));
    await fs.writeFile(path.join(rootPath, "tsconfig.json"), JSON.stringify({ include: ["src/**/*.ts"] }));
    await fs.writeFile(path.join(rootPath, "src", "index.ts"), [
      "const a: number = 'a';",
      "const b: number = 'b';",
      "const c: number = 'c';",
    ].join("\n"));

    const result = await collectTypeScriptDiagnostics({ rootPath, maxProblems: 2 });

    expect(result.diagnostics).toHaveLength(2);
    expect(result.errorCount).toBe(3);
    expect(result.truncated).toBe(true);
  });
});
