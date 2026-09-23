const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

function classifyPaths(paths) {
  const codePaths = paths.filter((file) => !/^(?:docs\/|(?:LICENSE|NOTICE)$)|\.md$/i.test(file));
  return {
    code: codePaths.length > 0,
    platform: codePaths.some((file) =>
      /^(?:native\/|resources\/|scripts\/|src\/(?:assets|config|helpers|models|workers)\/|\.github\/workflows\/|(?:main|preload)\.js$|package(?:-lock)?\.json$|electron-builder\.(?:json|cjs)$|runtime-assets\.json$|\.node-version$)/.test(
        file
      )
    ),
  };
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
  const changes = classifyPaths(changedPaths(process.env.BASE));
  const output = Object.entries(changes)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
  console.log(output);
}

module.exports = { classifyPaths, changedPaths };
