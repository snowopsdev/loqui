// Runs on every push to main: tags a merged release PR's commit and starts the
// release workflow. Unreleased commits and existing tags are skipped; tags are never moved.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { changelogReleaseProblem } = require("./validate-release.cjs");
const REPOSITORY = "snowopsdev/loqui";
const API = `https://api.github.com/repos/${REPOSITORY}`;

async function githubRequest(endpoint, { token, fetchImpl, method = "GET", body, allowMissing }) {
  const response = await fetchImpl(`${API}${endpoint}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404 && allowMissing) return null;
  if (!response.ok) {
    // The error body only adds detail to a failure that is already being raised.
    const detail = await response.json().then(
      (data) => (typeof data?.message === "string" ? `: ${data.message}` : ""),
      () => ""
    );
    throw Error(`GitHub ${method} ${endpoint || "/"} failed (HTTP ${response.status})${detail}`);
  }
  const data = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error(`GitHub returned an invalid response for ${method} ${endpoint || "/"}`);
  return data;
}

async function run({
  cwd = path.resolve(__dirname, ".."),
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
  command = (file, args) =>
    execFileSync(file, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
  git = (args) => command("git", args),
} = {}) {
  if (env.GITHUB_REPOSITORY !== REPOSITORY)
    throw Error(`Release tags are created only in ${REPOSITORY}`);
  // A manual dispatch from another branch must not tag a commit outside main.
  if (env.GITHUB_REF !== "refs/heads/main") throw Error("Release tags are created only from main");
  const commit = env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(commit || "")) throw Error("GITHUB_SHA must be a full commit SHA");
  if (!env.GH_TOKEN) throw Error("GH_TOKEN is required to create release tags");
  const read = (name) => fs.readFileSync(path.join(cwd, name), "utf8");
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  if (
    !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(pkg.version) ||
    lock.version !== pkg.version ||
    lock.packages?.[""]?.version !== pkg.version
  )
    throw Error("Package and lockfile versions must match a Loqui release version");
  const tag = `v${pkg.version}`;
  const problem = changelogReleaseProblem(read("CHANGELOG.md"), pkg.version);
  if (problem) {
    log(`No release tag for ${pkg.version}: ${problem}`);
    return { state: "skipped", tag, commit };
  }
  // Only the push that merges the version change is released automatically, so a
  // failed or skipped run never releases a later commit nobody accepted. A manual
  // run of this workflow is the explicit way to tag main's current commit instead.
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
    const previous = JSON.parse(git(["show", "HEAD^1:package.json"])).version;
    if (previous === pkg.version) {
      log(`No release tag for ${pkg.version}: this push did not change the version`);
      return { state: "skipped", tag, commit };
    }
  }

  const options = { token: env.GH_TOKEN, fetchImpl };
  // Prove repository access first so a permission-masked 404 is never read as a missing tag.
  const repository = await githubRequest("", options);
  if (repository.full_name !== REPOSITORY || repository.fork || repository.archived)
    throw Error("Release repository identity or availability mismatch");
  // Tags created with GITHUB_TOKEN do not trigger push workflows; workflow_dispatch is
  // GitHub's documented exception, and release.yml validates the tag as its ref.
  const dispatch = ["workflow", "run", "release.yml", "--ref", tag, "-f", `tag=${tag}`];
  const startRelease = (context) => {
    try {
      command("gh", [...dispatch, "--repo", REPOSITORY]);
    } catch (error) {
      throw new Error(
        `${context} but could not start the release; rerun Tag release from main or run gh ${dispatch.join(" ")} --repo ${REPOSITORY}: ${error.message}`,
        { cause: error }
      );
    }
    log(`Started the release workflow for ${tag}`);
  };

  const existing = await githubRequest(`/git/ref/tags/${tag}`, { ...options, allowMissing: true });
  if (existing) {
    let target = existing.object?.sha;
    if (existing.object?.type === "tag")
      target = (await githubRequest(`/git/tags/${target}`, options)).object?.sha;
    // A push leaves an existing tag alone: pushing it already started its release. A
    // manual run is the recovery when tagging succeeded but starting the release failed.
    if (env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
      log(`${tag} already exists (${target}); existing tags are never moved`);
      return { state: "exists", tag, commit };
    }
    if (target !== commit)
      throw Error(`${tag} points at ${target}, not main's commit ${commit}; tags are never moved`);
    startRelease(`${tag} already exists at ${commit}`);
    return { state: "dispatched", tag, commit };
  }
  // GitHub rejects an existing ref with 422, so a concurrent tag push fails closed here.
  const created = await githubRequest("/git/refs", {
    ...options,
    method: "POST",
    body: { ref: `refs/tags/${tag}`, sha: commit },
  });
  if (created.ref !== `refs/tags/${tag}` || created.object?.sha !== commit)
    throw Error(`GitHub created ${tag} at an unexpected ref or commit`);
  log(`Created ${tag} at ${commit}`);
  startRelease(`Created ${tag}`);
  return { state: "created", tag, commit };
}

if (require.main === module)
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { run, githubRequest };
