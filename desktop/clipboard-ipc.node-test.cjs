/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mainSource = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
const preloadSource = fs.readFileSync(path.join(__dirname, "preload.cjs"), "utf8");

test("image clipboard writes native image and Zenme marker representations together", () => {
  assert.match(preloadSource, /writeClipboardImage:\s*\(input\).*zenme:write-clipboard-image/);
  assert.match(mainSource, /ipcMain\.handle\("zenme:write-clipboard-image"/);
  assert.match(mainSource, /nativeImage\.createFromBuffer\(Buffer\.from\(input\.bytes\)\)/);
  assert.match(mainSource, /clipboard\.write\(\{ image, text: input\.fallbackText \}\)/);
  assert.match(mainSource, /input\.bytes\.byteLength > 50 \* 1024 \* 1024/);
});
