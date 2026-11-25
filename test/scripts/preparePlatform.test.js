const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter, PassThrough } = require("node:stream");
const { preparePlatform, runStep, DOWNLOADS } = require("../../scripts/prepare-platform.cjs");

// Records each step's start and finish; steps resolve only when released, so the
// test can observe which ones were in flight together.
function recorder({ fail = new Set() } = {}) {
  const events = [];
  const pending = new Map();
  const run = (file, args = []) =>
    new Promise((resolve, reject) => {
      events.push(["start", file, args]);
      pending.set(file, () => {
        events.push(["end", file]);
        fail.has(file) ? reject(Error(`${file} failed`)) : resolve();
      });
    });
  const drain = async () => {
    for (let i = 0; i < 100; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      const next = [...pending.entries()];
      pending.clear();
      for (const [, release] of next) release();
    }
  };
  const inFlight = () => {
    const open = new Set();
    let max = new Set();
    for (const [kind, file] of events) {
      if (kind === "start") open.add(file);
      else open.delete(file);
      if (open.size > max.size) max = new Set(open);
    }
    return max;
  };
  return { run, events, drain, inFlight };
}

const present = { exists: () => true, size: () => 1 };

test("[change-driving] downloads run concurrently with each other and with native builds", async () => {
  const r = recorder();
  const done = preparePlatform({ platform: "linux", arch: "x64", run: r.run, ...present });
  await r.drain();
  await done;
  const parallel = r.inFlight();
  for (const [file] of DOWNLOADS) assert.ok(parallel.has(file), `${file} overlaps the others`);
  assert.ok(parallel.has("build-linux-key-listener"), "native builds overlap the downloads");
  const at = (kind, file) => r.events.findIndex(([k, f]) => k === kind && f === file);
  assert.ok(
    at("start", "build-linux-fast-paste") > at("end", "build-linux-key-listener"),
    "native builds stay sequential"
  );
  const sherpaDone = r.events.findIndex(([k, f]) => k === "end" && f === "download-sherpa-onnx");
  const aecDone = r.events.findIndex(([k, f]) => k === "end" && f === "build-meeting-aec-helper");
  const websocket = r.events.findIndex(([k, f]) => k === "start" && f === "build-sherpa-websocket");
  assert.ok(
    websocket > sherpaDone && websocket > aecDone,
    "the loopback server builds after its runtime and the other CMake build"
  );
});

test("every download keeps --force so no stale binary skips SHA-256 verification", async () => {
  const r = recorder();
  const done = preparePlatform({ platform: "darwin", arch: "arm64", run: r.run, ...present });
  await r.drain();
  await done;
  const args = Object.fromEntries(
    r.events.filter(([kind]) => kind === "start").map(([, file, list]) => [file, list])
  );
  for (const [file] of DOWNLOADS) assert.ok(args[file].includes("--force"), file);
  for (const file of ["download-whisper-cpp", "download-sherpa-onnx", "download-qdrant"])
    assert.deepEqual(args[file], ["--current", "--force"], file);
  assert.deepEqual(args["download-minilm"], ["--for-build", "--force"]);
  assert.ok("build-macos-audio-tap" in args && !("build-linux-key-listener" in args));
});

test("a failed step fails the run only after its siblings settle, naming every failure", async () => {
  const r = recorder({ fail: new Set(["download-qdrant", "build-text-monitor"]) });
  // Observe the rejection immediately so it is never reported as unhandled.
  const done = preparePlatform({ platform: "linux", arch: "x64", run: r.run, ...present }).then(
    () => assert.fail("expected the run to fail"),
    (error) => error
  );
  await r.drain();
  await assert.rejects(Promise.reject(await done), (error) => {
    assert.match(error.message, /download-qdrant failed/);
    assert.match(error.message, /build-text-monitor failed/);
    return true;
  });
  const ended = new Set(r.events.filter(([kind]) => kind === "end").map(([, file]) => file));
  for (const [file] of DOWNLOADS) assert.ok(ended.has(file), `${file} finished before exit`);
  assert.ok(!r.events.some(([, file]) => file === "build-sherpa-websocket"));
});

test("unsupported targets and missing runtimes still fail", async () => {
  await assert.rejects(
    preparePlatform({ platform: "win32", arch: "x64", run: async () => {} }),
    /Unsupported release platform: win32-x64/
  );
  await assert.rejects(
    preparePlatform({
      platform: "linux",
      arch: "x64",
      run: async () => {},
      exists: () => true,
      size: (file) => (file.includes("qdrant") ? 0 : 1),
    }),
    /Missing required runtime: resources\/bin\/qdrant-linux-x64/
  );
});

test("step output is prefixed per line and a non-zero exit rejects", async () => {
  const lines = [];
  const fake = (code) => () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setImmediate(() => {
      child.stdout.write("one\ntw");
      child.stdout.end("o");
      child.stderr.end("warn\n");
      setImmediate(() => child.emit("close", code, null));
    });
    return child;
  };
  await runStep("download-qdrant", ["--current"], {
    spawnImpl: fake(0),
    write: (t) => lines.push(t),
  });
  assert.deepEqual(
    lines.sort(),
    ["[download-qdrant] one\n", "[download-qdrant] two\n", "[download-qdrant] warn\n"].sort()
  );
  await assert.rejects(
    runStep("download-qdrant", ["--current"], { spawnImpl: fake(2), write: () => {} }),
    /download-qdrant --current failed \(exit 2\)/
  );
  await assert.rejects(
    runStep("build-sherpa-websocket", [], { spawnImpl: fake(1), write: () => {} }),
    (error) => error.message === "build-sherpa-websocket failed (exit 1)"
  );
});
