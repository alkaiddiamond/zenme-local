/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

function ensureWindowsEnvironment(env = process.env, executablePath = process.execPath, platform = process.platform) {
  if (platform !== "win32") return env;
  const systemDrive = readEnvironmentValue(env, "SystemDrive") ||
    driveFromPath(readEnvironmentValue(env, "SystemRoot")) ||
    driveFromPath(readEnvironmentValue(env, "WINDIR")) ||
    driveFromPath(executablePath);
  if (systemDrive) {
    if (!Object.prototype.hasOwnProperty.call(env, "SystemDrive")) env.SystemDrive = systemDrive;
    if (!Object.prototype.hasOwnProperty.call(env, "SYSTEMDRIVE")) env.SYSTEMDRIVE = systemDrive;
    if (!readEnvironmentValue(env, "PROGRAMDATA")) env.PROGRAMDATA = path.win32.join(systemDrive, "ProgramData");
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || !value.includes("%")) continue;
    env[key] = expandWindowsEnvironmentValue(value, env);
  }
  return env;
}

function expandWindowsEnvironmentValue(value, env) {
  return value.replace(/%([^%]+)%/g, (match, name) => readEnvironmentValue(env, name) || match);
}

function readEnvironmentValue(env, name) {
  const wanted = name.toLocaleLowerCase();
  const key = Object.keys(env).find((candidate) => candidate.toLocaleLowerCase() === wanted);
  return key && typeof env[key] === "string" ? env[key] : "";
}

function driveFromPath(value) {
  if (!value) return "";
  const root = path.win32.parse(value).root;
  return /^[a-z]:\\$/i.test(root) ? root.slice(0, 2) : "";
}

module.exports = { ensureWindowsEnvironment, expandWindowsEnvironmentValue };
