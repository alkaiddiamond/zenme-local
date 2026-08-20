/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const standaloneDir = path.join(projectRoot, ".next", "standalone");
const staleDevDir = path.join(projectRoot, ".next", "dev");
const staleTypesDir = path.join(projectRoot, ".next", "types");

fs.rmSync(standaloneDir, { force: true, recursive: true });
// Old builds/dev sessions can leave generated route validators behind after a
// route is retired. They are derived output and must not participate in the
// next production type check.
fs.rmSync(staleDevDir, { force: true, recursive: true });
fs.rmSync(staleTypesDir, { force: true, recursive: true });

