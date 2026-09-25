const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const REPOSITORY = "snowopsdev/loqui";
const API = `https://api.github.com/repos/${REPOSITORY}`;

async function readGitHub(endpoint, { token, fetchImpl = fetch, allowMissing = false }) {
  if (!token) throw Error("GH_TOKEN is required to verify release state");
  const response = await fetchImpl(`${API}${endpoint}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404 && allowMissing) return null;
  if (!response.ok) throw Error(`GitHub release-state check failed (HTTP ${response.status})`);
  const data = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error("GitHub returned an invalid release-state response");
  return data;
}

function assertDraft(release, { commit, tag }) {
  if (release === null) return;
  if (release.draft !== true || release.published_at)
    throw Error("Published versions are immutable; create a new version");
  if (release.tag_name !== tag || release.target_commitish !== commit)
    throw Error("Retry requires an unpublished draft of the same tag and commit");
  if (release.prerelease !== tag.includes("-beta."))
    throw Error("Draft prerelease channel does not match the version tag");
}

function verifyAssets(cwd) {
  const dir = path.join(cwd, "release");
  const names = fs.readdirSync(dir).sort();
  if (!names.includes("SHA256SUMS")) throw Error("Assembled release checksums are missing");
  for (const name of names) {
    const stat = fs.lstatSync(path.join(dir, name));
    if (!/^[A-Za-z0-9._-]+$/.test(name) || !stat.isFile() || !stat.size)
      throw Error(`Invalid release asset: ${name}`);
  }
  const expected = new Map();
  for (const line of fs.readFileSync(path.join(dir, "SHA256SUMS"), "utf8").trim().split("\n")) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    if (!match || match[2] === "SHA256SUMS" || expected.has(match[2]))
      throw Error("Invalid or duplicate release checksum entry");
    expected.set(match[2], match[1]);
  }
  if (
    expected.size !== names.length - 1 ||
    [...expected.keys()].some((name) => !names.includes(name))
  )
    throw Error("Release checksums do not cover the exact asset set");
  for (const name of names.filter((name) => name !== "SHA256SUMS")) {
    const hash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(dir, name)))
      .digest("hex");
    if (hash !== expected.get(name)) throw Error(`Release asset changed after assembly: ${name}`);
  }
  return names;
}

async function run(
  mode,
  {
    cwd = path.resolve(__dirname, ".."),
    env = process.env,
    fetchImpl = fetch,
    command = (file, args) =>
      execFileSync(file, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
  } = {}
) {
  if (!["check", "assemble"].includes(mode)) throw Error("Usage: release-draft.cjs check|assemble");
  const tag = env.RELEASE_TAG;
  const commit = env.RELEASE_COMMIT || command("git", ["rev-parse", "HEAD"]).trim();
  if (
    env.GITHUB_REPOSITORY !== REPOSITORY ||
    !/^v\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(tag) ||
    !/^[a-f0-9]{40}$/.test(commit)
  )
    throw Error("Invalid repository, release tag, or commit");
  const options = { token: env.GH_TOKEN, fetchImpl };
  // Prove repository access first: a permission-masked 404 must not be treated as
  // a missing release. Authentication, rate-limit and transport errors fail closed.
  const repository = await readGitHub("", options);
  if (repository.full_name !== REPOSITORY || repository.fork || repository.archived)
    throw Error("Release repository identity or availability mismatch");
  const readRelease = () =>
    readGitHub(`/releases/tags/${encodeURIComponent(tag)}`, { ...options, allowMissing: true });
  let release = await readRelease();
  assertDraft(release, { commit, tag });
  if (mode === "check") return { state: release ? "draft" : "missing", tag, commit };

  // GitHub's immutable-release setting protects the interval between checking a
  // draft and uploading an asset if a maintainer publishes it concurrently.
  const immutable = await readGitHub("/immutable-releases", options);
  if (immutable.enabled !== true)
    throw Error("Enable immutable releases before assembling a draft");
  const refs = command("git", [
    "ls-remote",
    "--exit-code",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ])
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/));
  const remoteCommit =
    refs.find(([, ref]) => ref === `refs/tags/${tag}^{}`)?.[0] ||
    refs.find(([, ref]) => ref === `refs/tags/${tag}`)?.[0];
  if (remoteCommit !== commit)
    throw Error("Remote release tag no longer matches the validated commit");
  const names = verifyAssets(cwd);
  if (release) {
    if (
      !Array.isArray(release.assets) ||
      release.assets.some((asset) => !names.includes(asset.name))
    )
      throw Error("Draft contains unexpected assets; remove stale draft assets before retrying");
    for (const name of names) {
      release = await readRelease();
      if (!release) throw Error("Draft disappeared during retry; rerun the workflow");
      assertDraft(release, { commit, tag });
      command("gh", [
        "release",
        "upload",
        tag,
        path.join("release", name),
        "--clobber",
        "--repo",
        REPOSITORY,
      ]);
    }
  } else {
    const args = [
      "release",
      "create",
      tag,
      ...names.map((name) => path.join("release", name)),
      "--repo",
      REPOSITORY,
      "--draft",
      "--verify-tag",
      "--target",
      commit,
      "--title",
      `Loqui ${tag}`,
      "--notes-file",
      "CHANGELOG.md",
    ];
    if (tag.includes("-beta.")) args.push("--prerelease");
    command("gh", args);
  }
  return { state: "draft", tag, commit, assets: names.length };
}

if (require.main === module)
  run(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { run, readGitHub, assertDraft, verifyAssets };
