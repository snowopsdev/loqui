const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const yaml = require("js-yaml");

function assembleRelease({
  cwd = path.resolve(__dirname, ".."),
  env = process.env,
  git = (args) => execFileSync("git", args, { cwd, encoding: "utf8" }),
} = {}) {
  const { version } = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
  const dir = path.join(cwd, "release");
  const channel = version.includes("-") ? "beta" : "latest";
  const artifacts = {
    dmg: `Loqui-${version}-mac-arm64.dmg`,
    zip: `Loqui-${version}-mac-arm64.zip`,
    appImage: `Loqui-${version}-linux-x64.AppImage`,
    tar: `Loqui-${version}-linux-x64.tar.gz`,
  };
  const metadata = [`${channel}-mac.yml`, `${channel}-linux.yml`];
  const required = [
    ...Object.values(artifacts),
    `${artifacts.zip}.blockmap`,
    ...metadata,
    "SBOM.cdx.json",
  ];
  const readArtifact = (name) => {
    if (typeof name !== "string" || path.basename(name) !== name || /[\\\r\n]/.test(name))
      throw Error("Unexpected updater URL or artifact name");
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size === 0) throw Error(`Incomplete release: ${name}`);
    return fs.readFileSync(file);
  };
  for (const name of fs.readdirSync(dir)) {
    readArtifact(name);
    if (name.endsWith(".yml") && !metadata.includes(name))
      throw Error(`Unexpected channel metadata: ${name}`);
    if (name.startsWith("Loqui-") && !required.includes(name))
      throw Error(`Unexpected release artifact: ${name}`);
  }
  for (const name of required) readArtifact(name);
  const sbom = JSON.parse(readArtifact("SBOM.cdx.json"));
  if (sbom.bomFormat !== "CycloneDX" || !sbom.specVersion || !Array.isArray(sbom.components))
    throw Error("Invalid CycloneDX SBOM");
  const updates = metadata.map((name, index) => {
    const data = yaml.load(readArtifact(name).toString("utf8"));
    const primary = index === 0 ? artifacts.zip : artifacts.appImage;
    const allowed = index === 0 ? [artifacts.zip, artifacts.dmg] : [artifacts.appImage];
    if (data?.version !== version) throw Error("Updater version mismatch");
    if (
      !Array.isArray(data.files) ||
      data.files.length !== allowed.length ||
      new Set(data.files.map((entry) => entry?.url)).size !== allowed.length ||
      data.files.some((entry) => !allowed.includes(entry?.url)) ||
      data.path !== primary
    )
      throw Error(`Incomplete or unexpected updater file list: ${name}`);
    for (const entry of data.files) {
      const bytes = readArtifact(entry.url);
      const hash = crypto.createHash("sha512").update(bytes).digest("base64");
      if (entry.url === artifacts.dmg) {
        // Developer ID signing and stapling change the DMG after builder emits
        // metadata. Only that artifact needs its hash refreshed; ZIP/Linux bytes
        // must still match the metadata produced in their build jobs.
        entry.sha512 = hash;
        entry.size = bytes.length;
        delete entry.blockMapSize;
      } else if (entry.sha512 !== hash || entry.size !== bytes.length) {
        throw Error(`Updater integrity mismatch: ${entry.url}`);
      }
      if (
        entry.url === artifacts.appImage &&
        (!Number.isInteger(entry.blockMapSize) ||
          entry.blockMapSize <= 0 ||
          entry.blockMapSize >= bytes.length)
      )
        throw Error("AppImage embedded blockmap metadata is missing or invalid");
    }
    const main = data.files.find((entry) => entry.url === primary);
    if (data.sha512 !== main.sha512) throw Error(`Updater primary checksum mismatch: ${name}`);
    return { name, data };
  });
  // Validate all inputs before creating checksums/provenance or modifying metadata.
  for (const { name, data } of updates) fs.writeFileSync(path.join(dir, name), yaml.dump(data));
  for (const file of ["THIRD_PARTY_NOTICES.md", "LICENSE", "runtime-assets.json"])
    fs.copyFileSync(path.join(cwd, file), path.join(dir, file));
  fs.writeFileSync(
    path.join(dir, "build-provenance.json"),
    JSON.stringify(
      {
        repository: "snowopsdev/loqui",
        version,
        commit: git(["rev-parse", "HEAD"]).trim(),
        run: env.GITHUB_RUN_ID,
        node: process.version,
        runtimeManifestSha256: crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(cwd, "runtime-assets.json")))
          .digest("hex"),
      },
      null,
      2
    ) + "\n"
  );
  for (const name of fs.readdirSync(path.join(cwd, "licenses")))
    fs.copyFileSync(path.join(cwd, "licenses", name), path.join(dir, `LICENSE-${name}`));
  const sums = fs
    .readdirSync(dir)
    .filter((name) => name !== "SHA256SUMS")
    .sort()
    .map(
      (name) => `${crypto.createHash("sha256").update(readArtifact(name)).digest("hex")}  ${name}`
    );
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), sums.join("\n") + "\n");
  return { version, channel, artifacts: required };
}

if (require.main === module) assembleRelease();
module.exports = { assembleRelease };
