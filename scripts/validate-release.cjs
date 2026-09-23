const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function validateRelease({
  cwd = path.resolve(__dirname, ".."),
  env = process.env,
  git = (args, options = {}) => execFileSync("git", args, { cwd, ...options }),
} = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(cwd, "package-lock.json"), "utf8"));
  const tag = env.RELEASE_TAG || env.GITHUB_REF_NAME;
  if (env.GITHUB_REF !== `refs/tags/${tag}`)
    throw Error("Run release retries with the version tag as the workflow ref");
  if (env.GITHUB_REPOSITORY !== "snowopsdev/loqui")
    throw Error("Releases must originate from snowopsdev/loqui");
  if (
    !/^v\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(tag) ||
    tag !== `v${pkg.version}` ||
    lock.version !== pkg.version ||
    lock.packages?.[""]?.version !== pkg.version
  )
    throw Error("Tag, package and lockfile versions must match");
  const heading = fs
    .readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8")
    .split(/\r?\n/)
    .find((line) => line === `## ${pkg.version}` || line.startsWith(`## ${pkg.version} `));
  if (!heading) throw Error("Missing exact changelog entry");
  if (/unreleased/i.test(heading)) throw Error("Changelog entry is still marked unreleased");
  const escaped = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^## ${escaped}(?: - \\d{4}-\\d{2}-\\d{2})?$`).test(heading))
    throw Error("Changelog release heading must name the exact version, optionally with a date");
  git(["fetch", "origin", "main", "--no-tags"], { stdio: "inherit" });
  git(["merge-base", "--is-ancestor", "HEAD", "origin/main"]);
  const commit = git(["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (commit !== git(["rev-parse", `${tag}^{commit}`], { encoding: "utf8" }).trim())
    throw Error("Checkout is not the release tag");
  return { tag, version: pkg.version, commit };
}

if (require.main === module) validateRelease();
module.exports = { validateRelease };
