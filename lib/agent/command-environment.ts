import path from "node:path";

type NodeEnvironment = "development" | "production" | "test";
type CommandEnvironment = Record<string, string> & { NODE_ENV: NodeEnvironment };

export function buildCommandEnvironment(
  runtimeExecutable?: string,
  source: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
  hostRuntimeExecutable: string = process.execPath,
): CommandEnvironment {
  const allowed = [
    "SYSTEMROOT", "SystemRoot", "COMSPEC", "ComSpec", "PATHEXT", "PSModulePath",
    "SYSTEMDRIVE", "SystemDrive", "WINDIR", "windir",
    "TEMP", "TMP", "TMPDIR", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "USERNAME",
    "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
    "LANG", "LC_ALL", "TERM", "COLORTERM", "CI", "NO_COLOR", "FORCE_COLOR",
  ];
  const inheritedPath = source.PATH ?? source.Path ?? "";
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  // cc-haha executes every shell command with the session runtime environment.
  // Zenme intentionally keeps a secret-safe allowlist, but must still expose the
  // Node runtime that owns the local server. PowerShell-launched package-manager
  // shims resolve `node` themselves, so only adding the directory when the direct
  // executable is Node leaves `pnpm run dev` broken in packaged desktop builds.
  const directRuntimeIsNode = Boolean(runtimeExecutable && /^node(?:\.exe)?$/i.test(pathApi.basename(runtimeExecutable)));
  const runtimeCandidate = directRuntimeIsNode ? runtimeExecutable : hostRuntimeExecutable;
  const runtimeDirectories = (runtimeCandidate && /^node(?:\.exe)?$/i.test(pathApi.basename(runtimeCandidate)) ? [runtimeCandidate] : [])
    .map((candidate) => pathApi.dirname(candidate))
    .filter(Boolean);
  const pathEntries = inheritedPath.split(pathApi.delimiter).filter(Boolean);
  for (const runtimeDirectory of runtimeDirectories.reverse()) {
    if (!pathEntries.some((entry) => pathApi.normalize(entry).toLocaleLowerCase() === pathApi.normalize(runtimeDirectory).toLocaleLowerCase())) {
      pathEntries.unshift(runtimeDirectory);
    }
  }
  const executablePath = pathEntries.join(pathApi.delimiter);
  const inferredSystemDrive = windowsSystemDrive(source, hostRuntimeExecutable, platform);
  const expandedSource: Record<string, string | undefined> = { ...source };
  if (platform === "win32" && inferredSystemDrive) {
    expandedSource.SystemDrive ??= inferredSystemDrive;
    expandedSource.SYSTEMDRIVE ??= inferredSystemDrive;
    expandedSource.PROGRAMDATA ??= path.win32.join(inferredSystemDrive, "ProgramData");
  }
  const inherited = Object.fromEntries(allowed.flatMap((key) => expandedSource[key] === undefined ? [] : [
    [key, platform === "win32" ? expandWindowsEnvironmentValue(expandedSource[key]!, expandedSource) : expandedSource[key]!],
  ])) as Record<string, string>;
  return {
    NODE_ENV: normalizeNodeEnvironment(source.NODE_ENV),
    ...inherited,
    [platform === "win32" ? "Path" : "PATH"]: executablePath,
  };
}

function windowsSystemDrive(
  source: Readonly<Record<string, string | undefined>>,
  hostRuntimeExecutable: string,
  platform: NodeJS.Platform,
) {
  if (platform !== "win32") return "";
  const direct = source.SystemDrive ?? source.SYSTEMDRIVE;
  if (direct && /^[a-z]:$/i.test(direct)) return direct;
  for (const candidate of [source.SystemRoot, source.SYSTEMROOT, source.WINDIR, source.windir, hostRuntimeExecutable]) {
    if (!candidate) continue;
    const root = path.win32.parse(candidate).root;
    if (/^[a-z]:\\$/i.test(root)) return root.slice(0, 2);
  }
  return "";
}

function expandWindowsEnvironmentValue(value: string, source: Readonly<Record<string, string | undefined>>) {
  return value.replace(/%([^%]+)%/g, (match, name: string) => {
    const wanted = name.toLocaleLowerCase();
    const key = Object.keys(source).find((candidate) => candidate.toLocaleLowerCase() === wanted);
    return key && typeof source[key] === "string" ? source[key]! : match;
  });
}

function normalizeNodeEnvironment(value: string | undefined): NodeEnvironment {
  return value === "development" || value === "production" || value === "test" ? value : "test";
}
