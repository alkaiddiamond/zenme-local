/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const requiredRuntimePaths = [
  "standalone/server.js",
  "standalone/node_modules/tesseract.js/src/worker-script/node/index.js",
  "standalone/node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz",
  "standalone/node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
];

module.exports = async function verifyPackagedRuntime(context) {
  const resourcesDir = context.electronPlatformName === "darwin"
    ? path.join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`,
        "Contents",
        "Resources",
      )
    : path.join(context.appOutDir, "resources");

  const missingPaths = requiredRuntimePaths.filter((relativePath) => {
    const absolutePath = path.join(resourcesDir, ...relativePath.split("/"));
    return !fs.existsSync(absolutePath) || fs.statSync(absolutePath).size === 0;
  });

  if (missingPaths.length > 0) {
    throw new Error(
      `Packaged standalone runtime is incomplete. Missing: ${missingPaths.join(", ")}`,
    );
  }

  console.log("Packaged runtime verified with chi_sim and eng OCR models.");
};
