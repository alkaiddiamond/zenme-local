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
      autoSaveIntervalMs: 5000,
      dataDir,
      version: 1,
    });

    const settings = await updateLocalSettings({
      autoSaveIntervalMs: 1000,
      lastTextModelId: "glm-5.2",
    }, dataDir);

    expect(settings).toMatchObject({
      autoSaveIntervalMs: 5000,
      lastTextModelId: "glm-5.2",
    });
    await expect(
      fs.readFile(getLocalSettingsPath(dataDir), "utf-8"),
    ).resolves.toContain('"lastTextModelId": "glm-5.2"');
  });
});
