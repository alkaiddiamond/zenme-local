/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const requiredPaths = [
  ".next/standalone/server.js",
  ".next/standalone/node_modules/tesseract.js/src/worker-script/node/index.js",
  ".next/standalone/node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz",
  ".next/standalone/node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  ".next/static",
  "public",
];

const missingPaths = requiredPaths.filter((relativePath) => {
  const absolutePath = path.join(projectRoot, ...relativePath.split("/"));
  if (!fs.existsSync(absolutePath)) return true;
  return fs.statSync(absolutePath).isFile() && fs.statSync(absolutePath).size === 0;
});

if (missingPaths.length > 0) {
  throw new Error(
    `Standalone runtime is incomplete. Run npm run build before packaging. Missing: ${missingPaths.join(", ")}`,
  );
}

console.log("Standalone runtime verified with chi_sim and eng OCR models.");
