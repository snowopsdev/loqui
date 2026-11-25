const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

// Paths that change what the native/package build produces. Pure app logic
// (renderer, main-process helpers, main.js/preload.js) is covered by the quality
// job on pull requests and by the full platform build on every push to main, so
// a JS-only pull request does not wait an hour for Linux and macOS packaging.
// src/assets and src/config are packaging inputs: electron-builder reads
// product.json and package-smoke.cjs compares the shipped artwork.
const PLATFORM_PATHS =
  /^(?:native\/|resources\/|scripts\/|src\/(?:assets|config)\/|package(?:-lock)?\.json$|electron-builder\.(?:json|cjs)$|runtime-assets\.json$|\.node-version$|\.github\/workflows\/platform\.yml$)/;

function classifyPaths(paths, { fullBuild = false } = {}) {
  const codePaths = paths.filter((file) => !/^(?:docs\/|(?:LICENSE|NOTICE)$)|\.md$/i.test(file));
  const code = codePaths.length > 0;
  return {
    code,
    platform: code && (fullBuild || codePaths.some((file) => PLATFORM_PATHS.test(file))),
  };
}

// Pushes to main always build both platforms so packaging regressions from app
// code are caught before a release, never later than the merge that caused them.
function isMainPush(env = process.env) {
  return env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF === "refs/heads/main";
}

function changedPaths(base, git = (args) => execFileSync("git", args, { encoding: "utf8" })) {
  // The first push has no before commit. Check the whole tree, including a
  // single-commit import, rather than comparing HEAD with itself and skipping CI.
  if (!base || /^0+$/.test(base)) return git(["ls-files", "-z"]).split("\0").filter(Boolean);
  if (!/^[a-f0-9]{40,64}$/i.test(base)) throw Error("Expected a base commit SHA");
  // Missing history fails the job instead of accidentally reporting no changes.
  git(["cat-file", "-e", `${base}^{commit}`]);
  return git(["diff", "--name-only", "-z", base, "HEAD"]).split("\0").filter(Boolean);
}

if (require.main === module) {
  const changes = classifyPaths(changedPaths(process.env.BASE), { fullBuild: isMainPush() });
  const output = Object.entries(changes)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
  console.log(output);
}

module.exports = { classifyPaths, changedPaths, isMainPush };
