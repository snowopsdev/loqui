const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Always isolate model fixtures from the application's downloaded models.
const testCache = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-snowopsdev-tests-"));
try {
  const args = process.argv.slice(2);
  const options = args.filter((arg) => arg.startsWith("--"));
  const patterns = args.filter((arg) => !arg.startsWith("--"));
  const files = [
    ...new Set(
      (patterns.length ? patterns : ["test/**/*.test.js"]).flatMap((pattern) => [
        ...fs.globSync(pattern),
      ])
    ),
  ].sort();
  if (!files.length) throw new Error("No test files matched the supplied patterns.");
  const native = [];
  const renderer = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    // better-sqlite3 and tsx's loader worker can race during Node cleanup.
    // These CommonJS tests do not need the TypeScript loader.
    (source.includes("helpers/database") || source.includes('require("./harness/db")')
      ? native
      : renderer
    ).push(file);
  }
  if (native.length) {
    try {
      const Sqlite = require("better-sqlite3");
      const probe = new Sqlite(":memory:");
      probe.close();
    } catch (error) {
      throw new Error(
        "Database tests require better-sqlite3 built for this Node runtime. " +
          "Run npm rebuild better-sqlite3 with the same Node version, then rerun npm test. " +
          "Before launching Electron again, run npm run native:electron. " +
          `Native binding error: ${error.message}`,
        { cause: error }
      );
    }
  }
  for (const [group, imports] of [
    [native, []],
    [renderer, ["--import", "tsx"]],
  ]) {
    if (!group.length) continue;
    const result = spawnSync(process.execPath, [...imports, "--test", ...options, ...group], {
      stdio: "inherit",
      env: {
        ...process.env,
        LOQUI_CACHE_ROOT: testCache,
        XDG_CACHE_HOME: path.join(testCache, "xdg"),
      },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  }
} finally {
  fs.rmSync(testCache, { recursive: true, force: true });
}
