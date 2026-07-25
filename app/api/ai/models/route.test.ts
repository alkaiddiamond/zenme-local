import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/ai/models/route";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-models-api-"));
  process.env.ZENME_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("AI models API", () => {
  it.each(["text", "image"])(
    "returns no %s models when no provider is configured",
    async (modality) => {
      const response = await GET(
        new Request(`http://127.0.0.1/api/ai/models?modality=${modality}`),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: [],
        preferredModelId: null,
      });
    },
  );
});
