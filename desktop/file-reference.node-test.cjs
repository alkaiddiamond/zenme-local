/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const preloadSource = fs.readFileSync(path.join(__dirname, "preload.cjs"), "utf8");

test("desktop exposes only the scoped File-to-path bridge for local references", () => {
  assert.match(preloadSource, /webUtils\.getPathForFile\(file\)/);
  assert.doesNotMatch(preloadSource, /require\(["']node:fs["']\)/);
});

test("desktop inspects only folders represented by dropped File objects", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(preloadSource, /inspectMusicFolderForFile: \(file\)/);
  assert.match(preloadSource, /webUtils\.getPathForFile\(file\)/);
  assert.match(mainSource, /zenme:inspect-music-folder/);
  assert.match(mainSource, /audioExtensions/);
});
