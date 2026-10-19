const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/preview/onboardingScenarioBridge.ts");

function manualClock() {
  let now = 0;
  let queue = [];
  return {
    clock: {
      setTimeout(callback, ms) {
        const handle = { at: now + ms, callback };
        queue.push(handle);
        return handle;
      },
      clearTimeout(handle) {
        queue = queue.filter((entry) => entry !== handle);
      },
      now: () => now,
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue[0];
        if (!next || next.at > end) break;
        queue.shift();
        now = next.at;
        next.callback();
      }
      now = end;
    },
  };
}

async function bridgeFor(scenario, platform = "linux") {
  const { createOnboardingScenarioBridge } = await load();
  const time = manualClock();
  const config = { step: "welcome", scenario, platform };
  const bridge = createOnboardingScenarioBridge(() => config, time.clock);
  return { bridge, api: bridge.api, time, config };
}

test("a fresh download completes and the voice then reads as installed", async () => {
  const { api, time } = await bridgeFor("fresh");
  const progress = [];
  api.onParakeetDownloadProgress((_event, data) => progress.push(data));
  const pending = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(10000);
  assert.deepEqual(await pending, {
    success: true,
    downloaded: true,
    model: "parakeet-unified-en-0.6b",
  });
  assert.equal(progress.at(-1).type, "complete");
  assert.ok(progress.some((event) => event.type === "progress" && event.total_bytes === 631000000));
  assert.equal((await api.checkParakeetModelStatus("parakeet-unified-en-0.6b")).downloaded, true);
});

test("an interrupted download keeps its progress and Retry resumes it", async () => {
  const { api, time } = await bridgeFor("download-interrupted");
  const progress = [];
  api.onParakeetDownloadProgress((_event, data) => progress.push(data));
  const pending = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(10000);
  const result = await pending;
  assert.equal(result.success, false);
  assert.equal(result.code, "ECONNRESET");
  assert.equal(result.keptBytes, Math.round(631000000 * 0.35));
  assert.equal(progress.at(-1).type, "error");
  assert.equal(progress.at(-1).keptBytes, result.keptBytes);
  assert.ok(
    progress.filter((event) => event.type === "progress").every((event) => event.percentage < 42)
  );

  progress.length = 0;
  const retry = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(10000);
  assert.equal((await retry).success, true);
  assert.equal(
    progress.find((event) => event.type === "progress").percentage,
    42,
    "resumes from 35%"
  );
});

test("cancel stops the transfer with the cancellation code", async () => {
  const { api, time } = await bridgeFor("fresh");
  const pending = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(900);
  await api.cancelParakeetDownload();
  assert.equal((await pending).code, "DOWNLOAD_CANCELLED");
});

test("the downloading scenario rehydrates an in-flight transfer", async () => {
  const { api } = await bridgeFor("downloading");
  const [active] = await api.modelGetActiveDownloads();
  assert.equal(active.modelType, "parakeet");
  assert.equal(active.progress, 35);
});

async function trial(scenario, platform) {
  const context = await bridgeFor(scenario, platform);
  const events = [];
  context.api.onOnboardingDemoEvent((event) => events.push(event));
  await context.api.beginOnboardingDemo({ id: "demo-1", kind: "dictation" });
  return { ...context, events };
}

test("the trial streams listening, levels, words and a result", async () => {
  const { api, time, events } = await trial("ready");
  await api.toggleOnboardingDemo("demo-1");
  time.advance(800);
  await api.toggleOnboardingDemo("demo-1");
  time.advance(400);
  const statuses = [...new Set(events.map((event) => event.status))];
  assert.deepEqual(statuses, [
    "preparing",
    "listening",
    "level",
    "partial",
    "processing",
    "success",
  ]);
  assert.equal(events.at(-1).text, "Remind me to send the draft before lunch.");
  assert.ok(events.every((event) => event.demoId === "demo-1" && event.kind === "dictation"));
});

test("failure scenarios fail where the real app would", async () => {
  const denied = await trial("microphone-denied");
  await denied.api.toggleOnboardingDemo("demo-1");
  assert.deepEqual(
    denied.events.map((event) => [event.status, event.code]),
    [
      ["preparing", undefined],
      ["error", "NotAllowedError"],
    ]
  );

  const quiet = await trial("nothing-heard");
  await quiet.api.toggleOnboardingDemo("demo-1");
  quiet.time.advance(800);
  await quiet.api.toggleOnboardingDemo("demo-1");
  quiet.time.advance(400);
  assert.ok(
    quiet.events.filter((event) => event.status === "level").every((event) => event.level < 0.015)
  );
  assert.equal(quiet.events.at(-1).code, "NO_AUDIO");

  const messy = await trial("cleanup-failed");
  await messy.api.toggleOnboardingDemo("demo-1");
  messy.time.advance(400);
  await messy.api.toggleOnboardingDemo("demo-1");
  messy.time.advance(400);
  assert.deepEqual(
    [messy.events.at(-1).cleanup, messy.events.at(-1).text],
    ["failed", "um remind me to send the draft before lunch"]
  );
});

test("shortcut sessions mirror presses but never record", async () => {
  const { api, bridge } = await bridgeFor("ready");
  const presses = [];
  const demo = [];
  api.onDictationHotkeyEvent((event) => presses.push(event.phase));
  api.onOnboardingDemoEvent((event) => demo.push(event));
  await api.beginOnboardingDemo({ id: "demo-2", kind: "shortcut" });
  bridge.simulateHotkey("down");
  bridge.simulateHotkey("up");
  assert.deepEqual(presses, ["down", "up"]);
  assert.deepEqual(demo, []);
});

test("without Accessibility on macOS, presses never arrive", async () => {
  const { api, bridge } = await bridgeFor("accessibility-missing", "macos");
  const presses = [];
  api.onDictationHotkeyEvent((event) => presses.push(event));
  await api.beginOnboardingDemo({ id: "demo-3", kind: "dictation" });
  bridge.simulateHotkey("down");
  assert.deepEqual(presses, []);
  assert.equal(await api.checkAccessibilityPermission(), false);
});

test("the system profile follows the scenario", async () => {
  assert.deepEqual((await (await bridgeFor("multilingual")).api.getSystemProfile()).locales, [
    "es-ES",
    "en-US",
  ]);
  assert.equal(
    (await (await bridgeFor("low-disk")).api.getSystemProfile()).freeDiskBytes,
    412000000
  );
  assert.equal(await (await bridgeFor("insufficient-memory")).api.getTotalMemory(), 4 * 1024 ** 3);
});

test("reset settles a pending transfer and cancel never leaves stale active work (I12)", async () => {
  const { api, bridge, time } = await bridgeFor("fresh");
  const pending = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(900);
  bridge.reset();
  assert.deepEqual(await pending, {
    success: false,
    downloaded: false,
    model: "parakeet-unified-en-0.6b",
    error: "Preview reset",
    code: "DOWNLOAD_CANCELLED",
    keptBytes: 0,
  });
  assert.deepEqual(await api.modelGetActiveDownloads(), []);

  const second = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(900);
  assert.deepEqual(await api.cancelParakeetDownload(), { success: true });
  assert.equal((await second).downloaded, false);
  assert.deepEqual(
    await api.modelGetActiveDownloads(),
    [],
    "cancelled work is not reported as active"
  );
  assert.deepEqual(
    await api.cancelParakeetDownload(),
    { success: false },
    "nothing left to cancel"
  );
  const retry = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(10000);
  assert.equal((await retry).success, true);
});

test("Esc while processing cancels the take: its result never arrives (R2-I07)", async () => {
  const { api, time, events } = await trial("ready");
  await api.toggleOnboardingDemo("demo-1");
  time.advance(200);
  await api.toggleOnboardingDemo("demo-1"); // stop → processing
  assert.equal(events.at(-1).status, "processing");
  assert.equal(await api.cancelOnboardingDemo("demo-1"), true);
  time.advance(2000);
  assert.deepEqual(
    events.slice(-2).map((event) => event.status),
    ["processing", "cancelled"]
  );
  assert.equal(
    events.some((event) => event.status === "success"),
    false
  );
});

test("leaving mid-processing and coming back never delivers the old result to the new session", async () => {
  const { api, time, events } = await trial("ready");
  await api.toggleOnboardingDemo("demo-1");
  time.advance(200);
  await api.toggleOnboardingDemo("demo-1");
  await api.endOnboardingDemo("demo-1");
  await api.beginOnboardingDemo({ id: "demo-2", kind: "dictation" });
  time.advance(2000);
  assert.equal(
    events.some((event) => event.status === "success"),
    false
  );
  await api.toggleOnboardingDemo("demo-2");
  assert.deepEqual(events.at(-1), {
    demoId: "demo-2",
    takeId: "2",
    kind: "dictation",
    origin: "button",
    status: "listening",
  });
});

test("a cancel is discarded with no Undo, like desktop before Plan 04 (§5.2 fallback, I12)", async () => {
  const { api, time, events } = await trial("ready");
  await api.toggleOnboardingDemo("demo-1");
  time.advance(200);
  assert.equal(await api.cancelOnboardingDemo("demo-1"), true);
  assert.deepEqual(events.at(-1), {
    demoId: "demo-1",
    takeId: "1",
    kind: "dictation",
    origin: "button",
    status: "cancelled",
  });
  assert.equal(await api.undoOnboardingDemoCancel("demo-1"), false);
  time.advance(1000);
  assert.equal(events.at(-1).status, "cancelled", "nothing resumes");
});

test("ending a session silences it and reset forgets downloads", async () => {
  const { api, bridge, time, events } = await trial("fresh");
  await api.endOnboardingDemo("demo-1");
  assert.equal(await api.toggleOnboardingDemo("demo-1"), false);
  assert.deepEqual(events, []);
  const pending = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(10000);
  await pending;
  bridge.reset();
  assert.equal((await api.checkParakeetModelStatus("parakeet-unified-en-0.6b")).downloaded, false);
});

const DEFAULT_MODEL = "parakeet-unified-en-0.6b";
const OTHER_MODEL = "orukeet-v0.1.0";

test("singleton admission refuses actual concurrent API callers without losing the owner", async () => {
  const { api, time } = await bridgeFor("fresh");
  const events = [];
  api.onParakeetDownloadProgress((_event, data) => events.push(data));
  const first = api.downloadParakeetModel(DEFAULT_MODEL);
  const [before] = await api.modelGetActiveDownloads();
  for (const model of [DEFAULT_MODEL, OTHER_MODEL]) {
    const refused = await api.downloadParakeetModel(model);
    assert.deepEqual(refused, {
      success: false,
      downloaded: false,
      model,
      error: "A model is already being downloaded",
      code: "DOWNLOAD_IN_PROGRESS",
      keptBytes: 0,
    });
  }
  assert.deepEqual(await api.modelGetActiveDownloads(), [before]);
  assert.deepEqual(events, [], "refusal must not publish a terminal event for the owner");
  time.advance(10000);
  assert.equal((await first).success, true);
  assert.equal(events.filter((event) => event.type === "complete").length, 1);
  assert.deepEqual(await api.modelGetActiveDownloads(), []);
});

test("catalog status and byte totals belong to the queried model", async () => {
  const { api, time } = await bridgeFor("ready");
  assert.equal((await api.checkParakeetModelStatus(DEFAULT_MODEL)).downloaded, true);
  assert.equal((await api.checkParakeetModelStatus(OTHER_MODEL)).downloaded, false);
  assert.equal((await api.checkParakeetModelStatus("unknown")).success, false);
  assert.equal((await api.downloadParakeetModel("unknown")).success, false);
  const pending = api.downloadParakeetModel(OTHER_MODEL);
  time.advance(400);
  const status = await api.checkParakeetModelStatus(OTHER_MODEL);
  assert.equal(status.downloaded, false);
  assert.equal(status.isDownloading, true);
  assert.equal(status.downloadProgress, 7);
  assert.equal(status.totalBytes, 671619800);
  assert.equal((await api.checkParakeetModelStatus(DEFAULT_MODEL)).isDownloading, false);
  await api.cancelParakeetDownload();
  assert.equal((await pending).keptBytes, 0);
});

test("sequence is monotonic across attempts/reset and cancel resumes from zero", async () => {
  const { api, time, bridge } = await bridgeFor("download-interrupted");
  const events = [];
  api.onParakeetDownloadProgress((_event, data) => events.push(data));
  const first = api.downloadParakeetModel(DEFAULT_MODEL);
  time.advance(10000);
  assert.ok((await first).keptBytes > 0);
  const second = api.downloadParakeetModel(DEFAULT_MODEL);
  time.advance(400);
  assert.equal(events.at(-1).percentage, 42);
  await api.cancelParakeetDownload();
  assert.equal((await second).keptBytes, 0);
  const third = api.downloadParakeetModel(DEFAULT_MODEL);
  time.advance(400);
  assert.equal(events.at(-1).percentage, 7);
  bridge.reset();
  assert.equal((await third).keptBytes, 0);
  const fourth = api.downloadParakeetModel(DEFAULT_MODEL);
  time.advance(400);
  bridge.reset();
  await fourth;
  assert.ok(
    events.every(
      (event, index) =>
        Number.isInteger(event.sequence) &&
        (index === 0 || event.sequence > events[index - 1].sequence)
    )
  );
});

test("retained network bytes survive another model's transfer", async () => {
  const { api, time } = await bridgeFor("download-interrupted");
  const events = [];
  api.onParakeetDownloadProgress((_event, data) => events.push(data));
  const first = api.downloadParakeetModel(DEFAULT_MODEL);
  time.advance(10000);
  await first;
  const other = api.downloadParakeetModel(OTHER_MODEL);
  time.advance(400);
  await api.cancelParakeetDownload();
  await other;
  const retry = api.downloadParakeetModel(DEFAULT_MODEL);
  time.advance(400);
  assert.equal(events.at(-1).percentage, 42);
  await api.cancelParakeetDownload();
  await retry;
});

test("denial is correlated before listening and each admitted take has a fresh string id", async () => {
  const { api, events, config } = await trial("microphone-denied");
  await api.toggleOnboardingDemo("demo-1");
  assert.deepEqual(events, [
    { demoId: "demo-1", takeId: "1", kind: "dictation", origin: "button", status: "preparing" },
    {
      demoId: "demo-1",
      takeId: "1",
      kind: "dictation",
      origin: "button",
      status: "error",
      code: "NotAllowedError",
      message: "Permission denied",
    },
  ]);
  config.scenario = "ready";
  await api.toggleOnboardingDemo("demo-1");
  assert.deepEqual(events.at(-1), {
    demoId: "demo-1",
    takeId: "2",
    kind: "dictation",
    origin: "button",
    status: "listening",
  });
});

test("queued old callbacks cannot borrow a reused demo id or take after reentry/cancel", async () => {
  const { createOnboardingScenarioBridge } = await load();
  const callbacks = [];
  const bridge = createOnboardingScenarioBridge(
    () => ({ step: "try", scenario: "ready", platform: "linux" }),
    {
      setTimeout(callback) {
        callbacks.push(callback);
        return callback;
      },
      clearTimeout() {}, // A callback already queued by the browser may still run.
      now: () => 0,
    }
  );
  const api = bridge.api;
  const events = [];
  api.onOnboardingDemoEvent((event) => events.push(event));
  await api.beginOnboardingDemo({ id: "reused", kind: "dictation" });
  await api.toggleOnboardingDemo("reused");
  const oldLevel = callbacks.shift();
  await api.stopOnboardingDemo("reused");
  const oldResult = callbacks.shift();
  await api.endOnboardingDemo("reused");
  await api.beginOnboardingDemo({ id: "reused", kind: "dictation" });
  await api.toggleOnboardingDemo("reused");
  const before = [...events];
  oldLevel();
  oldResult();
  assert.deepEqual(events, before);
  const currentLevel = callbacks.shift();
  await api.cancelOnboardingDemo("reused");
  assert.equal(events.at(-1).takeId, "2");
  await api.toggleOnboardingDemo("reused");
  currentLevel();
  assert.equal(events.at(-1).takeId, "3");
  assert.equal(events.at(-1).status, "listening");
  assert.equal(await api.undoOnboardingDemoCancel("reused"), false);
  assert.equal("sessionId" in events.at(-1), false);
});

test("insufficient-memory and clean/raw success values stay exact", async () => {
  for (const [scenario, expected] of [
    [
      "insufficient-memory",
      {
        status: "error",
        code: "INSUFFICIENT_MEMORY",
        message: "Not enough memory to load this model.",
      },
    ],
    [
      "ready",
      {
        status: "success",
        text: "Remind me to send the draft before lunch.",
        rawText: "Remind me to send the draft before lunch.",
        cleanup: "skipped",
      },
    ],
    [
      "cleanup-failed",
      {
        status: "success",
        text: "um remind me to send the draft before lunch",
        rawText: "um remind me to send the draft before lunch",
        cleanup: "failed",
        cleanupOperationId: "cleanup-1",
      },
    ],
  ]) {
    const { api, time, events } = await trial(scenario);
    await api.toggleOnboardingDemo("demo-1");
    await api.stopOnboardingDemo("demo-1");
    time.advance(400);
    assert.deepEqual(events.at(-1), {
      demoId: "demo-1",
      takeId: "1",
      kind: "dictation",
      origin: "button",
      ...expected,
    });
  }
});

test("unsubscribed listeners and wrong demo controls have no authority", async () => {
  const { api, time, events } = await trial("ready");
  let calls = 0;
  const dispose = api.onOnboardingDemoEvent(() => calls++);
  dispose();
  for (const name of [
    "toggleOnboardingDemo",
    "stopOnboardingDemo",
    "cancelOnboardingDemo",
    "undoOnboardingDemoCancel",
  ]) {
    assert.equal(await api[name]("wrong"), false);
  }
  await api.toggleOnboardingDemo("demo-1");
  time.advance(80);
  assert.equal(calls, 0);
  assert.equal(events.at(-1).takeId, "1");
});

test("a queued old transfer tick cannot mutate a new attempt after reset", async () => {
  const { createOnboardingScenarioBridge } = await load();
  const callbacks = [];
  const config = { step: "speech", scenario: "fresh", platform: "linux" };
  const bridge = createOnboardingScenarioBridge(() => config, {
    setTimeout(callback) {
      callbacks.push(callback);
      return callback;
    },
    clearTimeout() {},
    now: () => 0,
  });
  const { api } = bridge;
  const events = [];
  api.onParakeetDownloadProgress((_event, data) => events.push(data));
  let settlements = 0;
  const first = api.downloadParakeetModel(DEFAULT_MODEL).then((result) => {
    settlements++;
    return result;
  });
  const oldTick = callbacks.shift();
  bridge.reset();
  assert.equal((await first).code, "DOWNLOAD_CANCELLED");
  const second = api.downloadParakeetModel(DEFAULT_MODEL);
  const [before] = await api.modelGetActiveDownloads();
  oldTick();
  assert.deepEqual(await api.modelGetActiveDownloads(), [before]);
  assert.equal(events.length, 1);
  callbacks.shift()();
  assert.equal(events.at(-1).percentage, 7);
  await api.cancelParakeetDownload();
  await second;
  oldTick();
  assert.equal(settlements, 1);
});

test("push activation records only while held and reset does not rewind take identity", async (t) => {
  const { installBrowserGlobals } = require("../lib/rendererTestHarness");
  installBrowserGlobals(t, { initialStorage: { activationMode: "push" } });
  const { api, bridge, time, events } = await trial("ready");
  bridge.simulateHotkey("down");
  assert.equal(events.at(-1).status, "listening");
  bridge.simulateHotkey("down");
  assert.equal(events.length, 2, "a repeated down cannot admit another take");
  bridge.simulateHotkey("up");
  time.advance(400);
  assert.equal(events.at(-1).status, "success");
  bridge.reset();
  await api.beginOnboardingDemo({ id: "demo-1", kind: "dictation" });
  bridge.simulateHotkey("down");
  assert.equal(events.at(-1).takeId, "2");
  await api.cancelOnboardingDemo("demo-1");
  assert.equal(await api.undoOnboardingDemoCancel("demo-1"), false);
});

test("cleanup retry stays with the completed failed take, refuses duplicates and retires on replacement/end/reset", async () => {
  const { api, time, events, bridge } = await trial("cleanup-failed");
  await api.toggleOnboardingDemo("demo-1");
  time.advance(200);
  await api.toggleOnboardingDemo("demo-1");
  time.advance(400);
  const event = events.at(-1);
  const identity = {
    demoId: event.demoId,
    takeId: event.takeId,
    operationId: event.cleanupOperationId,
  };
  assert.ok(identity.operationId);
  const pending = api.retryOnboardingCleanup(identity);
  assert.equal((await api.retryOnboardingCleanup(identity)).code, "CLEANUP_OPERATION_BUSY");
  time.advance(400);
  assert.equal((await pending).code, "CLEANUP_FAILED");
  const old = api.retryOnboardingCleanup(identity);
  await api.toggleOnboardingDemo("demo-1");
  assert.equal((await old).code, "CLEANUP_OPERATION_UNAVAILABLE");
  time.advance(400);
  assert.equal((await api.retryOnboardingCleanup(identity)).code, "CLEANUP_OPERATION_UNAVAILABLE");
  await api.endOnboardingDemo("demo-1");
  bridge.reset();
});

test("shortcut preview explicitly reports its simulated release capability without recording", async () => {
  const { api, bridge, time } = await bridgeFor("ready", "macos");
  assert.equal(typeof api.getHotkeyModeInfo, "function");
  const info = await api.getHotkeyModeInfo("GLOBE");
  assert.equal(info.supportsPushToTalk, true);
  const events = [];
  api.onOnboardingDemoEvent((event) => events.push(event));
  const keys = [];
  api.onDictationHotkeyEvent((event) => keys.push(event));
  await api.beginOnboardingDemo({ id: "shortcut-capability", kind: "shortcut" });
  bridge.simulateHotkey("down");
  time.advance(600);
  bridge.simulateHotkey("up");
  assert.deepEqual(
    keys.map((event) => event.phase),
    ["down", "up"]
  );
  assert.equal(keys[1].at - keys[0].at, 600);
  assert.equal(await api.toggleOnboardingDemo("shortcut-capability"), false);
  assert.deepEqual(events, []);
});
