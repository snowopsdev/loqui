const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { version } = require("../package.json");
const yaml = require("js-yaml");
const dir = "release";
const channel = version.includes("-") ? "beta" : "latest";
const required = [
  `Loqui-${version}-mac-arm64.dmg`,
  `Loqui-${version}-mac-arm64.zip`,
  `Loqui-${version}-linux-x64.AppImage`,
  `Loqui-${version}-linux-x64.tar.gz`,
  `${channel}-mac.yml`,
  `${channel}-linux.yml`,
  "SBOM.cdx.json",
];
for (const name of fs.readdirSync(dir)) {
  if (name.endsWith(".yml") && ![`${channel}-mac.yml`, `${channel}-linux.yml`].includes(name))
    throw Error(`Unexpected channel metadata: ${name}`);
  if (name.startsWith("Loqui-") && !name.startsWith(`Loqui-${version}-`))
    throw Error(`Unexpected artifact version: ${name}`);
}
for (const name of required)
  if (!fs.existsSync(path.join(dir, name)) || !fs.statSync(path.join(dir, name)).size)
    throw Error(`Incomplete release: ${name}`);
for (const name of [`${channel}-mac.yml`, `${channel}-linux.yml`]) {
  const file = path.join(dir, name),
    data = yaml.load(fs.readFileSync(file, "utf8"));
  if (data.version !== version) throw Error("Updater version mismatch");
  for (const entry of data.files) {
    if (path.basename(entry.url) !== entry.url) throw Error("Unexpected updater URL");
    const bytes = fs.readFileSync(path.join(dir, entry.url));
    entry.sha512 = crypto.createHash("sha512").update(bytes).digest("base64");
    entry.size = bytes.length;
  }
  const main = data.files.find((f) => f.url === data.path);
  if (main) data.sha512 = main.sha512;
  fs.writeFileSync(file, yaml.dump(data));
}
for (const file of ["THIRD_PARTY_NOTICES.md", "LICENSE", "runtime-assets.json"])
  fs.copyFileSync(file, path.join(dir, file));
fs.writeFileSync(
  path.join(dir, "build-provenance.json"),
  JSON.stringify(
    {
      repository: "snowopsdev/loqui",
      version,
      commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      run: process.env.GITHUB_RUN_ID,
      node: process.version,
      runtimeManifestSha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync("runtime-assets.json"))
        .digest("hex"),
    },
    null,
    2
  ) + "\n"
);
for (const name of fs.readdirSync("licenses"))
  fs.copyFileSync(path.join("licenses", name), path.join(dir, `LICENSE-${name}`));
const sums = fs
  .readdirSync(dir)
  .filter((f) => f !== "SHA256SUMS")
  .sort()
  .map(
    (name) =>
      `${crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(dir, name)))
        .digest("hex")}  ${name}`
  );
fs.writeFileSync(path.join(dir, "SHA256SUMS"), sums.join("\n") + "\n");
