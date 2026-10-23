const test = require("node:test");
const assert = require("node:assert/strict");
const dns = require("dns");
const https = require("https");
const childProcess = require("child_process");
const { EventEmitter } = require("events");
const { Readable } = require("stream");
const fs = require("fs");
const os = require("os");
const path = require("path");
// Isolate the yt-dlp self-update cache in a temp dir so tests never touch the
// real ~/.cache/openwhispr. Must be set before the module is required.
const YT_DLP_TEST_CACHE_DIR = path.join(os.tmpdir(), `ow-ytdlp-test-${process.pid}`);
process.env.LOQUI_YTDLP_CACHE_DIR = YT_DLP_TEST_CACHE_DIR;
const Module = require("node:module");
const downloaderPath = require.resolve("../../src/helpers/urlAudioDownloader");
const ownedTemp = fs.mkdtempSync(path.join(os.tmpdir(), "ow-downloader-unit-"));
const originalLoad = Module._load;
let fixtureFfmpegPath = null;
let proxyAnswer = "DIRECT";
Module._load = function (request, parent, isMain) {
  if (parent?.filename === downloaderPath) {
    if (request === "./debugLogger") return new Proxy({}, { get: () => () => {} });
    if (request === "./safeTempDir") return { getSafeTempDir: () => ownedTemp };
    if (request === "./ffmpegUtils") return { getFFmpegPath: () => fixtureFfmpegPath };
    // resolveProxyForUrl's only Electron use; DIRECT unless a test sets a proxy.
    if (request === "electron")
      return { session: { defaultSession: { resolveProxy: async () => proxyAnswer } } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => {
  Module._load = originalLoad;
  fs.rmSync(ownedTemp, { recursive: true, force: true });
});
const downloader = require("../../src/helpers/urlAudioDownloader");
const {
  detectUrlType,
  extractYouTubeVideoId,
  isPlaylistUrl,
  isPrivateIp,
  isAcceptableAudioContentType,
  ssrfSafeLookup,
  maybeUpdateYtDlp,
} = downloader;

// --- Sealed mode (Task 10): shared production wiring for every test here ---
//
// The safety chain admits the real downloader only from this exact file, so
// the sealed URL-import and yt-dlp tests live here. Every test runs with the
// real gate (unsealed unless a test seals it), an in-memory recorder, the real
// child registry with terminal process facts, and the production spawn guard
// over a leaf that never starts a real program. Tests that assign
// childProcess.spawn directly replace the guard for their duration, as before.
const { PassThrough } = require("stream");
const vm = require("node:vm");
const sealedSpawned = [];
let sealedLeaf = () => {
  throw Object.assign(new Error("no fixture child"), { code: "EACCES" });
};
const savedSpawnLeaf = childProcess.spawn;
childProcess.spawn = (command, args, options) => {
  sealedSpawned.push({ command, args, options });
  return sealedLeaf(command, args, options);
};
const registry = require("../../src/helpers/privacy/childRegistry");
registry.installSpawnGuard({ childProcess });
const guardedSpawn = childProcess.spawn;
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const {
  SealedModeError,
  isSealedModeError,
  sealedPhaseOf,
} = require("../../src/helpers/privacy/egressPolicy");
test.after(() => {
  childProcess.spawn = savedSpawnLeaf;
  Module.syncBuiltinESMExports();
});
// Terminal process facts: nothing is listed, probed or signalled for real.
const FAKE_SYSTEM = {
  listProcesses: () => [],
  pidAlive: () => false,
  groupAlive: () => false,
  killGroup: () => {},
};
const flags = { sealed: false };
let rows = [];
test.beforeEach(() => {
  flags.sealed = false;
  proxyAnswer = "DIRECT";
  fixtureFfmpegPath = null;
  sealedSpawned.length = 0;
  childProcess.spawn = guardedSpawn;
  let clock = 0;
  const recorder = new FlightRecorder({ now: () => ++clock });
  rows = [];
  recorder.on("event", (row) => rows.push(row));
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => ++clock });
  registry._resetForTests();
  registry._setSystemForTests(FAKE_SYSTEM);
});
test.afterEach(() => {
  gate._resetForTests();
  registry._resetForTests();
  fs.rmSync(YT_DLP_TEST_CACHE_DIR, { recursive: true, force: true });
});
// Bounded: a regression must fail, never hang on a fake transport.
const sealedTest = (name, fn) => test(name, { timeout: 10000 }, fn);

test("detectUrlType returns youtube for standard watch URL", () => {
  assert.equal(detectUrlType("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "youtube");
});

test("detectUrlType returns youtube for youtu.be short URL", () => {
  assert.equal(detectUrlType("https://youtu.be/dQw4w9WgXcQ"), "youtube");
});

test("detectUrlType returns youtube for Shorts URL", () => {
  assert.equal(detectUrlType("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "youtube");
});

test("detectUrlType returns youtube for Music URL", () => {
  assert.equal(detectUrlType("https://music.youtube.com/watch?v=dQw4w9WgXcQ"), "youtube");
});

test("detectUrlType returns youtube for URL with extra params", () => {
  assert.equal(
    detectUrlType(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
    ),
    "youtube"
  );
});

test("detectUrlType returns youtube for embed URL", () => {
  assert.equal(detectUrlType("https://www.youtube.com/embed/dQw4w9WgXcQ"), "youtube");
});

test("detectUrlType returns direct for a podcast mp3 URL", () => {
  assert.equal(detectUrlType("https://example.com/episodes/ep42.mp3"), "direct");
});

test("detectUrlType returns direct for any non-YouTube https URL", () => {
  assert.equal(detectUrlType("https://cdn.radio.com/stream.ogg"), "direct");
});

test("detectUrlType throws INVALID_URL for non-http scheme", () => {
  assert.throws(() => detectUrlType("ftp://files.example.com/audio.mp3"));
  try {
    detectUrlType("ftp://files.example.com/audio.mp3");
  } catch (err) {
    assert.equal(err.code, "INVALID_URL");
  }
});

test("detectUrlType throws INVALID_URL for empty string", () => {
  assert.throws(() => detectUrlType(""));
  try {
    detectUrlType("");
  } catch (err) {
    assert.equal(err.code, "INVALID_URL");
  }
});

test("detectUrlType throws INVALID_URL for garbage input", () => {
  assert.throws(() => detectUrlType("not a url at all"));
  try {
    detectUrlType("not a url at all");
  } catch (err) {
    assert.equal(err.code, "INVALID_URL");
  }
});

test("extractYouTubeVideoId extracts from standard watch URL", () => {
  assert.equal(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractYouTubeVideoId extracts from short URL", () => {
  assert.equal(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractYouTubeVideoId extracts from Shorts URL", () => {
  assert.equal(extractYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractYouTubeVideoId extracts from embed URL", () => {
  assert.equal(extractYouTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractYouTubeVideoId extracts from Music URL", () => {
  assert.equal(
    extractYouTubeVideoId("https://music.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
});

test("extractYouTubeVideoId returns null for playlist-only URL", () => {
  assert.equal(extractYouTubeVideoId("https://www.youtube.com/playlist?list=PLrAXtmErZgOe"), null);
});

test("isPlaylistUrl returns true for playlist-only URL", () => {
  assert.equal(isPlaylistUrl("https://www.youtube.com/playlist?list=PLrAXtmErZgOe"), true);
});

test("isPlaylistUrl returns false for watch URL with playlist param", () => {
  assert.equal(
    isPlaylistUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOe"),
    false
  );
});

test("isPlaylistUrl returns false for non-YouTube URL", () => {
  assert.equal(isPlaylistUrl("https://example.com/playlist"), false);
});

test("isPrivateIp blocks loopback 127.x.x.x", () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("127.255.255.255"), true);
});

test("isPrivateIp blocks 10.x.x.x", () => {
  assert.equal(isPrivateIp("10.0.0.1"), true);
  assert.equal(isPrivateIp("10.255.255.255"), true);
});

test("isPrivateIp blocks 172.16-31.x.x", () => {
  assert.equal(isPrivateIp("172.16.0.1"), true);
  assert.equal(isPrivateIp("172.31.255.255"), true);
  assert.equal(isPrivateIp("172.15.0.1"), false);
  assert.equal(isPrivateIp("172.32.0.1"), false);
});

test("isPrivateIp blocks 192.168.x.x", () => {
  assert.equal(isPrivateIp("192.168.0.1"), true);
  assert.equal(isPrivateIp("192.168.255.255"), true);
});

test("isPrivateIp blocks link-local 169.254.x.x", () => {
  assert.equal(isPrivateIp("169.254.169.254"), true);
});

test("isPrivateIp blocks 0.0.0.0/8 (this network)", () => {
  assert.equal(isPrivateIp("0.0.0.0"), true);
  assert.equal(isPrivateIp("0.1.2.3"), true);
});

test("isPrivateIp blocks CGNAT 100.64-127.x.x", () => {
  assert.equal(isPrivateIp("100.64.0.1"), true);
  assert.equal(isPrivateIp("100.127.255.255"), true);
  assert.equal(isPrivateIp("100.63.0.1"), false);
  assert.equal(isPrivateIp("100.128.0.1"), false);
});

test("isPrivateIp blocks multicast and reserved (224+)", () => {
  assert.equal(isPrivateIp("224.0.0.1"), true);
  assert.equal(isPrivateIp("240.0.0.1"), true);
  assert.equal(isPrivateIp("255.255.255.255"), true);
});

test("isPrivateIp allows public IPs", () => {
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(isPrivateIp("1.1.1.1"), false);
  assert.equal(isPrivateIp("203.0.113.1"), false);
});

test("isPrivateIp blocks IPv6 loopback and unspecified", () => {
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("::"), true);
});

test("isPrivateIp blocks IPv6 unique local (fc/fd)", () => {
  assert.equal(isPrivateIp("fc00::1"), true);
  assert.equal(isPrivateIp("fd12:3456::1"), true);
});

test("isPrivateIp blocks IPv6 link-local (fe80)", () => {
  assert.equal(isPrivateIp("fe80::1"), true);
});

test("isPrivateIp blocks IPv6 multicast (ff)", () => {
  assert.equal(isPrivateIp("ff02::1"), true);
});

test("isPrivateIp blocks IPv4-mapped IPv6", () => {
  assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateIp("::ffff:10.0.0.1"), true);
  assert.equal(isPrivateIp("::ffff:169.254.169.254"), true);
  assert.equal(isPrivateIp("::ffff:8.8.8.8"), false);
});

test("isPrivateIp blocks IPv4-compatible IPv6", () => {
  assert.equal(isPrivateIp("::127.0.0.1"), true);
  assert.equal(isPrivateIp("::10.0.0.1"), true);
  assert.equal(isPrivateIp("::8.8.8.8"), false);
});

test("isPrivateIp blocks NAT64 (64:ff9b::/96) with private embedded IPv4", () => {
  // hex-embedded forms
  assert.equal(isPrivateIp("64:ff9b::a00:1"), true); // 10.0.0.1
  assert.equal(isPrivateIp("64:ff9b::c0a8:101"), true); // 192.168.1.1
  // dotted-embedded form
  assert.equal(isPrivateIp("64:ff9b::10.0.0.1"), true);
  assert.equal(isPrivateIp("64:ff9b::192.168.1.1"), true);
});

test("isPrivateIp allows NAT64 (64:ff9b::/96) with public embedded IPv4", () => {
  assert.equal(isPrivateIp("64:ff9b::8.8.8.8"), false);
  assert.equal(isPrivateIp("64:ff9b::808:808"), false); // 8.8.8.8 in hex
});

test("isPrivateIp blocks zero-padded NAT64 prefix (0064:ff9b)", () => {
  assert.equal(isPrivateIp("0064:ff9b::a00:1"), true); // 10.0.0.1
  assert.equal(isPrivateIp("0064:ff9b::c0a8:101"), true); // 192.168.1.1
  assert.equal(isPrivateIp("0064:ff9b::10.0.0.1"), true);
});

test("isPrivateIp allows zero-padded NAT64 prefix with public embedded IPv4", () => {
  assert.equal(isPrivateIp("0064:ff9b::808:808"), false); // 8.8.8.8
});

test("isPrivateIp blocks fully-expanded IPv4-mapped loopback/private", () => {
  assert.equal(isPrivateIp("0:0:0:0:0:ffff:7f00:1"), true); // 127.0.0.1
  assert.equal(isPrivateIp("0000:0000:0000:0000:0000:ffff:7f00:0001"), true); // 127.0.0.1
  assert.equal(isPrivateIp("0:0:0:0:0:ffff:a00:1"), true); // 10.0.0.1
  assert.equal(isPrivateIp("0:0:0:0:0:ffff:a9fe:a9fe"), true); // 169.254.169.254
});

test("isPrivateIp allows fully-expanded IPv4-mapped public address", () => {
  assert.equal(isPrivateIp("0:0:0:0:0:ffff:808:808"), false); // 8.8.8.8
});

test("isPrivateIp blocks fully-expanded IPv4-mapped with dotted tail", () => {
  assert.equal(isPrivateIp("0:0:0:0:0:ffff:127.0.0.1"), true);
  assert.equal(isPrivateIp("0:0:0:0:0:ffff:169.254.169.254"), true);
  assert.equal(isPrivateIp("0:0:0:0:0:ffff:8.8.8.8"), false);
});

test("isAcceptableAudioContentType accepts audio and video, rejects octet-stream and html", () => {
  assert.equal(isAcceptableAudioContentType("audio/mpeg"), true);
  assert.equal(isAcceptableAudioContentType("video/mp4"), true);
  assert.equal(isAcceptableAudioContentType("AUDIO/MPEG"), true);
  assert.equal(isAcceptableAudioContentType("application/octet-stream"), false);
  assert.equal(isAcceptableAudioContentType("text/html"), false);
  assert.equal(isAcceptableAudioContentType(""), false);
  assert.equal(isAcceptableAudioContentType(undefined), false);
});

test("ssrfSafeLookup rejects private IPs via callback", () => {
  return new Promise((resolve, reject) => {
    const original = dns.lookup;
    dns.lookup = (_hostname, _opts, cb) => cb(null, "127.0.0.1", 4);
    ssrfSafeLookup("evil.com", {}, (err) => {
      dns.lookup = original;
      try {
        assert.ok(err);
        assert.equal(err.code, "SSRF_BLOCKED");
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
});

test("ssrfSafeLookup allows public IPs via callback", () => {
  return new Promise((resolve, reject) => {
    const original = dns.lookup;
    dns.lookup = (_hostname, _opts, cb) => cb(null, "93.184.216.34", 4);
    ssrfSafeLookup("example.com", {}, (err, address) => {
      dns.lookup = original;
      try {
        assert.equal(err, null);
        assert.equal(address, "93.184.216.34");
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
});

// Regression: Happy Eyeballs / autoSelectFamily calls lookup with { all: true },
// so dns.lookup returns an ARRAY. The old single-value check let private IPs through.
test("ssrfSafeLookup blocks a private IP in the all:true array form", () => {
  return new Promise((resolve, reject) => {
    const original = dns.lookup;
    dns.lookup = (_hostname, _opts, cb) => cb(null, [{ address: "169.254.169.254", family: 4 }]);
    try {
      ssrfSafeLookup("metadata.evil.com", { all: true }, (err) => {
        dns.lookup = original;
        try {
          assert.ok(err);
          assert.equal(err.code, "SSRF_BLOCKED");
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      dns.lookup = original;
      reject(e);
    }
  });
});

test("ssrfSafeLookup forwards an all-public array unchanged", () => {
  return new Promise((resolve, reject) => {
    const original = dns.lookup;
    const arr = [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ];
    dns.lookup = (_hostname, _opts, cb) => cb(null, arr);
    try {
      ssrfSafeLookup("example.com", { all: true }, (err, address) => {
        dns.lookup = original;
        try {
          assert.equal(err, null);
          assert.deepEqual(address, arr);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      dns.lookup = original;
      reject(e);
    }
  });
});

test("ssrfSafeLookup blocks one private entry mixed into a public array", () => {
  return new Promise((resolve, reject) => {
    const original = dns.lookup;
    dns.lookup = (_hostname, _opts, cb) =>
      cb(null, [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ]);
    try {
      ssrfSafeLookup("rebind.evil.com", { all: true }, (err) => {
        dns.lookup = original;
        try {
          assert.ok(err);
          assert.equal(err.code, "SSRF_BLOCKED");
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      dns.lookup = original;
      reject(e);
    }
  });
});

test("ssrfSafeLookup still blocks the legacy single-string private form", () => {
  return new Promise((resolve, reject) => {
    const original = dns.lookup;
    dns.lookup = (_hostname, _opts, cb) => cb(null, "127.0.0.1", 4);
    try {
      ssrfSafeLookup("evil.com", {}, (err) => {
        dns.lookup = original;
        try {
          assert.ok(err);
          assert.equal(err.code, "SSRF_BLOCKED");
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      dns.lookup = original;
      reject(e);
    }
  });
});

test("extractYouTubeVideoId rejects youtu.be with non-standard ID", () => {
  assert.equal(extractYouTubeVideoId("https://youtu.be/x%25(home)s"), null);
  assert.equal(extractYouTubeVideoId("https://youtu.be/short"), null);
  assert.equal(extractYouTubeVideoId("https://youtu.be/toolongvideoiddd"), null);
});

// --- maybeUpdateYtDlp self-update: hang/leak regression ---

// A fake child that never emits close/exit, with a kill() that records the call.
function makeFakeChild() {
  const child = new EventEmitter();
  child.killCalled = false;
  child.kill = () => {
    child.killCalled = true;
    return true;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

// Reject if the promise hasn't settled within ms, so a real hang fails loudly
// instead of relying on the test runner's global timeout.
async function resolvesWithin(promise, ms) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`did not resolve within ${ms}ms`)), ms);
  });
  try {
    await Promise.race([promise, guard]);
  } finally {
    clearTimeout(timer);
  }
}

// Ensure the writable cache binary exists so maybeUpdateYtDlp reaches the spawn
// path (it short-circuits when the cache copy is missing). Operates in the
// isolated test cache dir; the cleanup fn removes that whole dir.
function ensureCacheBinary() {
  const cacheDir = YT_DLP_TEST_CACHE_DIR;
  const name = `yt-dlp-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  const binPath = path.join(cacheDir, name);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(binPath, "#!/bin/sh\n");
  try {
    fs.chmodSync(binPath, 0o755);
  } catch {}
  // The update path refuses unverified cache copies, so record the checksum.
  downloader._recordCacheChecksum();
  return () => {
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    } catch {}
  };
}

test("maybeUpdateYtDlp resolves on -U timeout, kills the child, and clears the in-flight flag", async () => {
  const cleanup = ensureCacheBinary();
  const origSpawn = childProcess.spawn;
  let spawnCount = 0;
  let lastChild = null;
  childProcess.spawn = () => {
    spawnCount += 1;
    lastChild = makeFakeChild();
    return lastChild;
  };
  try {
    await resolvesWithin(maybeUpdateYtDlp({ force: true, timeoutMs: 20 }), 2000);
    assert.ok(lastChild.killCalled, "timeout should have killed the stuck child");
    assert.equal(downloader._isYtDlpUpdateInFlight(), false, "in-flight flag must be cleared");
    assert.equal(spawnCount, 1);

    // A stuck flag would make this second call short-circuit without spawning.
    await resolvesWithin(maybeUpdateYtDlp({ force: true, timeoutMs: 20 }), 2000);
    assert.equal(
      spawnCount,
      2,
      "second call must spawn again, proving no stuck single-flight flag"
    );
    assert.equal(downloader._isYtDlpUpdateInFlight(), false);
  } finally {
    childProcess.spawn = origSpawn;
    cleanup();
  }
});

test("maybeUpdateYtDlp with an already-aborted signal resolves promptly and kills the child", async () => {
  const cleanup = ensureCacheBinary();
  const origSpawn = childProcess.spawn;
  let lastChild = null;
  childProcess.spawn = () => {
    lastChild = makeFakeChild();
    return lastChild;
  };
  const ac = new AbortController();
  ac.abort();
  try {
    await resolvesWithin(
      maybeUpdateYtDlp({ force: true, abortSignal: ac.signal, timeoutMs: 60000 }),
      2000
    );
    assert.ok(lastChild.killCalled, "abort should have killed the child");
    assert.equal(downloader._isYtDlpUpdateInFlight(), false, "in-flight flag must be cleared");
  } finally {
    childProcess.spawn = origSpawn;
    cleanup();
  }
});

// --- downloadViaProxy: redirect handling regression ---
//
// Electron requires request.followRedirect()/request.abort() to be invoked
// synchronously from inside the "redirect" event. downloadViaProxy instead
// aborts and rejects with a REDIRECT_RESTART sentinel, then recurses on the
// redirect URL (re-running assertPublicHost). These fakes emit their events
// from inside request.end(), which runs after all request.on() listeners are
// attached in the source, matching real net.request() ordering.

function makeFakeProxyRequest() {
  const req = new EventEmitter();
  req.abortCalled = false;
  req.followRedirectCalled = false;
  req.abort = () => {
    req.abortCalled = true;
  };
  req.followRedirect = () => {
    req.followRedirectCalled = true;
  };
  req.setHeader = () => {};
  req.end = () => {};
  return req;
}

function makeAudioResponse(body) {
  const response = Readable.from([Buffer.from(body)]);
  response.statusCode = 200;
  response.headers = { "content-type": "audio/mpeg", "content-length": String(body.length) };
  return response;
}

test("downloadViaProxy restarts on redirect via abort, never calls followRedirect, and ignores a late error", async () => {
  const requests = [];
  const fakeNet = {
    request(options) {
      const req = makeFakeProxyRequest();
      req.url = options.url;
      requests.push(req);
      req.end = () => {
        if (requests.length === 1) {
          req.emit("redirect", 302, "GET", "https://93.184.216.34/real.mp3");
          // Late error after the abort must be a no-op: the promise already settled.
          req.emit("error", new Error("stale socket error"));
        } else {
          req.emit("response", makeAudioResponse("audiodata"));
        }
      };
      return req;
    },
  };

  downloader._setElectronNetForTests(fakeNet);
  let tempPath;
  try {
    const result = await downloader.downloadViaProxy("https://93.184.216.34/file.mp3", null, null);
    tempPath = result.tempPath;
    assert.equal(fs.readFileSync(tempPath, "utf8"), "audiodata");
    assert.equal(requests.length, 2, "must restart with a fresh request, not follow in place");
    assert.equal(requests[0].url, "https://93.184.216.34/file.mp3");
    assert.equal(
      requests[1].url,
      "https://93.184.216.34/real.mp3",
      "restart must target the redirect URL"
    );
    assert.equal(requests[0].abortCalled, true);
    assert.equal(requests[0].followRedirectCalled, false);
    assert.equal(requests[1].followRedirectCalled, false);
  } finally {
    downloader._setElectronNetForTests(null);
    if (tempPath) {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    }
  }
});

test("downloadViaProxy rejects a redirect to a private IP with SSRF_BLOCKED", async () => {
  const requests = [];
  const fakeNet = {
    request(options) {
      const req = makeFakeProxyRequest();
      req.url = options.url;
      requests.push(req);
      req.end = () => {
        req.emit("redirect", 302, "GET", "https://127.0.0.1/x.mp3");
      };
      return req;
    },
  };

  downloader._setElectronNetForTests(fakeNet);
  try {
    await assert.rejects(
      downloader.downloadViaProxy("https://93.184.216.34/file.mp3", null, null),
      { code: "SSRF_BLOCKED" }
    );
    assert.equal(
      requests.length,
      1,
      "must not re-request a redirect target rejected by assertPublicHost"
    );
  } finally {
    downloader._setElectronNetForTests(null);
  }
});

test("downloadViaProxy rejects a non-https redirect with INVALID_URL", async () => {
  const requests = [];
  const fakeNet = {
    request(options) {
      const req = makeFakeProxyRequest();
      req.url = options.url;
      requests.push(req);
      req.end = () => {
        req.emit("redirect", 302, "GET", "http://93.184.216.34/x.mp3");
      };
      return req;
    },
  };

  downloader._setElectronNetForTests(fakeNet);
  try {
    await assert.rejects(
      downloader.downloadViaProxy("https://93.184.216.34/file.mp3", null, null),
      { code: "INVALID_URL" }
    );
    assert.equal(requests.length, 1);
  } finally {
    downloader._setElectronNetForTests(null);
  }
});

test("downloadViaProxy fails with DOWNLOAD_FAILED after exceeding MAX_REDIRECTS", async () => {
  const requests = [];
  const fakeNet = {
    request(options) {
      const req = makeFakeProxyRequest();
      req.url = options.url;
      requests.push(req);
      req.end = () => {
        req.emit("redirect", 302, "GET", "https://93.184.216.34/next.mp3");
      };
      return req;
    },
  };

  downloader._setElectronNetForTests(fakeNet);
  try {
    await assert.rejects(
      downloader.downloadViaProxy("https://93.184.216.34/file.mp3", null, null),
      (err) => {
        assert.equal(err.code, "DOWNLOAD_FAILED");
        assert.match(err.message, /Too many redirects/);
        return true;
      }
    );
    // MAX_REDIRECTS is 3 in urlAudioDownloader.js; the 4th redirect trips the limit.
    assert.equal(requests.length, 4);
  } finally {
    downloader._setElectronNetForTests(null);
  }
});

test("downloadViaProxy rejects with DOWNLOAD_CANCELLED on mid-flight abort", async () => {
  const requests = [];
  const fakeNet = {
    // A request that emits nothing: no redirect, no response, no error. abort()
    // only records the call, matching ClientRequest.abort() (never emits 'error').
    request(options) {
      const req = makeFakeProxyRequest();
      req.url = options.url;
      requests.push(req);
      return req;
    },
  };

  downloader._setElectronNetForTests(fakeNet);
  const ac = new AbortController();
  try {
    const promise = downloader.downloadViaProxy("https://93.184.216.34/file.mp3", null, ac.signal);
    // Abort after the synchronous setup (assertPublicHost + request.end()) has run.
    setImmediate(() => ac.abort());
    await assert.rejects(promise, { code: "DOWNLOAD_CANCELLED" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].abortCalled, true, "abort() must be called on the in-flight request");
  } finally {
    downloader._setElectronNetForTests(null);
  }
});

// --- downloadDirect: node-https path (HEAD/GET redirects, validation, caps) ---
//
// download() routes non-YouTube URLs here; the fakes patch https.request (the
// module calls it through its captured `https` reference, which is this same
// object). Literal-IP hosts skip DNS, so ssrfSafeLookup is never exercised —
// these tests cover the per-hop checks in the HEAD/GET redirect handling.

function makeDirectResponse({ statusCode = 200, headers = {}, body = null }) {
  const res = body != null ? Readable.from([Buffer.from(body)]) : new EventEmitter();
  res.statusCode = statusCode;
  res.headers = headers;
  if (!res.resume) res.resume = () => {};
  if (!res.destroy) res.destroy = () => {};
  if (!res.pipe) res.pipe = () => {};
  return res;
}

// Patch https.request for the duration of fn. handler(parsed, options) returns
// the fake response; onResponse (optional) runs after the caller received it.
async function withFakeHttps(handler, fn) {
  const orig = https.request;
  const calls = [];
  https.request = (parsed, options, callback) => {
    calls.push({ method: options.method, url: parsed.href });
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => {
      setImmediate(() => {
        const { response, after } = handler(parsed, options);
        callback(response);
        if (after) setImmediate(() => after(response));
      });
    };
    return req;
  };
  try {
    return await fn(calls);
  } finally {
    https.request = orig;
  }
}

function listOwUrlTempFiles() {
  return new Set(fs.readdirSync(ownedTemp).filter((f) => f.startsWith("ow-url-")));
}

test("downloadDirect streams a validated GET to a temp file", async () => {
  const body = "audiodata";
  let tempPath;
  try {
    await withFakeHttps(
      (parsed, options) => ({
        response:
          options.method === "HEAD"
            ? makeDirectResponse({
                headers: { "content-type": "audio/mpeg", "content-length": String(body.length) },
              })
            : makeDirectResponse({
                headers: { "content-type": "audio/mpeg", "content-length": String(body.length) },
                body,
              }),
      }),
      async (calls) => {
        const result = await downloader.download("https://93.184.216.34/interview.mp3", null, null);
        tempPath = result.tempPath;
        assert.equal(fs.readFileSync(tempPath, "utf8"), body);
        assert.equal(result.title, "interview");
        assert.equal(result.sizeBytes, body.length);
        assert.deepEqual(
          calls.map((c) => c.method),
          ["HEAD", "GET"]
        );
      }
    );
  } finally {
    if (tempPath) {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    }
  }
});

test("downloadDirect rejects a HEAD redirect to http:// with INVALID_URL", async () => {
  await withFakeHttps(
    () => ({
      response: makeDirectResponse({
        statusCode: 302,
        headers: { location: "http://93.184.216.34/x.mp3" },
      }),
    }),
    async () => {
      await assert.rejects(downloader.download("https://93.184.216.34/file.mp3", null, null), {
        code: "INVALID_URL",
      });
    }
  );
});

test("downloadDirect rejects a HEAD redirect to a private IP with SSRF_BLOCKED", async () => {
  await withFakeHttps(
    () => ({
      response: makeDirectResponse({
        statusCode: 302,
        headers: { location: "https://127.0.0.1/x.mp3" },
      }),
    }),
    async () => {
      await assert.rejects(downloader.download("https://93.184.216.34/file.mp3", null, null), {
        code: "SSRF_BLOCKED",
      });
    }
  );
});

test("downloadDirect fails with DOWNLOAD_FAILED after exceeding MAX_REDIRECTS on HEAD", async () => {
  await withFakeHttps(
    () => ({
      response: makeDirectResponse({
        statusCode: 302,
        headers: { location: "https://93.184.216.34/next.mp3" },
      }),
    }),
    async (calls) => {
      await assert.rejects(
        downloader.download("https://93.184.216.34/file.mp3", null, null),
        (err) => {
          assert.equal(err.code, "DOWNLOAD_FAILED");
          assert.match(err.message, /Too many redirects/);
          return true;
        }
      );
      // MAX_REDIRECTS is 3; the 4th redirect hop trips the limit.
      assert.equal(calls.length, 4);
    }
  );
});

test("downloadDirect rejects a GET redirect to a private IP with SSRF_BLOCKED", async () => {
  await withFakeHttps(
    (parsed, options) =>
      options.method === "HEAD"
        ? { response: makeDirectResponse({ statusCode: 405 }) }
        : {
            response: makeDirectResponse({
              statusCode: 302,
              headers: { location: "https://10.0.0.1/x.mp3" },
            }),
          },
    async () => {
      await assert.rejects(downloader.download("https://93.184.216.34/file.mp3", null, null), {
        code: "SSRF_BLOCKED",
      });
    }
  );
});

test("downloadDirect re-validates content-type on GET when HEAD is refused", async () => {
  await withFakeHttps(
    (parsed, options) =>
      options.method === "HEAD"
        ? { response: makeDirectResponse({ statusCode: 405 }) }
        : {
            response: makeDirectResponse({
              headers: { "content-type": "text/html" },
              body: "<html></html>",
            }),
          },
    async () => {
      await assert.rejects(downloader.download("https://93.184.216.34/file.mp3", null, null), {
        code: "CONTENT_TYPE_INVALID",
      });
    }
  );
});

test("downloadDirect enforces MAX_DOWNLOAD_BYTES on unknown-size streams and cleans up", async () => {
  const before = listOwUrlTempFiles();
  await withFakeHttps(
    (parsed, options) =>
      options.method === "HEAD"
        ? { response: makeDirectResponse({ statusCode: 405 }) }
        : {
            response: makeDirectResponse({ headers: { "content-type": "audio/mpeg" } }),
            // Lying length stands in for 501 MB without allocating it.
            after: (response) => response.emit("data", { length: 501 * 1024 * 1024 }),
          },
    async () => {
      await assert.rejects(downloader.download("https://93.184.216.34/file.mp3", null, null), {
        code: "FILE_TOO_LARGE",
      });
    }
  );
  assert.deepEqual(listOwUrlTempFiles(), before, "oversized download must remove its temp file");
});

test("downloadDirect rejects with DOWNLOAD_CANCELLED on mid-stream abort and cleans up", async () => {
  const before = listOwUrlTempFiles();
  const ac = new AbortController();
  await withFakeHttps(
    (parsed, options) =>
      options.method === "HEAD"
        ? { response: makeDirectResponse({ statusCode: 405 }) }
        : {
            response: makeDirectResponse({ headers: { "content-type": "audio/mpeg" } }),
            after: (response) => {
              response.emit("data", { length: 1024 });
              ac.abort();
            },
          },
    async () => {
      await assert.rejects(downloader.download("https://93.184.216.34/file.mp3", null, ac.signal), {
        code: "DOWNLOAD_CANCELLED",
      });
    }
  );
  assert.deepEqual(listOwUrlTempFiles(), before, "cancelled download must remove its temp file");
});

test("downloadDirect defers a cancelled download's rejection until the write stream closed", async () => {
  const before = listOwUrlTempFiles();
  const ac = new AbortController();
  const order = [];
  let releaseOpen;
  const openGate = new Promise((r) => (releaseOpen = r));
  let onAborted;
  const aborted = new Promise((r) => (onAborted = r));
  const realCreate = fs.createWriteStream;

  // Hold the stream's async open past cancellation: the window where cleanup
  // used to unlink before the file existed, orphaning it.
  fs.createWriteStream = (p, opts) => {
    const ws = realCreate(p, {
      ...opts,
      fs: {
        open: (...args) => {
          const cb = args[args.length - 1];
          openGate.then(() => fs.open(...args.slice(0, -1), cb));
        },
        write: fs.write.bind(fs),
        writev: fs.writev.bind(fs),
        close: fs.close.bind(fs),
      },
    });
    ws.once("close", () => order.push("close"));
    return ws;
  };

  try {
    await withFakeHttps(
      (parsed, options) =>
        options.method === "HEAD"
          ? { response: makeDirectResponse({ statusCode: 405 }) }
          : {
              response: makeDirectResponse({ headers: { "content-type": "audio/mpeg" } }),
              after: (response) => {
                response.emit("data", { length: 1024 });
                ac.abort();
                onAborted();
              },
            },
      async () => {
        let settled = null;
        const done = downloader.download("https://93.184.216.34/file.mp3", null, ac.signal).then(
          () => (settled = "resolved"),
          (err) => {
            order.push("rejected");
            settled = err;
          }
        );

        await aborted;
        for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
        assert.equal(settled, null, "cancel must not settle while the open is still pending");

        releaseOpen();
        await done;
        assert.equal(settled.code, "DOWNLOAD_CANCELLED");
        assert.deepEqual(order, ["close", "rejected"]);
      }
    );
  } finally {
    fs.createWriteStream = realCreate;
    releaseOpen();
  }

  assert.deepEqual(listOwUrlTempFiles(), before, "a late open must not orphan a temp file");
});

// --- selectYtDlpOutput: finished-file selection + transient cleanup ---

function mkSelectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ow-ytdlp-select-"));
}

// Create a prefix-matched file with a fixed mtime (seconds) to make ordering deterministic.
function writeAt(dir, name, mtimeSeconds) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, "x");
  fs.utimesSync(p, mtimeSeconds, mtimeSeconds);
  return p;
}

test("selectYtDlpOutput picks the finished file over a longer-named .part leftover", () => {
  const dir = mkSelectDir();
  const prefix = "ow-url-1-abc";
  try {
    writeAt(dir, `${prefix}.m4a`, 1700000000);
    writeAt(dir, `${prefix}.m4a.part`, 1700000500);
    const selected = downloader._selectYtDlpOutput(dir, prefix);
    assert.equal(selected, path.join(dir, `${prefix}.m4a`));
    assert.equal(fs.existsSync(selected), true);
    assert.equal(fs.existsSync(path.join(dir, `${prefix}.m4a.part`)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("selectYtDlpOutput prefers the finished file over a newer .fNNN intermediate (tier beats mtime)", () => {
  const dir = mkSelectDir();
  const prefix = "ow-url-2-abc";
  try {
    writeAt(dir, `${prefix}.m4a`, 1700000000);
    writeAt(dir, `${prefix}.f140.m4a`, 1700000500);
    const selected = downloader._selectYtDlpOutput(dir, prefix);
    assert.equal(selected, path.join(dir, `${prefix}.m4a`));
    assert.equal(fs.existsSync(path.join(dir, `${prefix}.f140.m4a`)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("selectYtDlpOutput picks the newest of two equal-tier audio files", () => {
  const dir = mkSelectDir();
  const prefix = "ow-url-3-abc";
  try {
    writeAt(dir, `${prefix}.m4a`, 1700000000);
    writeAt(dir, `${prefix}.opus`, 1700000500);
    const selected = downloader._selectYtDlpOutput(dir, prefix);
    assert.equal(selected, path.join(dir, `${prefix}.opus`));
    assert.equal(fs.existsSync(path.join(dir, `${prefix}.m4a`)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("selectYtDlpOutput throws DOWNLOAD_FAILED when only transients remain", () => {
  const dir = mkSelectDir();
  const prefix = "ow-url-4-abc";
  try {
    writeAt(dir, `${prefix}.m4a.part`, 1700000000);
    writeAt(dir, `${prefix}.ytdl`, 1700000500);
    assert.throws(
      () => downloader._selectYtDlpOutput(dir, prefix),
      (err) => {
        assert.equal(err.code, "DOWNLOAD_FAILED");
        assert.equal(err.message, "Download produced no output");
        return true;
      }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("selectYtDlpOutput keeps only the selected file and deletes every other prefix match", () => {
  const dir = mkSelectDir();
  const prefix = "ow-url-5-abc";
  try {
    const others = [
      `${prefix}.m4a.part`,
      `${prefix}.temp.m4a`,
      `${prefix}.f140.m4a.part`,
      `${prefix}.m4a.ytdl`,
      `${prefix}.f251.webm`,
    ];
    writeAt(dir, `${prefix}.m4a`, 1700000000);
    for (const name of others) writeAt(dir, name, 1700000500);
    const selected = downloader._selectYtDlpOutput(dir, prefix);
    assert.equal(selected, path.join(dir, `${prefix}.m4a`));
    assert.equal(fs.existsSync(selected), true);
    for (const name of others) {
      assert.equal(fs.existsSync(path.join(dir, name)), false, `${name} should have been deleted`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("selectYtDlpOutput excludes a .temp. infix file even when it is newer", () => {
  const dir = mkSelectDir();
  const prefix = "ow-url-6-abc";
  try {
    writeAt(dir, `${prefix}.temp.m4a`, 1700000500);
    writeAt(dir, `${prefix}.m4a`, 1700000000);
    const selected = downloader._selectYtDlpOutput(dir, prefix);
    assert.equal(selected, path.join(dir, `${prefix}.m4a`));
    assert.equal(fs.existsSync(path.join(dir, `${prefix}.temp.m4a`)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("selectYtDlpOutput excludes -Frag fragment files", () => {
  const dir = mkSelectDir();
  const prefix = "ow-url-7-abc";
  try {
    writeAt(dir, `${prefix}.m4a.part-Frag3`, 1700000500);
    writeAt(dir, `${prefix}.m4a`, 1700000000);
    const selected = downloader._selectYtDlpOutput(dir, prefix);
    assert.equal(selected, path.join(dir, `${prefix}.m4a`));
    assert.equal(fs.existsSync(path.join(dir, `${prefix}.m4a.part-Frag3`)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- fe80::/10 link-local range ---

test("isPrivateIp covers the whole fe80::/10 link-local range", () => {
  assert.equal(isPrivateIp("fe80::1"), true);
  assert.equal(isPrivateIp("fe81::1"), true);
  assert.equal(isPrivateIp("febf::1"), true);
  assert.equal(isPrivateIp("fec0::1"), false);
  assert.equal(isPrivateIp("fe00::1"), false);
});

// --- cache binary checksum verification ---

test("resolveYtDlpBinary discards a cache copy whose checksum does not match", () => {
  const cleanup = ensureCacheBinary();
  const name = `yt-dlp-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  const cachePath = path.join(YT_DLP_TEST_CACHE_DIR, name);
  try {
    assert.equal(downloader._resolveYtDlpBinary(), cachePath, "verified cache copy must win");

    fs.writeFileSync(cachePath, "#!/bin/sh\necho tampered\n");
    const resolved = downloader._resolveYtDlpBinary();
    assert.notEqual(resolved, cachePath, "tampered cache copy must not be executed");
    assert.equal(fs.existsSync(cachePath), false, "tampered copy must be discarded");
    assert.equal(fs.existsSync(`${cachePath}.sha256`), false, "stale checksum must be discarded");
  } finally {
    cleanup();
  }
});

test("resolveYtDlpBinary ignores a cache copy that has no recorded checksum", () => {
  const cleanup = ensureCacheBinary();
  const name = `yt-dlp-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  const cachePath = path.join(YT_DLP_TEST_CACHE_DIR, name);
  try {
    fs.unlinkSync(`${cachePath}.sha256`);
    const resolved = downloader._resolveYtDlpBinary();
    assert.notEqual(resolved, cachePath);
    assert.equal(fs.existsSync(cachePath), false, "unverifiable copy must be discarded");
  } finally {
    cleanup();
  }
});

test("maybeUpdateYtDlp never executes a tampered cache copy and a failed update keeps the old checksum", async () => {
  const cleanup = ensureCacheBinary();
  const name = `yt-dlp-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  const cachePath = path.join(YT_DLP_TEST_CACHE_DIR, name);
  fs.writeFileSync(cachePath, "#!/bin/sh\necho tampered\n");
  const origSpawn = childProcess.spawn;
  const spawnedContents = [];
  childProcess.spawn = (bin) => {
    spawnedContents.push(fs.readFileSync(bin));
    const child = makeFakeChild();
    setImmediate(() => child.emit("close", 1));
    return child;
  };
  try {
    await resolvesWithin(maybeUpdateYtDlp({ force: true }), 2000);
    for (const content of spawnedContents) {
      assert.ok(!content.includes("tampered"), "tampered binary must never be spawned");
    }
    // Whatever remains on disk must be either absent or checksum-consistent —
    // a failed update (exit 1) must not have blessed anything new.
    if (fs.existsSync(cachePath)) {
      assert.equal(downloader._resolveYtDlpBinary(), cachePath, "remaining copy must verify");
    }
  } finally {
    childProcess.spawn = origSpawn;
    cleanup();
  }
});

test("maybeUpdateYtDlp updates on the nightly channel and re-records the checksum", async () => {
  const cleanup = ensureCacheBinary();
  const name = `yt-dlp-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  const cachePath = path.join(YT_DLP_TEST_CACHE_DIR, name);
  const origSpawn = childProcess.spawn;
  let spawnArgs = null;
  let child = null;
  childProcess.spawn = (_bin, args) => {
    spawnArgs = args;
    child = makeFakeChild();
    setImmediate(() => {
      // Simulate the updater replacing the binary before exiting.
      fs.writeFileSync(cachePath, "#!/bin/sh\necho updated\n");
      child.emit("close", 0);
    });
    return child;
  };
  try {
    await resolvesWithin(maybeUpdateYtDlp({ force: true }), 2000);
    assert.deepEqual(spawnArgs, ["--update-to", "nightly"]);
    assert.equal(
      downloader._resolveYtDlpBinary(),
      cachePath,
      "updated copy must pass verification"
    );
  } finally {
    childProcess.spawn = origSpawn;
    cleanup();
  }
});

// --- YouTube network-block heuristic ---

test("looksLikeYouTubeBlock matches bot checks, 403s, and login walls but not ordinary errors", () => {
  const block = downloader._looksLikeYouTubeBlock;
  assert.equal(block("ERROR: Sign in to confirm you're not a bot"), true);
  assert.equal(block("HTTP Error 403: Forbidden"), true);
  assert.equal(block("The following content is not available on this app (LOGIN_REQUIRED)"), true);
  assert.equal(block("YouTube is forcing SABR streaming for this client"), true);
  assert.equal(block("Video unavailable"), false);
  assert.equal(block("This video is private"), false);
  assert.equal(block(""), false);
});

// --- Sealed mode (Task 10): yt-dlp self-update, URL import and IPC envelope ---

function seal() {
  flags.sealed = true;
  gate.abortAllRemote();
}
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await tick(5);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function sealedCacheBinary({ throttle = false } = {}) {
  const name = `yt-dlp-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  fs.mkdirSync(YT_DLP_TEST_CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(YT_DLP_TEST_CACHE_DIR, name), "#!/bin/sh\n");
  fs.chmodSync(path.join(YT_DLP_TEST_CACHE_DIR, name), 0o755);
  downloader._recordCacheChecksum();
  // A fresh stamp throttles the background self-update after a download.
  if (throttle) fs.writeFileSync(path.join(YT_DLP_TEST_CACHE_DIR, ".last-update"), "now");
}

// A child the test drives. It starts like a real one ("spawn" on the next
// tick) unless `start: false`, and only ends when the test says so.
function fakeChild({ start = true, pid = undefined } = {}) {
  const child = new EventEmitter();
  if (pid !== undefined) child.pid = pid;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    return true;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.end = (code = 0, signal = null) => {
    child.emit("exit", code, signal);
    child.emit("close", code, signal);
  };
  if (start) process.nextTick(() => child.emit("spawn"));
  return child;
}

// ---------------------------------------------------------------- self-update

sealedTest(
  "sealing kills an in-flight yt-dlp self-update; its opaque session ends only at exit",
  async () => {
    sealedCacheBinary();
    let child;
    sealedLeaf = () => (child = fakeChild());
    const update = downloader.maybeUpdateYtDlp({ force: true, timeoutMs: 60000 });
    await tick();
    assert.equal(sealedSpawned.length, 1);
    assert.equal(sealedSpawned[0].options.detached, process.platform !== "win32");
    assert.equal(downloader.ytDlpControl.alive(), true);
    assert.equal(gate.activeRemoteCount(), 1);
    seal();
    await update; // the caller's promise resolves; the process is another matter
    assert.deepEqual(child.signals, ["SIGKILL"]);
    assert.equal(downloader.ytDlpControl.alive(), true, "a kill signal is not an exit");
    assert.equal(rows.length, 0, "the session is not settled before the exit");
    assert.equal(gate.activeRemoteCount(), 1, "the session stays represented");
    await assert.rejects(
      downloader.ytDlpControl.stop({ termGraceMs: 20, killGraceMs: 20 }),
      (e) => e.code === "CHILD_STOP_FAILED" && e.kinds.includes("yt-dlp")
    );
    child.end(null, "SIGKILL");
    assert.equal(rows.length, 1, "exactly one row: the guard did not open a second session");
    const [row] = rows;
    assert.deepEqual(
      [row.task, row.host, row.kind, row.opaque, row.bytesIn, row.bytesOut, row.outcome],
      ["runtimeDownload", "github.com", "session", true, null, null, "cancelled"]
    );
    assert.equal(row.errorClass, "SEALED_MODE");
    assert.equal(gate.activeRemoteCount(), 0);
    // 07a: a root exit is not whole-tree proof. Coverage stays unresolved.
    assert.equal(downloader.ytDlpControl.alive(), true);
    const [fact] = registry.diagnostics().unresolved.filter((e) => e.kind === "yt-dlp");
    assert.deepEqual([fact.reason, fact.rootExited], ["DESCENDANTS_UNVERIFIED", true]);
  }
);

sealedTest(
  "a self-update that times out is still running until it exits, and is recorded then",
  async () => {
    sealedCacheBinary();
    let child;
    sealedLeaf = () => (child = fakeChild());
    await downloader.maybeUpdateYtDlp({ force: true, timeoutMs: 20 }); // the kill timer fires
    assert.deepEqual(child.signals, ["SIGKILL"]);
    assert.equal(downloader._isYtDlpUpdateInFlight(), false, "the existing throttle flag clears");
    assert.equal(rows.length, 0, "a timed-out child is not a stopped one");
    assert.equal(gate.activeRemoteCount(), 1);
    child.end(null, "SIGKILL");
    assert.deepEqual(
      rows.map((r) => [r.task, r.outcome, r.errorClass]),
      [["runtimeDownload", "error", "TIMEOUT"]]
    );
    assert.equal(gate.activeRemoteCount(), 0);
  }
);

sealedTest(
  "a self-update that fails to spawn left nothing running and writes no session",
  async () => {
    sealedCacheBinary();
    sealedLeaf = () => {
      throw Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
    };
    await downloader.maybeUpdateYtDlp({ force: true });
    assert.equal(sealedSpawned.length, 1);
    assert.equal(downloader.ytDlpControl.alive(), false);
    assert.equal(gate.activeRemoteCount(), 0);
    assert.deepEqual(rows, [], "nothing started, so no session to GitHub is claimed");
  }
);

sealedTest(
  "an asynchronous spawn failure discards the session; an error after start does not",
  async () => {
    sealedCacheBinary();
    let child;
    sealedLeaf = () => (child = fakeChild({ start: false }));
    // 1. EACCES after spawn() returned: no pid, no "spawn", "error" then "close".
    const failing = downloader.maybeUpdateYtDlp({ force: true, timeoutMs: 60000 });
    child.emit("error", Object.assign(new Error("spawn EACCES"), { code: "EACCES" }));
    child.emit("close", -13, null);
    await failing;
    assert.equal(gate.activeRemoteCount(), 0, "no immortal ticket");
    assert.deepEqual(rows, []);

    // 2. An error after a successful start: still running until it exits.
    sealedLeaf = () => (child = fakeChild());
    const running = downloader.maybeUpdateYtDlp({ force: true, timeoutMs: 60000 });
    await tick();
    child.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    await running; // best effort: the caller is released
    assert.equal(gate.activeRemoteCount(), 1);
    assert.equal(rows.length, 0);
    child.end(1, null);
    assert.equal(gate.activeRemoteCount(), 0);
    assert.deepEqual(
      rows.map((r) => [r.outcome, r.errorClass]),
      [["error", "CHILD_EXIT"]]
    );
  }
);

sealedTest("a self-update that exits 0 is one ok session with unknown bytes", async () => {
  sealedCacheBinary();
  let child;
  sealedLeaf = () => (child = fakeChild());
  const update = downloader.maybeUpdateYtDlp({ force: true, timeoutMs: 60000 });
  await tick();
  child.end(0, null);
  await update;
  assert.deepEqual(
    rows.map((r) => [r.task, r.kind, r.outcome, r.bytesIn, r.bytesOut]),
    [["runtimeDownload", "session", "ok", null, null]]
  );
});

sealedTest("while sealed, a self-update is not even attempted", async () => {
  sealedCacheBinary();
  flags.sealed = true;
  sealedLeaf = () => fakeChild();
  await downloader.maybeUpdateYtDlp({ force: true });
  assert.equal(sealedSpawned.length, 0);
  assert.deepEqual(rows, []);
});

// Fix round 1 (I1). The bundled yt-dlp is a PyInstaller one-file build: the
// bootloader root runs the real program as its child, and SIGKILL cannot be
// forwarded. Every stop must reach the whole detached group. All process facts
// are fakes: the group id is beyond every kernel's pid range, and the
// registry's killGroup/groupAlive leaves only record.
const FAKE_GROUP_PID = 4_206_649;
// The continuity clock and the group watch are injected too (T10-m2): a slow
// test host can never end continuity on a real 400 ms gap, and no real
// interval runs. `facts.now` only moves when a test moves it.
function fakeGroupFacts() {
  const facts = { alive: false, kills: [], now: 0, watches: [] };
  registry._setSystemForTests({
    groupAlive: (pid) => {
      assert.equal(pid, FAKE_GROUP_PID);
      return facts.alive;
    },
    killGroup: (pid, signal) => facts.kills.push([pid, signal]),
    now: () => facts.now,
    every: (fn, ms) => {
      const watch = { fn, ms, stopped: false };
      facts.watches.push(watch);
      return () => {
        watch.stopped = true;
      };
    },
  });
  return facts;
}
const groupTest = (name, fn) =>
  test(
    name,
    {
      timeout: 10000,
      skip: process.platform === "win32" && "process groups are POSIX-only (Windows is 07b)",
    },
    fn
  );

groupTest(
  "sealing a self-update kills its whole process group, and the barrier still reaches the group after the root exits",
  async () => {
    const facts = fakeGroupFacts();
    sealedCacheBinary();
    let child;
    sealedLeaf = () => (child = fakeChild({ pid: FAKE_GROUP_PID }));
    const update = downloader.maybeUpdateYtDlp({ force: true, timeoutMs: 60000 });
    await tick();
    assert.equal(sealedSpawned[0].options.detached, true, "the root leads its own group");
    seal();
    await update;
    assert.deepEqual(facts.kills, [[FAKE_GROUP_PID, "SIGKILL"]], "the group, not just the root");
    assert.deepEqual(child.signals, []);
    assert.equal(rows.length, 0, "a signal is not an exit");

    // The root is gone, but the group still exists at its exit: the payload
    // survived. The seal barrier's stop must still reach that group.
    facts.alive = true;
    child.end(null, "SIGKILL");
    assert.deepEqual(
      facts.watches.map((w) => [w.ms, w.stopped]),
      [[100, false]],
      "the root's exit starts one group watch on the injected timer"
    );
    assert.deepEqual(
      rows.map((r) => [r.task, r.outcome, r.errorClass]),
      [["runtimeDownload", "cancelled", "SEALED_MODE"]]
    );
    await assert.rejects(
      registry.stopAll({ termGraceMs: 20, killGraceMs: 20 }),
      (e) => e.code === "CHILD_STOP_FAILED" && e.kinds.includes("yt-dlp")
    );
    assert.deepEqual(facts.kills.slice(1), [
      [FAKE_GROUP_PID, "SIGTERM"],
      [FAKE_GROUP_PID, "SIGKILL"],
    ]);
    assert.equal(downloader.ytDlpControl.alive(), true, "still unresolved: no success claim");

    // Once the group is observed gone, its id may be reused: never signal it again.
    facts.alive = false;
    await assert.rejects(downloader.ytDlpControl.stop({ termGraceMs: 5, killGraceMs: 5 }), {
      code: "CHILD_STOP_FAILED",
    });
    assert.equal(facts.kills.length, 3);
    const [fact] = registry.diagnostics().unresolved.filter((e) => e.kind === "yt-dlp");
    assert.deepEqual([fact.reason, fact.rootExited], ["DESCENDANTS_UNVERIFIED", true]);
    assert.equal(facts.watches[0].stopped, true, "an ended group stops its watch");
  }
);

groupTest("a self-update that times out is killed as a whole group", async () => {
  const facts = fakeGroupFacts();
  sealedCacheBinary();
  let child;
  sealedLeaf = () => (child = fakeChild({ pid: FAKE_GROUP_PID }));
  await downloader.maybeUpdateYtDlp({ force: true, timeoutMs: 20 });
  assert.deepEqual(facts.kills, [[FAKE_GROUP_PID, "SIGKILL"]]);
  assert.deepEqual(child.signals, []);
  child.end(null, "SIGKILL");
  assert.deepEqual(
    rows.map((r) => [r.outcome, r.errorClass]),
    [["error", "TIMEOUT"]]
  );
});

groupTest(
  "a cancelled self-update is killed as a whole group, mid-flight or pre-aborted",
  async () => {
    const facts = fakeGroupFacts();
    sealedCacheBinary();
    const children = [];
    sealedLeaf = () => {
      const child = fakeChild({ pid: FAKE_GROUP_PID });
      children.push(child);
      return child;
    };
    const controller = new AbortController();
    const update = downloader.maybeUpdateYtDlp({
      force: true,
      abortSignal: controller.signal,
      timeoutMs: 60000,
    });
    await tick();
    controller.abort();
    await update;
    assert.deepEqual(facts.kills, [[FAKE_GROUP_PID, "SIGKILL"]]);
    children[0].end(null, "SIGKILL");

    await downloader.maybeUpdateYtDlp({
      force: true,
      abortSignal: AbortSignal.abort(),
      timeoutMs: 60000,
    });
    assert.deepEqual(facts.kills, [
      [FAKE_GROUP_PID, "SIGKILL"],
      [FAKE_GROUP_PID, "SIGKILL"],
    ]);
    for (const child of children) assert.deepEqual(child.signals, []);
    children[1].end(null, "SIGKILL");
    assert.deepEqual(
      rows.map((r) => [r.outcome, r.errorClass]),
      [
        ["cancelled", "ABORTED"],
        ["cancelled", "ABORTED"],
      ]
    );
  }
);

// ------------------------------------------------------------- URL import

sealedTest(
  "sealed: direct and YouTube imports are refused before any transport or child",
  async () => {
    flags.sealed = true;
    const origRequest = https.request;
    let httpsCalls = 0;
    https.request = () => {
      httpsCalls++;
      throw new Error("must not be called");
    };
    try {
      for (const url of [
        "https://93.184.216.34/talk.mp3",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      ]) {
        const error = await downloader
          .download(url, () => {}, new AbortController().signal)
          .catch((e) => e);
        assert.equal(sealedPhaseOf(error), "refused", url);
      }
    } finally {
      https.request = origRequest;
    }
    assert.equal(httpsCalls, 0);
    assert.equal(sealedSpawned.length, 0);
    assert.deepEqual(
      rows.map((r) => [r.task, r.host, r.outcome, r.bytesOut]),
      [
        ["urlImport", "93.184.216.34", "blocked", 0],
        ["urlImport", "www.youtube.com", "blocked", 0],
      ]
    );
  }
);

// Fake node https: handler(parsed, options) returns { statusCode, headers, body?, stall? }.
async function withMeteredHttps(handler, fn) {
  const orig = https.request;
  const calls = [];
  https.request = (parsed, options, callback) => {
    calls.push({ method: options.method, url: parsed.href, headers: options.headers });
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => {
      setImmediate(() => {
        const {
          statusCode = 200,
          headers = {},
          body = null,
          stall = false,
        } = handler(parsed, options);
        const res = new PassThrough();
        res.statusCode = statusCode;
        res.headers = headers;
        callback(res);
        if (body != null) res.write(Buffer.from(body));
        if (!stall) res.end();
        options.signal?.addEventListener("abort", () => res.destroy(new Error("aborted")));
      });
    };
    return req;
  };
  try {
    return await fn(calls);
  } finally {
    https.request = orig;
  }
}

sealedTest(
  "a direct import records each actual request with its own bytes, and never tags Node requests",
  async () => {
    const body = "audiodata";
    const headers = { "content-type": "audio/mpeg", "content-length": String(body.length) };
    let tempPath;
    await withMeteredHttps(
      (parsed, options) => (options.method === "HEAD" ? { headers } : { headers, body }),
      async (calls) => {
        const result = await downloader.download("https://93.184.216.34/interview.mp3", null, null);
        tempPath = result.tempPath;
        assert.equal(fs.readFileSync(tempPath, "utf8"), body);
        assert.deepEqual(
          calls.map((c) => c.method),
          ["HEAD", "GET"]
        );
        for (const call of calls)
          assert.equal(
            Object.keys(call.headers).some((h) => h.toLowerCase() === gate.EGRESS_TAG_HEADER),
            false
          );
      }
    );
    fs.unlinkSync(tempPath);
    assert.deepEqual(
      rows.map((r) => [r.task, r.kind, r.outcome, r.status, r.bytesIn, r.bytesOut]),
      [
        ["urlImport", "request", "ok", 200, null, null],
        ["urlImport", "request", "ok", 200, body.length, null],
      ]
    );
    assert.equal(rows[0].operationId, rows[1].operationId);
    assert.equal(gate.activeRemoteCount(), 0);
  }
);

sealedTest(
  "sealing a direct import mid-body interrupts it; it is never 'nothing sent'",
  async () => {
    const headers = { "content-type": "audio/mpeg", "content-length": "100" };
    await withMeteredHttps(
      (parsed, options) =>
        options.method === "HEAD" ? { headers } : { headers, body: "part", stall: true },
      async () => {
        const pending = downloader.download("https://93.184.216.34/long.mp3", null, null);
        await until(() => rows.length === 1, "HEAD row");
        await tick(20);
        seal();
        const error = await pending.catch((e) => e);
        assert.equal(sealedPhaseOf(error), "interrupted");
      }
    );
    assert.deepEqual(
      rows.map((r) => [r.outcome, r.errorClass, r.bytesIn]),
      [
        ["ok", null, null],
        ["cancelled", "SEALED_MODE", null],
      ]
    );
    assert.equal(gate.activeRemoteCount(), 0);
  }
);

sealedTest(
  "a proxied import tags each Electron request with its own attempt and counts its body",
  async () => {
    proxyAnswer = "PROXY 127.0.0.1:9";
    const tags = [];
    const body = "proxied!";
    downloader._setElectronNetForTests({
      request(options) {
        const req = new EventEmitter();
        req.setHeader = (name, value) => {
          if (name.toLowerCase() === gate.EGRESS_TAG_HEADER) tags.push(gate.ticketByTag(value));
        };
        req.abort = () => {};
        req.end = () =>
          setImmediate(() => {
            if (options.url.endsWith("/old.mp3")) {
              req.emit("redirect", 302, "GET", "https://93.184.216.35/new.mp3");
              return;
            }
            const response = Readable.from([Buffer.from(body)]);
            response.statusCode = 200;
            response.headers = {
              "content-type": "audio/mpeg",
              "content-length": String(body.length),
            };
            req.emit("response", response);
          });
        return req;
      },
    });
    try {
      const result = await downloader.download("https://93.184.216.34/old.mp3", null, null);
      fs.unlinkSync(result.tempPath);
    } finally {
      downloader._setElectronNetForTests(null);
    }
    assert.equal(tags.length, 2);
    assert.ok(tags.every((owner) => owner?.ticket));
    assert.equal(tags[0].ticket, tags[1].ticket);
    assert.deepEqual(
      rows.map((r) => [r.task, r.host, r.status, r.outcome, r.bytesIn]),
      [
        ["urlImport", "93.184.216.34", 302, "ok", null],
        ["urlImport", "93.184.216.35", 200, "ok", body.length],
      ]
    );
  }
);

// Fix round 1 (M5): a seal that lands while the OS proxy is being resolved
// stops the import there, before any DNS lookup, request or attempt.
sealedTest(
  "sealing during proxy resolution stops the import before DNS, a request or an attempt",
  async () => {
    const origLookup = dns.lookup;
    let lookups = 0;
    dns.lookup = (host, options, callback) => {
      lookups++;
      (typeof options === "function" ? options : callback)(new Error("fixture: no DNS"));
    };
    const proxied = [];
    downloader._setElectronNetForTests({
      request(options) {
        proxied.push(options.url);
        throw new Error("must not be called");
      },
    });
    try {
      await withMeteredHttps(
        () => ({ headers: { "content-type": "audio/mpeg" } }),
        async (calls) => {
          for (const resolved of ["PROXY 127.0.0.1:9", "DIRECT"]) {
            flags.sealed = false;
            let answer;
            proxyAnswer = new Promise((resolve) => (answer = resolve));
            const pending = downloader.download("https://media.example.com/talk.mp3", null, null);
            await tick(5);
            seal();
            answer(resolved);
            const error = await pending.catch((e) => e);
            assert.equal(isSealedModeError(error), true, resolved);
          }
          assert.equal(calls.length, 0, "no direct request");
        }
      );
    } finally {
      dns.lookup = origLookup;
      downloader._setElectronNetForTests(null);
    }
    assert.equal(lookups, 0, "no DNS lookup for the proxy pre-flight");
    assert.deepEqual(proxied, []);
    assert.deepEqual(
      rows.filter((r) => r.kind === "request"),
      [],
      "no attempt was dispatched"
    );
    assert.equal(gate.activeRemoteCount(), 0);
  }
);

sealedTest("a direct hop after a seal is never requested nor marked dispatched", async () => {
  const dispatched = [];
  const onDispatched = (event) => dispatched.push(event.operationId);
  gate.events.on("dispatched", onDispatched);
  try {
    await withMeteredHttps(
      (parsed) => {
        if (parsed.pathname === "/old.mp3") {
          seal(); // lands while the first HEAD is answered
          return { statusCode: 302, headers: { location: "https://93.184.216.35/new.mp3" } };
        }
        return { headers: { "content-type": "audio/mpeg" } };
      },
      async (calls) => {
        const error = await downloader
          .download("https://93.184.216.34/old.mp3", null, null)
          .catch((e) => e);
        assert.equal(isSealedModeError(error), true);
        assert.deepEqual(
          calls.map((c) => [c.method, c.url]),
          [["HEAD", "https://93.184.216.34/old.mp3"]]
        );
      }
    );
  } finally {
    gate.events.off("dispatched", onDispatched);
  }
  assert.deepEqual(
    rows.filter((r) => r.kind === "request").map((r) => [r.host, r.outcome, r.errorClass]),
    [["93.184.216.34", "cancelled", "SEALED_MODE"]],
    "only the request that actually went out has an attempt"
  );
  assert.equal(dispatched.length, 1, "the cancelled hop never announced a dispatch");
});

// YouTube: every yt-dlp run of one import is in one opaque session.
function youtubeLeaf(children) {
  fixtureFfmpegPath = "/fixture/bin/ffmpeg";
  return (command, args) => {
    const child = fakeChild();
    child.args = args;
    children.push(child);
    return child;
  };
}
function finishMetadata(child) {
  child.stdout.emit("data", Buffer.from(JSON.stringify({ title: "Talk", duration: 60 })));
  child.end(0);
}
function finishExtraction(child) {
  const template = child.args[child.args.indexOf("-o") + 1];
  fs.writeFileSync(template.replace("%(ext)s", "m4a"), "audio");
  child.stdout.emit("data", Buffer.from("[download] 100.0% of 1MiB\n"));
  child.end(0);
}
const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

sealedTest("a YouTube import is one opaque urlImport session across its yt-dlp runs", async () => {
  sealedCacheBinary({ throttle: true });
  const children = [];
  sealedLeaf = youtubeLeaf(children);
  const pending = downloader.download(YOUTUBE, null, null);
  await until(() => children.length === 1, "metadata child");
  assert.equal(children[0].args.includes("--dump-single-json"), true);
  finishMetadata(children[0]);
  await until(() => children.length === 2, "extraction child");
  assert.equal(rows.length, 0, "still running");
  finishExtraction(children[1]);
  const result = await pending;
  fs.unlinkSync(result.tempPath);
  assert.equal(rows.length, 1, "one session row, no guard-owned duplicates");
  assert.deepEqual(
    [rows[0].task, rows[0].host, rows[0].kind, rows[0].opaque, rows[0].bytesIn, rows[0].bytesOut],
    ["urlImport", "www.youtube.com", "session", true, null, null]
  );
  assert.equal(rows[0].outcome, "ok");
  assert.equal(gate.activeRemoteCount(), 0);
});

sealedTest(
  "a YouTube session outlives a caller released early until its child actually exits",
  async () => {
    sealedCacheBinary({ throttle: true });
    const children = [];
    sealedLeaf = youtubeLeaf(children);
    const pending = downloader.download(YOUTUBE, null, null);
    await until(() => children.length === 1, "metadata child");
    finishMetadata(children[0]);
    await until(() => children.length === 2, "extraction child");
    await tick();
    // An error after start rejects the caller at once; the process may still run.
    children[1].emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    await assert.rejects(pending);
    assert.equal(rows.length, 0, "the session is not settled before the exit");
    assert.equal(gate.activeRemoteCount(), 1);
    children[1].end(1);
    assert.deepEqual(
      rows.map((r) => [r.task, r.kind, r.outcome]),
      [["urlImport", "session", "error"]]
    );
    assert.equal(gate.activeRemoteCount(), 0);
  }
);

sealedTest(
  "sealing a YouTube import signals yt-dlp and records the session only at exit",
  async () => {
    sealedCacheBinary({ throttle: true });
    const children = [];
    sealedLeaf = youtubeLeaf(children);
    let settled = false;
    const pending = downloader
      .download(YOUTUBE, null, new AbortController().signal)
      .finally(() => (settled = true));
    await until(() => children.length === 1, "metadata child");
    finishMetadata(children[0]);
    await until(() => children.length === 2, "extraction child");
    await tick();
    seal();
    assert.deepEqual(children[1].signals, ["SIGTERM"]);
    await tick(10);
    assert.equal(settled, false, "the import waits for yt-dlp's actual exit");
    assert.equal(rows.length, 0);
    children[1].end(null, "SIGTERM");
    const error = await pending.catch((e) => e);
    assert.equal(sealedPhaseOf(error), "interrupted");
    assert.deepEqual(
      rows.map((r) => [r.task, r.kind, r.outcome, r.errorClass, r.bytesIn]),
      [["urlImport", "session", "cancelled", "SEALED_MODE", null]]
    );
    assert.equal(gate.activeRemoteCount(), 0);
  }
);

sealedTest("a YouTube import that never started yt-dlp claims no session", async () => {
  sealedCacheBinary({ throttle: true });
  sealedLeaf = youtubeLeaf([]);
  const error = await downloader
    .download("https://www.youtube.com/playlist?list=PL123", null, null)
    .catch((e) => e);
  assert.equal(error.code, "PLAYLIST_URL");
  assert.equal(sealedSpawned.length, 0);
  assert.deepEqual(rows, []);
  assert.equal(gate.activeRemoteCount(), 0);
});

// --------------------------------------------------------- IPC envelope

sealedTest("the download-url-audio handler returns a typed SEALED_MODE envelope", async () => {
  const handlers = new Map();
  const module = { exports: {} };
  const inert = () =>
    new Proxy(function () {}, {
      get: (_, key) => (key === "then" ? undefined : inert()),
      apply: () => inert(),
      construct: () => inert(),
    });
  let failure;
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, "../../src/helpers/ipcHandlers.js"), "utf8"),
    {
      module,
      exports: module.exports,
      process,
      Date,
      setTimeout,
      clearTimeout,
      AbortController,
      require: (name) => {
        if (name === "electron")
          return { ipcMain: { handle: (n, fn) => handlers.set(n, fn), on() {} } };
        if (name === "./privacy/egressPolicy")
          return require("../../src/helpers/privacy/egressPolicy");
        if (name === "./urlAudioDownloader")
          return {
            sweepStaleTempArtifacts() {},
            download: async () => {
              throw failure;
            },
          };
        return inert();
      },
    }
  );
  const context = new Proxy({}, { get: (target, key) => (key in target ? target[key] : inert()) });
  module.exports.prototype.setupHandlers.call(context);
  const sender = { isDestroyed: () => false, send() {} };
  for (const phase of ["refused", "interrupted"]) {
    failure = new SealedModeError({ task: "urlImport", host: "www.youtube.com", phase });
    const result = await handlers.get("download-url-audio")({ sender }, YOUTUBE, "dl-1");
    assert.equal(result.success, false);
    assert.equal(result.code, "SEALED_MODE");
    assert.equal(result.phase, phase);
    assert.equal(isSealedModeError(new Error(result.error)), true, "the marker survives IPC");
  }
});

// --------------------------------------------------------------------------
// Plan 07a Task 12 matrix rows for N14/N15 (the safety chain admits the real
// downloader only from this file; sealedModeEnforcement.test.js cross-checks
// that these rows exist). The REAL `download-url-audio` handler registered by
// IPCHandlers.setupHandlers runs over the REAL downloader; DNS, https.request
// and the yt-dlp spawn are counted terminal leaves under the real gate and
// the production spawn guard.
function matrixIpc(t) {
  const { loadIpcHandlers, inertUi } = require("./harness/ipcHandlersHarness");
  const ipc = loadIpcHandlers({
    construct: false,
    leaves: { "./urlAudioDownloader": downloader },
    managers: new Proxy({}, { get: (target, key) => (key in target ? target[key] : inertUi()) }),
  });
  t.after(() => ipc.restore());
  return ipc;
}
function countedLeaves(t) {
  const counts = { dns: 0, https: 0 };
  const savedLookup = dns.lookup;
  const savedRequest = https.request;
  dns.lookup = (...args) => {
    counts.dns++;
    return savedLookup(...args);
  };
  https.request = (...args) => {
    counts.https++;
    return savedRequest(...args);
  };
  t.after(() => {
    dns.lookup = savedLookup;
    https.request = savedRequest;
  });
  return counts;
}
const matrixSender = () => ({ id: 3, isDestroyed: () => false, send() {} });
for (const [label, url] of [
  ["direct URL", "https://media.example/episode.mp3"],
  ["YouTube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
]) {
  sealedTest(
    `Task 12 matrix: download-url-audio (${label}) — sealed: typed refusal before DNS, socket or yt-dlp`,
    async (t) => {
      sealedCacheBinary({ throttle: true });
      const ipc = matrixIpc(t);
      const counts = countedLeaves(t);
      flags.sealed = true;
      fixtureFfmpegPath = "/fixture/bin/ffmpeg";
      sealedLeaf = () => fakeChild();
      const result = await ipc.invokeWith(
        { sender: matrixSender() },
        "download-url-audio",
        url,
        "dl-matrix"
      );
      assert.deepEqual(
        [result.success, result.code, result.phase],
        [false, "SEALED_MODE", "refused"]
      );
      assert.deepEqual(counts, { dns: 0, https: 0 });
      assert.equal(sealedSpawned.length, 0);
      assert.deepEqual(
        rows.map((r) => [r.task, r.outcome, r.bytesOut]),
        [["urlImport", "blocked", 0]]
      );
    }
  );
  sealedTest(
    `Task 12 matrix: download-url-audio (${label}) — Layer A disabled: reaches DNS, a socket or the spawn guard`,
    async (t) => {
      sealedCacheBinary({ throttle: true });
      const ipc = matrixIpc(t);
      const counts = countedLeaves(t);
      flags.sealed = true;
      // An installed FFmpeg (a synthetic path; nothing runs it).
      fixtureFfmpegPath = "/fixture/bin/ffmpeg";
      sealedLeaf = () => fakeChild();
      gate._setBypassForTests(true);
      try {
        await ipc.invokeWith({ sender: matrixSender() }, "download-url-audio", url, "dl-matrix");
      } finally {
        gate._setBypassForTests(false);
      }
      // With the backstop absent in this file, the next layer is the DNS/socket
      // leaf (direct) or the production spawn guard (YouTube: a refused program
      // start, recorded as a nativeLaunch operation, never a request; I1).
      const guardRefused = rows.some(
        (r) => r.task === "nativeLaunch" && r.kind === "operation" && r.outcome === "blocked"
      );
      assert.ok(
        counts.dns + counts.https + sealedSpawned.length > 0 || guardRefused,
        JSON.stringify({ counts, rows })
      );
    }
  );
}
sealedTest(
  "Task 12 matrix: yt-dlp self-update — sealed: not attempted (no spawn, no row); unsealed: reaches its spawn",
  async () => {
    sealedCacheBinary();
    flags.sealed = true;
    let child;
    sealedLeaf = () => (child = fakeChild());
    await downloader.maybeUpdateYtDlp({ force: true });
    assert.equal(sealedSpawned.length, 0);
    assert.deepEqual(rows, []);
    flags.sealed = false;
    const update = downloader.maybeUpdateYtDlp({ force: true, timeoutMs: 60000 });
    await until(() => sealedSpawned.length === 1, "self-update spawn");
    child.end(0);
    await update;
  }
);

// T10-M4: a direct import that fails before any request (scheme, SSRF
// literal) contacted nothing, so it writes no urlImport row naming a host.
sealedTest("a direct import refused before any request writes no row", async () => {
  for (const [url, code] of [
    ["http://audio.example/a.mp3", "INVALID_URL"],
    ["https://10.0.0.1/a.mp3", "SSRF_BLOCKED"],
  ]) {
    await assert.rejects(downloader.download(url), { code });
  }
  assert.deepEqual(rows, []);
  assert.equal(gate.activeRemoteCount(), 0);
});

// T10-m4: stopping a YouTube import's yt-dlp signals its group only through
// the registry, which does so only while continuity holds; never a raw
// process.kill(-pid).
groupTest("a YouTube import's yt-dlp group is stopped through the registry only", async (t) => {
  const facts = fakeGroupFacts();
  const realKill = process.kill;
  const rawKills = [];
  process.kill = (pid, signal) => {
    if (pid === -FAKE_GROUP_PID) {
      rawKills.push([pid, signal]);
      return true;
    }
    return realKill.call(process, pid, signal);
  };
  t.after(() => {
    process.kill = realKill;
  });
  sealedCacheBinary({ throttle: true });
  const children = [];
  sealedLeaf = (command, args) => {
    const child = fakeChild({ pid: FAKE_GROUP_PID });
    child.args = args;
    children.push(child);
    return child;
  };
  fixtureFfmpegPath = "/fixture/bin/ffmpeg";
  const controller = new AbortController();
  const pending = downloader.download(YOUTUBE, null, controller.signal);
  await until(() => children.length === 1, "metadata child");
  controller.abort();
  children[0].end(null, "SIGTERM");
  await pending.catch(() => {});
  assert.deepEqual(rawKills, []);
  assert.deepEqual(facts.kills, [[FAKE_GROUP_PID, "SIGTERM"]]);
  assert.deepEqual(children[0].signals, []);
});
