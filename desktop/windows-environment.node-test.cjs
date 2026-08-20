/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const { ensureWindowsEnvironment } = require("./scripts/windows-environment.cjs");

test("desktop dev restores Windows system variables before Electron starts", () => {
  const env = {
    PROGRAMDATA: "%SystemDrive%\\ProgramData",
  };

  ensureWindowsEnvironment(env, "C:\\Program Files\\nodejs\\node.exe", "win32");

  assert.equal(env.SystemDrive, "C:");
  assert.equal(env.SYSTEMDRIVE, "C:");
  assert.equal(env.PROGRAMDATA, "C:\\ProgramData");
});
