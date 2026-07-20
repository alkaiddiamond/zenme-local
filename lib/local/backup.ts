import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import path from "node:path";

import { getZenmeDataDir } from "@/lib/local/data-dir";
import { resolveInside } from "@/lib/local/path-safety";

const BACKUP_ENTRY_PREFIX = "zenme-data";
export const MAX_BACKUP_ARCHIVE_BYTES = 200 * 1024 * 1024;
const MAX_BACKUP_ENTRIES = 20_000;
const MAX_BACKUP_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024;
const PRIVATE_LOCAL_FILES = new Set(["openai-oauth.json"]);

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
  if (input.backup.length > MAX_BACKUP_ARCHIVE_BYTES) {
    throw new Error("备份包超过 200 MB 限制");
  }

  const dataDir = input.dataDir ?? getZenmeDataDir();
  const zip = new AdmZip(input.backup);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  validateBackupEntries(entries);

  const stagingDir = `${dataDir}.restore-${process.pid}-${Date.now()}`;
  const previousDir = `${dataDir}.bak-${Date.now()}`;
  await fs.mkdir(stagingDir, { recursive: true });

  let restoredFiles = 0;
  try {
    for (const entry of entries) {
      const relativePath = normalizeBackupEntryName(entry.entryName);
      if (!relativePath) continue;
      if (PRIVATE_LOCAL_FILES.has(relativePath)) continue;
      const destination = resolveInside(stagingDir, relativePath);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, entry.getData());
      restoredFiles += 1;
    }

    const hadExistingData = await pathExists(dataDir);
    if (hadExistingData) {
      await fs.rename(dataDir, previousDir);
    }
    try {
      await fs.rename(stagingDir, dataDir);
    } catch (error) {
      if (hadExistingData) {
        await fs.rename(previousDir, dataDir).catch(() => undefined);
      }
      throw error;
    }
  } catch (error) {
    await fs.rm(stagingDir, { force: true, recursive: true }).catch(() => undefined);
    throw error;
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
    if (entryRoot === BACKUP_ENTRY_PREFIX && PRIVATE_LOCAL_FILES.has(entry.name)) {
      continue;
    }
    const absolutePath = path.join(dir, entry.name);
    const entryName = `${entryRoot}/${entry.name}`.replaceAll("\\", "/");
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, absolutePath, entryName);
    } else if (entry.isFile()) {
      zip.addFile(
        entryName,
        entryName === `${BACKUP_ENTRY_PREFIX}/settings.json`
          ? await readRedactedSettings(absolutePath)
          : await fs.readFile(absolutePath),
      );
    }
  }
}

function validateBackupEntries(entries: AdmZip.IZipEntry[]) {
  if (entries.length === 0 || entries.length > MAX_BACKUP_ENTRIES) {
    throw new Error("备份包条目数量无效");
  }

  let expandedBytes = 0;
  for (const entry of entries) {
    if (normalizeBackupEntryName(entry.entryName) === null) {
      throw new Error("备份包包含无效路径");
    }
    expandedBytes += entry.header.size;
    if (expandedBytes > MAX_BACKUP_EXPANDED_BYTES) {
      throw new Error("备份包解压后超过 2 GB 限制");
    }
  }
}

function normalizeBackupEntryName(entryName: string) {
  const normalized = entryName.replaceAll("\\", "/");
  if (!normalized.startsWith(`${BACKUP_ENTRY_PREFIX}/`)) {
    return null;
  }

  const withoutPrefix = normalized.slice(BACKUP_ENTRY_PREFIX.length + 1);
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

async function readRedactedSettings(filePath: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf-8")) as {
      modelProviders?: Array<Record<string, unknown>>;
    };
    if (Array.isArray(parsed.modelProviders)) {
      parsed.modelProviders = parsed.modelProviders.map((provider) => ({
        ...provider,
        apiKey: "",
        networkProxy: redactNetworkProxy(provider.networkProxy),
      }));
    }
    return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  } catch {
    return Buffer.from("{}\n", "utf-8");
  }
}

function redactNetworkProxy(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const networkProxy = value as Record<string, unknown>;
  return {
    ...networkProxy,
    url: redactProxyCredentials(networkProxy.url),
  };
}

function redactProxyCredentials(value: unknown) {
  if (typeof value !== "string" || !value) return value;
  try {
    const url = new URL(value);
    if (!url.username && !url.password) return value;
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
