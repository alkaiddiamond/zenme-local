import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const writeLocks = new Map<string, Promise<unknown>>();

function cloneDefault<T>(value: T): T {
  if (value && typeof value === "object") {
    return JSON.parse(JSON.stringify(value)) as T;
  }
  return value;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

async function quarantineInvalidJson(filePath: string) {
  const invalidPath = `${filePath}.invalid-${Date.now()}-${randomBytes(3).toString("hex")}`;
  await fs.rename(filePath, invalidPath).catch(() => undefined);
}

export async function readJsonFile<T>(
  filePath: string,
  options: {
    defaultValue: T;
    normalize?: (value: unknown) => T | null;
  },
) {
  let raw: string;

  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return cloneDefault(options.defaultValue);
    }
    throw error;
  }

  if (raw.trim() === "") {
    return cloneDefault(options.defaultValue);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await quarantineInvalidJson(filePath);
    return cloneDefault(options.defaultValue);
  }

  if (!options.normalize) {
    return parsed as T;
  }

  const normalized = options.normalize(parsed);
  if (normalized === null) {
    await quarantineInvalidJson(filePath);
    return cloneDefault(options.defaultValue);
  }

  return normalized;
}

export async function writeJsonFile(filePath: string, value: unknown) {
  return withWriteLock(filePath, async () => {
    const dir = path.dirname(filePath);
    const content = `${JSON.stringify(value, null, 2)}\n`;
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}`;
      try {
        await fs.mkdir(dir, { recursive: true });
        const handle = await fs.open(tmpPath, "w");
        try {
          await handle.writeFile(content, "utf-8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(tmpPath, filePath);
        return;
      } catch (error) {
        lastError = error;
        await fs.unlink(tmpPath).catch(() => undefined);
        if (errorCode(error) !== "ENOENT" || attempt === 1) {
          break;
        }
      }
    }

    throw lastError;
  });
}

async function withWriteLock<T>(filePath: string, task: () => Promise<T>) {
  const previous = writeLocks.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  writeLocks.set(filePath, next);

  try {
    return await next;
  } finally {
    if (writeLocks.get(filePath) === next) {
      writeLocks.delete(filePath);
    }
  }
}

