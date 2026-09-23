const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-text-monitor-build-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ["scripts", "resources/bin", "commands"])
    fs.mkdirSync(path.join(dir, name), { recursive: true });
  for (const name of ["build-linux-text-monitor.js", "download-text-monitor.js"])
    fs.copyFileSync(path.join(__dirname, "../../scripts", name), path.join(dir, "scripts", name));
  fs.writeFileSync(
    path.join(dir, "resources/linux-text-monitor.c"),
    "int main(void) { return 0; }\n"
  );
  fs.writeFileSync(
    path.join(dir, "commands/pkg-config"),
    `#!/bin/sh
if [ "$LOQUI_TEST_NO_HEADERS" = 1 ]; then exit 1; fi
if [ "$1" = --exists ]; then exit 0; fi
printf '%s\\n' '-I/fixture -latspi'
`,
    { mode: 0o755 }
  );
  for (const name of ["gcc", "cc"]) {
    fs.writeFileSync(
      path.join(dir, "commands", name),
      `#!/bin/sh
printf '%s\\n' "$0" >> "$LOQUI_TEST_COMMAND_LOG"
if [ "$LOQUI_TEST_COMPILE_FAIL" = 1 ]; then exit 1; fi
if [ "$LOQUI_TEST_NO_OUTPUT" = 1 ]; then exit 0; fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then shift; printf 'native fixture' > "$1"; exit 0; fi
  shift
done
exit 1
`,
      { mode: 0o755 }
    );
  }
  return {
    dir,
    binary: path.join(dir, "resources/bin/linux-text-monitor"),
    build(env = {}, script = "build-linux-text-monitor.js") {
      return spawnSync(process.execPath, [path.join(dir, "scripts", script)], {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          CI: "",
          LOQUI_RELEASE_BUILD: "",
          PATH: path.join(dir, "commands"),
          LOQUI_TEST_COMMAND_LOG: path.join(dir, "compiler.log"),
          ...env,
        },
      });
    },
  };
}

test(
  "CI and release builds fail on missing AT-SPI headers without trying a download",
  { skip: process.platform !== "linux" },
  (t) => {
    const f = fixture(t);
    for (const strict of [{ CI: "true" }, { LOQUI_RELEASE_BUILD: "1" }]) {
      const result = f.build({ ...strict, LOQUI_TEST_NO_HEADERS: "1" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /source-built Linux text monitor is required/);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /Fetching latest|Attempting to download|OpenWhispr/
      );
    }
  }
);

test(
  "development without native headers retains the Python fallback",
  { skip: process.platform !== "linux" },
  (t) => {
    const f = fixture(t);
    const result = f.build({ LOQUI_TEST_NO_HEADERS: "1" });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /Python fallback/);
    assert.equal(fs.existsSync(f.binary), false);
  }
);

test(
  "strict builds recompile matching cached output and fail on compiler errors",
  { skip: process.platform !== "linux" },
  (t) => {
    const f = fixture(t);
    assert.equal(f.build().status, 0);
    assert.equal(f.build().status, 0);
    assert.equal(
      fs.readFileSync(path.join(f.dir, "compiler.log"), "utf8").trim().split("\n").length,
      1
    );
    const result = f.build({ LOQUI_RELEASE_BUILD: "1", LOQUI_TEST_COMPILE_FAIL: "1" });
    assert.equal(result.status, 1);
    assert.equal(
      fs.readFileSync(path.join(f.dir, "compiler.log"), "utf8").trim().split("\n").length,
      3
    );
  }
);

test(
  "an unverified existing binary is compiled instead of being blessed with a source hash",
  { skip: process.platform !== "linux" },
  (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.binary, "unverified binary");
    assert.equal(f.build().status, 0);
    assert.equal(fs.readFileSync(f.binary, "utf8"), "native fixture");
    assert.ok(fs.existsSync(path.join(f.dir, "compiler.log")));
  }
);

test(
  "missing source and missing compiler output fail strict builds",
  { skip: process.platform !== "linux" },
  (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.binary, "old cached binary");
    const noOutput = f.build({ CI: "true", LOQUI_TEST_NO_OUTPUT: "1" });
    assert.equal(noOutput.status, 1);
    assert.match(noOutput.stdout, /did not produce a nonempty/);
    assert.equal(fs.readFileSync(f.binary, "utf8"), "old cached binary");
    fs.rmSync(path.join(f.dir, "resources/linux-text-monitor.c"));
    const noSource = f.build({ CI: "true" });
    assert.equal(noSource.status, 1);
    assert.match(noSource.stdout, /C source not found/);
  }
);

test(
  "the old Linux download entry point builds local source without loading download utilities",
  { skip: process.platform !== "linux" },
  (t) => {
    const f = fixture(t);
    const result = f.build({ CI: "true" }, "download-text-monitor.js");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no prebuilt download/);
    assert.equal(fs.readFileSync(f.binary, "utf8"), "native fixture");
  }
);
