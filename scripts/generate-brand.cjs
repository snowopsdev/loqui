const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "../src/assets");
const source = path.join(root, "brand/source");
const manifest = require("../src/assets/brand/source/manifest.json");
const check = process.argv.includes("--check");
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
const outputs = new Map();

// Ignore almost-transparent export noise when locating the artwork, then retain
// four pixels around it. The source PNGs themselves remain byte-for-byte intact.
async function artwork(name) {
  const input = path.join(source, name);
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] <= 16) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  if (!right || !bottom) throw Error(`Empty source artwork: ${name}`);
  left = Math.max(0, left - 4);
  top = Math.max(0, top - 4);
  right = Math.min(info.width, right + 4);
  bottom = Math.min(info.height, bottom + 4);
  return sharp(input)
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toBuffer();
}

async function square(input, size, inset = 0) {
  const image = await sharp(input)
    .resize(size - inset * 2, size - inset * 2, { fit: "contain", background: transparent })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: transparent } })
    .composite([{ input: image, gravity: "centre" }])
    .png()
    .toBuffer();
}

async function generate() {
  for (const [name, { sha256 }] of Object.entries(manifest.files)) {
    const hash = createHash("sha256")
      .update(fs.readFileSync(path.join(source, name)))
      .digest("hex");
    if (hash !== sha256) throw Error(`Source artwork changed: ${name}; verify provenance first`);
  }
  const icon = await artwork("loqui-app-icon.png");
  const mark = await artwork("loqui-symbol.png");
  const wordmark = await artwork("loqui-horizontal-wordmark.png");
  const stacked = await artwork("loqui-stacked-lockup.png");

  // A consistent 86% footprint leaves room around the supplied rounded tile in
  // the Dock and Linux launchers. Render every size from the original image.
  for (const size of sizes)
    outputs.set(`brand/icon-${size}.png`, await square(icon, size, Math.round(size * 0.07)));
  outputs.set("icon.png", outputs.get("brand/icon-512.png"));
  outputs.set("favicon.png", outputs.get("brand/icon-32.png"));
  outputs.set("brand/mark.png", await square(mark, 512, 8));
  const horizontal = await sharp(wordmark).resize({ width: 800 }).png().toBuffer();
  outputs.set("brand/logo-light.png", horizontal);
  outputs.set("brand/logo-dark.png", horizontal);
  outputs.set(
    "brand/logo-stacked.png",
    await sharp(stacked).resize({ width: 512 }).png().toBuffer()
  );

  // Template images use only alpha. Preserve the silhouette and holes with
  // black RGB, so macOS supplies light/dark menu-bar contrast.
  const alpha = await sharp(mark).ensureAlpha().extractChannel("alpha").toBuffer();
  const { width, height } = await sharp(mark).metadata();
  const mono = await sharp({ create: { width, height, channels: 3, background: "#000000" } })
    .joinChannel(alpha)
    .png()
    .toBuffer();
  outputs.set("brand/mark-mono.png", await square(mono, 512, 8));
  for (const [name, size] of [
    ["iconTemplate.png", 16],
    ["iconTemplate@2x.png", 32],
    ["iconTemplate@3x.png", 48],
  ])
    outputs.set(name, await square(mono, size, size / 16));

  // Use integer sRGB alpha compositing for this opaque social background.
  // Native floating-point compositing differs by one channel level between
  // platforms; integer division keeps the strict artifact check reproducible.
  const { data: foreground, info } = await sharp(wordmark)
    .resize({ width: 960 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = [15, 23, 42];
  const pixels = Buffer.alloc(1200 * 630 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 15;
    pixels[i + 1] = 23;
    pixels[i + 2] = 42;
    pixels[i + 3] = 255;
  }
  const left = Math.floor((1200 - info.width) / 2);
  const top = Math.floor((630 - info.height) / 2);
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const sourceOffset = (y * info.width + x) * 4;
      const targetOffset = ((top + y) * 1200 + left + x) * 4;
      const alpha = foreground[sourceOffset + 3];
      for (let channel = 0; channel < 3; channel++) {
        pixels[targetOffset + channel] = Math.floor(
          (foreground[sourceOffset + channel] * alpha + background[channel] * (255 - alpha)) / 255
        );
      }
    }
  outputs.set(
    "brand/social.png",
    await sharp(pixels, {
      raw: { width: 1200, height: 630, channels: 4 },
    })
      .png()
      .toBuffer()
  );

  const chunks = [];
  for (const [type, size] of [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
    ["ic11", 32],
    ["ic12", 64],
    ["ic13", 256],
    ["ic14", 512],
  ]) {
    const png = outputs.get(`brand/icon-${size}.png`);
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  const bytes = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(bytes.length + 8, 4);
  outputs.set("icon.icns", Buffer.concat([header, bytes]));

  for (const [name, buffer] of outputs) {
    const file = path.join(root, name);
    if (check) {
      if (!fs.existsSync(file) || !fs.readFileSync(file).equals(buffer))
        throw Error(`Stale or missing Loqui artwork: ${name}; run npm run assets:generate`);
    } else fs.writeFileSync(file, buffer);
  }
  console.log(
    `${check ? "Verified" : "Generated"} ${outputs.size} Loqui assets from the supplied PNG pack`
  );
}
generate().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
