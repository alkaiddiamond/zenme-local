import os from "node:os";
import path from "node:path";

import { resolveInside } from "@/lib/local/path-safety";

export function getZenmeDataDir() {
  return process.env.ZENME_DATA_DIR
    ? path.resolve(process.env.ZENME_DATA_DIR)
    : path.join(process.cwd(), "data", "local");
}

export function getDefaultZenmeDataDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? os.homedir(), "Zenme", "data");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Zenme", "data");
  }

  return path.join(os.homedir(), ".local", "share", "zenme", "data");
}

export function getProjectsDir(dataDir = getZenmeDataDir()) {
  return resolveInside(dataDir, "projects");
}

export function getProjectDir(projectId: string, dataDir = getZenmeDataDir()) {
  return resolveInside(getProjectsDir(dataDir), projectId);
}

