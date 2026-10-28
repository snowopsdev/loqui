const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const cp = require("node:child_process");
const http = require("node:http");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const registry = require("../../src/helpers/privacy/childRegistry");
const ff = require("../../src/helpers/ffmpegUtils");
const { pcm16Mono16kWav } = require("./harness/wavFixtures");

test("each input gets exactly file,pipe without mutating arguments", () => {
  const args = ["-i", "first.wav", "-i", "pipe:0", "pipe:1"];
  const expected = [
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    "first.wav",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    "pipe:0",
    "pipe:1",
  ];
  assert.deepEqual(ff.localOnlyInputs(args), expected);
  assert.deepEqual(ff.localOnlyInputs(expected), expected);
  assert.equal(args.length, 5);
});
test("dangerous whitelists, override forms and output protocols are rejected", () => {
  for (const args of [
    ["-protocol_whitelist", "file,http", "-i", "a"],
    ["-protocol_whitelist=file,pipe", "-i", "a"],
    ["-protocol_whitelist:0", "file,pipe", "-i", "a"],
    ["-protocol_blacklist", "http", "-i", "a"],
    ["-i", "a", "-protocol_whitelist", "file,http", "b"],
    ["-i", "http://127.0.0.1:9/input", "b"],
    ["-i", "a", "tcp://127.0.0.1:9/out"],
    ["-i", "a", "-f", "tee", "[f=wav]http://127.0.0.1/out"],
    ["-i", "a", "-hls_segment_filename", "http://127.0.0.1/%d", "out.m3u8"],
    ["-i", "a", "[f=wav]udp:127.0.0.1:9"],
    ["-i", "a", "-filter_complex", "[0:a]amovie=udp:127.0.0.1:9[out]", "b"],
    ["-i"],
  ])
    assert.throws(
      () => ff.localOnlyInputs(args),
      { code: "FFMPEG_UNSAFE_INPUT" },
      JSON.stringify(args)
    );
});
test("guard refuses unsafe FFmpeg argv and every shell form even unsealed", () => {
  gate.configureEgress({ isSealed: () => false });
  let calls = 0;
  const leaf = {
    spawn: () => {
      calls++;
      return { once() {} };
    },
    exec: () => {
      calls++;
    },
    execSync: () => {
      calls++;
    },
  };
  registry.installSpawnGuard({ childProcess: leaf });
  for (const args of [
    ["-i", "a", "b"],
    ["-protocol_whitelist", "http", "-i", "a", "b"],
    ["-protocol_whitelist", "file,pipe", "-i", "a", "udp://127.0.0.1/out"],
  ])
    assert.throws(() => leaf.spawn("ffmpeg", args), { code: "FFMPEG_UNSAFE_INPUT" });
  assert.throws(() => leaf.spawn("ffmpeg", ff.localOnlyInputs(["-i", "a", "b"]), { shell: true }), {
    code: "FFMPEG_UNSAFE_INPUT",
  });
  for (const command of ["ffmpeg -i a b", '"/usr/bin/ffmpeg" -i a b', "sh -c 'ffmpeg -i a b'"])
    for (const name of ["exec", "execSync"])
      assert.throws(() => leaf[name](command), { code: "FFMPEG_UNSAFE_INPUT" });
  assert.throws(() => leaf.spawn("sh", ["-c", "ffmpeg -i a b"]), { code: "FFMPEG_UNSAFE_INPUT" });
  assert.equal(calls, 0);
});

test("filter sources and file-loading aliases reject before any native leaf", () => {
  gate.configureEgress({ isSealed: () => false });
  let calls = 0;
  const leaf = Object.fromEntries(
    ["spawn", "execFile", "spawnSync", "execFileSync"].map((name) => [
      name,
      () => {
        calls++;
        throw new Error("unsafe argv reached native leaf");
      },
    ])
  );
  registry.installSpawnGuard({ childProcess: leaf });
  // No native execution in this matrix: even local file sources and source
  // spellings the raw URL scan cannot recognize must fail closed.
  const sources = [
    "amovie='http\\://127.0.0.1\\:12345/synthetic.wav'[out]",
    "movie='http\\://127.0.0.1\\:12345/synthetic.wav'[out]",
    "amovie=filename='http\\\\://127.0.0.1\\\\:12345/synthetic.wav'[out]",
    "amovie='http%3A%2F%2F127.0.0.1%3A12345/synthetic.wav'[out]",
    "amov%69e='/synthetic.wav'[out]",
    "amovie='file\\:/synthetic.wav'[out]",
    "amovie='/synthetic.wav'[out]",
    "amovie=pipe\\:0[out]",
    "am\\ovie='/synthetic.wav'[out]",
    "amovie@source='/synthetic.wav'[out]",
    "[0:a]asendcmd=f=/synthetic.commands[out]",
    "[0:a]afir=ir='/synthetic.wav'[out]",
    "[0:v]drawtext=fontfile='/synthetic.font'[out]",
    "[0:v]subtitles='/synthetic.srt'[out]",
    "[0:a]azmq=bind_address='tcp\\://127.0.0.1\\:12345'[out]",
    "[0:a]aresample=16000[out];amovie='/synthetic.wav'[extra]",
  ];
  const cases = sources.flatMap((source) =>
    ["-filter_complex", "-lavfi", "-af", "-filter:a", "-vf", "-filter:v:0"].map((option) => [
      "-v",
      "error",
      option,
      source,
      "-map",
      "[out]",
      "-f",
      "null",
      "-",
    ])
  );
  cases.push(
    ["-f", "lavfi", "-i", sources[0], "-f", "null", "-"],
    ["-/filter_complex", "/synthetic.graph", "-f", "null", "-"],
    ["-/af", "/synthetic.graph", "-f", "null", "-"],
    ["-filter_script:a", "/synthetic.graph", "-f", "null", "-"],
    ["-filter_complex_script", "/synthetic.graph", "-f", "null", "-"],
    ["-filter_complex=amovie='/synthetic.wav'[out]", "-f", "null", "-"],
    ["-af:0", "amovie='/synthetic.wav'", "-f", "null", "-"],
    ["-filter_complex", "[0:a]anull[out]", "-f", "null", "-"],
    ["-filter_complex", "", "-f", "null", "-"]
  );
  for (const args of cases.flatMap((args) => [
    args,
    ["-protocol_whitelist", "file,pipe", "-i", "synthetic.wav", ...args],
  ])) {
    assert.throws(
      () => ff.localOnlyInputs(args),
      { code: "FFMPEG_UNSAFE_INPUT" },
      JSON.stringify(args)
    );
    for (const name of Object.keys(leaf))
      assert.throws(() => leaf[name]("ffmpeg", args), { code: "FFMPEG_UNSAFE_INPUT" }, name);
  }
  assert.equal(calls, 0);
});

test("only the complete production audio merge grammar is accepted", () => {
  const graph =
    "[0:a]aresample=16000,aformat=sample_fmts=fltp:channel_layouts=mono[s0];" +
    "[1:a]aresample=16000,aformat=sample_fmts=fltp:channel_layouts=mono[s1];" +
    "[s0][s1]concat=n=2:v=0:a=1[out]";
  const inputs = ["-i", "a.wav", "-i", "b.wav"];
  assert.ok(ff.localOnlyInputs([...inputs, "-filter_complex", graph, "-map", "[out]", "out.wav"]));
  for (const unsafe of [
    graph + ";amovie='/synthetic.wav'[extra]",
    graph.replace("aresample=16000", "amovie='/synthetic.wav'"),
    graph.replace("sample_fmts=fltp", "sample_fmts=fltp:filename=/synthetic.wav"),
    graph.replace("concat=n=2", "concat=n=3"),
    graph + "\n",
  ])
    assert.throws(() => ff.localOnlyInputs([...inputs, "-filter_complex", unsafe, "out.wav"]), {
      code: "FFMPEG_UNSAFE_INPUT",
    });
  assert.throws(() => ff.localOnlyInputs(["-filter_complex", graph, "out.wav"]), {
    code: "FFMPEG_UNSAFE_INPUT",
  });
});

test(
  "escaped reviewer filter reaches only the owned fixture in the unguarded control",
  { timeout: 10000 },
  async (t) => {
    gate.configureEgress({ isSealed: () => false });
    const wav = pcm16Mono16kWav(Array.from({ length: 1600 }, () => 0));
    let hits = 0;
    const server = http.createServer((req, res) => {
      assert.equal(req.url, "/synthetic.wav");
      hits++;
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": wav.length });
      res.end(wav);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const methods = Object.fromEntries(
      ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"].map((name) => [
        name,
        cp[name],
      ])
    );
    const children = [];
    t.after(async () => {
      Object.assign(cp, methods);
      for (const c of children) {
        if (c.exitCode !== null || c.signalCode !== null) continue;
        const closed = once(c, "close");
        c.kill("SIGKILL");
        await closed;
      }
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    const binary = ff.getFFmpegPath();
    assert.ok(binary && fs.existsSync(binary), "installed FFmpeg required; do not download");
    const filter = `amovie='http\\://127.0.0.1\\:${server.address().port}/synthetic.wav'[out]`;
    const args = ["-v", "error", "-filter_complex", filter, "-map", "[out]", "-f", "null", "-"];
    const options = { stdio: ["ignore", "ignore", "pipe"], killSignal: "SIGKILL", timeout: 2500 };
    // Deliberate negative control retains the preloaded safety leaf. Both URL
    // colons are escaped, so FFmpeg addresses this listener's exact numeric port.
    const control = methods.spawn(binary, args, options);
    children.push(control);
    let stderr = "";
    control.stderr.on("data", (b) => {
      stderr += b;
    });
    const [code, signal] = await once(control, "close");
    assert.equal(code, 0, stderr);
    assert.equal(signal, null);
    assert.ok(hits > 0, "negative control must fetch the owned synthetic WAV");
    const controlHits = hits;
    let nativeCalls = 0;
    cp.spawn = (...call) => {
      nativeCalls++;
      const c = methods.spawn(...call);
      children.push(c);
      return c;
    };
    registry.installSpawnGuard({ childProcess: cp });
    assert.throws(() => cp.spawn(binary, args, options), { code: "FFMPEG_UNSAFE_INPUT" });
    assert.equal(nativeCalls, 0, "real guard rejects before native launch");
    assert.equal(hits, controlHits);
    t.diagnostic(
      `owned synthetic fixture: controlRequests=${controlHits}, guardedNativeCalls=${nativeCalls}, guardedRequests=${hits - controlHits}`
    );
  }
);

test(
  "installed FFmpeg executes all four restricted production launch sites and private cancellation",
  { timeout: 20000 },
  async (t) => {
    gate.configureEgress({ isSealed: () => false });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-ff-local-"));
    t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
    const binary = ff.getFFmpegPath();
    assert.ok(binary && fs.existsSync(binary), "installed FFmpeg required; do not download");
    const methods = Object.fromEntries(
      ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"].map((name) => [
        name,
        cp[name],
      ])
    );
    const original = cp.spawn;
    const children = [];
    const launches = [];
    cp.spawn = (...args) => {
      assert.equal(args[0], binary);
      const argv = args[1];
      launches.push(argv);
      assert.deepEqual(ff.localOnlyInputs(argv), argv);
      const c = original(args[0], argv, { ...args[2], killSignal: "SIGKILL", timeout: 5000 });
      children.push(c);
      return c;
    };
    registry._resetForTests();
    registry.installSpawnGuard({ childProcess: cp });
    delete require.cache[require.resolve("../../src/helpers/ffmpegUtils")];
    const actual = require("../../src/helpers/ffmpegUtils");
    t.after(async () => {
      Object.assign(cp, methods);
      for (const c of children) {
        if (c.exitCode !== null || c.signalCode !== null) continue;
        const closed = once(c, "close");
        c.kill("SIGKILL");
        await closed;
      }
    });
    const wav = pcm16Mono16kWav(
      Array.from({ length: 32000 }, (_, i) => Math.round(Math.sin(i / 10) * 2000))
    );
    const input = path.join(dir, "input.wav");
    fs.writeFileSync(input, wav);
    const output = path.join(dir, "out.wav");
    await actual.convertToWav(input, output);
    assert.ok(actual.isPcm16Mono16kWav(fs.readFileSync(output)));
    const split = await actual.splitAudioFile(input, dir, { segmentDuration: 1 });
    assert.ok(split.chunkPaths.length >= 2);
    const merged = await actual.mergeAudioSegments([{ buffer: wav }, { buffer: wav }]);
    assert.ok(merged.length > 0);
    const privateWav = await actual.convertPrivateBufferToWav(wav);
    assert.ok(actual.isPcm16Mono16kWav(privateWav));
    assert.equal(launches.length, 4);
    assert.equal(registry.alive().length, 4, "actual ended roots retain unresolved tree evidence");
    assert.equal(launches[3].includes("pipe:0"), true);
    assert.equal(launches[3].at(-1), "pipe:1");
    const abort = new AbortController();
    const pending = actual.convertPrivateBufferToWav(wav, { signal: abort.signal });
    abort.abort();
    await assert.rejects(pending, { name: "AbortError" });
    abort.abort();
    assert.equal(
      fs.readdirSync(dir).some((n) => n.includes("private")),
      false
    );
  }
);

test(
  "installed FFmpeg rejects a local playlist's owned numeric HTTP reference",
  { timeout: 10000 },
  async (t) => {
    gate.configureEgress({ isSealed: () => false });
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits++;
      res.end("fixture");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(
      () =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        })
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-ff-playlist-"));
    t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
    const playlist = path.join(dir, "local.m3u8");
    fs.writeFileSync(
      playlist,
      `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1,\nhttp://127.0.0.1:${server.address().port}/fixture.ts\n#EXT-X-ENDLIST\n`
    );
    const c = cp.spawn(
      ff.getFFmpegPath(),
      ff.localOnlyInputs(["-v", "error", "-i", playlist, "-f", "null", "-"]),
      { stdio: ["ignore", "ignore", "pipe"], killSignal: "SIGKILL", timeout: 5000 }
    );
    t.after(() => {
      if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
    });
    let stderr = "";
    c.stderr.on("data", (b) => {
      stderr += b;
    });
    const [code] = await once(c, "close");
    assert.notEqual(code, 0);
    assert.match(stderr, /not on whitelist|not on protocol_whitelist/i);
    assert.equal(hits, 0, "input restriction refused before contacting the owned fixture");
  }
);
