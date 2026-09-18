const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");
const { downloadFile } = require("./lib/download-utils");
async function main() {
  execFileSync(process.execPath, ["node_modules/electron/install.js"], { stdio: "inherit" });
  const platform = `${process.platform}-${process.arch}`;
  if (!["linux-x64", "darwin-arm64"].includes(platform)) throw Error("Unsupported platform");
  const base = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/";
  const dir = path.resolve("node_modules/ffmpeg-static");
  const archive = path.join(dir, "ffmpeg.gz");
  await downloadFile(`${base}ffmpeg-${platform}.gz`, archive);
  fs.writeFileSync(path.join(dir, "ffmpeg"), zlib.gunzipSync(fs.readFileSync(archive)), {
    mode: 0o755,
  });
  fs.chmodSync(path.join(dir, "ffmpeg"), 0o755);
  fs.unlinkSync(archive);
  for (const ext of ["LICENSE", "README"])
    await downloadFile(`${base}${platform}.${ext}`, path.join(dir, `ffmpeg.${ext}`));
  // ONNX's CPU/CoreML binaries ship inside its lockfile-integrity-verified npm
  // package. Its install hook fetches optional CUDA libraries, not used by the
  // embedding worker; speech GPU acceleration is supplied by sherpa/llama.
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
