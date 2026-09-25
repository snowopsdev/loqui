const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const root = path.resolve(__dirname, "../src/assets");
async function generate() {
  const icon = path.join(root, "brand/app-icon.svg");
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024])
    await sharp(icon)
      .resize(size, size)
      .png()
      .toFile(path.join(root, `brand/icon-${size}.png`));
  fs.copyFileSync(path.join(root, "brand/icon-512.png"), path.join(root, "icon.png"));
  for (const [name, size] of [
    ["iconTemplate.png", 16],
    ["iconTemplate@2x.png", 32],
    ["iconTemplate@3x.png", 48],
  ])
    await sharp(path.join(root, "brand/mark-mono.svg"))
      .resize(size, size)
      .png()
      .toFile(path.join(root, name));
  for (const name of ["mark", "logo-light", "logo-dark", "social"])
    await sharp(path.join(root, `brand/${name}.svg`))
      .png()
      .toFile(path.join(root, `brand/${name}.png`));
  const chunks = [];
  for (const [type, size] of [
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ]) {
    const png = fs.readFileSync(path.join(root, `brand/icon-${size}.png`));
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  const bytes = Buffer.concat(chunks),
    header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(bytes.length + 8, 4);
  fs.writeFileSync(path.join(root, "icon.icns"), Buffer.concat([header, bytes]));
}
generate().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
