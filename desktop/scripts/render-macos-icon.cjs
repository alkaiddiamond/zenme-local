/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const sharp = require("sharp");

const projectRoot = path.resolve(__dirname, "..", "..");
const sourceLogo = path.join(projectRoot, "public", "brand", "zenme-logo-cropped.png");
const outputIcon = path.join(projectRoot, "build", "icon-source-rounded.png");

const canvasSize = 1024;
const tileSize = 824;
const tileRadius = 185;
const logoWidth = 620;
const tileOffset = Math.round((canvasSize - tileSize) / 2);

async function renderIcon() {
  const logo = await sharp(sourceLogo)
    .resize({ width: logoWidth, withoutEnlargement: true })
    .png()
    .toBuffer();
  const logoMetadata = await sharp(logo).metadata();
  const logoLeft = Math.round((canvasSize - logoWidth) / 2);
  const logoTop = Math.round((canvasSize - (logoMetadata.height ?? 0)) / 2);

  const roundedTile = Buffer.from(`
    <svg width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="${tileOffset}"
        y="${tileOffset}"
        width="${tileSize}"
        height="${tileSize}"
        rx="${tileRadius}"
        ry="${tileRadius}"
        fill="#fff"
      />
    </svg>
  `);

  await sharp({
    create: {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      channels: 4,
      height: canvasSize,
      width: canvasSize,
    },
  })
    .composite([
      { input: roundedTile, left: 0, top: 0 },
      { input: logo, left: logoLeft, top: logoTop },
    ])
    .png()
    .toFile(outputIcon);

  console.log(`Generated ${outputIcon}`);
}

renderIcon().catch((error) => {
  console.error(error);
  process.exit(1);
});
