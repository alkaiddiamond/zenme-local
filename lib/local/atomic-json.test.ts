import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readJsonFile, replaceFileWithRetry, writeJsonFile } from "@/lib/local/atomic-json";

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

  it("retries transient Windows rename failures with bounded backoff", async () => {
    const attempts: string[] = [];
    const delays: number[] = [];
    await replaceFileWithRetry("source.tmp", "session.json", {
      rename: async () => {
        attempts.push("rename");
        if (attempts.length < 3) throw Object.assign(new Error("locked"), { code: "EPERM" });
      },
      wait: async (delayMs) => { delays.push(delayMs); },
    });

    expect(attempts).toHaveLength(3);
    expect(delays).toEqual([20, 50]);
  });

  it("does not retry permanent rename failures", async () => {
    let attempts = 0;
    await expect(replaceFileWithRetry("source.tmp", "session.json", {
      rename: async () => {
        attempts += 1;
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      wait: async () => undefined,
    })).rejects.toMatchObject({ code: "ENOENT" });
    expect(attempts).toBe(1);
  });
});
