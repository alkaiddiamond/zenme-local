/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const desktopMain = fs.readFileSync(
  path.join(projectRoot, "desktop", "main.cjs"),
  "utf8",
);
const nextConfig = fs.readFileSync(
  path.join(projectRoot, "next.config.ts"),
  "utf8",
);
const standaloneVerifier = fs.readFileSync(
  path.join(projectRoot, "desktop", "scripts", "verify-standalone-runtime.cjs"),
  "utf8",
);
const packagedVerifier = fs.readFileSync(
  path.join(projectRoot, "desktop", "scripts", "verify-packaged-runtime.cjs"),
  "utf8",
);

test("desktop packages the traced Next standalone runtime", () => {
  assert.match(nextConfig, /output: "standalone"/);
  assert.equal(packageJson.build.asarUnpack, undefined);
  assert.ok(packageJson.build.files.includes("!node_modules/**/*"));

  const copiedDirectories = new Map(
    packageJson.build.extraResources.map((entry) => [entry.from, entry.to]),
  );
  assert.equal(copiedDirectories.get(".next/standalone"), "standalone");
  assert.equal(
    copiedDirectories.get(".next/standalone/node_modules"),
    "standalone/node_modules",
  );
  assert.equal(
    copiedDirectories.get(".next/static"),
    "standalone/.next/static",
  );
  assert.equal(copiedDirectories.get("public"), "standalone/public");
  assert.ok(!packageJson.build.files.includes("app/**/*"));
  assert.ok(!packageJson.build.files.includes("components/**/*"));
  assert.ok(!packageJson.build.files.includes("lib/**/*"));
});

test("desktop packaging requires both OCR models and the Tesseract worker", () => {
  assert.match(standaloneVerifier, /tesseract\.js\/src\/worker-script\/node\/index\.js/);
  assert.match(standaloneVerifier, /chi_sim\.traineddata\.gz/);
  assert.match(standaloneVerifier, /eng\.traineddata\.gz/);
  assert.equal(
    packageJson.build.afterPack,
    "desktop/scripts/verify-packaged-runtime.cjs",
  );
  assert.match(packagedVerifier, /tesseract\.js\/src\/worker-script\/node\/index\.js/);
  assert.match(packagedVerifier, /chi_sim\.traineddata\.gz/);
  assert.match(packagedVerifier, /eng\.traineddata\.gz/);
  assert.match(packagedVerifier, /electronPlatformName === "darwin"/);

  for (const scriptName of [
    "desktop:pack",
    "desktop:dist:win",
    "desktop:pack:mac:intel",
    "desktop:dist:mac:intel",
  ]) {
    assert.match(
      packageJson.scripts[scriptName],
      /verify-standalone-runtime\.cjs/,
    );
  }
});

test("packaged desktop starts standalone server while development keeps next dev", () => {
  assert.match(
    desktopMain,
    /path\.join\(process\.resourcesPath, "standalone"\)/,
  );
  assert.match(desktopMain, /path\.join\(root, "server\.js"\)/);
  assert.match(desktopMain, /require\.resolve\("next\/dist\/bin\/next"\)/);
  assert.match(desktopMain, /"dev",[\s\S]*?"--hostname"/);
  assert.match(desktopMain, /ELECTRON_RUN_AS_NODE/);
  assert.match(desktopMain, /LOCAL_MODEL_OCR_CACHE_PATH/);
  assert.match(desktopMain, /LOCAL_MODEL_OCR_LANG_PATH/);
});
