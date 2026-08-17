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
  const inherited = Object.fromEntries(allowed.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]!]])) as Record<string, string>;
  return {
    NODE_ENV: normalizeNodeEnvironment(source.NODE_ENV),
    ...inherited,
    [platform === "win32" ? "Path" : "PATH"]: executablePath,
  };
}

function normalizeNodeEnvironment(value: string | undefined): NodeEnvironment {
  return value === "development" || value === "production" || value === "test" ? value : "test";
}
