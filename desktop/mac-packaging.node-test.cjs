/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);

test("macOS release targets Intel x64 on the supported OS baseline", () => {
  const mac = packageJson.build.mac;

  assert.equal(mac.minimumSystemVersion, "12.0");
  assert.equal(mac.icon, "build/icon.icns");
  assert.deepEqual(
    mac.target.map(({ target, arch }) => ({ target, arch })),
    [
      { target: "dmg", arch: ["x64"] },
      { target: "zip", arch: ["x64"] },
    ],
  );
  assert.match(mac.artifactName, /\$\{arch\}/);
});

test("macOS Intel build tooling prepares the icon and uses an Intel runner", () => {
  const iconScript = fs.readFileSync(
    path.join(projectRoot, "desktop", "scripts", "prepare-macos-icon.sh"),
    "utf8",
  );
  const workflow = fs.readFileSync(
    path.join(projectRoot, ".github", "workflows", "verify-macos-intel.yml"),
    "utf8",
  );

  assert.match(packageJson.scripts["desktop:dist:mac:intel"], /--mac dmg zip --x64/);
  assert.match(iconScript, /iconutil -c icns/);
  assert.match(workflow, /runs-on: macos-15-intel/);
  assert.match(workflow, /npm run desktop:dist:mac:intel/);
  assert.match(packageJson.scripts["desktop:smoke"], /smoke-packaged-app/);
});
