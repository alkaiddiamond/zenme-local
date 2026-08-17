import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { queryTypeScriptCodeIntelligence } from "@/lib/agent/code-intelligence";

let rootPath: string;

beforeEach(async () => {
  rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-code-intelligence-"));
  await fs.mkdir(path.join(rootPath, "src"));
  await fs.writeFile(path.join(rootPath, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, target: "ES2022", module: "CommonJS" },
    include: ["src/**/*.ts"],
  }));
  await fs.writeFile(path.join(rootPath, "src", "math.ts"), [
    "/** Add two numbers. */",
    "export function add(left: number, right: number) {",
    "  return left + right;",
    "}",
    "",
  ].join("\n"));
  await fs.writeFile(path.join(rootPath, "src", "index.ts"), [
    "import { add } from './math';",
    "export function calculate() {",
    "  return add(1, 2);",
    "}",
    "export function caller() {",
    "  return calculate();",
    "}",
    "",
  ].join("\n"));
  await fs.writeFile(path.join(rootPath, "src", "worker.ts"), [
    "export interface Worker {",
    "  run(): number;",
    "}",
    "export class Engine implements Worker {",
    "  run() { return 1; }",
    "}",
    "",
  ].join("\n"));
});

afterEach(async () => {
  await fs.rm(rootPath, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
});

describe("TypeScript code intelligence", () => {
  it("finds definitions, references, hover details and symbols with relative locations", async () => {
    await expect(queryTypeScriptCodeIntelligence({
      rootPath,
      operation: "goToDefinition",
      filePath: "src/index.ts",
      line: 3,
      character: 10,
    })).resolves.toMatchObject({
      available: true,
      items: [expect.objectContaining({ file: "src/math.ts", line: 2, name: "add" })],
    });

    const references = await queryTypeScriptCodeIntelligence({
      rootPath,
      operation: "findReferences",
      filePath: "src/math.ts",
      line: 2,
      character: 17,
    });
    expect(references.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "src/math.ts", line: 2, display: "definition" }),
      expect.objectContaining({ file: "src/index.ts", line: 1 }),
      expect.objectContaining({ file: "src/index.ts", line: 3 }),
    ]));

    await expect(queryTypeScriptCodeIntelligence({
      rootPath,
      operation: "hover",
      filePath: "src/index.ts",
      line: 3,
      character: 10,
    })).resolves.toMatchObject({
      items: [expect.objectContaining({
        display: expect.stringContaining("add"),
        documentation: expect.stringContaining("Add two numbers"),
      })],
    });

    await expect(queryTypeScriptCodeIntelligence({
      rootPath,
      operation: "documentSymbol",
      filePath: "src/index.ts",
      line: 1,
      character: 1,
    })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ name: "calculate", file: "src/index.ts" })]),
    });

    await expect(queryTypeScriptCodeIntelligence({
      rootPath,
      operation: "workspaceSymbol",
      filePath: "src/index.ts",
      line: 2,
      character: 17,
      query: "add",
    })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ name: "add", file: "src/math.ts" })]),
    });
  });

  it("returns implementations and call hierarchy operations", async () => {
    await expect(queryTypeScriptCodeIntelligence({
      rootPath,
      operation: "goToImplementation",
      filePath: "src/worker.ts",
      line: 2,
      character: 3,
    })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ file: "src/worker.ts", line: 5 })]),
    });

    await expect(queryTypeScriptCodeIntelligence({
      rootPath,
      operation: "prepareCallHierarchy",
      filePath: "src/index.ts",
      line: 2,
      character: 17,
    })).resolves.toMatchObject({
      items: [expect.objectContaining({ name: "calculate", file: "src/index.ts" })],
    });

    await expect(queryTypeScriptCodeIntelligence({
      rootPath,
      operation: "incomingCalls",
      filePath: "src/index.ts",
      line: 2,
      character: 17,
    })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ name: "caller", file: "src/index.ts" })]),
    });

    await expect(queryTypeScriptCodeIntelligence({
      rootPath,
      operation: "outgoingCalls",
      filePath: "src/index.ts",
      line: 2,
      character: 17,
    })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ name: "add", file: "src/math.ts" })]),
    });
  });

  it("uses proposed ChangeSet overlays before they reach disk", async () => {
    const overlayResult = await queryTypeScriptCodeIntelligence({
      rootPath,
      operation: "goToDefinition",
      filePath: "src/index.ts",
      line: 2,
      character: 23,
      overlays: {
        "src/index.ts": "import { multiply } from './multiply';\nexport const value = multiply(2, 3);\n",
        "src/multiply.ts": "export function multiply(left: number, right: number) { return left * right; }\n",
      },
    });
    expect(overlayResult.available).toBe(true);
    expect(overlayResult.items).toEqual([
      expect.objectContaining({ file: "src/multiply.ts", line: 1, name: "multiply" }),
    ]);
    await expect(fs.stat(path.join(rootPath, "src", "multiply.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects paths and positions outside the declared workspace boundary", async () => {
    await expect(queryTypeScriptCodeIntelligence({
      rootPath,
      operation: "hover",
      filePath: "../outside.ts",
      line: 1,
      character: 1,
    })).rejects.toThrow("相对路径");
    await expect(queryTypeScriptCodeIntelligence({
      rootPath,
      operation: "hover",
      filePath: "src/index.ts",
      line: 999,
      character: 1,
    })).rejects.toThrow("只有");
  });
});
