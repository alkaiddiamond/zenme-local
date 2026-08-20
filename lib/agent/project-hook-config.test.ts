import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";

import { loadProjectAgentHooks } from "@/lib/agent/project-hook-config";
import { loadProjectPluginMcpServers, loadProjectPluginMcpServersWithFailures } from "@/lib/agent/project-plugin-hooks";
import { bindLocalWorkspace, setLocalWorkspacePermissions } from "@/lib/local/workspace-repository";
import { createLocalProject } from "@/lib/local/project-repository";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((target) => fs.rm(target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })));
});

describe("project hook config", () => {
  it("merges user, project, and local cc-haha-compatible Hook settings in precedence order", async () => {
    const dataDir = await temporaryDirectory("zenme-hook-data-");
    const homeDir = await temporaryDirectory("zenme-hook-home-");
    const workspace = await temporaryDirectory("zenme-hook-workspace-");
    const project = await createLocalProject({ name: "Hooks", prompt: "", model: "" }, dataDir);
    await bindLocalWorkspace({ projectId: project.id, rootPath: workspace }, dataDir);
    await setLocalWorkspacePermissions({ projectId: project.id, permissions: { read: true } }, dataDir);
    await writeSettings(path.join(homeDir, ".claude", "settings.json"), "echo user");
    await writeSettings(path.join(workspace, ".claude", "settings.json"), "echo project");
    await writeSettings(path.join(workspace, ".zenme", "settings.local.json"), "echo local");

    const hooks = await loadProjectAgentHooks(project.id, dataDir, { homeDir });

    expect(hooks?.PreCompact?.[0]?.hooks[0]).toMatchObject({ type: "command", command: "echo user" });
    expect(hooks?.PreCompact?.[1]?.hooks[0]).toMatchObject({ type: "command", command: "echo project" });
    expect(hooks?.PreCompact?.[2]?.hooks[0]).toMatchObject({ type: "command", command: "echo local" });
  });

  it("does not trust project Hook files until Workspace read access is enabled", async () => {
    const dataDir = await temporaryDirectory("zenme-hook-data-");
    const homeDir = await temporaryDirectory("zenme-hook-home-");
    const workspace = await temporaryDirectory("zenme-hook-workspace-");
    const project = await createLocalProject({ name: "Hooks", prompt: "", model: "" }, dataDir);
    await bindLocalWorkspace({ projectId: project.id, rootPath: workspace }, dataDir);
    await setLocalWorkspacePermissions({ projectId: project.id, permissions: { read: false } }, dataDir);
    await writeSettings(path.join(workspace, ".claude", "settings.json"), "echo project");

    await expect(loadProjectAgentHooks(project.id, dataDir, { homeDir })).resolves.toBeUndefined();
  });

  it("loads managed Hook base and drop-ins before editable Hook sources", async () => {
    const dataDir = await temporaryDirectory("zenme-managed-hook-data-");
    const homeDir = await temporaryDirectory("zenme-managed-hook-home-");
    const managedDirectory = await temporaryDirectory("zenme-managed-hook-policy-");
    const project = await createLocalProject({ name: "Managed Hooks", prompt: "", model: "" }, dataDir);
    await writeSettings(path.join(managedDirectory, "managed-settings.json"), "echo managed-base");
    await writeSettings(path.join(managedDirectory, "managed-settings.d", "20-extra.json"), "echo managed-drop-in");
    await writeSettings(path.join(homeDir, ".claude", "settings.json"), "echo user");

    const hooks = await loadProjectAgentHooks(project.id, dataDir, {
      homeDir,
      managedDirectories: [managedDirectory],
    });

    expect(hooks?.PreCompact?.map((matcher) => matcher.hooks[0])).toEqual([
      expect.objectContaining({ type: "command", command: "echo managed-base" }),
      expect.objectContaining({ type: "command", command: "echo managed-drop-in" }),
      expect.objectContaining({ type: "command", command: "echo user" }),
    ]);
  });

  it("enforces allowManagedHooksOnly and disableAllHooks policy switches", async () => {
    const dataDir = await temporaryDirectory("zenme-managed-only-hook-data-");
    const homeDir = await temporaryDirectory("zenme-managed-only-hook-home-");
    const managedDirectory = await temporaryDirectory("zenme-managed-only-hook-policy-");
    const project = await createLocalProject({ name: "Managed-only Hooks", prompt: "", model: "" }, dataDir);
    await writeSettings(path.join(homeDir, ".claude", "settings.json"), "echo user");
    await fs.writeFile(path.join(managedDirectory, "managed-settings.json"), JSON.stringify({
      allowManagedHooksOnly: true,
      hooks: { PreCompact: [{ hooks: [{ type: "command", command: "echo managed" }] }] },
    }), "utf8");

    const managedOnly = await loadProjectAgentHooks(project.id, dataDir, {
      homeDir,
      managedDirectories: [managedDirectory],
    });
    expect(managedOnly?.PreCompact).toHaveLength(1);
    expect(managedOnly?.PreCompact?.[0]?.hooks[0]).toMatchObject({ command: "echo managed" });

    await fs.mkdir(path.join(managedDirectory, "managed-settings.d"), { recursive: true });
    await fs.writeFile(path.join(managedDirectory, "managed-settings.d", "99-disable.json"), JSON.stringify({
      disableAllHooks: true,
    }), "utf8");
    await expect(loadProjectAgentHooks(project.id, dataDir, {
      homeDir,
      managedDirectories: [managedDirectory],
    })).resolves.toBeUndefined();
  });

  it("loads Hooks only from explicitly enabled plugins recorded in the cc-haha installation registry", async () => {
    const dataDir = await temporaryDirectory("zenme-hook-data-");
    const homeDir = await temporaryDirectory("zenme-hook-home-");
    const managedDirectory = await temporaryDirectory("zenme-hook-policy-");
    const project = await createLocalProject({ name: "Plugin Hooks", prompt: "", model: "" }, dataDir);
    const pluginId = "guard@example";
    const pluginRoot = path.join(homeDir, ".claude", "plugins", "cache", "example", "guard", "1.0.0");
    await fs.mkdir(path.join(pluginRoot, "hooks"), { recursive: true });
    await fs.mkdir(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    await fs.writeFile(path.join(pluginRoot, "hooks", "hooks.json"), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/check.ps1 --token ${user_config.TOKEN}" }] }] },
    }), "utf8");
    await fs.writeFile(path.join(pluginRoot, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "guard",
      userConfig: { TOKEN: { type: "string", title: "Token", description: "Hook token", required: true, sensitive: true } },
    }));
    await fs.mkdir(path.join(homeDir, ".claude", "plugins"), { recursive: true });
    await fs.writeFile(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
      version: 2,
      plugins: { [pluginId]: [{ scope: "user", installPath: pluginRoot }] },
    }), "utf8");
    await fs.mkdir(path.join(homeDir, ".claude"), { recursive: true });
    await fs.writeFile(path.join(homeDir, ".claude", "settings.json"), JSON.stringify({
      enabledPlugins: { [pluginId]: true },
      hooks: { PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "echo user-hook" }] }] },
    }), "utf8");
    await fs.writeFile(path.join(managedDirectory, "managed-settings.json"), JSON.stringify({
      strictPluginOnlyCustomization: ["hooks"],
    }), "utf8");
    await fs.writeFile(path.join(homeDir, ".claude", ".credentials.json"), JSON.stringify({
      pluginSecrets: { [pluginId]: { TOKEN: "hook-secret" } },
    }), "utf8");

    const hooks = await loadProjectAgentHooks(project.id, dataDir, { homeDir, managedDirectories: [managedDirectory] });

    expect(hooks?.PreToolUse?.[0]).toMatchObject({
      matcher: "Bash",
      pluginId,
      pluginRoot: await fs.realpath(pluginRoot),
      pluginDataRoot: path.join(homeDir, ".claude", "plugins", "data", "guard-example"),
      pluginOptions: expect.objectContaining({ values: { TOKEN: "hook-secret" } }),
    });
    expect(hooks?.PreToolUse).toHaveLength(1);
  });

  it("does not load installed plugin Hooks when settings disable the plugin", async () => {
    const dataDir = await temporaryDirectory("zenme-hook-data-");
    const homeDir = await temporaryDirectory("zenme-hook-home-");
    const project = await createLocalProject({ name: "Disabled Plugin", prompt: "", model: "" }, dataDir);
    const pluginId = "guard@example";
    const pluginRoot = path.join(homeDir, ".claude", "plugins", "cache", "example", "guard", "1.0.0");
    await fs.mkdir(path.join(pluginRoot, "hooks"), { recursive: true });
    await fs.writeFile(path.join(pluginRoot, "hooks", "hooks.json"), JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo unsafe" }] }] },
    }), "utf8");
    await fs.mkdir(path.join(homeDir, ".claude", "plugins"), { recursive: true });
    await fs.writeFile(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
      version: 2,
      plugins: { [pluginId]: [{ scope: "user", installPath: pluginRoot }] },
    }), "utf8");
    await fs.mkdir(path.join(homeDir, ".claude"), { recursive: true });
    await fs.writeFile(path.join(homeDir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { [pluginId]: false } }), "utf8");

    await expect(loadProjectAgentHooks(project.id, dataDir, { homeDir })).resolves.toBeUndefined();
  });

  it("loads plugin-level MCP declarations and expands trusted plugin paths", async () => {
    const dataDir = await temporaryDirectory("zenme-plugin-mcp-data-");
    const homeDir = await temporaryDirectory("zenme-plugin-mcp-home-");
    const project = await createLocalProject({ name: "Plugin MCP", prompt: "", model: "" }, dataDir);
    const pluginId = "tools@example";
    const pluginRoot = path.join(homeDir, ".claude", "plugins", "cache", "example", "tools", "1.0.0");
    await fs.mkdir(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    await fs.mkdir(path.join(homeDir, ".claude", "plugins"), { recursive: true });
    await fs.writeFile(path.join(pluginRoot, ".mcp.json"), JSON.stringify({
      mcpServers: {
        local: { type: "stdio", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.js"], env: { API_TOKEN: "${user_config.TOKEN}" } },
      },
    }));
    await fs.writeFile(path.join(pluginRoot, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "tools",
      userConfig: { TOKEN: { type: "string", title: "Token", description: "MCP token", required: true, sensitive: true } },
      mcpServers: {
        remote: { type: "http", url: "https://mcp.example.test/api" },
      },
    }));
    await fs.writeFile(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
      version: 2,
      plugins: { [pluginId]: [{ scope: "user", installPath: pluginRoot }] },
    }));
    await fs.writeFile(path.join(homeDir, ".claude", "settings.json"), JSON.stringify({
      enabledPlugins: { [pluginId]: true },
    }));
    await fs.writeFile(path.join(homeDir, ".claude", ".credentials.json"), JSON.stringify({
      pluginSecrets: { [pluginId]: { TOKEN: "mcp-secret" } },
    }));

    const realPluginRoot = await fs.realpath(pluginRoot);
    await expect(loadProjectPluginMcpServers(project.id, dataDir, { homeDir })).resolves.toEqual([
      { "tools-local": { type: "stdio", command: "node", args: [`${realPluginRoot}/server.js`], env: { API_TOKEN: "mcp-secret" } } },
      { "tools-remote": { type: "http", url: "https://mcp.example.test/api" } },
    ]);
  });

  it("loads a cc-haha-compatible MCPB declaration through the plugin MCP registry", async () => {
    const dataDir = await temporaryDirectory("zenme-plugin-mcpb-data-");
    const homeDir = await temporaryDirectory("zenme-plugin-mcpb-home-");
    const project = await createLocalProject({ name: "Plugin MCPB", prompt: "", model: "" }, dataDir);
    const pluginId = "bundle@example";
    const pluginRoot = path.join(homeDir, ".claude", "plugins", "cache", "example", "bundle", "1.0.0");
    await fs.mkdir(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({
      manifest_version: "0.3",
      name: "server",
      version: "1.0.0",
      description: "Plugin MCPB fixture",
      author: { name: "Zenme Test" },
      server: {
        type: "node",
        entry_point: "server/index.js",
        mcp_config: { command: "node", args: ["${__dirname}/server/index.js"] },
      },
    })));
    zip.addFile("server/index.js", Buffer.from("process.stdin.resume();"));
    zip.writeZip(path.join(pluginRoot, "server.mcpb"));
    await fs.writeFile(path.join(pluginRoot, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "bundle",
      mcpServers: "server.mcpb",
    }));
    await fs.mkdir(path.join(homeDir, ".claude", "plugins"), { recursive: true });
    await fs.writeFile(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
      version: 2,
      plugins: { [pluginId]: [{ scope: "user", installPath: pluginRoot }] },
    }));
    await fs.writeFile(path.join(homeDir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { [pluginId]: true } }));

    const servers = await loadProjectPluginMcpServers(project.id, dataDir, { homeDir });

    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ "bundle-server": { type: "stdio", command: "node" } });
    expect((servers[0] as Record<string, { args?: string[] }>)["bundle-server"].args?.[0]).toMatch(/[\\/]\.mcpb-cache[\\/][a-f0-9]{16}[\\/]server[\\/]index\.js$/);
  });

  it("isolates a broken MCPB declaration without hiding healthy sibling servers", async () => {
    const dataDir = await temporaryDirectory("zenme-plugin-mcpb-failure-data-");
    const homeDir = await temporaryDirectory("zenme-plugin-mcpb-failure-home-");
    const project = await createLocalProject({ name: "Plugin MCPB failure", prompt: "", model: "" }, dataDir);
    const pluginId = "mixed@example";
    const pluginRoot = path.join(homeDir, ".claude", "plugins", "cache", "example", "mixed", "1.0.0");
    await fs.mkdir(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    await fs.mkdir(path.join(homeDir, ".claude", "plugins"), { recursive: true });
    await fs.writeFile(path.join(pluginRoot, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "mixed",
      mcpServers: [
        "missing.mcpb",
        { healthy: { type: "http", url: "https://mcp.example.test/api" } },
      ],
    }));
    await fs.writeFile(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
      version: 2,
      plugins: { [pluginId]: [{ scope: "user", installPath: pluginRoot }] },
    }));
    await fs.writeFile(path.join(homeDir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { [pluginId]: true } }));

    const result = await loadProjectPluginMcpServersWithFailures(project.id, dataDir, { homeDir });

    expect(result.servers).toEqual([
      { "mixed-healthy": { type: "http", url: "https://mcp.example.test/api" } },
    ]);
    expect(result.failures).toEqual([
      expect.objectContaining({ pluginId, pluginName: "mixed", source: "missing.mcpb" }),
    ]);
  });
});

async function temporaryDirectory(prefix: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
}

async function writeSettings(filePath: string, command: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({
    hooks: { PreCompact: [{ hooks: [{ type: "command", command }] }] },
  }), "utf8");
}
