import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chokidar from "chokidar";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeProjectConfigChangeRuntime,
  getProjectConfigGeneration,
  notifyProjectConfigFileChanged,
  resetProjectConfigChangeRuntimeForTests,
  resolveProjectAgentHooksWithConfigChangeRuntime,
} from "@/lib/agent/project-config-change-runtime";
import { loadProjectAgentHooks } from "@/lib/agent/project-hook-config";
import { listProjectSkills, loadProjectSkill } from "@/lib/agent/project-skills";
import { createLocalProject } from "@/lib/local/project-repository";
import { bindLocalWorkspace } from "@/lib/local/workspace-repository";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await resetProjectConfigChangeRuntimeForTests();
  vi.restoreAllMocks();
  await Promise.all(temporaryPaths.splice(0).map((target) => fs.rm(target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })));
});

describe("Project ConfigChange runtime", () => {
  it.each(["close", "reset"] as const)("does not restart a disposed watcher after an in-flight change (%s)", async (action) => {
    const dataDir = await temporaryDirectory("zenme-config-disposal-data-");
    const homeDir = await temporaryDirectory("zenme-config-disposal-home-");
    const project = await createLocalProject({ name: "Config disposal", prompt: "", model: "" }, dataDir);
    const settingsPath = path.join(homeDir, ".zenme", "settings.json");
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const callback = vi.fn(async () => {
      started.resolve();
      await release.promise;
      return { blocked: false };
    });
    const watch = vi.spyOn(chokidar, "watch");
    await resolveProjectAgentHooksWithConfigChangeRuntime({
      projectId: project.id, dataDir, homeDir, managedDirectories: [],
      onConfigChange: callback, waitUntilReady: true,
    });
    const watcher = watch.mock.results[0].value;
    const add = vi.spyOn(watcher, "add");
    const notification = notifyProjectConfigFileChanged(settingsPath);
    await started.promise;
    // Queue a second change while the first callback is still pending.
    const queued = notifyProjectConfigFileChanged(settingsPath);
    try {
      if (action === "close") await closeProjectConfigChangeRuntime(project.id, dataDir);
      else await resetProjectConfigChangeRuntimeForTests();
      release.resolve();
      await Promise.all([notification, queued]);
      expect(add).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(watcher.closed).toBe(true);
      expect(getProjectConfigGeneration(project.id, dataDir)).toBeUndefined();
    } finally {
      release.resolve();
      await Promise.all([notification, queued]);
      await watcher.close();
    }
  });

  it("keeps the accepted Hook configuration when ConfigChange blocks a stable file update", async () => {
    const dataDir = await temporaryDirectory("zenme-config-runtime-data-");
    const homeDir = await temporaryDirectory("zenme-config-runtime-home-");
    const workspace = await temporaryDirectory("zenme-config-runtime-workspace-");
    const project = await createLocalProject({ name: "Config runtime", prompt: "", model: "" }, dataDir);
    await bindLocalWorkspace({ projectId: project.id, rootPath: workspace }, dataDir);
    const settingsPath = path.join(workspace, ".zenme", "settings.json");
    await writeSettings(settingsPath, "https://hooks.example.test/original");
    const callback = vi.fn(async () => ({ blocked: true }));
    const initial = await loadProjectAgentHooks(project.id, dataDir, { homeDir, managedDirectories: [] });
    expect(initial?.ConfigChange?.[0]?.hooks[0]).toMatchObject({ url: "https://hooks.example.test/original" });
    await resolveProjectAgentHooksWithConfigChangeRuntime({
      projectId: project.id,
      dataDir,
      homeDir,
      managedDirectories: [],
      acceptedCandidate: initial,
      onConfigChange: callback,
      waitUntilReady: true,
    });
    await writeSettings(settingsPath, "https://hooks.example.test/rejected");
    const canonicalSettingsPath = await fs.realpath(settingsPath);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ source: "project_settings", filePath: canonicalSettingsPath }),
      initial,
    ), { timeout: 5_000 });

    const accepted = await resolveProjectAgentHooksWithConfigChangeRuntime({
      projectId: project.id,
      dataDir,
      homeDir,
      managedDirectories: [],
      acceptedCandidate: initial,
      onConfigChange: callback,
      waitUntilReady: true,
    });
    expect(accepted?.ConfigChange?.[0]?.hooks[0]).toMatchObject({ url: "https://hooks.example.test/original" });
  }, 10_000);

  it("reloads accepted Hooks after ConfigChange allows a skills/config update", async () => {
    const dataDir = await temporaryDirectory("zenme-config-runtime-data-");
    const homeDir = await temporaryDirectory("zenme-config-runtime-home-");
    const workspace = await temporaryDirectory("zenme-config-runtime-workspace-");
    const project = await createLocalProject({ name: "Config runtime", prompt: "", model: "" }, dataDir);
    await bindLocalWorkspace({ projectId: project.id, rootPath: workspace }, dataDir);
    const settingsPath = path.join(workspace, ".zenme", "settings.json");
    await writeSettings(settingsPath, "https://hooks.example.test/original");
    const callback = vi.fn(async () => ({ blocked: false }));
    const initial = await loadProjectAgentHooks(project.id, dataDir, { homeDir, managedDirectories: [] });
    expect(initial?.ConfigChange?.[0]?.hooks[0]).toMatchObject({ url: "https://hooks.example.test/original" });

    await resolveProjectAgentHooksWithConfigChangeRuntime({
      projectId: project.id,
      dataDir,
      homeDir,
      managedDirectories: [],
      acceptedCandidate: initial,
      onConfigChange: callback,
      waitUntilReady: true,
    });
    await writeSettings(settingsPath, "https://hooks.example.test/accepted");
    await vi.waitFor(() => expect(callback).toHaveBeenCalled(), { timeout: 5_000 });
    await vi.waitFor(async () => {
      const accepted = await resolveProjectAgentHooksWithConfigChangeRuntime({
        projectId: project.id,
        dataDir,
        homeDir,
        managedDirectories: [],
        acceptedCandidate: undefined,
        onConfigChange: callback,
      });
      expect(accepted?.ConfigChange?.[0]?.hooks[0]).toMatchObject({ url: "https://hooks.example.test/accepted" });
    });
  }, 10_000);

  it("keeps the previously loaded skill instructions when a skills ConfigChange is blocked", async () => {
    const dataDir = await temporaryDirectory("zenme-config-runtime-data-");
    const homeDir = await temporaryDirectory("zenme-config-runtime-home-");
    const workspace = await temporaryDirectory("zenme-config-runtime-workspace-");
    const project = await createLocalProject({ name: "Config runtime", prompt: "", model: "" }, dataDir);
    await bindLocalWorkspace({ projectId: project.id, rootPath: workspace }, dataDir);
    const skillPath = path.join(workspace, ".zenme", "skills", "review", "SKILL.md");
    await writeSkill(skillPath, "Original instructions");
    const callback = vi.fn(async () => ({ blocked: true }));
    await resolveProjectAgentHooksWithConfigChangeRuntime({
      projectId: project.id,
      dataDir,
      homeDir,
      managedDirectories: [],
      acceptedCandidate: undefined,
      onConfigChange: callback,
      waitUntilReady: true,
    });
    await expect(listProjectSkills(project.id, dataDir, undefined, { homeDir, managedDirectories: [] })).resolves.toContainEqual(
      expect.objectContaining({ name: "review" }),
    );

    await writeSkill(skillPath, "Rejected instructions");
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ source: "skills" }),
      undefined,
    ), { timeout: 5_000 });
    await expect(loadProjectSkill({ projectId: project.id, dataDir, skill: "review", homeDir, managedDirectories: [] }))
      .resolves.toMatchObject({ content: expect.stringContaining("Original instructions") });
  }, 10_000);

  it("applies an explicitly notified first user setting write even when the directory did not exist at watcher startup", async () => {
    const dataDir = await temporaryDirectory("zenme-config-runtime-data-");
    const homeDir = await temporaryDirectory("zenme-config-runtime-home-");
    const project = await createLocalProject({ name: "Config runtime", prompt: "", model: "" }, dataDir);
    const settingsPath = path.join(homeDir, ".zenme", "settings.json");
    const callback = vi.fn(async () => ({ blocked: false }));
    await resolveProjectAgentHooksWithConfigChangeRuntime({
      projectId: project.id,
      dataDir,
      homeDir,
      managedDirectories: [],
      acceptedCandidate: undefined,
      onConfigChange: callback,
      waitUntilReady: true,
    });

    await writeSettings(settingsPath, "https://hooks.example.test/first-user-config");
    await notifyProjectConfigFileChanged(settingsPath);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ source: "user_settings" }), undefined);
    const accepted = await resolveProjectAgentHooksWithConfigChangeRuntime({
      projectId: project.id,
      dataDir,
      homeDir,
      managedDirectories: [],
      acceptedCandidate: undefined,
      onConfigChange: callback,
    });
    expect(accepted?.ConfigChange?.[0]?.hooks[0]).toMatchObject({ url: "https://hooks.example.test/first-user-config" });
  });

  it("watches and reloads managed-settings drop-ins as policy_settings", async () => {
    const dataDir = await temporaryDirectory("zenme-config-policy-data-");
    const homeDir = await temporaryDirectory("zenme-config-policy-home-");
    const managedDirectory = await temporaryDirectory("zenme-config-policy-managed-");
    const project = await createLocalProject({ name: "Policy config runtime", prompt: "", model: "" }, dataDir);
    const basePath = path.join(managedDirectory, "managed-settings.json");
    const dropInPath = path.join(managedDirectory, "managed-settings.d", "20-policy.json");
    await writeSettings(basePath, "https://hooks.example.test/policy-base");
    const callback = vi.fn(async () => ({ blocked: false }));
    const initial = await loadProjectAgentHooks(project.id, dataDir, {
      homeDir,
      managedDirectories: [managedDirectory],
    });
    await resolveProjectAgentHooksWithConfigChangeRuntime({
      projectId: project.id,
      dataDir,
      homeDir,
      managedDirectories: [managedDirectory],
      acceptedCandidate: initial,
      onConfigChange: callback,
      waitUntilReady: true,
    });

    await writeSettings(dropInPath, "https://hooks.example.test/policy-drop-in");
    await notifyProjectConfigFileChanged(dropInPath);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ source: "policy_settings", filePath: path.resolve(dropInPath) }),
      initial,
    );
    const accepted = await resolveProjectAgentHooksWithConfigChangeRuntime({
      projectId: project.id,
      dataDir,
      homeDir,
      managedDirectories: [managedDirectory],
      acceptedCandidate: undefined,
      onConfigChange: callback,
    });
    expect(accepted?.ConfigChange?.[0]?.hooks[0]).toMatchObject({ url: "https://hooks.example.test/policy-base" });
    expect(accepted?.ConfigChange?.[1]?.hooks[0]).toMatchObject({ url: "https://hooks.example.test/policy-drop-in" });
  });

  it("treats managed Agent components as policy_settings changes", async () => {
    const dataDir = await temporaryDirectory("zenme-config-policy-components-data-");
    const homeDir = await temporaryDirectory("zenme-config-policy-components-home-");
    const managedDirectory = await temporaryDirectory("zenme-config-policy-components-managed-");
    const project = await createLocalProject({ name: "Policy components", prompt: "", model: "" }, dataDir);
    const callback = vi.fn(async () => ({ blocked: false }));
    await resolveProjectAgentHooksWithConfigChangeRuntime({
      projectId: project.id,
      dataDir,
      homeDir,
      managedDirectories: [managedDirectory],
      acceptedCandidate: undefined,
      onConfigChange: callback,
      waitUntilReady: true,
    });
    const skillPath = path.join(managedDirectory, ".claude", "skills", "managed-review", "SKILL.md");
    await writeSkill(skillPath, "Managed review instructions");
    await notifyProjectConfigFileChanged(skillPath);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ source: "policy_settings", filePath: path.resolve(skillPath) }),
      undefined,
    );
    await expect(listProjectSkills(project.id, dataDir, undefined, {
      homeDir,
      managedDirectories: [managedDirectory],
    })).resolves.toContainEqual(expect.objectContaining({ name: "review", source: "policy" }));
  });

  it("invalidates customization discovery when a managed plugin-only policy changes", async () => {
    const dataDir = await temporaryDirectory("zenme-config-customization-data-");
    const homeDir = await temporaryDirectory("zenme-config-customization-home-");
    const workspace = await temporaryDirectory("zenme-config-customization-workspace-");
    const managedDirectory = await temporaryDirectory("zenme-config-customization-managed-");
    const project = await createLocalProject({ name: "Customization policy", prompt: "", model: "" }, dataDir);
    await bindLocalWorkspace({ projectId: project.id, rootPath: workspace }, dataDir);
    await writeSkill(path.join(workspace, ".claude", "skills", "review", "SKILL.md"), "Project review");
    await fs.writeFile(path.join(managedDirectory, "managed-settings.json"), "{}", "utf8");
    const callback = vi.fn(async () => ({ blocked: false }));
    await resolveProjectAgentHooksWithConfigChangeRuntime({
      projectId: project.id,
      dataDir,
      homeDir,
      managedDirectories: [managedDirectory],
      acceptedCandidate: undefined,
      onConfigChange: callback,
      waitUntilReady: true,
    });
    await expect(listProjectSkills(project.id, dataDir, undefined, {
      homeDir,
      managedDirectories: [managedDirectory],
    })).resolves.toContainEqual(expect.objectContaining({ name: "review", source: "project" }));

    const policyPath = path.join(managedDirectory, "managed-settings.d", "50-customization.json");
    await fs.mkdir(path.dirname(policyPath), { recursive: true });
    await fs.writeFile(policyPath, JSON.stringify({ strictPluginOnlyCustomization: ["skills"] }), "utf8");
    await notifyProjectConfigFileChanged(policyPath);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ source: "policy_settings" }), undefined);
    await expect(listProjectSkills(project.id, dataDir, undefined, {
      homeDir,
      managedDirectories: [managedDirectory],
    })).resolves.toEqual([]);
  });
});

async function temporaryDirectory(prefix: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
}

async function writeSettings(filePath: string, url: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({
    hooks: { ConfigChange: [{ matcher: "project_settings", hooks: [{ type: "http", url }] }] },
  }), "utf8");
}

async function writeSkill(filePath: string, instructions: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `---\nname: review\ndescription: Review\n---\n${instructions}`, "utf8");
}
