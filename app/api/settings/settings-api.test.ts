import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, PATCH } from "@/app/api/settings/route";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-settings-api-"));
  process.env.ZENME_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("settings API", () => {
  it("reads and updates local settings", async () => {
    const getResponse = await GET();
    expect(await getResponse.json()).toMatchObject({
      mode: "local",
      settings: {
        dataDir,
        autoSaveIntervalMs: 5000,
      },
    });

    const patchResponse = await PATCH(
      new Request("http://localhost/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          autoSaveIntervalMs: 45000,
          theme: "dark",
          lastImageAspectRatio: "auto",
          lastImageQuality: "1K",
          lastTextModelId: "glm-5.2",
        }),
      }),
    );

    expect(await patchResponse.json()).toMatchObject({
      mode: "local",
      settings: {
        autoSaveIntervalMs: 45000,
        theme: "dark",
        lastImageAspectRatio: "auto",
        lastImageQuality: "1K",
        lastTextModelId: "glm-5.2",
      },
    });
  });
});
