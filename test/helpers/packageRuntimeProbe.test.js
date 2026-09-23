const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { probeRuntimeVersion } = require("../../scripts/lib/package-runtime-probe.cjs");

test("version probes retain execution and expose macOS llama cold-start budget", () => {
  for (const [platform, name, timeout] of [
    ["darwin", "llama-server-darwin-arm64", 60000],
    ["darwin", "qdrant-darwin-arm64", 15000],
    ["linux", "llama-server-linux-x64-cpu", 15000],
  ]) {
    const messages = [];
    let executions = 0;
    probeRuntimeVersion(`/packaged/bin/${name}`, {
      platform,
      log: (message) => messages.push(message),
      run: (binary, args, options) => {
        executions++;
        assert.equal(binary, `/packaged/bin/${name}`);
        assert.deepEqual(args, ["--version"]);
        assert.equal(options.timeout, timeout);
        assert.equal(options.killSignal, "SIGKILL");
        assert.equal(options.stdio, "inherit");
      },
    });
    assert.equal(executions, 1);
    assert.match(messages[0], new RegExp(`timeout ${timeout} ms`));
    assert.match(messages[1], /passed in \d+ ms/);
  }
});

test("timeouts, missing binaries, denied execution and crashes fail without retrying", () => {
  for (const [properties, reason] of [
    [{ code: "ETIMEDOUT", signal: "SIGKILL", status: null }, /timed out after 60000 ms/],
    [{ code: "ENOENT" }, /ENOENT/],
    [{ code: "EACCES" }, /EACCES/],
    [{ signal: "SIGKILL", status: null }, /terminated by SIGKILL/],
    [{ status: 1 }, /exited with status 1/],
  ]) {
    const failure = Object.assign(new Error("runtime failed"), properties);
    const messages = [];
    let executions = 0;
    assert.throws(
      () =>
        probeRuntimeVersion("/packaged/bin/llama-server-darwin-arm64", {
          platform: "darwin",
          log: (message) => messages.push(message),
          run: () => {
            executions++;
            throw failure;
          },
        }),
      (error) => error.cause === failure && reason.test(error.message)
    );
    assert.equal(executions, 1);
    assert.equal(messages.length, 1, "a failed probe must never announce success");
  }
});

test("a runtime that ignores termination is killed and still fails the probe", () => {
  assert.throws(
    () =>
      probeRuntimeVersion("/packaged/bin/llama-server-darwin-arm64", {
        platform: "darwin",
        log: () => {},
        run: (_binary, _args, options) =>
          execFileSync(
            process.execPath,
            ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
            { ...options, timeout: 250 }
          ),
      }),
    (error) => error.cause.code === "ETIMEDOUT" && error.cause.signal === "SIGKILL"
  );
});
