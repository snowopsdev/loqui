// Fast repository hygiene check. Gitleaks separately scans full Git history.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const iconAdapters = new Set(["createIcon.tsx", "index.ts", "primitives.tsx"]);
const executableMagic = new Set([
  "7f454c46", // ELF
  "feedface",
  "feedfacf",
  "cefaedfe",
  "cffaedfe", // Mach-O
  "cafebabe",
  "bebafeca",
  "cafebabf",
  "bfbafeca", // Universal Mach-O / compiled Java
]);

function pathIssue(file) {
  const name = path.posix.basename(file);
  if (/^\.env(?:\.|$)/i.test(name) && !/^\.env\.(?:example|template)$/.test(name))
    return "private environment file; publish an empty .env.example instead";
  if (/\.(?:p12|pfx|p8|pem|key|jks|keychain-db)$/i.test(name))
    return "signing or credential material belongs outside Git";
  if (/^(?:auth|credentials)\.json$/i.test(name)) return "private authentication data";
  if (/\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/i.test(name))
    return "application database; use synthetic test fixtures in code";
  if (
    /\.(?:node|exe|dll|so(?:\.\d+)*|dylib|dmg|appimage|deb|rpm|msi|o|a|gguf|onnx|zip|tar|tgz|gz|7z)$/i.test(
      name
    )
  )
    return "generated executable, installer, or model; use verified build/download scripts";
  if (/^(?:node_modules|dist|build|release|\.cache|resources\/bin)\//.test(file))
    return "generated output or cache";
  if (/^src\/assets\/fonts\/yowza(?:\/|$)/i.test(file)) return "restricted upstream font asset";
  if (
    file.startsWith("src/components/icons/") &&
    !iconAdapters.has(file.slice("src/components/icons/".length))
  )
    return "vendored icon component; use the Lucide adapter or existing geometric primitives";
  return null;
}

function contentIssue(prefix, size) {
  if (size > 10 * 1024 * 1024) return "file exceeds the 10 MiB source/asset limit";
  if (
    executableMagic.has(prefix.subarray(0, 4).toString("hex")) ||
    prefix.subarray(0, 2).toString("ascii") === "MZ"
  )
    return "compiled executable content";
  if (prefix.subarray(0, 16).toString("ascii") === "SQLite format 3\0")
    return "SQLite database content";
  if (prefix.subarray(0, 4).toString("ascii") === "GGUF") return "downloaded model content";
  if (/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(prefix.toString("utf8")))
    return "private key content";
  return null;
}

function checkFiles(root, files) {
  const issues = [];
  for (const file of files) {
    const absolute = path.join(root, file);
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat) continue; // An unstaged deletion is not published.
    const namedIssue = pathIssue(file);
    if (namedIssue) {
      issues.push({ file, reason: namedIssue });
      continue;
    }
    if (stat.isSymbolicLink()) {
      // Do not dereference a symlink into a contributor's private filesystem.
      const target = fs.readlinkSync(absolute);
      const relative = path.relative(root, path.resolve(path.dirname(absolute), target));
      if (path.isAbsolute(target) || relative === ".." || relative.startsWith(`..${path.sep}`))
        issues.push({ file, reason: "symlink points outside the repository" });
      continue;
    }
    if (!stat.isFile()) continue;
    const fd = fs.openSync(absolute, "r");
    let issue;
    try {
      const prefix = Buffer.alloc(Math.min(stat.size, 4096));
      fs.readSync(fd, prefix, 0, prefix.length, 0);
      issue = contentIssue(prefix, stat.size);
    } finally {
      fs.closeSync(fd);
    }
    if (issue) issues.push({ file, reason: issue });
  }
  return issues;
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: root,
      encoding: "utf8",
    }
  )
    .split("\0")
    .filter(Boolean);
  const issues = checkFiles(root, [...new Set(files)]);
  if (issues.length) {
    // Only print paths and reasons, never file contents or secret values.
    for (const { file, reason } of issues) console.error(`${JSON.stringify(file)}: ${reason}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Publication hygiene passed (${files.length} tracked or unignored files). History secrets are checked separately by Gitleaks.`
    );
  }
}

module.exports = { pathIssue, contentIssue, checkFiles };
