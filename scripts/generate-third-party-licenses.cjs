/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"));

function repositoryUrl(repository) {
  const value = typeof repository === "string" ? repository : repository?.url;
  if (!value) return "";
  const normalized = value
    .replace(/^git\+/, "")
    .replace(/^github:/, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^git:\/\/github\.com\//, "https://github.com/")
    .replace(/\.git$/, "");
  return /^[\w.-]+\/[\w.-]+$/.test(normalized)
    ? `https://github.com/${normalized}`
    : normalized;
}

const packages = new Map();
for (const [packagePath, lockEntry] of Object.entries(lock.packages ?? {})) {
  if (!packagePath.startsWith("node_modules/")) continue;

  const packageJsonPath = path.join(projectRoot, packagePath, "package.json");
  let metadata = {};
  if (fs.existsSync(packageJsonPath)) {
    metadata = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  }

  const name = metadata.name ?? lockEntry.name;
  const version = metadata.version ?? lockEntry.version;
  if (!name || !version) continue;

  const includedAtRuntime = lockEntry.dev !== true || name === "electron";
  if (!includedAtRuntime) continue;

  const license = metadata.license
    ?? lockEntry.license
    ?? (Array.isArray(metadata.licenses)
      ? metadata.licenses.map((item) => item.type ?? item).join(" OR ")
      : "UNKNOWN");
  const repository = repositoryUrl(metadata.repository ?? lockEntry.repository);
  packages.set(`${name}@${version}`, { name, version, license, repository });
}

const rows = Array.from(packages.values()).sort((left, right) =>
  left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
);

const lines = [
  "# Third-Party Licenses",
  "",
  "Zenme's original source code is licensed under the MIT License. This file covers bundled third-party software only; each component remains subject to its own license.",
  "",
  "Zenme bundles the runtime packages listed below. This inventory is generated from `package-lock.json` and installed package metadata with `npm run licenses:generate`.",
  "",
  "Original license files remain bundled with their packages. Electron distributions also include Electron and Chromium license notices. Before every public release, regenerate this file and review any `UNKNOWN`, non-permissive, or changed license entry.",
  "",
  "| Package | Version | License | Source |",
  "| --- | --- | --- | --- |",
  ...rows.map(({ name, version, license, repository }) => {
    const source = repository ? `[source](${repository})` : "—";
    return `| ${name.replaceAll("|", "\\|")} | ${version} | ${String(license).replaceAll("|", "\\|")} | ${source} |`;
  }),
  "",
];

fs.writeFileSync(path.join(projectRoot, "THIRD_PARTY_LICENSES.md"), lines.join("\n"));
console.log(`Wrote THIRD_PARTY_LICENSES.md with ${rows.length} runtime packages.`);
