import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadProjectCustomizationPolicy } from "@/lib/agent/project-customization-policy";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((target) => fs.rm(target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  })));
});

describe("Project customization policy", () => {
  it("loads the first managed root and lets sorted drop-ins override the base", async () => {
    const dataDir = await temporaryDirectory("zenme-customization-policy-data-");
    const first = await temporaryDirectory("zenme-customization-policy-first-");
    const second = await temporaryDirectory("zenme-customization-policy-second-");
    await writeJson(path.join(first, "managed-settings.json"), { strictPluginOnlyCustomization: true });
    await writeJson(path.join(first, "managed-settings.d", "20-policy.json"), { strictPluginOnlyCustomization: ["skills", "mcp", "future-surface"] });
    await writeJson(path.join(second, "managed-settings.json"), { strictPluginOnlyCustomization: ["agents"] });

    const policy = await loadProjectCustomizationPolicy("project", dataDir, { managedDirectories: [first, second] });
    expect(policy.managedDirectory).toBe(first);
    expect([...policy.restrictedSurfaces]).toEqual(["skills", "mcp"]);
  });

  it("treats false and invalid values as an unlocked policy field", async () => {
    const dataDir = await temporaryDirectory("zenme-customization-policy-data-");
    const managed = await temporaryDirectory("zenme-customization-policy-managed-");
    await writeJson(path.join(managed, "managed-settings.json"), { strictPluginOnlyCustomization: "skills" });
    await expect(loadProjectCustomizationPolicy("project", dataDir, { managedDirectories: [managed] }))
      .resolves.toMatchObject({ restrictedSurfaces: new Set() });
  });
});

async function temporaryDirectory(prefix: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
}
