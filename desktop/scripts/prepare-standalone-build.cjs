/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const standaloneDir = path.join(projectRoot, ".next", "standalone");

fs.rmSync(standaloneDir, { force: true, recursive: true });

