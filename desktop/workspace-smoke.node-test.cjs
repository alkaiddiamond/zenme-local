/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
const flowSource = source.slice(
  source.indexOf("async function verifyPackagedWorkspaceFlow("),
  source.indexOf("async function verifyBrowserText("),
);

function fixture({ commandError, previewError, missingRuntime = false } = {}) {
  let value = "alpha";
  const calls = [];
  const stopped = [];
  const preview = new EventEmitter();
  preview.pid = 42;
  preview.exitCode = null;
  preview.signalCode = null;
  preview.kill = () => { stopped.push("parent-only"); };
  const executable = "C:\\Program Files\\nodejs\\node.exe";
  const cli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  const context = vm.createContext({
    path: path.win32,
    process: { platform: "win32", env: missingRuntime ? {} : { npm_node_execpath: executable, npm_execpath: cli } },
    fs: {
      existsSync: () => true,
      readFileSync: () => value,
      writeFileSync: (_filename, content) => { value = content.trim(); },
    },
    DESKTOP_API_TOKEN: "test-only-token",
    fetch: async (url) => ({
      ok: true,
      text: async () => url.includes("/api/") ? JSON.stringify({ id: "fixture-id" }) : value,
    }),
    spawnSync: (command, args, options) => {
      calls.push({ command, args: Array.from(args), options });
      if (command.endsWith(".cmd") || commandError) {
        return { status: null, error: commandError ?? new Error("spawnSync npm.cmd EINVAL") };
      }
      return { status: 0, stdout: "workspace-test-ok", stderr: "" };
    },
    spawn: (command, args, options) => {
      calls.push({ command, args: Array.from(args), options });
      if (previewError) queueMicrotask(() => preview.emit("error", previewError));
      return preview;
    },
    stopChildProcess: (child) => { stopped.push(child.pid); },
    verifyBrowserText: async (_url, expected) => { assert.equal(value, expected); },
    console: { log() {} },
    setTimeout,
  });
  vm.runInContext(flowSource, context);
  return {
    calls, stopped, executable, cli,
    run: () => context.verifyPackagedWorkspaceFlow("http://127.0.0.1:10001", "C:\\smoke workspace", "http://127.0.0.1:10002"),
  };
}

test("workspace smoke runs npm through Node with separate arguments and cleans up the preview tree", async () => {
  const input = fixture();
  await input.run();
  assert.equal(input.calls.length, 2);
  for (const call of input.calls) {
    assert.equal(call.command, input.executable);
    assert.equal(call.options.cwd, "C:\\smoke workspace");
    assert.equal(call.options.windowsHide, true);
    assert.notEqual(call.options.shell, true);
  }
  assert.deepEqual(input.calls[0].args, [input.cli, "test"]);
  assert.deepEqual(input.calls[1].args, [input.cli, "run", "preview"]);
  assert.ok(input.calls[0].options.timeout > 0);
  assert.deepEqual(input.stopped, [42]);
});

test("workspace smoke reports the actual command startup error", async () => {
  const input = fixture({ commandError: new Error("spawnSync node.exe ENOENT") });
  await assert.rejects(input.run(), /spawnSync node\.exe ENOENT/);
});

test("workspace smoke rejects missing Node/npm paths before spawning", async () => {
  const input = fixture({ missingRuntime: true });
  await assert.rejects(input.run(), /npm run desktop:smoke/);
  assert.equal(input.calls.length, 0);
});

test("workspace smoke reports preview startup errors and still cleans up", async () => {
  const input = fixture({ previewError: new Error("spawn node.exe ENOENT") });
  await assert.rejects(input.run(), /spawn node\.exe ENOENT/);
  assert.deepEqual(input.stopped, [42]);
});
