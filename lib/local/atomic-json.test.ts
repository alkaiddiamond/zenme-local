import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-atomic-json-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("atomic json files", () => {
  it("writes and reads JSON", async () => {
    const filePath = path.join(tmpDir, "settings.json");
    await writeJsonFile(filePath, { version: 1, name: "Zenme" });

    await expect(
      readJsonFile(filePath, { defaultValue: { version: 0 } }),
    ).resolves.toEqual({ version: 1, name: "Zenme" });
  });

  it("quarantines invalid JSON and returns the default value", async () => {
    const filePath = path.join(tmpDir, "settings.json");
    await fs.writeFile(filePath, "{", "utf-8");

    await expect(
      readJsonFile(filePath, { defaultValue: { version: 1 } }),
    ).resolves.toEqual({ version: 1 });

    const files = await fs.readdir(tmpDir);
    expect(files.some((file) => file.startsWith("settings.json.invalid-"))).toBe(true);
  });
});

