const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");
const { listenerBus } = require("../helpers/harness/listenerBus");

const MODEL = "parakeet-unified-en-0.6b";
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

// Mounts the real flow on Voice with an English profile, so the pick is MODEL.
async function mountVoice(t, { cancelResult = { success: true } } = {}) {
  const progress = listenerBus();
  let installed = false;
  const pending = [];
  const counts = { cancels: 0 };
  const ui = await mountComponent(t, "/components/OnboardingFlow.tsx", {
    props: {
      onComplete() {},
      initialStep: "speech",
      previewConfig: { step: "speech", scenario: "fresh", platform: "linux" },
    },
    mocks: { "/SettingsPage": "export default function SettingsPage() { return null; }" },
    api: {
      getSystemProfile: async () => ({
        locales: ["en-US"],
        freeDiskBytes: 5e11,
        gpu: { kind: "unknown", name: null },
      }),
      getTotalMemory: async () => 16e9,
      checkParakeetModelStatus: async () => ({
        success: true,
        model: MODEL,
        downloaded: installed,
      }),
      modelGetActiveDownloads: async () => [],
      onParakeetDownloadProgress: progress.subscribe,
      downloadParakeetModel: () => {
        const request = deferred();
        pending.push(request);
        return request.promise;
      },
      cancelParakeetDownload: async () => (counts.cancels++, cancelResult),
    },
  });
  const settle = () => React.act(async () => {});
  await settle();
  return {
    ui,
    counts,
    settle,
    install: () => (installed = true),
    emit: (data) => React.act(async () => progress.emit({}, { model: MODEL, ...data })),
    resolve: (result) =>
      React.act(async () => pending.shift().resolve({ model: MODEL, ...result })),
    // Download from Voice, then come back to it: the panel shows the transfer.
    async startAndReturn() {
      await ui.click(ui.byAttr("data-onb-primary")[0]);
      await ui.click("setupFlow.back");
    },
  };
}

const progressbar = (ui) => ui.byAttr("role", "progressbar")[0] ?? null;
const PROGRESS = {
  type: "progress",
  percentage: 42,
  downloaded_bytes: 265_000_000,
  total_bytes: 631_000_000,
};

test("Voice shows the real download percentage as a progressbar", async (t) => {
  const v = await mountVoice(t);
  await v.startAndReturn();
  await v.emit(PROGRESS);
  assert.equal(progressbar(v.ui).attributes["aria-valuenow"], "42");
  assert.equal(
    v.ui.findAll((node) => /\banimate-pulse\b/.test(node.attributes.class ?? "")).length,
    0,
    "no fake bar"
  );
});

test("a download in flight follows the user to later steps as a footer chip", async (t) => {
  const v = await mountVoice(t);
  await v.startAndReturn();
  await v.emit(PROGRESS);
  await v.ui.click(v.ui.byAttr("data-onb-primary")[0]); // Continue → Say something
  await v.ui.click("setupFlow.skipStep"); // → Cleanup
  // One sample cannot establish a rate, so there is no ETA yet (the chip never invents one).
  expectKey(v.ui, "setupFlow.download.chipNoEta", { percent: 42 });
});

test("a confirmed cancel leaves Download again, and a late result cannot mark it failed", async (t) => {
  const v = await mountVoice(t);
  await v.startAndReturn();
  await v.emit(PROGRESS);
  await v.ui.click("setupFlow.download.cancel");
  assert.equal(v.counts.cancels, 1);
  await v.emit({ type: "error", error: "Download cancelled", code: "DOWNLOAD_CANCELLED" });
  await v.resolve({
    success: false,
    downloaded: false,
    error: "cancelled",
    code: "DOWNLOAD_CANCELLED",
  });
  expectKey(v.ui, "setupFlow.download.cancelledLine");
  assert.equal(v.ui.text().includes("setupFlow.download.stoppedRestart"), false);
  assert.equal(progressbar(v.ui), null);
  assert.ok(
    v.ui.findAll(
      (node) =>
        node.tagName === "BUTTON" && node.textContent.includes("setupFlow.download.downloadAgain")
    ).length >= 1
  );
});

test("a cancel main refuses keeps the download and its result", async (t) => {
  const v = await mountVoice(t, {
    cancelResult: { success: false, code: "INSTALLATION_IN_PROGRESS" },
  });
  await v.startAndReturn();
  await v.emit({ ...PROGRESS, percentage: 99 });
  await v.ui.click("setupFlow.download.cancel");
  assert.equal(v.counts.cancels, 1);
  assert.ok(progressbar(v.ui), "the transfer is still shown");
  v.install();
  await v.emit({ type: "complete" });
  await v.resolve({ success: true, downloaded: true });
  await v.settle();
  expectKey(v.ui, "setupFlow.voice.installed");
});

test("the download cannot be restarted until the cancelled request settles", async (t) => {
  const v = await mountVoice(t);
  await v.startAndReturn();
  await v.emit(PROGRESS);
  await v.ui.click("setupFlow.download.cancel");
  const again = () =>
    v.ui.findAll(
      (node) =>
        node.tagName === "BUTTON" && node.textContent.includes("setupFlow.download.downloadAgain")
    );
  assert.equal(again().length, 0, "still cancelling");
  assert.ok("disabled" in v.ui.byAttr("data-onb-primary")[0].attributes);
  await v.emit({ type: "error", error: "Download cancelled", code: "DOWNLOAD_CANCELLED" });
  await v.resolve({
    success: false,
    downloaded: false,
    error: "cancelled",
    code: "DOWNLOAD_CANCELLED",
  });
  assert.ok(again().length >= 1);
  assert.equal("disabled" in v.ui.byAttr("data-onb-primary")[0].attributes, false);
});
