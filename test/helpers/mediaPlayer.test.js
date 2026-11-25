const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const childProcess = require("node:child_process");
const fs = require("node:fs");

const modulePath = require.resolve("../../src/helpers/mediaPlayer");
// mediaPlayer kills timed-out helpers through this shared utility, which
// spawns taskkill on Windows — so it has to re-bind to each test's stub too.
const processUtilPath = require.resolve("../../src/utils/process");
const originalLoad = Module._load;
const originalPlatform = process.platform;

function setPlatform(platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}
test.afterEach(() => {
  setPlatform(originalPlatform);
  Module._load = originalLoad;
});

// A child whose pipes only close when the test says so, so a helper that never
// finishes can be observed the way the reporter's stuck PowerShell behaved.
// Records what the timeout branch does to it (kill / destroy).
function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdoutDestroyed = false;
  child.stderrDestroyed = false;
  child.stdout.destroy = () => {
    child.stdoutDestroyed = true;
  };
  child.stderr.destroy = () => {
    child.stderrDestroyed = true;
  };
  // killProcess skips a child that has already exited, and needs a pid to
  // hand to taskkill.
  child.exitCode = null;
  child.pid = 4242;
  child.killSignals = [];
  child.kill = (signal) => {
    child.killSignals.push(signal);
    return true;
  };
  // child_process delivers "error" and then "close" when the executable is
  // missing; spawnAsync must treat that like a failure rather than hang.
  child.fail = (err) => {
    child.emit("error", err);
    child.emit("close", -2);
  };
  child.finish = (status, stdout = "", stderr = "") => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", status);
  };
  // A helper that printed its result and exited, but whose pipes a descendant
  // still holds open. Node sets exitCode at "exit"; "close" is what's stuck,
  // so the deadline fires with the outcome already known.
  child.exitLeavingPipesOpen = (status, stdout = "") => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    child.exitCode = status;
    child.emit("exit", status, null);
  };
  return child;
}

// Loads a fresh MediaPlayer singleton for `platform`. Every synchronous
// child_process entry point throws, so a regression back to a blocking call
// fails every test in this file (#2073). The stub stays installed for the whole
// test rather than just the initial require, so a call added inside a function
// is caught too, and it only answers requires made by the two modules under
// test, so node:test's own requires are untouched.
function loadMediaPlayer(platform, { existingPaths = () => false, warnThrows = false } = {}) {
  delete require.cache[modulePath];
  delete require.cache[processUtilPath];
  setPlatform(platform);
  const calls = [];
  const logs = [];
  const spawn = (cmd, args, options) => {
    const child = createFakeChild();
    calls.push({ cmd: path.basename(cmd), args, options, child });
    return child;
  };
  const syncSpawn = () => {
    throw new Error(
      "no synchronous child-process call may run on the media pause/resume path (#2073)"
    );
  };
  const mockedRequesters = new Set([modulePath, processUtilPath]);
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (!mockedRequesters.has(parent?.filename)) {
      return originalLoad.call(this, request, parent, isMain);
    }
    // A "node:"-prefixed require reaches the same builtin, so it must not be
    // the way a blocking call slips past the stub.
    const builtin = request.startsWith("node:") ? request.slice(5) : request;
    if (request === "./debugLogger") {
      // The real logger requires electron at load time.
      return {
        debug: (message, meta) => logs.push({ level: "debug", message, meta }),
        info() {},
        warn: (message, meta) => {
          logs.push({ level: "warn", message, meta });
          // debugLogger.write ends in an unguarded logStream.write, so a
          // broken sink throws straight back into the caller.
          if (warnThrows) throw new Error("log stream is broken");
        },
        error() {},
      };
    }
    if (builtin === "child_process") {
      return {
        ...childProcess,
        spawn,
        spawnSync: syncSpawn,
        execSync: syncSpawn,
        execFileSync: syncSpawn,
      };
    }
    if (builtin === "fs") {
      // Binary resolution hits the real filesystem; pin it so the host's
      // downloaded binaries can't change which fallback runs. Only existsSync
      // is stubbed, which covers the macOS mediaremote adapter;
      // resolvers that also call accessSync (linux-fast-paste,
      // macos-media-remote) still see the real filesystem and resolve null.
      return { ...fs, existsSync: (p) => existingPaths(String(p)) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return { mediaPlayer: require(modulePath), calls, logs };
}

// Lets any pending continuation run, for assertions that something did *not*
// happen and so have no call to wait for.
async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Awaits until the module has spawned call #index. The chain between one
// child's close and the next spawn is microtask-only, so a single immediate
// suffices; the bound is just a guard against a hang.
async function waitForCall(calls, index) {
  for (let i = 0; i < 50 && calls.length <= index; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(calls.length > index, `expected spawn call #${index + 1}, saw ${calls.length}`);
  return calls[index];
}

// macOS never blocked the main thread, but it was already async and therefore
// already raced: _pauseMacOS only sets _didPause after two perl spawns, so a
// resume arriving in that window saw _didPause false, returned early, and left
// media paused until the next dictation ended.
const MAC_ADAPTER_PATHS = (p) =>
  p === "/usr/bin/perl" ||
  p.endsWith("mediaremote-adapter.pl") ||
  p.endsWith("MediaRemoteAdapter.framework");

test("darwin: resume waits for an in-flight pause instead of no-oping on _didPause", async () => {
  const { mediaPlayer, calls } = loadMediaPlayer("darwin", { existingPaths: MAC_ADAPTER_PATHS });

  const pausing = mediaPlayer.pauseMedia();
  const resuming = mediaPlayer.resumeMedia();

  const probe = await waitForCall(calls, 0);
  assert.equal(probe.cmd, "perl");
  assert.deepEqual(probe.args.slice(-2), ["get", "--no-artwork"]);
  probe.child.finish(0, '{"playing":true}');

  const pause = await waitForCall(calls, 1);
  assert.deepEqual(pause.args.slice(-2), ["send", "1"]); // kMRAPause
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2, "resume must not spawn until the pause has settled");
  pause.child.finish(0);

  assert.equal(await pausing, true);

  const play = await waitForCall(calls, 2);
  assert.deepEqual(play.args.slice(-2), ["send", "0"]); // kMRAPlay
  play.child.finish(0);

  assert.equal(await resuming, true);
  assert.equal(mediaPlayer._didPause, false);
});

// Linux has the same hazard: dbus-send and playerctl ran through spawnSync on
// the same main thread (#2073).
// spawnAsync is shared by the Linux and macOS helpers. These run it through the
// Linux MPRIS listing (call #0, a 2 s deadline) because that is the first spawn
// every pause makes.
const MPRIS_LIST_TIMEOUT_MS = 2000;
const MPRIS_PLAYERS =
  'string "org.mpris.MediaPlayer2.spotify"\nstring "org.mpris.MediaPlayer2.vlc"\n';

// A helper that never closes its pipes is killed at the deadline, its stdio is
// destroyed so stuck pipes don't accumulate, and a late close can neither
// double-settle nor re-run anything.
test("linux: a helper stuck past its deadline is killed, its stdio destroyed, and the pause falls through", async (t) => {
  // Only setTimeout is mocked: waitForCall drives progress with setImmediate,
  // which a bare enable() would also mock, stalling every helper below.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { mediaPlayer, calls, logs } = loadMediaPlayer("linux");

  const pausing = mediaPlayer.pauseMedia();
  const list = await waitForCall(calls, 0);

  t.mock.timers.tick(MPRIS_LIST_TIMEOUT_MS - 1);
  assert.deepEqual(list.child.killSignals, [], "nothing is killed before the deadline");
  t.mock.timers.tick(1);

  assert.deepEqual(list.child.killSignals, ["SIGKILL"]);
  assert.equal(list.child.stdoutDestroyed, true);
  assert.equal(list.child.stderrDestroyed, true);
  assert.ok(
    logs.some((entry) => entry.level === "warn" && entry.message.includes("timed out")),
    "a timed-out helper is reported above debug level"
  );

  // A timed-out listing reads as "no players", so playerctl takes over.
  const playerctl = await waitForCall(calls, 1);
  assert.equal(playerctl.cmd, "playerctl");
  assert.deepEqual(playerctl.args, ["pause"]);

  list.child.finish(0, MPRIS_PLAYERS);
  playerctl.child.finish(0);
  assert.equal(await pausing, true);
  await drain();
  assert.equal(calls.length, 2);
  assert.deepEqual(mediaPlayer._pausedPlayers, ["playerctl"]);
});

// The deadline can arrive after the helper has already done its job and
// exited, with only its pipes held open by a descendant — the shape behind
// #2073. Its exit code and the output we buffered are the real result.
test("linux: a helper that exited before the deadline is honoured, not reported as a timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { mediaPlayer, calls, logs } = loadMediaPlayer("linux");

  const pausing = mediaPlayer.pauseMedia();
  const list = await waitForCall(calls, 0);
  list.child.exitLeavingPipesOpen(0, 'string "org.mpris.MediaPlayer2.spotify"\n');

  t.mock.timers.tick(MPRIS_LIST_TIMEOUT_MS);
  await drain();

  // The listing's players are used rather than the playerctl fallback.
  const status = await waitForCall(calls, 1);
  assert.equal(status.cmd, "dbus-send");
  assert.ok(status.args.includes("--dest=org.mpris.MediaPlayer2.spotify"));
  assert.deepEqual(list.child.killSignals, [], "an exited helper is not killed");
  const timeout = logs.find((entry) => entry.message.includes("timed out"));
  assert.equal(timeout.meta.exitCode, 0);

  status.child.finish(0, 'variant string "Playing"\n');
  (await waitForCall(calls, 2)).child.finish(0);
  assert.equal(await pausing, true);
  assert.deepEqual(mediaPlayer._pausedPlayers, ["org.mpris.MediaPlayer2.spotify"]);
});

// spawnSync capped output at 1 MB and killed anything past it. Without a
// replacement cap a runaway helper buffers in the main process until its
// deadline, and a large enough payload makes the settle path throw after it
// has marked itself settled — stalling the serialized queue for good.
test("linux: a helper that floods stdout has its output capped", async () => {
  const { mediaPlayer, calls } = loadMediaPlayer("linux");

  const pausing = mediaPlayer.pauseMedia();
  const list = await waitForCall(calls, 0);
  list.child.stdout.emit("data", Buffer.from('string "org.mpris.MediaPlayer2.early"\n'));
  const chunk = "A".repeat(512 * 1024);
  for (let i = 0; i < 4; i += 1) list.child.stdout.emit("data", Buffer.from(chunk));
  // Past the 1 MB cap, so this player is never buffered.
  list.child.stdout.emit("data", Buffer.from('string "org.mpris.MediaPlayer2.late"\n'));
  list.child.finish(0);

  const status = await waitForCall(calls, 1);
  assert.ok(status.args.includes("--dest=org.mpris.MediaPlayer2.early"));
  status.child.finish(0, 'variant string "Paused"\n');

  // Only the early player was listed, so playerctl is next, not a "late" query.
  const playerctl = await waitForCall(calls, 2);
  assert.equal(playerctl.cmd, "playerctl");
  playerctl.child.finish(1);
  assert.equal(await pausing, false);
  assert.ok(!calls.some((call) => call.args.includes("--dest=org.mpris.MediaPlayer2.late")));
});

// Teardown and logging at the deadline are best effort, but the deadline must
// still settle: an unsettled promise sits at the head of the serial queue and
// kills every later pause and resume for the rest of the session.
test("linux: a logger that throws at the deadline still settles and leaves the queue usable", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { mediaPlayer, calls } = loadMediaPlayer("linux", { warnThrows: true });

  const pausing = mediaPlayer.pauseMedia();
  await waitForCall(calls, 0);
  t.mock.timers.tick(MPRIS_LIST_TIMEOUT_MS);

  (await waitForCall(calls, 1)).child.finish(0); // playerctl pause
  assert.equal(await pausing, true);

  const resuming = mediaPlayer.resumeMedia();
  const play = await waitForCall(calls, 2);
  assert.deepEqual(play.args, ["play"]);
  play.child.finish(0);
  assert.equal(await resuming, true);
});

test("linux: pauses only Playing MPRIS players and resumes exactly those", async () => {
  const { mediaPlayer, calls } = loadMediaPlayer("linux");

  const pausing = mediaPlayer.pauseMedia();

  const list = await waitForCall(calls, 0);
  assert.equal(list.cmd, "dbus-send");
  assert.ok(list.args.includes("org.freedesktop.DBus.ListNames"));
  list.child.finish(
    0,
    'string "org.mpris.MediaPlayer2.spotify"\nstring "org.mpris.MediaPlayer2.vlc"\n'
  );

  const spotifyStatus = await waitForCall(calls, 1);
  assert.ok(spotifyStatus.args.includes("--dest=org.mpris.MediaPlayer2.spotify"));
  assert.ok(spotifyStatus.args.includes("string:PlaybackStatus"));
  spotifyStatus.child.finish(0, 'variant string "Playing"\n');

  const spotifyPause = await waitForCall(calls, 2);
  assert.ok(spotifyPause.args.includes("org.mpris.MediaPlayer2.Player.Pause"));
  spotifyPause.child.finish(0);

  const vlcStatus = await waitForCall(calls, 3);
  assert.ok(vlcStatus.args.includes("--dest=org.mpris.MediaPlayer2.vlc"));
  vlcStatus.child.finish(0, 'variant string "Paused"\n');

  assert.equal(await pausing, true);
  assert.equal(calls.length, 4);
  assert.deepEqual(mediaPlayer._pausedPlayers, ["org.mpris.MediaPlayer2.spotify"]);

  const resuming = mediaPlayer.resumeMedia();
  const play = await waitForCall(calls, 4);
  assert.ok(play.args.includes("--dest=org.mpris.MediaPlayer2.spotify"));
  assert.ok(play.args.includes("org.mpris.MediaPlayer2.Player.Play"));
  play.child.finish(0);

  assert.equal(await resuming, true);
  assert.equal(calls.length, 5);
  assert.deepEqual(mediaPlayer._pausedPlayers, []);
});

test("linux: falls back to playerctl when no MPRIS player is available", async () => {
  const { mediaPlayer, calls } = loadMediaPlayer("linux");

  const pausing = mediaPlayer.pauseMedia();
  (await waitForCall(calls, 0)).child.finish(1); // ListNames failed → no players

  const playerctl = await waitForCall(calls, 1);
  assert.equal(playerctl.cmd, "playerctl");
  assert.deepEqual(playerctl.args, ["pause"]);
  playerctl.child.finish(0);

  assert.equal(await pausing, true);
  assert.deepEqual(mediaPlayer._pausedPlayers, ["playerctl"]);

  const resuming = mediaPlayer.resumeMedia();
  const play = await waitForCall(calls, 2);
  assert.equal(play.cmd, "playerctl");
  assert.deepEqual(play.args, ["play"]);
  play.child.finish(0);
  assert.equal(await resuming, true);
});

test("linux: toggle uses MPRIS PlayPause for every player, else playerctl play-pause", async () => {
  const { mediaPlayer, calls } = loadMediaPlayer("linux");

  const toggling = mediaPlayer.toggleMedia();
  (await waitForCall(calls, 0)).child.finish(0, 'string "org.mpris.MediaPlayer2.vlc"\n');
  const playPause = await waitForCall(calls, 1);
  assert.ok(playPause.args.includes("org.mpris.MediaPlayer2.Player.PlayPause"));
  playPause.child.finish(0);
  assert.equal(await toggling, true);

  const togglingAgain = mediaPlayer.toggleMedia();
  (await waitForCall(calls, 2)).child.finish(1); // no MPRIS players this time
  const playerctl = await waitForCall(calls, 3);
  assert.equal(playerctl.cmd, "playerctl");
  assert.deepEqual(playerctl.args, ["play-pause"]);
  playerctl.child.finish(0);
  assert.equal(await togglingAgain, true);
});
