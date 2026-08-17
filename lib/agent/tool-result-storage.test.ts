import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isPersistedAgentToolResult, persistAgentToolResultForModel } from "@/lib/agent/tool-result-storage";

let dataDir: string | undefined;

afterEach(async () => {
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

describe("cc-haha-style tool result persistence", () => {
  it("persists the complete oversized result and returns a readable bounded preview", async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-tool-results-"));
    const complete = Array.from({ length: 2_000 }, (_, index) => `${index}:${"x".repeat(80)}`).join("\n");
    const result = await persistAgentToolResultForModel({
      dataDir,
      name: "search_files",
      output: { matches: complete },
      projectId: "project-1",
      toolCallId: "tool-1",
    });

    expect(result).toMatchObject({
      persistedOutput: true,
      outputFilePath: expect.stringContaining("agent-tool-results"),
      originalSize: expect.any(Number),
      preview: expect.stringContaining("0:"),
    });
    if (!isPersistedAgentToolResult(result)) throw new Error("Expected persisted output");
    const stored = await fs.readFile(result.outputFilePath, "utf8");
    expect(stored).toContain("1999:");
    expect(stored.length).toBeGreaterThan(String(result.preview).length);
  });

  it("keeps Read results inline to avoid a persistence loop", async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-tool-results-"));
    const output = { content: "x".repeat(150_000) };
    await expect(persistAgentToolResultForModel({
      dataDir,
      name: "read_file",
      output,
      projectId: "project-1",
      toolCallId: "tool-1",
    })).resolves.toBe(output);
  });
});
