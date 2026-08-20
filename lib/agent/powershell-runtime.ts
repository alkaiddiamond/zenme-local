import fs from "node:fs/promises";
import path from "node:path";

type Access = (candidate: string) => Promise<unknown>;
type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export async function resolvePowerShellExecutable(
  source: EnvironmentSource = process.env,
  platform: NodeJS.Platform = process.platform,
  access: Access = fs.access,
) {
  if (platform !== "win32") return null;
  const override = source.ZENME_POWERSHELL_PATH?.trim();
  if (override && isPowerShellExecutable(override) && hasPathSeparator(override)) {
    if (await isAccessible(override, access)) return path.win32.resolve(override);
  }

  const pathDirectories = (source.PATH ?? source.Path ?? "").split(path.win32.delimiter).filter(Boolean);
  const windowsRoot = source.SystemRoot ?? source.SYSTEMROOT ?? "C:\\Windows";
  const programFiles = source.ProgramFiles ?? source.PROGRAMFILES ?? "C:\\Program Files";
  const discovered = [
    ...pathDirectories.map((directory) => path.win32.join(directory, "pwsh.exe")),
    path.win32.join(programFiles, "PowerShell", "7", "pwsh.exe"),
    ...pathDirectories.map((directory) => path.win32.join(directory, "powershell.exe")),
    path.win32.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  ];
  const overrideBasename = override && isPowerShellExecutable(override) && !hasPathSeparator(override)
    ? path.win32.basename(override).replace(/\.exe$/i, "").toLowerCase()
    : null;
  const candidates = overrideBasename
    ? [
        ...discovered.filter((candidate) => path.win32.basename(candidate).toLowerCase().startsWith(overrideBasename)),
        ...discovered.filter((candidate) => !path.win32.basename(candidate).toLowerCase().startsWith(overrideBasename)),
      ]
    : discovered;
  for (const candidate of candidates) {
    if (await isAccessible(candidate, access)) return path.win32.resolve(candidate);
  }
  return null;
}

function isPowerShellExecutable(candidate: string) {
  return /^(?:pwsh|powershell)(?:\.exe)?$/i.test(path.win32.basename(candidate));
}

function hasPathSeparator(candidate: string) {
  return candidate.includes("/") || candidate.includes("\\");
}

async function isAccessible(candidate: string, access: Access) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}
