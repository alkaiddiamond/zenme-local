/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const desktopMain = fs.readFileSync(
  path.join(projectRoot, "desktop", "main.cjs"),
  "utf8",
);

test("Windows keeps standard editing shortcuts without showing a native menu bar", () => {
  assert.doesNotMatch(desktopMain, /Menu\.setApplicationMenu\(null\)/);
  assert.match(
    desktopMain,
    /process\.platform !== "darwin"[\s\S]*Menu\.buildFromTemplate\(\[\{ role: "editMenu" \}\]\)/,
  );
  assert.match(desktopMain, /autoHideMenuBar: true/);
});

test("Windows release targets an x64 NSIS installer without deleting user data", () => {
  assert.deepEqual(packageJson.build.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(packageJson.build.nsis.oneClick, false);
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(packageJson.build.nsis.include, "desktop/installer.nsh");
  assert.match(
    fs.readFileSync(path.join(projectRoot, "desktop", "installer.nsh"), "utf8"),
    /ShowInstDetails show/,
  );
  assert.match(
    fs.readFileSync(path.join(projectRoot, "desktop", "installer.nsh"), "utf8"),
    /SetDetailsPrint both/,
  );
  assert.match(
    fs.readFileSync(path.join(projectRoot, "desktop", "installer.nsh"), "utf8"),
    /DetailPrint "Preparing the Zenme installation/,
  );
  assert.match(packageJson.scripts["desktop:dist:win"], /--win nsis --x64/);
});

test("Windows release uses the native cc-haha command lifecycle without a bundled Codex sandbox", () => {
  assert.equal(packageJson.dependencies["@openai/codex"], undefined);
  assert.equal(packageJson.build.win.extraResources, undefined);
  assert.doesNotMatch(desktopMain, /ZENME_WINDOWS_SANDBOX_BIN/);
  assert.doesNotMatch(desktopMain, /codex-win32-x64/);
  assert.match(desktopMain, /ZENME_SERVER_INSTANCE_ID: crypto\.randomUUID\(\)/);
  assert.match(desktopMain, /spawnSync\("taskkill\.exe", \["\/PID", String\(child\.pid\), "\/T", "\/F"\]/);
});

test("desktop release bundles the isolated Agent browser controller", () => {
  assert.ok(packageJson.build.files.includes("desktop/browser-control.cjs"));
  assert.match(desktopMain, /startBrowserControlServer/);
  assert.match(desktopMain, /ZENME_BROWSER_CONTROL_URL: browserControlUrl/);
  const browserControl = fs.readFileSync(path.join(projectRoot, "desktop", "browser-control.cjs"), "utf8");
  assert.match(browserControl, /hostname === "localhost" \|\| hostname === "127\.0\.0\.1" \|\| hostname === "::1"/);
  assert.match(browserControl, /contextIsolation: true/);
  assert.match(browserControl, /nodeIntegration: false/);
  assert.match(browserControl, /sandbox: true/);
});

test("release package declares MIT and includes license notices", () => {
  assert.equal(packageJson.license, "MIT");
  assert.ok(packageJson.build.files.includes("LICENSE"));
  assert.ok(packageJson.build.files.includes("THIRD_PARTY_LICENSES.md"));
  assert.match(
    fs.readFileSync(path.join(projectRoot, "LICENSE"), "utf8"),
    /^MIT License/,
  );
});

test("release workflow allows verified unsigned Windows artifacts while macOS is paused", () => {
  const workflow = fs.readFileSync(
    path.join(projectRoot, ".github", "workflows", "release.yml"),
    "utf8",
  );

  assert.match(workflow, /Get-AuthenticodeSignature/);
  assert.match(workflow, /Windows signing credentials are not configured/);
  assert.match(workflow, /Status -ne 'NotSigned'/);
  assert.doesNotMatch(workflow, /signing secrets are required for a release/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /needs: windows/);
  assert.doesNotMatch(workflow, /macos-intel:/);
});
