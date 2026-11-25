const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

// Paths that change what the native/package build produces or checks. Pure app
// logic (renderer, most main-process helpers, main.js/preload.js) is covered by
// the quality job on pull requests and by the full platform build on code-changing
// pushes to main, so a JS-only pull request does not wait an hour for Linux and
// macOS packaging. src/assets and src/config are packaging inputs (electron-builder
// reads product.json; package-smoke.cjs compares the shipped artwork). The three
// helpers are required by the runtime download, afterPack and sherpa loopback
// build scripts, test/native holds the loopback check platform.yml runs, and
// quality.yml decides when platform.yml runs at all.
const PLATFORM_HELPERS = ["parakeetCapability", "sherpaLoopback", "whisperCppRelease"];
const PLATFORM_PATHS = new RegExp(
  [
    "^(?:native/|resources/|scripts/|test/native/|src/(?:assets|config)/",
    `src/helpers/(?:${PLATFORM_HELPERS.join("|")})\\.js$`,
    "package(?:-lock)?\\.json$|electron-builder\\.(?:json|cjs)$|runtime-assets\\.json$",
    "\\.node-version$|\\.github/workflows/(?:platform|quality)\\.yml$)",
  ].join("|")
);

function classifyPaths(paths, { fullBuild = false } = {}) {
  const codePaths = paths.filter((file) => !/^(?:docs\/|(?:LICENSE|NOTICE)$)|\.md$/i.test(file));
  const code = codePaths.length > 0;
  return {
    code,
    platform: code && (fullBuild || codePaths.some((file) => PLATFORM_PATHS.test(file))),
  };
}

// Code-changing pushes to main always build both platforms, so packaging
// regressions from app code surface at the merge that caused them, never first
// in a release. Documentation-only pushes still skip the build (code=false).
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
  // Without rename detection a moved file lists both paths, so moving a packaging
  // input out of a watched directory still reports the watched path.
  return git(["diff", "--name-only", "--no-renames", "-z", base, "HEAD"])
    .split("\0")
    .filter(Boolean);
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
