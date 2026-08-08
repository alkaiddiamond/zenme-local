/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const APP_NAME = "Zenme";
const APP_ID = "local.zenme.desktop.dev";

if (process.platform !== "darwin") {
  process.exit(0);
}

const projectRoot = path.resolve(__dirname, "../..");
const electronDistDir = path.join(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
);
const sourceElectronApp = path.join(electronDistDir, "Electron.app");
const electronApp = path.join(electronDistDir, `${APP_NAME}.app`);
const executablePath = path.join(electronApp, "Contents", "MacOS", "Electron");
const plistPath = path.join(electronApp, "Contents", "Info.plist");

if (!fs.existsSync(sourceElectronApp)) {
  console.warn(`Skipping dev app name setup; missing ${sourceElectronApp}`);
  process.exit(0);
}

fs.rmSync(electronApp, { force: true, recursive: true });
execFileSync("ditto", [sourceElectronApp, electronApp], { stdio: "ignore" });

const renamedExecutablePath = path.join(electronApp, "Contents", "MacOS", APP_NAME);
if (fs.existsSync(renamedExecutablePath) && !fs.existsSync(executablePath)) {
  fs.renameSync(renamedExecutablePath, executablePath);
}

if (!fs.existsSync(plistPath)) {
  console.warn(`Skipping dev app name setup; missing ${plistPath}`);
  process.exit(0);
}

function setPlistValue(key, value) {
  try {
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      `Set :${key} ${value}`,
      plistPath,
    ], { stdio: "ignore" });
  } catch {
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      `Add :${key} string ${value}`,
      plistPath,
    ], { stdio: "ignore" });
  }
}

setPlistValue("CFBundleName", APP_NAME);
setPlistValue("CFBundleDisplayName", APP_NAME);
setPlistValue("CFBundleIdentifier", APP_ID);
setPlistValue("CFBundleExecutable", "Electron");
fs.utimesSync(electronApp, new Date(), new Date());

console.log(executablePath);
