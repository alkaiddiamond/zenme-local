import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/settings/import-local/route";

let dataDir: string;
let tmpDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-import-api-data-"));
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-import-api-"));
  process.env.ZENME_DATA_DIR = dataDir;
  process.env.ZENME_STORAGE_DRIVER = "local";
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  delete process.env.ZENME_STORAGE_DRIVER;
  await fs.rm(dataDir, { force: true, recursive: true });
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("settings import local API", () => {
  it("imports zenme-export.zip into the configured local data directory", async () => {
    const zipPath = path.join(tmpDir, "zenme-export.zip");
    const zip = new AdmZip();
    zip.addFile(
      "projects.json",
      Buffer.from(
        JSON.stringify([
          {
            id: "project-import-api",
            name: "Imported API",
            prompt: "",
            model: "glm-4.5",
            created_at: "2026-07-08T00:00:00.000Z",
            updated_at: "2026-07-08T00:00:00.000Z",
          },
        ]),
      ),
    );
    zip.addFile(
      "reading_assets.json",
      Buffer.from(
        JSON.stringify([
          {
            id: "asset-import-api",
            project_id: "project-import-api",
            title: "Imported Book",
            format: "txt",
            file_name: "book.txt",
            storage_path: "user/project/reading/original/book.txt",
            created_at: "2026-07-08T00:00:00.000Z",
            updated_at: "2026-07-08T00:00:00.000Z",
          },
        ]),
      ),
    );
    zip.addFile("reading_files/user__project__reading__original__book.txt", Buffer.from("book"));
    zip.writeZip(zipPath);

    const formData = new FormData();
    formData.set(
      "file",
      new File([await fs.readFile(zipPath)], "zenme-export.zip", {
        type: "application/zip",
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/settings/import-local", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      summary: {
        projects: 1,
        readingAssets: 1,
      },
    });
    await expect(
      fs.readFile(
        path.join(dataDir, "projects", "project-import-api", "project.json"),
        "utf-8",
      ),
    ).resolves.toContain("Imported API");
    await expect(
      fs.readFile(
        path.join(
          dataDir,
          "projects",
          "project-import-api",
          "reading",
          "asset-import-api",
          "asset.json",
        ),
        "utf-8",
      ),
    ).resolves.toContain("Imported Book");
  });
});

