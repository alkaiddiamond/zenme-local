import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createLocalDataBackup,
  restoreLocalDataBackup,
} from "@/lib/local/backup";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-backup-"));
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
  const parent = path.dirname(dataDir);
  const base = path.basename(dataDir);
  const entries = await fs.readdir(parent);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(`${base}.bak-`))
      .map((entry) => fs.rm(path.join(parent, entry), { force: true, recursive: true })),
  );
});

describe("local backup", () => {
  it("creates and restores local data backups", async () => {
    await fs.mkdir(path.join(dataDir, "projects", "project-1"), { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "projects", "project-1", "project.json"),
      '{"name":"before"}\n',
    );

    const backup = await createLocalDataBackup(dataDir);
    await fs.rm(dataDir, { force: true, recursive: true });

    await expect(restoreLocalDataBackup({ backup, dataDir })).resolves.toMatchObject({
      restoredFiles: expect.any(Number),
    });
    await expect(
      fs.readFile(path.join(dataDir, "projects", "project-1", "project.json"), "utf-8"),
    ).resolves.toContain("before");
  });

  it("rejects backup entries that escape the data directory", async () => {
    const zip = new AdmZip();
    zip.addFile("C:/escape.txt", Buffer.from("bad"));

    await expect(
      restoreLocalDataBackup({ backup: zip.toBuffer(), dataDir }),
    ).rejects.toThrow("备份包包含无效路径");
  });
});
