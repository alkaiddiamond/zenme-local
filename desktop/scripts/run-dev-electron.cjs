/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("node:child_process");
const path = require("node:path");

const prepareDevElectronApp = path.resolve(
  __dirname,
  "prepare-dev-electron-app.cjs",
);

const prepare = spawn(process.execPath, [prepareDevElectronApp], {
  stdio: ["ignore", "pipe", "inherit"],
});

let executablePath = "";
prepare.stdout.on("data", (chunk) => {
  executablePath += String(chunk);
});

prepare.on("close", (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
    return;
  }

  const electronExecutable = executablePath.trim() || require("electron");
  const child = spawn(electronExecutable, process.argv.slice(2), {
    stdio: "inherit",
    windowsHide: false,
  });
  let childClosed = false;

  child.on("close", (childCode, signal) => {
    childClosed = true;
    if (childCode === null) {
      console.error(`${electronExecutable} exited with signal ${signal}`);
      process.exit(1);
      return;
    }
    process.exit(childCode);
  });

  for (const signal of ["SIGINT", "SIGTERM", "SIGUSR2"]) {
    process.on(signal, () => {
      if (!childClosed) {
        child.kill(signal);
      }
    });
  }
});
