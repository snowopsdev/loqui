const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const cp = require("node:child_process");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { wavHeader } = require("./harness/wavFixtures");

function conversionFixture(t) {
  const sinks = [],
    processes = [],
    files = new Map();
  let fail = false,
    deferred = false;
  t.mock.method(fs, "existsSync", () => true);
  t.mock.method(fs, "accessSync", () => {});
  t.mock.method(fs, "mkdtempSync", () => {
    sinks.push("mkdir");
    return "/fixture-audio";
  });
  t.mock.method(fs, "mkdirSync", () => {
    sinks.push("mkdir");
  });
  t.mock.method(fs, "writeFileSync", (path, data) => {
    sinks.push(["write", path]);
    files.set(path, Buffer.from(data));
  });
  t.mock.method(fs, "statSync", (path) => ({ size: files.get(path)?.length ?? 0 }));
  const read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (path, ...args) =>
    files.has(path)
      ? files.get(path)
      : /\.wav$/.test(String(path))
        ? wavHeader()
        : read(path, ...args)
  );
  t.mock.method(fs, "rmSync", () => {});
  t.mock.method(fs, "unlinkSync", () => {});
  t.mock.method(cp, "spawn", (binary, args, options) => {
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    const inputs = [];
    proc.stdin = new Writable({
      write(data, _encoding, done) {
        inputs.push(Buffer.from(data));
        done();
      },
    });
    proc.kill = () => {
      queueMicrotask(() => proc.emit("close", null));
      return true;
    };
    const finish = () => {
      if (args.at(-1) !== "pipe:1") {
        sinks.push(["output", args.at(-1)]);
        files.set(args.at(-1), wavHeader());
      } else proc.stdout.end(Buffer.from([0x10, 0x20, 0x30, 0x40]));
      proc.emit("close", fail ? 1 : 0);
    };
    processes.push({ binary, args, options, inputs, finish, proc });
    proc.stdin.on("finish", () => {
      if (!deferred) queueMicrotask(finish);
    });
    if (options.stdio[0] === "ignore") queueMicrotask(finish);
    return proc;
  });
  const file = require.resolve("../../src/helpers/ffmpegUtils");
  const previous = require.cache[file];
  delete require.cache[file];
  const converter = require(file);
  t.after(() => {
    if (previous) require.cache[file] = previous;
    else delete require.cache[file];
  });
  return {
    converter,
    sinks,
    processes,
    fail: (value) => {
      fail = value;
    },
    defer: (value) => {
      deferred = value;
    },
  };
}

for (const privateAudio of [true, false]) {
  test(`${privateAudio ? "private" : "public"} actual multisegment converter observes process and filesystem sinks`, async (t) => {
    const h = conversionFixture(t);
    const segments = [Buffer.from("segment-A-webm"), Buffer.from("segment-B-webm")].map(
      (buffer) => ({ buffer, mimeType: "audio/webm" })
    );
    const result = await h.converter.mergeAudioSegments(segments, { private: privateAudio });
    assert.ok(result.length > 0);
    if (privateAudio) {
      assert.deepEqual(h.sinks, []);
      assert.equal(h.processes.length, 2, "decode every segment in order");
      assert.deepEqual(
        h.processes.map((p) => Buffer.concat(p.inputs)),
        segments.map((s) => s.buffer)
      );
      assert.ok(h.processes.every((p) => p.args.includes("pipe:0") && p.args.at(-1) === "pipe:1"));
      assert.equal(h.converter.isPcm16Mono16kWav(result), true);
      assert.deepEqual(
        result.subarray(44),
        Buffer.from([0x10, 0x20, 0x30, 0x40, 0x10, 0x20, 0x30, 0x40])
      );
    } else
      assert.ok(
        h.sinks.some((s) => s === "mkdir") &&
          h.sinks.some((s) => s[0] === "write") &&
          h.sinks.some((s) => s[0] === "output")
      );
  });
}

test("actual Parakeet decoder private WebM missing PCM uses pipes; valid PCM WAV bypasses conversion", async (t) => {
  const h = conversionFixture(t);
  const file = require.resolve("../../src/helpers/parakeetServer");
  const old = require.cache[file];
  delete require.cache[file];
  const Server = require(file);
  t.after(() => {
    if (old) require.cache[file] = old;
    else delete require.cache[file];
  });
  const manager = Object.create(Server.prototype);
  const webm = Buffer.from("private-complete-original-webm");
  const result = await manager._ensureWav(webm, { private: true });
  assert.equal(h.converter.isPcm16Mono16kWav(result.wavBuffer), true);
  assert.deepEqual(result.filesToCleanup, []);
  assert.deepEqual(h.sinks, []);
  const wav = wavHeader();
  assert.equal((await manager._ensureWav(wav, { private: true })).wavBuffer, wav);
});

function mainConversionFixture(converter, parakeet) {
  const vm = require("node:vm");
  const handlers = new Map();
  const module = { exports: {} };
  const inert = () =>
    new Proxy(function () {}, {
      get: (_, key) => (key === "then" ? undefined : inert()),
      apply: () => inert(),
      construct: () => inert(),
    });
  vm.runInNewContext(fs.readFileSync(require.resolve("../../src/helpers/ipcHandlers"), "utf8"), {
    module,
    exports: module.exports,
    process,
    Date,
    Buffer,
    setTimeout,
    clearTimeout,
    require: (name) =>
      name === "electron"
        ? { ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} } }
        : name === "./ffmpegUtils"
          ? converter
          : inert(),
  });
  const context = new Proxy(
    { parakeetManager: parakeet },
    { get: (target, key) => (key in target ? target[key] : inert()) }
  );
  module.exports.prototype.setupHandlers.call(context);
  return (channel, ...args) => handlers.get(channel)({}, ...args);
}

for (const outcome of ["success", "error", "cancel", "late-owner"]) {
  test(`actual AudioManager → main → private merge pipes retains all RAM on ${outcome}`, async (t) => {
    const { loadAudioManager } = require("./harness/audioManager");
    const loaded = await loadAudioManager(t, {
      cachePrefix: "loqui-private-converter-",
      settingsKey: "__privateConverterSettings",
      settings: {},
    });
    const h = conversionFixture(t);
    const invoke = mainConversionFixture(h.converter);
    loaded.window.electronAPI.mergeAudioSegments = (segments, options) =>
      invoke("merge-audio-segments", segments, options);
    const manager = loaded.createManager();
    const originals = [
      new Blob(["A".repeat(1500)], { type: "audio/webm" }),
      new Blob(["B".repeat(1800)], { type: "audio/webm" }),
    ];
    const owner = { private: true };
    if (outcome === "error") h.fail(true);
    if (outcome === "cancel" || outcome === "late-owner") h.defer(true);
    const pending = manager.mergeRecordedSegments(originals, owner);
    const rejection = outcome === "error" ? assert.rejects(pending, /conversion failed/) : null;
    if (outcome === "cancel" || outcome === "late-owner") {
      for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
      manager._recordingContext = { private: false };
      manager.lastAudioBlob = new Blob(["newer B"]);
      const newer = manager.lastAudioBlob;
      h.processes[0].finish();
      for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
      h.processes[1].finish();
      await pending;
      assert.equal(
        manager.lastAudioBlob,
        newer,
        "old converter cannot replace newer manager bytes"
      );
    } else if (rejection) await rejection;
    else assert.equal((await pending).type, "audio/wav");
    assert.deepEqual(h.sinks, []);
    assert.deepEqual(owner.originalSegments, originals);
    assert.equal(await owner.originalSegments[0].text(), "A".repeat(1500));
    assert.equal(await owner.originalSegments[1].text(), "B".repeat(1800));
  });
}

test("private converter abort/error requests no files and never mutates its input", async (t) => {
  const h = conversionFixture(t);
  const original = Buffer.from("complete original compressed container");
  const copy = Buffer.from(original);
  h.defer(true);
  const abort = new AbortController();
  const pending = h.converter.convertPrivateBufferToWav(original, { signal: abort.signal });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  abort.abort();
  await rejected;
  assert.deepEqual(h.sinks, []);
  assert.deepEqual(original, copy);
});

test("real renderer Parakeet call crosses main and actual Parakeet decoder with absent/incomplete PCM, using no file sinks", async (t) => {
  const { loadAudioManager } = require("./harness/audioManager");
  const loaded = await loadAudioManager(t, {
    cachePrefix: "loqui-private-parakeet-",
    settingsKey: "__privateParakeetSettings",
    settings: {
      preferredLanguage: "en",
      useLocalWhisper: true,
      localTranscriptionProvider: "nvidia",
      parakeetModel: "parakeet-unified-en-0.6b",
    },
  });
  const h = conversionFixture(t);
  const serverPath = require.resolve("../../src/helpers/parakeetServer");
  const saved = require.cache[serverPath];
  delete require.cache[serverPath];
  const Server = require(serverPath);
  t.after(() => {
    if (saved) require.cache[serverPath] = saved;
    else delete require.cache[serverPath];
  });
  const server = Object.assign(Object.create(Server.prototype), {
    isAvailable: () => true,
    isModelDownloaded: () => true,
    getModelsDir: () => "/fixture-models",
    wsServer: {
      start: async () => {},
      transcribe: async () => ({ text: "Decoded original audio." }),
    },
  });
  const Manager = require("../../src/helpers/parakeet");
  const actualParakeet = Object.assign(Object.create(Manager.prototype), { serverManager: server });
  const invoke = mainConversionFixture(h.converter, actualParakeet);
  loaded.window.electronAPI.transcribeLocalParakeet = (buffer, options) =>
    invoke("transcribe-local-parakeet", buffer, options);
  const manager = loaded.createManager({ processTranscription: async (text) => text });
  const original = new Blob(["complete private original WebM bytes"], { type: "audio/webm" });
  for (const pcm of [undefined, null]) {
    const result = await manager.processWithLocalParakeet(original, "parakeet-unified-en-0.6b", {
      private: true,
      ...(pcm ? { rawWav: pcm } : {}),
    });
    assert.equal(result.text, "Decoded original audio.");
    assert.equal(await original.text(), "complete private original WebM bytes");
  }
  assert.equal(h.processes.length, 2);
  assert.deepEqual(h.sinks, []);
  assert.deepEqual(
    h.processes.map((p) => Buffer.concat(p.inputs).toString()),
    [await original.text(), await original.text()]
  );
  // The same real decoder path is also admitted through processAudio, so a
  // failed/late conversion cannot publish or release another recording's RAM.
  for (const outcome of ["error", "cancel", "late-owner"]) {
    h.fail(outcome === "error");
    h.defer(outcome !== "error");
    const owner = { private: true, audioBlob: original },
      results = [],
      errors = [];
    manager._recordingContext = owner;
    manager.lastAudioBlob = original;
    manager.lastAudioBlobPrivate = true;
    manager._processingCancellationGeneration = 0;
    manager.isProcessing = true;
    manager.onTranscriptionComplete = (value) => results.push(value);
    manager.onError = (value) => errors.push(value);
    const index = h.processes.length;
    const pending = manager.processAudio(original, { rawWav: null });
    let newer;
    if (outcome !== "error") {
      for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
      if (outcome === "cancel") manager._processingCancellationGeneration++;
      else {
        manager._recordingContext = { private: false };
        manager._activeProcessingPipeline = {};
        manager.lastAudioBlob = newer = new Blob(["newer owner WebM"]);
      }
      h.processes[index].finish();
    }
    await pending;
    assert.deepEqual(results, [], outcome);
    assert.equal(errors.length, outcome === "error" ? 1 : 0, outcome);
    assert.equal(owner.audioBlob, original);
    assert.equal(await owner.audioBlob.text(), "complete private original WebM bytes");
    if (newer) assert.equal(manager.lastAudioBlob, newer);
    assert.deepEqual(h.sinks, [], outcome);
  }
});

for (const path of ["batch", "streaming"]) {
  for (const outcome of ["error", "cancel", "late-owner"]) {
    test(`real private ${path} finalization preserves complete original RAM on ${outcome}`, async (t) => {
      const { loadAudioManager } = require("./harness/audioManager");
      const loaded = await loadAudioManager(t, {
        cachePrefix: "loqui-private-finalize-",
        settingsKey: "__privateFinalizeSettings",
      });
      const h = conversionFixture(t);
      h.fail(true);
      h.defer(outcome !== "error");
      const invoke = mainConversionFixture(h.converter);
      loaded.window.electronAPI.mergeAudioSegments = (segments, options) =>
        invoke("merge-audio-segments", segments, options);
      const segments = [new Blob(["A".repeat(1500)]), new Blob(["B".repeat(1800)])];
      const owner = { private: true },
        errors = [];
      let stops = 0;
      const manager = loaded.createManager({
        _recordingContext: owner,
        _recordingPrivate: true,
        _batchSegments: segments,
        _streamingFallbackSegments: segments,
        _activeStreamingSessionId: 7,
        _streamingCancellationGeneration: 0,
        streamingCleanupFns: [],
        _streamingTransport: {
          adapter: {
            stop: async () => {
              stops++;
            },
          },
          closed: false,
        },
        isStreaming: path === "streaming",
        isRecording: true,
        micRecovery: { stop() {} },
        teardownSpeechGate() {},
        cleanupPreview: async () => {},
        shouldShowPreviewCleanupState: () => false,
        finishStreamingFallbackSegment: async () => {},
        onError: (error) => errors.push(error),
      });
      const pending =
        path === "batch" ? manager.finalizeBatchRecording(null) : manager.stopStreamingRecording();
      let newer;
      if (outcome !== "error") {
        for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
        if (path === "batch") manager._processingCancellationGeneration = 1;
        else manager._streamingCancellationGeneration++;
        if (outcome === "late-owner") {
          manager._recordingContext = { private: false };
          manager.lastAudioBlob = newer = new Blob(["newer B"]);
        }
        h.processes[0].finish();
      }
      await pending;
      assert.deepEqual(h.sinks, []);
      assert.deepEqual(owner.originalSegments, segments);
      assert.equal(await owner.originalSegments[0].text(), "A".repeat(1500));
      assert.equal(await owner.originalSegments[1].text(), "B".repeat(1800));
      if (outcome === "error") {
        assert.equal(errors[0].code, "AUDIO_CONVERSION_FAILED");
        assert.equal(await manager.lastAudioBlob.text(), "A".repeat(1500) + "B".repeat(1800));
      } else assert.equal(errors.length, 0, "cancelled work does not publish an obsolete failure");
      if (newer) assert.equal(manager.lastAudioBlob, newer);
      if (path === "streaming") assert.equal(stops, 1);
    });
  }
}
