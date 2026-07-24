/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
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
  const child = spawn(
    executable,
    ["--smoke-test", `--user-data-dir=${path.join(tempRoot, "electron")}`],
    {
      env: {
        ...process.env,
        ZENME_DATA_DIR: path.join(tempRoot, "data"),
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

  console.log(`Packaged app smoke test passed: ${executable}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
