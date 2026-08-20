import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadActiveProjectOutputStyle } from "@/lib/agent/project-output-styles";
import { createLocalProject } from "@/lib/local/project-repository";
import { bindLocalWorkspace } from "@/lib/local/workspace-repository";

describe("project output styles", () => {
  let dataDir: string;
  let homeDir: string;
  let projectId: string;
  let workspace: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-output-style-data-"));
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-output-style-home-"));
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-output-style-workspace-"));
    projectId = (await createLocalProject({ name: "Output style", prompt: "", model: "" }, dataDir)).id;
    await bindLocalWorkspace({ projectId, rootPath: workspace }, dataDir);
  });

  afterEach(async () => {
    await Promise.all([dataDir, homeDir, workspace].map((target) => fs.rm(target, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    })));
  });

  it("uses the selected project output style over a user style with the same name", async () => {
    await writeStyle(path.join(homeDir, ".claude", "output-styles", "Concise.md"), "User prompt");
    await writeStyle(path.join(workspace, ".claude", "output-styles", "Concise.md"), "Project prompt");
    await writeJson(path.join(workspace, ".claude", "settings.local.json"), { outputStyle: "Concise" });

    await expect(loadActiveProjectOutputStyle(projectId, dataDir, { homeDir })).resolves.toMatchObject({
      name: "Concise",
      prompt: "Project prompt",
      source: "project",
    });
  });

  it("applies an enabled plugin style marked force-for-plugin", async () => {
    const pluginRoot = path.join(homeDir, ".claude", "plugins", "cache", "teacher");
    await writeJson(path.join(homeDir, ".claude", "settings.json"), {
      enabledPlugins: { "teacher@market": true },
      outputStyle: "default",
    });
    await writeJson(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"), {
      version: 2,
      plugins: { "teacher@market": [{ scope: "user", installPath: pluginRoot }] },
    });
    await writeStyle(path.join(pluginRoot, "output-styles", "Teacher.md"), "Teach while implementing", [
      "force-for-plugin: true",
      "keep-coding-instructions: true",
    ]);

    await expect(loadActiveProjectOutputStyle(projectId, dataDir, { homeDir })).resolves.toMatchObject({
      forceForPlugin: true,
      keepCodingInstructions: true,
      name: "Teacher",
      prompt: "Teach while implementing",
      source: "plugin",
    });
  });

  it("uses a managed output-style selection and definition over lower scopes", async () => {
    const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-output-style-managed-"));
    try {
      await writeStyle(path.join(workspace, ".claude", "output-styles", "Concise.md"), "Project prompt");
      await writeJson(path.join(workspace, ".claude", "settings.local.json"), { outputStyle: "Concise" });
      await writeStyle(path.join(managedRoot, ".claude", "output-styles", "Concise.md"), "Managed prompt");
      await writeJson(path.join(managedRoot, "managed-settings.json"), { outputStyle: "Concise" });
      await writeJson(path.join(managedRoot, "managed-settings.d", "20-style.json"), { outputStyle: "Concise" });

      await expect(loadActiveProjectOutputStyle(projectId, dataDir, {
        homeDir,
        managedDirectories: [managedRoot],
      })).resolves.toMatchObject({
        name: "Concise",
        prompt: "Managed prompt",
        source: "policy",
      });
    } finally {
      await fs.rm(managedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
}

async function writeStyle(filePath: string, prompt: string, fields: string[] = []) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, [
    "---",
    `name: ${path.basename(filePath, path.extname(filePath))}`,
    "description: Test style",
    ...fields,
    "---",
    prompt,
  ].join("\n"), "utf8");
}
