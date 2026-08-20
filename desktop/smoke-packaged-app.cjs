/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");

function packagedExecutable() {
  if (process.env.ZENME_PACKAGED_APP) {
    return path.resolve(process.env.ZENME_PACKAGED_APP);
  }

  if (process.platform === "win32") {
    return path.join(projectRoot, "dist-desktop", "win-unpacked", "Zenme.exe");
  }

  if (process.platform === "darwin") {
    const candidates = ["mac", "mac-x64"].map((directory) =>
      path.join(
        projectRoot,
        "dist-desktop",
        directory,
        "Zenme.app",
        "Contents",
        "MacOS",
        "Zenme",
      ),
    );
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
  }

  return path.join(projectRoot, "dist-desktop", "linux-unpacked", "zenme-local");
}

async function main() {
  const executable = packagedExecutable();
  if (!fs.existsSync(executable)) {
    throw new Error(`Packaged application not found: ${executable}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zenme-package-smoke-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const previewPort = await reservePort();
  fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "src", "value.txt"), "alpha\n", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "package.json"), `${JSON.stringify({
    name: "zenme-packaged-smoke-workspace",
    private: true,
    scripts: {
      test: "node test.cjs",
      preview: "node server.cjs",
    },
  }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "test.cjs"), [
    "const assert = require('node:assert/strict');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "assert.equal(fs.readFileSync(path.join(__dirname, 'src', 'value.txt'), 'utf8').trim(), 'beta');",
    "console.log('workspace-test-ok');",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "server.cjs"), [
    "const fs = require('node:fs');",
    "const http = require('node:http');",
    "const path = require('node:path');",
    `const port = ${previewPort};`,
    "const server = http.createServer((_request, response) => {",
    "  response.setHeader('content-type', 'text/plain; charset=utf-8');",
    "  response.end(fs.readFileSync(path.join(__dirname, 'src', 'value.txt'), 'utf8'));",
    "});",
    "server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));",
    "",
  ].join("\n"), "utf8");
  const child = spawn(
    executable,
    ["--smoke-test", `--user-data-dir=${path.join(tempRoot, "electron")}`],
    {
      env: {
        ...process.env,
        ZENME_DATA_DIR: path.join(tempRoot, "data"),
        ZENME_SMOKE_PREVIEW_URL: `http://127.0.0.1:${previewPort}`,
        ZENME_SMOKE_WORKSPACE: workspaceRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let output = "";
  child.stdout.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-12_000);
  });
  child.stderr.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-12_000);
  });

  let timeoutId;
  const result = await Promise.race([
    new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Packaged app smoke test timed out")),
        60_000,
      );
    }),
  ]).finally(() => {
    clearTimeout(timeoutId);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    fs.rmSync(tempRoot, { force: true, recursive: true });
  });

  if (result.code !== 0) {
    throw new Error(`Packaged app exited unexpectedly (${JSON.stringify(result)})\n${output}`);
  }
  if (!output.includes("[zenme-browser] smoke verified")) {
    throw new Error(`Packaged app did not complete Browser smoke verification\n${output}`);
  }
  if (!output.includes("[zenme-workspace] packaged smoke verified")) {
    throw new Error(`Packaged app did not complete Workspace smoke verification\n${output}`);
  }

  console.log(`Packaged app smoke test passed: ${executable}`);
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Unable to reserve packaged smoke preview port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
