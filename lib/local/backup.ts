import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import path from "node:path";

import { getZenmeDataDir } from "@/lib/local/data-dir";
import { resolveInside } from "@/lib/local/path-safety";

const BACKUP_ENTRY_PREFIX = "zenme-data";

export async function createLocalDataBackup(dataDir = getZenmeDataDir()) {
  const zip = new AdmZip();
  await addDirectoryToZip(zip, dataDir, BACKUP_ENTRY_PREFIX);
  zip.addFile(
    `${BACKUP_ENTRY_PREFIX}/manifest.json`,
    Buffer.from(
      `${JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          format: "zenme-local-backup",
          version: 1,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    ),
  );
  return zip.toBuffer();
}

export async function restoreLocalDataBackup(input: {
  backup: Buffer;
  dataDir?: string;
}) {
  const dataDir = input.dataDir ?? getZenmeDataDir();
  const zip = new AdmZip(input.backup);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);

  validateBackupEntries(entries);
  await backupExistingDataDir(dataDir);
  await fs.mkdir(dataDir, { recursive: true });

  let restoredFiles = 0;
  for (const entry of entries) {
    const relativePath = normalizeBackupEntryName(entry.entryName);
    if (!relativePath) continue;
    const destination = resolveInside(dataDir, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, entry.getData());
    restoredFiles += 1;
  }

  return { restoredFiles };
}

async function addDirectoryToZip(zip: AdmZip, dir: string, entryRoot: string) {
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const entryName = `${entryRoot}/${entry.name}`;
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, absolutePath, entryName);
    } else if (entry.isFile()) {
      zip.addFile(entryName.replaceAll("\\", "/"), await fs.readFile(absolutePath));
    }
  }
}

async function backupExistingDataDir(dataDir: string) {
  try {
    await fs.access(dataDir);
  } catch {
    return;
  }

  const backupDir = `${dataDir}.bak-${Date.now()}`;
  await fs.rename(dataDir, backupDir);
}

function validateBackupEntries(entries: AdmZip.IZipEntry[]) {
  for (const entry of entries) {
    const relativePath = normalizeBackupEntryName(entry.entryName);
    if (relativePath === null) {
      throw new Error("备份包包含无效路径");
    }
  }
}

function normalizeBackupEntryName(entryName: string) {
  const normalized = entryName.replaceAll("\\", "/");
  const withoutPrefix = normalized.startsWith(`${BACKUP_ENTRY_PREFIX}/`)
    ? normalized.slice(BACKUP_ENTRY_PREFIX.length + 1)
    : normalized;

  if (!withoutPrefix || withoutPrefix === "manifest.json") {
    return "";
  }

  if (
    withoutPrefix.startsWith("/") ||
    withoutPrefix.includes("../") ||
    withoutPrefix === ".." ||
    /^[a-zA-Z]:/.test(withoutPrefix)
  ) {
    return null;
  }

  return withoutPrefix;
}
