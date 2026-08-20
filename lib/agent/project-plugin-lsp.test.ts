import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectProjectPluginLspDiagnostics,
  loadProjectPluginLspServers,
  queryProjectPluginLspCodeIntelligence,
  resetProjectPluginLspForTests,
} from "@/lib/agent/project-plugin-lsp";
import { createLocalProject } from "@/lib/local/project-repository";

const temporaryPaths: string[] = [];

afterEach(async () => {
  resetProjectPluginLspForTests();
  await Promise.all(temporaryPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

describe("project plugin LSP", () => {
  it("loads only enabled cc-haha plugin LSP declarations and expands plugin paths", async () => {
    const fixture = await createPluginFixture();
    await fs.writeFile(path.join(fixture.pluginRoot, ".lsp.json"), JSON.stringify({
      mock: {
        command: process.execPath,
        args: ["${CLAUDE_PLUGIN_ROOT}/server.cjs"],
        extensionToLanguage: { ".foo": "foo" },
        env: { PLUGIN_DATA: "${CLAUDE_PLUGIN_DATA}" },
      },
    }));

    const servers = await loadProjectPluginLspServers(fixture.projectId, fixture.dataDir, { homeDir: fixture.homeDir });

    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      id: "plugin:tools:mock",
      command: process.execPath,
      args: [`${await fs.realpath(fixture.pluginRoot)}/server.cjs`],
      extensionToLanguage: { ".foo": "foo" },
    });
    expect(servers[0]?.env.PLUGIN_DATA).toBe(path.join(fixture.homeDir, ".claude", "plugins", "data", "tools-example"));
  });

  it("uses a persistent stdio language server for code navigation", async () => {
    const fixture = await createPluginFixture();
    const sourcePath = path.join(fixture.workspace, "sample.foo");
    await fs.writeFile(sourcePath, "hello world\n", "utf8");
    await fs.writeFile(path.join(fixture.pluginRoot, "server.cjs"), mockLanguageServer(), "utf8");
    await fs.writeFile(path.join(fixture.pluginRoot, ".lsp.json"), JSON.stringify({
      mock: {
        command: process.execPath,
        args: ["${CLAUDE_PLUGIN_ROOT}/server.cjs"],
        extensionToLanguage: { ".foo": "foo" },
      },
    }));

    const result = await queryProjectPluginLspCodeIntelligence({
      character: 1,
      dataDir: fixture.dataDir,
      filePath: "sample.foo",
      homeDir: fixture.homeDir,
      line: 1,
      operation: "goToDefinition",
      projectId: fixture.projectId,
      rootPath: fixture.workspace,
    });

    expect(result).toEqual({
      available: true,
      filePath: "sample.foo",
      items: [{ column: 1, endColumn: 6, endLine: 1, file: "sample.foo", line: 1 }],
      operation: "goToDefinition",
      truncated: false,
    });
  });

  it("collects, normalizes, and deduplicates passive diagnostics published by plugin servers", async () => {
    const fixture = await createPluginFixture();
    await fs.writeFile(path.join(fixture.workspace, "sample.foo"), "bad value\n", "utf8");
    await fs.writeFile(path.join(fixture.pluginRoot, "server.cjs"), mockLanguageServer(), "utf8");
    await fs.writeFile(path.join(fixture.pluginRoot, ".lsp.json"), JSON.stringify({
      mock: {
        command: process.execPath,
        args: ["${CLAUDE_PLUGIN_ROOT}/server.cjs"],
        extensionToLanguage: { ".foo": "foo" },
      },
    }));

    const result = await collectProjectPluginLspDiagnostics({
      dataDir: fixture.dataDir,
      homeDir: fixture.homeDir,
      projectId: fixture.projectId,
      relativePaths: ["sample.foo"],
      rootPath: fixture.workspace,
    });

    expect(result).toMatchObject({ available: true, failures: [], serverCount: 1, truncated: false });
    expect(result.diagnostics).toEqual([{
      code: "mock-error",
      column: 1,
      file: "sample.foo",
      line: 1,
      message: "Mock diagnostic",
      severity: "error",
      source: "mock-lsp",
    }]);

    await expect(collectProjectPluginLspDiagnostics({
      dataDir: fixture.dataDir,
      homeDir: fixture.homeDir,
      projectId: fixture.projectId,
      relativePaths: ["sample.foo"],
      rootPath: fixture.workspace,
    })).resolves.toMatchObject({ diagnostics: result.diagnostics });
  });

  it("substitutes declared plugin user configuration into the LSP process only", async () => {
    const fixture = await createPluginFixture();
    await fs.writeFile(path.join(fixture.pluginRoot, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "tools",
      userConfig: {
        TOKEN: { type: "string", title: "Token", description: "API token", required: true, sensitive: true },
        MODE: { type: "string", title: "Mode", description: "Server mode", required: true },
      },
    }));
    await fs.writeFile(path.join(fixture.homeDir, ".claude", "settings.json"), JSON.stringify({
      enabledPlugins: { "tools@example": true },
      pluginConfigs: { "tools@example": { options: { MODE: "strict" } } },
    }));
    await fs.writeFile(path.join(fixture.homeDir, ".claude", ".credentials.json"), JSON.stringify({
      pluginSecrets: { "tools@example": { TOKEN: "secret-value" } },
    }));
    await fs.writeFile(path.join(fixture.pluginRoot, ".lsp.json"), JSON.stringify({
      mock: {
        command: process.execPath,
        args: ["server.cjs", "${user_config.MODE}"],
        env: { ACCESS_TOKEN: "${user_config.TOKEN}" },
        extensionToLanguage: { ".foo": "foo" },
      },
    }));

    const [server] = await loadProjectPluginLspServers(fixture.projectId, fixture.dataDir, { homeDir: fixture.homeDir });

    expect(server?.args).toEqual(["server.cjs", "strict"]);
    expect(server?.env.ACCESS_TOKEN).toBe("secret-value");
  });
});

async function createPluginFixture() {
  const dataDir = await temporaryDirectory("zenme-lsp-data-");
  const homeDir = await temporaryDirectory("zenme-lsp-home-");
  const workspace = await temporaryDirectory("zenme-lsp-workspace-");
  const project = await createLocalProject({ name: "Plugin LSP", prompt: "", model: "" }, dataDir);
  const pluginId = "tools@example";
  const pluginRoot = path.join(homeDir, ".claude", "plugins", "cache", "example", "tools", "1.0.0");
  await fs.mkdir(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
  await fs.mkdir(path.join(homeDir, ".claude", "plugins"), { recursive: true });
  await fs.writeFile(path.join(pluginRoot, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "tools" }));
  await fs.writeFile(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
    version: 2,
    plugins: { [pluginId]: [{ scope: "user", installPath: pluginRoot }] },
  }));
  await fs.writeFile(path.join(homeDir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { [pluginId]: true } }));
  return { dataDir, homeDir, pluginRoot, projectId: project.id, workspace };
}

async function temporaryDirectory(prefix: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
}

function mockLanguageServer() {
  return String.raw`
let buffer = Buffer.alloc(0);
process.stdin.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); drain(); });
function drain() {
  while (true) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) return;
    const header = buffer.subarray(0, end).toString();
    const match = /Content-Length: (\d+)/i.exec(header);
    if (!match) process.exit(2);
    const length = Number(match[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
    buffer = buffer.subarray(end + 4 + length);
    if (message.id !== undefined) {
      const result = message.method === 'initialize' ? { capabilities: { definitionProvider: true } } :
        message.method === 'textDocument/definition' ? [{ uri: message.params.textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } }] : null;
      send({ jsonrpc: '2.0', id: message.id, result });
    } else if (message.method === 'textDocument/didOpen' || message.method === 'textDocument/didChange') {
      const uri = message.params.textDocument.uri;
      send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: {
        uri,
        diagnostics: [
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, severity: 1, code: 'mock-error', source: 'mock-lsp', message: 'Mock diagnostic' },
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, severity: 1, code: 'mock-error', source: 'mock-lsp', message: 'Mock diagnostic' },
        ],
      }});
    }
  }
}
function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n');
  process.stdout.write(body);
}
`;
}
