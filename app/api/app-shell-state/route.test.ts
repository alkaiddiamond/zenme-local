import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, PATCH } from "@/app/api/app-shell-state/route";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-app-shell-api-"));
  process.env.ZENME_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("app shell state API", () => {
  it("persists favorites through PATCH and GET", async () => {
    const patchResponse = await PATCH(
      new Request("http://localhost/api/app-shell-state", {
        method: "PATCH",
        body: JSON.stringify({ favoriteProjectIds: ["project-a"] }),
      }),
    );
    expect(patchResponse.status).toBe(200);

    const getResponse = await GET();
    expect(await getResponse.json()).toMatchObject({
      state: { favoriteProjectIds: ["project-a"] },
    });
  });
});
