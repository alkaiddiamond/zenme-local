/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

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

test("release package declares MIT and includes license notices", () => {
  assert.equal(packageJson.license, "MIT");
  assert.ok(packageJson.build.files.includes("LICENSE"));
  assert.ok(packageJson.build.files.includes("THIRD_PARTY_LICENSES.md"));
  assert.match(
    fs.readFileSync(path.join(projectRoot, "LICENSE"), "utf8"),
    /^MIT License/,
  );
});

test("release workflow requires signed Windows artifacts while macOS is paused", () => {
  const workflow = fs.readFileSync(
    path.join(projectRoot, ".github", "workflows", "release.yml"),
    "utf8",
  );

  assert.match(workflow, /Get-AuthenticodeSignature/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /needs: windows/);
  assert.doesNotMatch(workflow, /macos-intel:/);
});
