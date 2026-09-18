const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const pkg = require("../package.json");
const lock = require("../package-lock.json");
const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME;
if (process.env.GITHUB_REF !== `refs/tags/${tag}`)
  throw Error("Run release retries with the version tag as the workflow ref");
if (process.env.GITHUB_REPOSITORY !== "snowopsdev/loqui")
  throw Error("Releases must originate from snowopsdev/loqui");
if (
  !/^v\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(tag) ||
  tag !== `v${pkg.version}` ||
  lock.version !== pkg.version ||
  lock.packages[""].version !== pkg.version
)
  throw Error("Tag, package and lockfile versions must match");
if (!fs.readFileSync("CHANGELOG.md", "utf8").includes(`## ${pkg.version}`))
  throw Error("Missing changelog entry");
execFileSync("git", ["fetch", "origin", "main", "--no-tags"], { stdio: "inherit" });
execFileSync("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"]);
if (
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
  execFileSync("git", ["rev-parse", `${tag}^{commit}`], { encoding: "utf8" }).trim()
)
  throw Error("Checkout is not the release tag");
