const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");
const { listenerBus } = require("../helpers/harness/listenerBus");

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

async function mount(
  t,
  { cancelResult = { success: true }, unsupported = false, activeDownloads = [] } = {}
) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const status = new Map();
  const pending = [];
  const progress = listenerBus();
  const calls = [];
  const checks = [];
  const modelEvents = [];
  const events = new EventTarget();
  events.addEventListener("openwhispr-local-models-changed", (event) => modelEvents.push(event));
  const api = {
    checkParakeetModelStatus: (id) => {
      const request = status.get(id) ?? deferred();
      checks.push([id, request]);
      return request.promise;
    },
    onParakeetDownloadProgress: progress.subscribe,
    modelGetActiveDownloads: async () => activeDownloads,
    downloadParakeetModel: (id) => {
      calls.push(["download", id]);
      const request = deferred();
      pending.push(request);
      return request.promise;
    },
    cancelParakeetDownload: async () => {
      calls.push(["cancel"]);
      return await cancelResult;
    },
  };
  installBrowserGlobals(t, {
    initialStorage: require("../lib/routeStateFixture").MIGRATED_STORAGE,
    window: {
      electronAPI: unsupported ? {} : api,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-voice-download-test-", { "/ui/useToast": TOAST_MOCK })
  );
  const { useVoiceDownload } = await vite.ssrLoadModule(
    "/components/onboarding/useVoiceDownload.ts"
  );
  let current;
  const renders = [];
  function Harness({ modelId }) {
    current = useVoiceDownload(modelId);
    renders.push({ transferId: current.transferId, milestone: current.milestone });
    return null;
  }
  root = createRoot(container);
  const render = (modelId) =>
    React.act(async () => root.render(React.createElement(Harness, { modelId })));
  const emit = (data) => React.act(async () => progress.emit({}, data));
  const settle = (result) => React.act(async () => pending.shift().resolve(result));
  return {
    render,
    emit,
    settle,
    status,
    calls,
    checks,
    modelEvents,
    progress,
    renders,
    unmount: () =>
      React.act(async () => {
        root.unmount();
        root = null;
      }),
    current: () => current,
  };
}

test("switching models never inherits the previous model's readiness (I04)", async (t) => {
  const h = await mount(t);
  const a = deferred();
  const b = deferred();
  h.status.set("model-a", a);
  h.status.set("model-b", b);
  await h.render("model-a");
  await React.act(async () => a.resolve({ downloaded: true }));
  assert.equal(h.current().state.status, "ready");
  await h.render("model-b");
  assert.equal(h.current().state.status, "checking", "B is unknown while its status is pending");
  await React.act(async () => b.resolve({ downloaded: false }));
  assert.equal(h.current().state.status, "idle");
});

test("another model's transfer never shows as this model's progress", async (t) => {
  const h = await mount(t);
  const b = deferred();
  h.status.set("model-b", b);
  await h.render("model-b");
  await React.act(async () => b.resolve({ downloaded: false }));
  await h.emit({
    type: "progress",
    model: "model-c",
    percentage: 60,
    downloaded_bytes: 6e8,
    total_bytes: 1e9,
  });
  assert.equal(h.current().state.status, "idle");
});

test("a confirmed cancel leaves a restart path, not a dead idle", async (t) => {
  const h = await mount(t);
  const b = deferred();
  h.status.set("model-b", b);
  await h.render("model-b");
  await React.act(async () => b.resolve({ downloaded: false }));
  await React.act(async () => h.current().start());
  await h.emit({
    type: "progress",
    model: "model-b",
    percentage: 42,
    downloaded_bytes: 265e6,
    total_bytes: 631e6,
  });
  assert.equal(h.current().state.status, "downloading");
  await React.act(async () => h.current().cancel());
  await h.emit({
    type: "error",
    model: "model-b",
    error: "Download cancelled",
    code: "DOWNLOAD_CANCELLED",
  });
  await h.settle({
    success: false,
    model: "model-b",
    downloaded: false,
    error: "Download cancelled",
    code: "DOWNLOAD_CANCELLED",
  });
  assert.equal(h.current().state.status, "cancelled");
  assert.deepEqual(
    h.calls.map(([name]) => name),
    ["download", "cancel"]
  );
});

test("kept progress is claimed only when main reports kept bytes", async (t) => {
  const h = await mount(t);
  const b = deferred();
  h.status.set("model-b", b);
  await h.render("model-b");
  await React.act(async () => b.resolve({ downloaded: false }));
  await React.act(async () => h.current().start());
  await h.emit({
    type: "progress",
    model: "model-b",
    percentage: 42,
    downloaded_bytes: 265e6,
    total_bytes: 631e6,
  });
  await h.emit({
    type: "error",
    model: "model-b",
    error: "The connection was reset.",
    code: "ECONNRESET",
    keptBytes: 265e6,
  });
  await h.settle({
    success: false,
    model: "model-b",
    downloaded: false,
    error: "The connection was reset.",
    code: "ECONNRESET",
    keptBytes: 265e6,
  });
  assert.deepEqual(
    [h.current().state.status, h.current().state.percent, h.current().state.progressKept],
    ["error", 42, true]
  );
});

test("late status for an earlier selection cannot replace the selected model", async (t) => {
  const h = await mount(t);
  const a = deferred(),
    b = deferred();
  h.status.set("a", a);
  h.status.set("b", b);
  await h.render("a");
  await h.render("b");
  await React.act(async () => a.resolve({ downloaded: true }));
  assert.equal(h.current().state.status, "checking");
  await React.act(async () => b.resolve({ downloaded: false }));
  assert.equal(h.current().state.status, "idle");
});

test("returning to a model checks anew and rejects the earlier same-model response", async (t) => {
  const h = await mount(t);
  const oldA = deferred(),
    newA = deferred();
  h.status.set("a", oldA);
  await h.render("a");
  await h.render("b");
  h.status.set("a", newA);
  await h.render("a");
  await React.act(async () => oldA.resolve({ downloaded: true }));
  assert.equal(h.current().state.status, "checking");
  await React.act(async () => newA.resolve({ downloaded: false }));
  assert.equal(h.current().state.status, "idle");
});

test("terminal refresh stays pending until disk status settles and rejects the older check", async (t) => {
  const h = await mount(t);
  const initial = deferred(),
    completed = deferred();
  h.status.set("a", initial);
  await h.render("a");
  await React.act(async () => h.current().start());
  h.status.set("a", completed);
  await h.emit({ type: "complete", model: "a", sequence: 2 });
  await h.settle({ success: true, downloaded: true, model: "a" });
  assert.equal(h.modelEvents.length, 1, "real hook announces the completed local model");
  assert.equal(
    h.current().state.status,
    "downloading",
    "Plan02 keeps entry through status refresh"
  );
  await React.act(async () => completed.resolve({ downloaded: true }));
  assert.equal(h.current().state.status, "ready");
  await React.act(async () => initial.resolve({ downloaded: false }));
  assert.equal(h.current().state.status, "ready");
});

test("a refused cancellation leaves the active transfer; acknowledgement is required", async (t) => {
  const ack = deferred();
  const h = await mount(t, { cancelResult: ack.promise });
  const a = deferred();
  h.status.set("a", a);
  await h.render("a");
  await React.act(async () => a.resolve({ downloaded: false }));
  await React.act(async () => h.current().start());
  let cancelling;
  await React.act(async () => {
    cancelling = h.current().cancel();
  });
  assert.equal(h.current().state.status, "cancelling");
  await React.act(async () => {
    ack.resolve({ success: false });
    await cancelling;
  });
  assert.equal(h.current().state.status, "downloading");
});

test("confirmed cancellation survives a terminal arriving before the acknowledgement and permits restart", async (t) => {
  const ack = deferred();
  const h = await mount(t, { cancelResult: ack.promise });
  const a = deferred();
  h.status.set("a", a);
  await h.render("a");
  await React.act(async () => a.resolve({ downloaded: false }));
  await React.act(async () => h.current().start());
  let cancelling;
  await React.act(async () => {
    cancelling = h.current().cancel();
  });
  await h.emit({
    type: "error",
    model: "a",
    code: "DOWNLOAD_CANCELLED",
    error: "Download cancelled",
    keptBytes: 0,
  });
  await h.settle({ success: false, code: "DOWNLOAD_CANCELLED", error: "Download cancelled" });
  assert.equal(h.current().state.status, "cancelling", "no idle flash before main acknowledges");
  await React.act(async () => {
    ack.resolve({ success: true });
    await cancelling;
  });
  assert.equal(h.current().state.status, "cancelled");
  await React.act(async () => h.current().start());
  assert.equal(h.current().state.status, "downloading");
  assert.equal(h.calls.filter(([name]) => name === "download").length, 2);
});

test("a retry resets rate, milestone and main's prior retained-byte evidence", async (t) => {
  const h = await mount(t);
  const a = deferred();
  h.status.set("a", a);
  await h.render("a");
  await React.act(async () => a.resolve({ downloaded: false }));
  await React.act(async () => h.current().start());
  await h.emit({
    type: "progress",
    model: "a",
    percentage: 80,
    downloaded_bytes: 800,
    total_bytes: 1000,
  });
  assert.equal(h.current().milestone, 75);
  await h.emit({ type: "error", model: "a", error: "reset", keptBytes: 800 });
  await h.settle({ success: false, error: "reset" });
  assert.equal(h.current().state.progressKept, true);
  await React.act(async () => h.current().start());
  assert.equal(h.current().milestone, null);
  assert.equal(h.current().state.bytesPerSecond, null);
  await h.emit({ type: "error", model: "a", error: "HTTP 404" });
  await h.settle({ success: false, error: "HTTP 404" });
  assert.equal(
    h.current().state.progressKept,
    null,
    "a fresh failed attempt without main byte evidence is unknown"
  );
  assert.equal(h.current().state.percent, 0);
});

test("retained progress, cancellation and milestones never migrate to another model", async (t) => {
  const h = await mount(t);
  const a = deferred(),
    b = deferred();
  h.status.set("a", a);
  h.status.set("b", b);
  await h.render("a");
  await React.act(async () => a.resolve({ downloaded: false }));
  await React.act(async () => h.current().start());
  await h.emit({
    type: "progress",
    model: "a",
    percentage: 80,
    downloaded_bytes: 800,
    total_bytes: 1000,
  });
  await h.emit({ type: "error", model: "a", error: "reset", keptBytes: 800 });
  await h.settle({ success: false, error: "reset" });
  await h.render("b");
  assert.deepEqual(h.current().state, { status: "checking" });
  assert.equal(h.current().milestone, null);
  await React.act(async () => b.resolve({ downloaded: false }));
  await React.act(async () => h.current().start());
  await h.emit({ type: "error", model: "b", error: "HTTP 404", keptBytes: 0 });
  await h.settle({ success: false, error: "HTTP 404" });
  assert.equal(h.current().state.progressKept, false);
  assert.equal(h.current().state.percent, 0);
});

test("real hook subscriptions fan out and both dispose on unmount", async (t) => {
  const h = await mount(t);
  await h.render("a");
  assert.equal(h.progress.size(), 2);
  await h.unmount();
  assert.equal(h.progress.size(), 0);
  h.progress.emit({}, { type: "error", model: "a", keptBytes: 800 });
});

test("missing preload support cannot report readiness", async (t) => {
  const h = await mount(t, { unsupported: true });
  await h.render("a");
  assert.notEqual(h.current().state.status, "ready");
  await React.act(async () => h.current().cancel());
  assert.notEqual(h.current().state.status, "cancelled");
});

test("an active rate ages to unknown without progress events and its timer disposes", async (t) => {
  const h = await mount(t);
  const a = deferred();
  h.status.set("a", a);
  await h.render("a");
  await React.act(async () => a.resolve({ downloaded: false }));
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 100000 });
  await React.act(async () => h.current().start());
  await React.act(async () => t.mock.timers.tick(1000));
  await h.emit({
    type: "progress",
    model: "a",
    percentage: 8,
    downloaded_bytes: 8e6,
    total_bytes: 100e6,
  });
  assert.equal(h.current().state.bytesPerSecond, 8e6);
  for (let i = 0; i < 6; i++) await React.act(async () => t.mock.timers.tick(1000));
  assert.equal(h.current().state.bytesPerSecond, null);
  assert.equal(h.current().state.etaSeconds, null);
  await h.unmount();
  await React.act(async () => t.mock.timers.tick(10000));
});

test("stale sequenced progress cannot erase main's terminal retained-byte evidence", async (t) => {
  const h = await mount(t);
  const a = deferred();
  h.status.set("a", a);
  await h.render("a");
  await React.act(async () => a.resolve({ downloaded: false }));
  await React.act(async () => h.current().start());
  await h.emit({
    type: "progress",
    model: "a",
    percentage: 42,
    downloaded_bytes: 420,
    total_bytes: 1000,
    sequence: 10,
  });
  await h.emit({ type: "error", model: "a", error: "reset", keptBytes: 420, sequence: 11 });
  await h.emit({
    type: "progress",
    model: "a",
    percentage: 10,
    downloaded_bytes: 100,
    total_bytes: 1000,
    sequence: 9,
  });
  await h.settle({ success: false, error: "reset" });
  assert.equal(h.current().state.status, "error");
  assert.equal(h.current().state.progressKept, true);
  assert.equal(h.current().state.percent, 42);
});

for (const offSelectionTerminal of [true, false]) {
  test(`retained A survives ${offSelectionTerminal ? "an off-selection terminal and stale progress" : "B starting and failing"} before returning to A`, async (t) => {
    const h = await mount(t);
    const a = deferred(),
      b = deferred();
    h.status.set("a", a);
    h.status.set("b", b);
    await h.render("a");
    await React.act(async () => a.resolve({ downloaded: false }));
    await React.act(async () => h.current().start());
    await h.emit({
      type: "progress",
      model: "a",
      percentage: 42,
      downloaded_bytes: 420,
      total_bytes: 1000,
      sequence: 10,
    });
    if (offSelectionTerminal) {
      await h.render("b");
      await React.act(async () => b.resolve({ downloaded: false }));
    }
    await h.emit({
      type: "error",
      model: "a",
      error: "reset A",
      code: "ECONNRESET",
      keptBytes: 420,
      sequence: 11,
    });
    await h.settle({
      success: false,
      model: "a",
      error: "reset A",
      code: "ECONNRESET",
      keptBytes: 420,
    });
    if (offSelectionTerminal) {
      assert.deepEqual(h.current().state, { status: "idle" }, "A's error never displays on B");
      await h.emit({
        type: "progress",
        model: "a",
        percentage: 10,
        downloaded_bytes: 100,
        total_bytes: 1000,
        sequence: 9,
      });
    } else {
      assert.equal(h.current().state.progressKept, true);
      await h.render("b");
      await React.act(async () => b.resolve({ downloaded: false }));
      await React.act(async () => h.current().start());
      await h.emit({
        type: "progress",
        model: "b",
        percentage: 70,
        downloaded_bytes: 700,
        total_bytes: 1000,
        sequence: 20,
      });
      await h.emit({ type: "error", model: "b", error: "HTTP 404 B", keptBytes: 0, sequence: 21 });
      await h.settle({ success: false, model: "b", error: "HTTP 404 B" });
      assert.equal(h.current().state.progressKept, false);
    }
    const returnedA = deferred();
    h.status.set("a", returnedA);
    await h.render("a");
    await React.act(async () => returnedA.resolve({ downloaded: false }));
    assert.equal(h.current().state.status, "error");
    assert.equal(h.current().state.progressKept, true, "A retains its own main attestation");
    assert.equal(h.current().state.percent, 42, "B cannot overwrite A's last percentage");
    await React.act(async () => h.current().start());
    await h.emit({ type: "error", model: "a", error: "new A failure", sequence: 12 });
    await h.settle({ success: false, model: "a", error: "new A failure" });
    assert.equal(
      h.current().state.progressKept,
      null,
      "only A's admitted retry resets its evidence to unknown"
    );
    assert.equal(h.current().state.percent, 0);
  });
}

for (const initialPercent of [0, 10, 50]) {
  test(`a new observed attempt at ${initialPercent}% cannot expose the failed attempt's milestone in any render`, async (t) => {
    const h = await mount(t);
    const status = deferred();
    h.status.set("a", status);
    await h.render("a");
    await React.act(async () => status.resolve({ downloaded: false }));
    t.mock.timers.enable({ apis: ["Date"], now: 100000 });
    let sequence = 0;
    const progress = async (percentage) => {
      t.mock.timers.tick(101);
      await h.emit({
        type: "progress",
        model: "a",
        percentage,
        downloaded_bytes: percentage * 10,
        total_bytes: 1000,
        sequence: ++sequence,
      });
    };
    await React.act(async () => h.current().start());
    await progress(80);
    const previousId = h.current().transferId;
    assert.equal(h.current().milestone, 75);
    await h.emit({
      type: "error",
      model: "a",
      error: "reset",
      keptBytes: 800,
      sequence: ++sequence,
    });
    await h.settle({ success: false, error: "reset", keptBytes: 800 });
    assert.equal(h.current().state.status, "error");

    // A different owner restarted the model. Only the typed progress listener
    // creates this active entry; do not call this hook's start() again.
    const renderStart = h.renders.length;
    await progress(initialPercent);
    const expectedMilestone = initialPercent >= 50 ? 50 : null;
    assert.equal(h.current().state.status, "downloading");
    assert.equal(h.current().state.percent, initialPercent);
    assert.equal(h.current().transferId, previousId + 1);
    const newAttemptRenders = h.renders
      .slice(renderStart)
      .filter((r) => r.transferId === previousId + 1);
    assert.ok(newAttemptRenders.length > 0);
    assert.deepEqual(
      [...new Set(newAttemptRenders.map((r) => r.milestone))],
      [expectedMilestone],
      "identity and recomputed milestone must agree even before effects settle"
    );
    if (initialPercent < 25) {
      await progress(10);
      assert.equal(h.current().milestone, null);
      for (const percent of [25, 50, 75]) {
        await progress(percent);
        assert.equal(h.current().milestone, percent);
      }
    }
    assert.equal(h.calls.filter(([name]) => name === "download").length, 1);
  });
}

test("startup restoration computes the observed attempt's milestone without an explicit start", async (t) => {
  const h = await mount(t, {
    activeDownloads: [
      {
        modelType: "parakeet",
        modelId: "a",
        phase: "downloading",
        progress: 60,
        downloadedBytes: 600,
        totalBytes: 1000,
        sequence: 10,
      },
    ],
  });
  await h.render("a");
  assert.equal(h.current().state.status, "downloading");
  assert.equal(h.current().transferId, 1);
  assert.equal(h.current().milestone, 50);
  assert.deepEqual(h.calls, []);
});

test("cancel ACK pending + intervening model switch + late A success never readies B or retargets cancellation", async (t) => {
  const ack = deferred();
  const h = await mount(t, { cancelResult: ack.promise });
  const a = deferred(),
    b = deferred();
  h.status.set("a", a);
  h.status.set("b", b);
  await h.render("a");
  await React.act(async () => a.resolve({ downloaded: false }));
  await React.act(async () => h.current().start());
  let cancel;
  await React.act(async () => {
    cancel = h.current().cancel();
  });
  assert.equal(h.current().state.status, "cancelling");
  await h.render("b");
  await React.act(async () => b.resolve({ downloaded: false }));
  await h.emit({ type: "complete", model: "a", sequence: 10 });
  await h.settle({ success: true, downloaded: true });
  await React.act(async () => {
    ack.resolve({ success: true });
    await cancel;
  });
  assert.equal(h.current().state.status, "idle");
  assert.equal(h.calls.filter(([kind]) => kind === "cancel").length, 1);
  assert.deepEqual(
    h.calls.filter(([kind]) => kind === "download"),
    [["download", "a"]]
  );
  await React.act(async () => h.current().start());
  assert.deepEqual(
    h.calls.filter(([kind]) => kind === "download"),
    [
      ["download", "a"],
      ["download", "b"],
    ]
  );
});

test("accepted cancellation with failed cleanup preserves main bytes/unknown instead of saying nothing was kept", async (t) => {
  for (const keptBytes of [400, null]) {
    const h = await mount(t);
    const a = deferred();
    h.status.set("a", a);
    await h.render("a");
    await React.act(async () => a.resolve({ downloaded: false }));
    await React.act(async () => h.current().start());
    await h.emit({
      type: "progress",
      model: "a",
      percentage: 40,
      downloaded_bytes: 400,
      total_bytes: 1000,
    });
    await React.act(async () => h.current().cancel());
    await h.emit({
      type: "error",
      model: "a",
      code: "DOWNLOAD_CANCELLED",
      error: "Download cancelled",
      keptBytes,
      cleanupFailed: true,
    });
    await h.settle({
      success: false,
      error: "Download cancelled",
      code: "DOWNLOAD_CANCELLED",
      keptBytes,
      cleanupFailed: true,
    });
    assert.equal(h.current().state.status, "error");
    assert.equal(h.current().state.message, "setupFlow.download.cleanupFailed");
    assert.equal(h.current().state.progressKept, keptBytes === null ? null : true);
    await h.unmount();
  }
});
