const { nativeImage } = require("electron");

// Paint a filled circle into a BGRA bitmap (Electron's toBitmap() order).
function paintRecordingDot(bitmap, width, height) {
  const out = Buffer.from(bitmap);
  const r = Math.max(2, Math.round(Math.min(width, height) * 0.3));
  const cx = width - r - 1;
  const cy = height - r - 1;
  for (let y = cy - r; y <= cy + r; y += 1) {
    for (let x = cx - r; x <= cx + r; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r || x < 0 || y < 0 || x >= width || y >= height)
        continue;
      const i = (y * width + x) * 4;
      out[i] = 0x1f;
      out[i + 1] = 0x5a;
      out[i + 2] = 0xff;
      out[i + 3] = 0xff;
    }
  }
  return out;
}

function createRecordingTrayIcon(baseIcon) {
  const { width, height } = baseIcon.getSize();
  return nativeImage.createFromBitmap(paintRecordingDot(baseIcon.toBitmap(), width, height), {
    width,
    height,
  });
}

module.exports = { paintRecordingDot, createRecordingTrayIcon };
