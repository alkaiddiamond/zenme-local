import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";

import { listAgentPlugins, saveAgentPluginConfiguration } from "@/lib/agent/project-plugin-config-manager";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

describe("project plugin config manager", () => {
  it("discovers plugin and MCPB schemas while keeping sensitive values out of the response", async () => {
    const fixture = await createFixture();

    await saveAgentPluginConfiguration({
      dataDir: fixture.dataDir,
      homeDir: fixture.homeDir,
      pluginId: fixture.pluginId,
      configurationId: "plugin",
      values: { MODE: "strict", TOKEN: "top-secret" },
    });
    const plugins = await saveAgentPluginConfiguration({
      dataDir: fixture.dataDir,
      homeDir: fixture.homeDir,
      pluginId: fixture.pluginId,
      configurationId: "mcp:bundle",
      values: { PORT: 4317, API_KEY: "server-secret" },
    });

    expect(plugins).toEqual([
      expect.objectContaining({
        id: fixture.pluginId,
        configurations: [
          expect.objectContaining({
            id: "plugin",
            configuredKeys: expect.arrayContaining(["MODE", "TOKEN"]),
            missing: [],
            values: { MODE: "strict" },
          }),
          expect.objectContaining({
            id: "mcp:bundle",
            configuredKeys: expect.arrayContaining(["PORT", "API_KEY"]),
            missing: [],
            values: { PORT: 4317 },
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(plugins)).not.toContain("top-secret");
    expect(JSON.stringify(plugins)).not.toContain("server-secret");

    const settings = JSON.parse(await fs.readFile(path.join(fixture.homeDir, ".zenme", "settings.json"), "utf8"));
    expect(settings.pluginConfigs[fixture.pluginId]).toEqual({
      options: { MODE: "strict" },
      mcpServers: { bundle: { PORT: 4317 } },
    });
    const credentials = JSON.parse(await fs.readFile(path.join(fixture.dataDir, "plugin-credentials.json"), "utf8"));
    expect(credentials.pluginSecrets).toEqual({
      [fixture.pluginId]: { TOKEN: "top-secret" },
      [`${fixture.pluginId}/bundle`]: { API_KEY: "server-secret" },
    });
  });

  it("rejects unknown fields and invalid required values without mutating storage", async () => {
    const fixture = await createFixture();

    await expect(saveAgentPluginConfiguration({
      dataDir: fixture.dataDir,
      homeDir: fixture.homeDir,
      pluginId: fixture.pluginId,
      configurationId: "plugin",
      values: { UNKNOWN: "value" },
    })).rejects.toThrow("未知插件配置项");
    await expect(saveAgentPluginConfiguration({
      dataDir: fixture.dataDir,
      homeDir: fixture.homeDir,
      pluginId: fixture.pluginId,
      configurationId: "mcp:bundle",
      values: { PORT: 70000, API_KEY: "secret" },
    })).rejects.toThrow("格式无效");

    await expect(fs.stat(path.join(fixture.homeDir, ".zenme", "settings.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(fixture.dataDir, "plugin-credentials.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves an existing sensitive value when the masked form submits an empty string", async () => {
    const fixture = await createFixture();
    await saveAgentPluginConfiguration({
      dataDir: fixture.dataDir,
      homeDir: fixture.homeDir,
      pluginId: fixture.pluginId,
      configurationId: "plugin",
      values: { MODE: "first", TOKEN: "keep-me" },
    });

    await saveAgentPluginConfiguration({
      dataDir: fixture.dataDir,
      homeDir: fixture.homeDir,
      pluginId: fixture.pluginId,
      configurationId: "plugin",
      values: { MODE: "second", TOKEN: "" },
    });

    const plugins = await listAgentPlugins({ dataDir: fixture.dataDir, homeDir: fixture.homeDir });
    expect(plugins[0]?.configurations[0]).toMatchObject({ values: { MODE: "second" }, missing: [] });
    const credentials = JSON.parse(await fs.readFile(path.join(fixture.dataDir, "plugin-credentials.json"), "utf8"));
    expect(credentials.pluginSecrets[fixture.pluginId].TOKEN).toBe("keep-me");
  });
});

async function createFixture() {
  const homeDir = await temporaryDirectory("zenme-plugin-manager-home-");
  const dataDir = await temporaryDirectory("zenme-plugin-manager-data-");
  const pluginId = "configurable@example";
  const pluginRoot = path.join(homeDir, ".claude", "plugins", "cache", "example", "configurable", "1.0.0");
  await fs.mkdir(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify({
    manifest_version: "0.3",
    name: "bundle",
    display_name: "Bundle server",
    version: "1.0.0",
    description: "Configurable MCPB fixture",
    author: { name: "Zenme Test" },
    server: { type: "node", entry_point: "server.js", mcp_config: { command: "node", args: ["${__dirname}/server.js"] } },
    user_config: {
      PORT: { type: "number", title: "Port", description: "Local port", required: true, min: 1, max: 65535 },
      API_KEY: { type: "string", title: "API key", description: "Server secret", required: true, sensitive: true },
    },
  })));
  zip.addFile("server.js", Buffer.from("process.stdin.resume();"));
  zip.writeZip(path.join(pluginRoot, "bundle.mcpb"));
  await fs.writeFile(path.join(pluginRoot, ".claude-plugin", "plugin.json"), JSON.stringify({
    name: "configurable",
    userConfig: {
      MODE: { type: "string", title: "Mode", description: "Plugin mode", required: true },
      TOKEN: { type: "string", title: "Token", description: "Plugin secret", required: true, sensitive: true },
    },
    mcpServers: "bundle.mcpb",
  }));
  await fs.mkdir(path.join(homeDir, ".claude", "plugins"), { recursive: true });
  await fs.writeFile(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
    version: 2,
    plugins: { [pluginId]: [{ scope: "user", installPath: pluginRoot }] },
  }));
  await fs.writeFile(path.join(homeDir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { [pluginId]: true } }));
  return { dataDir, homeDir, pluginId };
}

async function temporaryDirectory(prefix: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
}
