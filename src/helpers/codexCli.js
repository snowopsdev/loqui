const fs = require("node:fs/promises");
const { createReadStream, constants } = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Readable, Transform, Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { createZstdDecompress } = require("node:zlib");
const { minimumVersion: MIN_CODEX_VERSION } = require("../config/codex.json");

const RELEASES = "https://api.github.com/repos/openai/codex/releases/tags/";
const DOWNLOADS = "https://github.com/openai/codex/releases/download/";
const SHA256 = /^[a-f0-9]{64}$/;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function failure(message, code = "CODEX_UNVERIFIED") {
  return Object.assign(new Error(message), { code });
}

function parseVersion(output) {
  const version = /^codex-cli (\S+)$/.exec(String(output).trim())?.[1];
  return version && STABLE_VERSION.test(version) ? version : null;
}

function supportedVersion(output) {
  const version = parseVersion(output);
  if (!version) return false;
  const minimum = MIN_CODEX_VERSION.split(".").map(BigInt);
  const parts = version.split(".").map(BigInt);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== minimum[i]) return parts[i] > minimum[i];
  }
  return true;
}

function targetTriple(platform, arch) {
  const cpu = { x64: "x86_64", arm64: "aarch64" }[arch];
  const os = { linux: "unknown-linux-musl", darwin: "apple-darwin", win32: "pc-windows-msvc" }[
    platform
  ];
  if (!cpu || !os)
    throw failure("Official Codex CLI verification is unavailable on this platform.");
  return `${cpu}-${os}`;
}

async function findExecutable(executable, env, platform = process.platform) {
  const names =
    platform === "win32" && !path.extname(executable)
      ? [`${executable}.exe`, `${executable}.cmd`, executable]
      : [executable];
  const candidates = /[/\\]/.test(executable)
    ? names.map((name) => path.resolve(name))
    : (env.PATH || "")
        .split(path.delimiter)
        .filter(Boolean)
        .flatMap((dir) => names.map((name) => path.join(dir, name)));
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, constants.X_OK);
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    }
  }
  throw Object.assign(new Error("Codex executable not found"), { code: "ENOENT" });
}

async function readHeader(file) {
  const handle = await fs.open(file, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(16384), 0, 16384, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isNative(header) {
  return (
    ["7f454c46", "cffaedfe", "feedfacf", "cafebabe", "bebafeca"].includes(
      header.subarray(0, 4).toString("hex")
    ) || header.subarray(0, 2).toString() === "MZ"
  );
}

// Never launch npm scripts or version-manager shims with the application's
// credentials. Resolve to the native file, then verify and launch that exact path.
async function resolveCodexExecutable({
  executable = "codex",
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  runFile,
}) {
  let selected = await findExecutable(executable, env, platform);
  const seen = new Set();
  for (let depth = 0; depth < 4; depth++) {
    const real = await fs.realpath(selected);
    if (seen.has(real)) break;
    seen.add(real);
    const header = await readHeader(real);
    const manager = /[/\\]\.volta[/\\]bin[/\\]/.test(selected)
      ? "volta"
      : !isNative(header) && /\bmise\b/.test(header.toString())
        ? "mise"
        : null;
    if (manager) {
      const command = await findExecutable(manager, env, platform);
      const result = await runFile(command, ["which", "codex"], {
        env,
        timeout: 10000,
        maxBuffer: 16384,
        windowsHide: true,
      });
      const resolved = String(result.stdout).trim();
      if (!path.isAbsolute(resolved)) break;
      selected = resolved;
      continue;
    }
    if (isNative(header)) return real;

    // npm/pnpm/bun launchers all point into @openai/codex. Package metadata is
    // only a discovery hint; the native binary still has to match the release.
    let root;
    for (const candidate of [
      path.resolve(path.dirname(real), ".."),
      path.join(path.dirname(real), "node_modules", "@openai", "codex"),
    ]) {
      try {
        const metadata = JSON.parse(
          await fs.readFile(path.join(candidate, "package.json"), "utf8")
        );
        if (metadata.name === "@openai/codex") {
          root = candidate;
          break;
        }
      } catch {
        // This location may not contain an npm package; try the next layout.
      }
    }
    if (!root) break;
    let vendor = path.join(root, "vendor");
    try {
      vendor = path.join(
        path.dirname(
          require.resolve(`@openai/codex-${platform}-${arch}/package.json`, { paths: [root] })
        ),
        "vendor"
      );
    } catch {
      // Older npm releases bundle the native executable directly under vendor.
    }
    const target = targetTriple(platform, arch);
    const name = platform === "win32" ? "codex.exe" : "codex";
    let binary;
    for (const dir of ["bin", "codex"]) {
      const candidate = path.join(vendor, target, dir, name);
      try {
        binary = await findExecutable(candidate, env, platform);
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!binary) break;
    selected = binary;
  }
  throw failure(
    "Could not locate the native official Codex CLI behind this launcher. Reinstall Codex from OpenAI's official installer, npm package, or Homebrew, then click Refresh."
  );
}

async function fileHash(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function getResponse(url, fetchImpl, timeoutMs) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: url.startsWith(RELEASES) ? "application/vnd.github+json" : "application/octet-stream",
      "User-Agent": "Loqui-Codex-Verification",
    },
    signal: AbortSignal.timeout(timeoutMs),
    credentials: "omit",
  });
  if (!response.ok) {
    if (response.status === 404)
      throw failure(
        "This Codex CLI version has no matching official release. Install an official stable release, then click Refresh."
      );
    throw new Error(`Release lookup failed (${response.status})`);
  }
  return response;
}

async function readLimited(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error("Release metadata is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function releaseAsset(release, name, base) {
  const asset = release.assets?.find((entry) => entry.name === name);
  if (
    !asset ||
    asset.browser_download_url !== `${base}/${name}` ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest)
  )
    throw new Error("Official release verification data is unavailable");
  return asset;
}

async function publishedHash(version, platform, target, fetchImpl, timeoutMs) {
  const tag = `rust-v${version}`;
  const base = `${DOWNLOADS}${tag}`;
  const release = JSON.parse(
    await readLimited(await getResponse(`${RELEASES}${tag}`, fetchImpl, timeoutMs), 2 * 1024 * 1024)
  );
  if (release.tag_name !== tag || release.draft !== false || release.prerelease !== false)
    throw failure(
      "This Codex CLI is not an official stable release. Install an official stable release, then click Refresh."
    );

  if (platform === "win32")
    return releaseAsset(release, `codex-${target}.exe`, base).digest.slice(7);

  if (platform === "linux") {
    const asset = releaseAsset(release, `codex-${target}.sigstore`, base);
    const bytes = await readLimited(
      await getResponse(asset.browser_download_url, fetchImpl, timeoutMs),
      256 * 1024
    );
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== asset.digest)
      throw new Error("Official release metadata checksum mismatch");
    // The authenticated GitHub release supplies this digest. We do not claim
    // independent Sigstore signature/transparency-log verification here.
    const bundle = JSON.parse(bytes);
    const record = JSON.parse(Buffer.from(bundle.rekorBundle.Payload.body, "base64").toString());
    const hash = record.spec?.data?.hash;
    if (record.kind !== "hashedrekord" || hash?.algorithm !== "sha256" || !SHA256.test(hash.value))
      throw new Error("Official release binary digest is unavailable");
    return hash.value;
  }

  // macOS publishes a compressed native executable. Hash it while streaming;
  // nothing is installed or extracted. Reuse its verified digest in this session.
  const asset = releaseAsset(release, `codex-${target}.zst`, base);
  const response = await getResponse(
    asset.browser_download_url,
    fetchImpl,
    Math.max(timeoutMs, 120000)
  );
  const archive = createHash("sha256");
  const binary = createHash("sha256");
  let compressed = 0;
  let expanded = 0;
  await pipeline(
    Readable.fromWeb(response.body),
    new Transform({
      transform(chunk, _encoding, callback) {
        compressed += chunk.length;
        if (compressed > 512 * 1024 * 1024)
          return callback(new Error("Release asset is too large"));
        archive.update(chunk);
        callback(null, chunk);
      },
    }),
    createZstdDecompress(),
    new Writable({
      write(chunk, _encoding, callback) {
        expanded += chunk.length;
        if (expanded > 1024 * 1024 * 1024)
          return callback(new Error("Release binary is too large"));
        binary.update(chunk);
        callback();
      },
    })
  );
  if (`sha256:${archive.digest("hex")}` !== asset.digest)
    throw new Error("Official release asset checksum mismatch");
  return binary.digest("hex");
}

async function verifyOfficialCodex({
  executable,
  version,
  verifiedReleases = new Map(),
  platform = process.platform,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30000,
}) {
  if (!supportedVersion(`codex-cli ${version}`))
    throw failure("Unsupported Codex CLI version.", "CODEX_VERSION");
  const target = targetTriple(platform, arch);
  const actual = await fileHash(executable);
  // Trust only digests fetched by this process, never a writable local checksum
  // file (an unverified executable could forge that during its version probe).
  const key = `${version}-${target}`;
  let expected = verifiedReleases.get(key);
  try {
    if (!expected) expected = await publishedHash(version, platform, target, fetchImpl, timeoutMs);
  } catch (error) {
    if (error.code === "CODEX_UNVERIFIED") throw error;
    throw failure(
      "Could not verify Codex CLI with OpenAI's official release on GitHub. Check your connection and click Refresh.",
      "CODEX_VERIFICATION_UNAVAILABLE"
    );
  }
  if (actual !== expected)
    throw failure(
      "This Codex CLI binary does not match OpenAI's official release. Reinstall the official CLI, then click Refresh."
    );
  verifiedReleases.set(key, expected);
}

module.exports = {
  MIN_CODEX_VERSION,
  parseVersion,
  supportedVersion,
  resolveCodexExecutable,
  verifyOfficialCodex,
};
