const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { zstdCompressSync } = require("node:zlib");
const { resolveCodexExecutable, verifyOfficialCodex } = require("../../src/helpers/codexCli");

const binary = Buffer.from("\x7fELF official fixture executable");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const version = "0.157.0";
const api = `https://api.github.com/repos/openai/codex/releases/tags/rust-v${version}`;
const base = `https://github.com/openai/codex/releases/download/rust-v${version}`;

async function fixture(t, platform = "linux") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "loqui-codex-release-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const executable = path.join(dir, "codex");
  await fs.writeFile(executable, binary, { mode: 0o755 });
  const target = {
    linux: "x86_64-unknown-linux-musl",
    darwin: "x86_64-apple-darwin",
    win32: "x86_64-pc-windows-msvc",
  }[platform];
  const record = {
    kind: "hashedrekord",
    spec: { data: { hash: { algorithm: "sha256", value: sha256(binary) } } },
  };
  let bytes =
    platform === "darwin"
      ? zstdCompressSync(binary)
      : Buffer.from(
          JSON.stringify({
            rekorBundle: {
              Payload: { body: Buffer.from(JSON.stringify(record)).toString("base64") },
            },
          })
        );
  const name = `codex-${target}${platform === "linux" ? ".sigstore" : platform === "darwin" ? ".zst" : ".exe"}`;
  const asset = {
    name,
    browser_download_url: `${base}/${name}`,
    digest: `sha256:${sha256(platform === "win32" ? binary : bytes)}`,
  };
  const release = {
    tag_name: `rust-v${version}`,
    draft: false,
    prerelease: false,
    assets: [asset],
  };
  const requests = [];
  const options = {
    executable,
    version,
    platform,
    arch: "x64",
    verifiedReleases: new Map(),
    fetchImpl: async (url, init) => {
      requests.push(url);
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(init.credentials, "omit");
      if (url === api) {
        assert.equal(init.headers.Accept, "application/vnd.github+json");
        return new Response(JSON.stringify(release));
      }
      assert.equal(url, asset.browser_download_url);
      return new Response(bytes);
    },
  };
  return {
    dir,
    options,
    release,
    asset,
    requests,
    changeAsset: (value) => {
      bytes = value;
    },
  };
}

for (const platform of ["linux", "darwin", "win32"])
  test(`verifies ${platform} native bytes against the official release`, async (t) => {
    const { options, requests } = await fixture(t, platform);
    await verifyOfficialCodex(options);
    assert.equal(requests[0], api);
    assert.equal(requests.length, platform === "win32" ? 1 : 2);
  });

test("session verification works offline but changed bytes with the same version do not", async (t) => {
  const { options, requests } = await fixture(t);
  await verifyOfficialCodex(options);
  const offline = {
    ...options,
    fetchImpl: async () => {
      throw new Error("offline");
    },
  };
  await verifyOfficialCodex(offline);
  assert.equal(requests.length, 2);
  await assert.rejects(verifyOfficialCodex({ ...offline, verifiedReleases: new Map() }), {
    code: "CODEX_VERIFICATION_UNAVAILABLE",
  });
  const originalStat = await fs.stat(options.executable);
  await fs.writeFile(options.executable, Buffer.alloc(binary.length, 65));
  await fs.utimes(options.executable, originalStat.atime, originalStat.mtime);
  await assert.rejects(verifyOfficialCodex(options), { code: "CODEX_UNVERIFIED" });
  await assert.rejects(verifyOfficialCodex(offline), { code: "CODEX_UNVERIFIED" });
});

test("a reported official version cannot authenticate a custom executable", async (t) => {
  const { dir, options } = await fixture(t);
  const custom = Buffer.from("codex-cli 0.157.0 custom binary");
  await fs.writeFile(options.executable, custom);
  // A forged on-disk digest must never authorize a binary on a subsequent run.
  const fakeCache = path.join(dir, "codex-release-cache");
  await fs.mkdir(fakeCache);
  await fs.writeFile(
    path.join(fakeCache, `${version}-x86_64-unknown-linux-musl.json`),
    JSON.stringify({
      schema: 1,
      version,
      target: "x86_64-unknown-linux-musl",
      sha256: sha256(custom),
    })
  );
  await assert.rejects(verifyOfficialCodex(options), { code: "CODEX_UNVERIFIED" });
  assert.equal(options.verifiedReleases.size, 0);
});

for (const mutation of [
  { draft: true },
  { prerelease: true },
  { tag_name: "rust-v0.158.0" },
  { prerelease: undefined },
])
  test(`rejects non-stable or mismatched release metadata ${JSON.stringify(mutation)}`, async (t) => {
    const { options, release } = await fixture(t);
    Object.assign(release, mutation);
    await assert.rejects(verifyOfficialCodex(options), { code: "CODEX_UNVERIFIED" });
  });

for (const status of [404, 403, 429, 500])
  test(`release lookup HTTP ${status} never accepts an unverified binary`, async (t) => {
    const { options } = await fixture(t);
    options.fetchImpl = async () => new Response("error", { status });
    await assert.rejects(verifyOfficialCodex(options), {
      code: status === 404 ? "CODEX_UNVERIFIED" : "CODEX_VERIFICATION_UNAVAILABLE",
    });
  });

test("network failure is retryable and is not cached as an official release", async (t) => {
  const { options } = await fixture(t);
  await assert.rejects(
    verifyOfficialCodex({
      ...options,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }),
    { code: "CODEX_VERIFICATION_UNAVAILABLE" }
  );
  await verifyOfficialCodex(options);
});

for (const platform of ["linux", "darwin"])
  test(`rejects corrupted ${platform} release assets`, async (t) => {
    const { options, asset } = await fixture(t, platform);
    asset.digest = `sha256:${"0".repeat(64)}`;
    await assert.rejects(verifyOfficialCodex(options), { code: "CODEX_VERIFICATION_UNAVAILABLE" });
  });

test("rejects a release asset pointing outside OpenAI's release", async (t) => {
  const { options, asset, requests } = await fixture(t);
  asset.browser_download_url = "https://example.com/codex.sigstore";
  await assert.rejects(verifyOfficialCodex(options), { code: "CODEX_VERIFICATION_UNAVAILABLE" });
  assert.deepEqual(requests, [api]);
});

test("rejects malformed attestation data even when its download checksum is valid", async (t) => {
  const { options, asset, changeAsset } = await fixture(t);
  const malformed = Buffer.from(JSON.stringify({ rekorBundle: { Payload: { body: "e30=" } } }));
  changeAsset(malformed);
  asset.digest = `sha256:${sha256(malformed)}`;
  await assert.rejects(verifyOfficialCodex(options), { code: "CODEX_VERIFICATION_UNAVAILABLE" });
});

test("unpublished version formats fail before release requests", async (t) => {
  const { options, requests } = await fixture(t);
  for (const value of ["0.153.9", "0.157.0-alpha.1", "0.157.0+custom", "../../other"])
    await assert.rejects(verifyOfficialCodex({ ...options, version: value }), {
      code: "CODEX_VERSION",
    });
  assert.equal(requests.length, 0);
});

test("finds a symlinked native binary without running it", async (t) => {
  const { dir, options } = await fixture(t);
  const bin = path.join(dir, "bin");
  await fs.mkdir(bin);
  await fs.symlink(options.executable, path.join(bin, "codex"));
  assert.equal(await resolveCodexExecutable({ env: { PATH: bin } }), options.executable);
});

test("resolves the native Windows executable from PATH", async (t) => {
  const { dir, options } = await fixture(t);
  await fs.rename(options.executable, `${options.executable}.exe`);
  assert.equal(
    await resolveCodexExecutable({ env: { PATH: dir }, platform: "win32" }),
    `${options.executable}.exe`
  );
});

test("resolves a Volta native shim before deciding which binary to verify", async (t) => {
  const { dir, options } = await fixture(t);
  const bin = path.join(dir, ".volta", "bin");
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(bin, "codex"), binary, { mode: 0o755 });
  await fs.writeFile(path.join(bin, "volta"), binary, { mode: 0o755 });
  const resolved = await resolveCodexExecutable({
    env: { PATH: bin },
    runFile: async (file, args) => {
      assert.equal(file, path.join(bin, "volta"));
      assert.deepEqual(args, ["which", "codex"]);
      return { stdout: options.executable };
    },
  });
  assert.equal(resolved, options.executable);
});

for (const layout of ["bin", "codex"])
  test(`resolves an npm launcher with the ${layout} native layout without executing JavaScript`, async (t) => {
    const { dir } = await fixture(t);
    const root = path.join(dir, "node_modules", "@openai", "codex");
    const nativeRoot = path.join(root, "node_modules", "@openai", "codex-linux-x64");
    const native = path.join(nativeRoot, "vendor", "x86_64-unknown-linux-musl", layout, "codex");
    const launcher = path.join(root, "bin", "codex.js");
    await fs.mkdir(path.dirname(native), { recursive: true });
    await fs.mkdir(path.dirname(launcher), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "@openai/codex" }));
    await fs.writeFile(
      path.join(nativeRoot, "package.json"),
      JSON.stringify({ name: "@openai/codex-linux-x64" })
    );
    await fs.writeFile(launcher, "#!/usr/bin/env node\nthrow Error('must not run launcher');", {
      mode: 0o755,
    });
    await fs.writeFile(native, binary, { mode: 0o755 });
    const resolved = await resolveCodexExecutable({
      executable: launcher,
      platform: "linux",
      arch: "x64",
    });
    assert.equal(resolved, native);
  });

test("asks mise only for the selected path and bypasses its auto-update wrapper", async (t) => {
  const { dir, options } = await fixture(t);
  const bin = path.join(dir, "bin");
  await fs.mkdir(bin);
  await fs.writeFile(
    path.join(bin, "codex"),
    '#!/bin/sh\nmise use -g codex\nexec mise x codex -- codex "$@"',
    { mode: 0o755 }
  );
  await fs.writeFile(path.join(bin, "mise"), "fixture manager", { mode: 0o755 });
  const calls = [];
  const resolved = await resolveCodexExecutable({
    env: { PATH: bin },
    runFile: async (...args) => {
      calls.push(args);
      return { stdout: `${options.executable}\n` };
    },
  });
  assert.equal(resolved, options.executable);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], path.join(bin, "mise"));
  assert.deepEqual(calls[0][1], ["which", "codex"]);
});

test("rejects unidentified shell wrappers without executing them", async (t) => {
  const { options } = await fixture(t);
  await fs.writeFile(options.executable, "#!/bin/sh\necho codex-cli 0.157.0");
  await assert.rejects(resolveCodexExecutable({ executable: options.executable }), {
    code: "CODEX_UNVERIFIED",
  });
});

test("missing and non-executable CLI paths retain distinct errors", async (t) => {
  const { options } = await fixture(t);
  await assert.rejects(resolveCodexExecutable({ executable: `${options.executable}-missing` }), {
    code: "ENOENT",
  });
  await fs.chmod(options.executable, 0o600);
  await assert.rejects(resolveCodexExecutable({ executable: options.executable }), {
    code: "EACCES",
  });
});
