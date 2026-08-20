import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";

import { loadProjectPluginMcpbServer } from "@/lib/agent/project-plugin-mcpb";
import type { EnabledProjectPlugin } from "@/lib/agent/project-plugin-hooks";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

describe("project plugin MCPB", () => {
  it("extracts a trusted bundle, validates its manifest, and generates the stdio config", async () => {
    const fixture = await createFixture();
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest())));
    zip.addFile("server/index.js", Buffer.from("process.stdin.resume();"));
    zip.writeZip(path.join(fixture.plugin.root, "server.mcpb"));
    await writeConfiguration(fixture, {
      settings: { pluginConfigs: { [fixture.plugin.id]: { mcpServers: { bundle: { MODE: "strict" } } } } },
      credentials: { pluginSecrets: { [`${fixture.plugin.id}/bundle`]: { TOKEN: "secret-value" } } },
    });

    const loaded = await loadProjectPluginMcpbServer({
      projectId: "project-1",
      dataDir: fixture.dataDir,
      plugin: fixture.plugin,
      source: "server.mcpb",
      homeDir: fixture.homeDir,
    });

    expect(loaded.name).toBe("bundle");
    expect(loaded.config).toMatchObject({
      type: "stdio",
      command: "node",
      env: { MODE: "strict", TOKEN: "secret-value" },
    });
    expect(loaded.config.type === "stdio" ? loaded.config.args?.[0] : undefined).toMatch(/[\\/]\.mcpb-cache[\\/][a-f0-9]{16}[\\/]server[\\/]index\.js$/);
  });

  it("rejects archive path traversal before writing outside the cache", async () => {
    const fixture = await createFixture();
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest({
      user_config: undefined,
      server: {
        type: "node",
        entry_point: "server/index.js",
        mcp_config: { command: "node", args: ["${__dirname}/server/index.js"] },
      },
    }))));
    zip.addFile("aa/outside.txt", Buffer.from("unsafe"));
    const archive = zip.toBuffer();
    replaceAllBytes(archive, Buffer.from("aa/outside.txt"), Buffer.from("../outside.txt"));
    await fs.writeFile(path.join(fixture.plugin.root, "unsafe.dxt"), archive);

    await expect(loadProjectPluginMcpbServer({
      projectId: "project-1",
      dataDir: fixture.dataDir,
      plugin: fixture.plugin,
      source: "unsafe.dxt",
      homeDir: fixture.homeDir,
    })).rejects.toThrow(/路径穿越|条目路径无效/);
    await expect(fs.stat(path.join(fixture.plugin.dataRoot, ".mcpb-cache", "outside.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports missing required MCPB configuration instead of starting a broken server", async () => {
    const fixture = await createFixture();
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest())));
    zip.addFile("server/index.js", Buffer.from("process.stdin.resume();"));
    zip.writeZip(path.join(fixture.plugin.root, "server.mcpb"));

    await expect(loadProjectPluginMcpbServer({
      projectId: "project-1",
      dataDir: fixture.dataDir,
      plugin: fixture.plugin,
      source: "server.mcpb",
      homeDir: fixture.homeDir,
    })).rejects.toThrow(/缺少必需配置.*TOKEN/);
  });
});

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    manifest_version: "0.3",
    name: "bundle",
    version: "1.0.0",
    description: "Fixture MCP bundle",
    author: { name: "Zenme Test" },
    server: {
      type: "node",
      entry_point: "server/index.js",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/server/index.js"],
        env: { MODE: "${user_config.MODE}", TOKEN: "${user_config.TOKEN}" },
      },
    },
    user_config: {
      MODE: { type: "string", title: "Mode", description: "Execution mode", default: "safe" },
      TOKEN: { type: "string", title: "Token", description: "Access token", required: true, sensitive: true },
    },
    ...overrides,
  };
}

async function createFixture() {
  const dataDir = await temporaryDirectory("zenme-mcpb-data-");
  const homeDir = await temporaryDirectory("zenme-mcpb-home-");
  const pluginRoot = path.join(homeDir, ".claude", "plugins", "cache", "example", "tools", "1.0.0");
  const dataRoot = path.join(homeDir, ".claude", "plugins", "data", "tools-example");
  await fs.mkdir(pluginRoot, { recursive: true });
  const plugin: EnabledProjectPlugin = { id: "tools@example", name: "tools", root: pluginRoot, dataRoot };
  return { dataDir, homeDir, plugin };
}

async function writeConfiguration(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  value: { settings: unknown; credentials: unknown },
) {
  await fs.mkdir(path.join(fixture.homeDir, ".claude"), { recursive: true });
  await fs.writeFile(path.join(fixture.homeDir, ".claude", "settings.json"), JSON.stringify(value.settings));
  await fs.writeFile(path.join(fixture.homeDir, ".claude", ".credentials.json"), JSON.stringify(value.credentials));
}

async function temporaryDirectory(prefix: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
}

function replaceAllBytes(buffer: Buffer, search: Buffer, replacement: Buffer) {
  expect(replacement.length).toBe(search.length);
  let offset = 0;
  while ((offset = buffer.indexOf(search, offset)) >= 0) {
    replacement.copy(buffer, offset);
    offset += replacement.length;
  }
}
