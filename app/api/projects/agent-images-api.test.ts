import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/projects/[projectId]/agent-images/[executionId]/[fileName]/route";
import { getProjectDir } from "@/lib/local/data-dir";
import { resolveInside } from "@/lib/local/path-safety";

let dataDir: string;
const previousDataDir = process.env.ZENME_DATA_DIR;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-image-api-"));
  process.env.ZENME_DATA_DIR = dataDir;
});

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.ZENME_DATA_DIR;
  else process.env.ZENME_DATA_DIR = previousDataDir;
  await fs.rm(dataDir, { force: true, recursive: true, maxRetries: 3, retryDelay: 50 });
});

describe("Agent generated image API", () => {
  it("serves only the exact project execution artifact", async () => {
    const directory = resolveInside(getProjectDir("project-1", dataDir), "agent-generated-images", "execution-1");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(resolveInside(directory, "result.png"), Buffer.from("image"));

    const response = await GET(new Request("http://localhost/api/image"), {
      params: Promise.resolve({ projectId: "project-1", executionId: "execution-1", fileName: "result.png" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    await expect(response.text()).resolves.toBe("image");
  });

  it("rejects path traversal segments", async () => {
    const response = await GET(new Request("http://localhost/api/image"), {
      params: Promise.resolve({ projectId: "project-1", executionId: "..", fileName: "result.png" }),
    });
    expect(response.status).toBe(400);
  });
});
