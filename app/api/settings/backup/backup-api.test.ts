import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/settings/backup/route";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-backup-api-"));
  process.env.ZENME_DATA_DIR = dataDir;
  process.env.ZENME_STORAGE_DRIVER = "local";
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  delete process.env.ZENME_STORAGE_DRIVER;
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("settings backup API", () => {
  it("downloads and restores local backups", async () => {
    await fs.mkdir(path.join(dataDir, "projects", "project-1"), { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "projects", "project-1", "project.json"),
      '{"name":"api"}\n',
    );

    const backupResponse = await GET();
    expect(backupResponse.headers.get("content-type")).toBe("application/zip");
    const backup = Buffer.from(await backupResponse.arrayBuffer());

    await fs.rm(dataDir, { force: true, recursive: true });
    const formData = new FormData();
    formData.set("file", new File([backup], "backup.zip", { type: "application/zip" }));
    const restoreResponse = await POST(
      new Request("http://localhost/api/settings/backup", {
        method: "POST",
        body: formData,
      }),
    );

    expect(restoreResponse.status).toBe(200);
    await expect(restoreResponse.json()).resolves.toMatchObject({ ok: true });
    await expect(
      fs.readFile(path.join(dataDir, "projects", "project-1", "project.json"), "utf-8"),
    ).resolves.toContain("api");
  });

  it("rejects invalid backup uploads", async () => {
    const zip = new AdmZip();
    zip.addFile("C:/escape.txt", Buffer.from("bad"));
    const formData = new FormData();
    formData.set("file", new File([zip.toBuffer()], "backup.zip"));

    const response = await POST(
      new Request("http://localhost/api/settings/backup", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(500);
  });
});
