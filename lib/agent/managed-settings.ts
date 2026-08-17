import path from "node:path";

/**
 * Local, administrator-owned policy roots used by cc-haha. Zenme also accepts
 * a native sibling root without weakening the Claude-compatible policy path.
 */
export function getDefaultManagedSettingsDirectories() {
  if (process.platform === "win32") return ["C:\\Program Files\\ClaudeCode", "C:\\Program Files\\Zenme"];
  if (process.platform === "darwin") {
    return ["/Library/Application Support/ClaudeCode", "/Library/Application Support/Zenme"];
  }
  return ["/etc/claude-code", "/etc/zenme"];
}

export function managedComponentDirectories(
  component: "agents" | "commands" | "output-styles" | "skills",
  directories: readonly string[] = getDefaultManagedSettingsDirectories(),
) {
  return directories.map((directory) => path.join(directory, ".claude", component));
}
