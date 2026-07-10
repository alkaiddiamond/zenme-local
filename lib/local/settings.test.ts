import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getLocalSettings,
  getLocalSettingsPath,
  updateLocalSettings,
} from "@/lib/local/settings";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-settings-"));
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("local settings", () => {
  it("returns defaults and persists updates to settings.json", async () => {
    await expect(getLocalSettings(dataDir)).resolves.toMatchObject({
      autoSaveIntervalMs: 30000,
      dataDir,
      enableCloudSyncExperimental: false,
      enableSnapshotHistory: false,
      language: "zh-CN",
      theme: "system",
      version: 1,
    });

    const settings = await updateLocalSettings({
      autoSaveIntervalMs: 1000,
      enableSnapshotHistory: true,
      theme: "dark",
    }, dataDir);

    expect(settings).toMatchObject({
      autoSaveIntervalMs: 5000,
      enableSnapshotHistory: true,
      theme: "dark",
    });
    await expect(
      fs.readFile(getLocalSettingsPath(dataDir), "utf-8"),
    ).resolves.toContain('"enableSnapshotHistory": true');
  });
});

