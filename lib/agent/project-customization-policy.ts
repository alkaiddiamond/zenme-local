import fs from "node:fs/promises";
import path from "node:path";

import { getProjectConfigGeneration } from "@/lib/agent/project-config-generation";
import { getDefaultManagedSettingsDirectories } from "@/lib/agent/managed-settings";

const MAX_MANAGED_SETTINGS_BYTES = 1_000_000;
const CUSTOMIZATION_SURFACES = ["skills", "agents", "hooks", "mcp"] as const;

export type ProjectCustomizationSurface = typeof CUSTOMIZATION_SURFACES[number];

export type ProjectCustomizationPolicy = {
  managedDirectory?: string;
  restrictedSurfaces: ReadonlySet<ProjectCustomizationSurface>;
};

const policyCache = new Map<string, Promise<ProjectCustomizationPolicy>>();

export async function loadProjectCustomizationPolicy(
  projectId: string,
  dataDir: string,
  options: { managedDirectories?: string[] } = {},
) {
  const managedDirectories = options.managedDirectories ?? getDefaultManagedSettingsDirectories();
  const generation = await getProjectConfigGeneration(projectId, dataDir);
  if (generation === undefined) return loadProjectCustomizationPolicyUncached(managedDirectories);
  const key = JSON.stringify([path.resolve(dataDir), projectId, managedDirectories, generation]);
  const cached = policyCache.get(key);
  if (cached) return cached;
  const pending = loadProjectCustomizationPolicyUncached(managedDirectories).catch((error) => {
    policyCache.delete(key);
    throw error;
  });
  policyCache.set(key, pending);
  while (policyCache.size > 200) {
    const oldest = policyCache.keys().next().value;
    if (typeof oldest !== "string") break;
    policyCache.delete(oldest);
  }
  return pending;
}

export async function isProjectCustomizationRestricted(
  projectId: string,
  dataDir: string,
  surface: ProjectCustomizationSurface,
  options: { managedDirectories?: string[] } = {},
) {
  return (await loadProjectCustomizationPolicy(projectId, dataDir, options)).restrictedSurfaces.has(surface);
}

async function loadProjectCustomizationPolicyUncached(managedDirectories: readonly string[]) {
  for (const directory of managedDirectories) {
    const loaded = await readManagedCustomizationPolicy(directory);
    if (loaded.found) {
      return {
        managedDirectory: directory,
        restrictedSurfaces: loaded.restrictedSurfaces,
      } satisfies ProjectCustomizationPolicy;
    }
  }
  return { restrictedSurfaces: new Set<ProjectCustomizationSurface>() } satisfies ProjectCustomizationPolicy;
}

async function readManagedCustomizationPolicy(directory: string) {
  const files = [path.join(directory, "managed-settings.json")];
  const dropInDirectory = path.join(directory, "managed-settings.d");
  const entries = await fs.readdir(dropInDirectory, { withFileTypes: true }).catch((error) => {
    if (isMissingOrUnreadable(error)) return [];
    throw error;
  });
  files.push(...entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
    .map((entry) => path.join(dropInDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right)));

  let found = false;
  let value: unknown;
  for (const filePath of files) {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_MANAGED_SETTINGS_BYTES) continue;
      const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (!isRecord(parsed)) continue;
      found ||= Object.keys(parsed).length > 0;
      if (Object.hasOwn(parsed, "strictPluginOnlyCustomization")) {
        value = parsed.strictPluginOnlyCustomization;
      }
    } catch (error) {
      if (error instanceof SyntaxError || isMissingOrUnreadable(error)) continue;
      throw error;
    }
  }
  return { found, restrictedSurfaces: normalizeRestrictedSurfaces(value) };
}

function normalizeRestrictedSurfaces(value: unknown) {
  if (value === true) return new Set<ProjectCustomizationSurface>(CUSTOMIZATION_SURFACES);
  if (!Array.isArray(value)) return new Set<ProjectCustomizationSurface>();
  return new Set(value.filter((entry): entry is ProjectCustomizationSurface =>
    typeof entry === "string" && (CUSTOMIZATION_SURFACES as readonly string[]).includes(entry)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissingOrUnreadable(error: unknown) {
  return error instanceof Error && "code" in error &&
    ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(String(error.code));
}
