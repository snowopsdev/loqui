const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");

const profile = (patch = {}) => ({
  locales: ["en-US"],
  totalMemoryBytes: 16 * 1024 ** 3,
  freeDiskBytes: 212e9,
  gpu: { kind: "apple-silicon", name: null },
  ...patch,
});

async function voice(t, patch = {}) {
  const { detectVoice } = await import("../../src/utils/onboardingDetection.ts");
  const p = patch.profile ?? profile();
  const pick = detectVoice(p);
  const events = [];
  const ui = await mountComponent(t, "/components/onboarding/VoiceStep.tsx", {
    exportName: "VoiceStep",
    props: {
      platform: "darwin",
      profile: p,
      pick,
      selectedModel: pick.modelId,
      onSelectModel: (id) => events.push(["select", id]),
      language: p.locales[0] ?? "en-US",
      onLanguageChange: (language) => events.push(["language", language]),
      languageLocked: false,
      compatible: pick.modelId !== null,
      blockedId: "onb-voice-blocked",
      download: { status: "idle" },
      onStartDownload: () => events.push(["start"]),
      onCancelDownload: () => events.push(["cancel"]),
      ...patch.props,
    },
  });
  return { ui, events };
}

test("says what it noticed and why it picked this voice", async (t) => {
  const { ui } = await voice(t);
  expectKey(ui, "setupFlow.voice.title");
  expectKey(ui, "setupFlow.voice.why.englishMac");
  assert.equal(ui.findAll((node) => node.attributes.class === "onb-signal").length, 4);
  expectKey(ui, "setupFlow.voice.gpu.appleSilicon");
  expectKey(ui, "setupFlow.voice.outcomes.fastEnglish.name");
  assert.ok(
    ui.text().includes("Parakeet Unified EN 0.6B"),
    "the catalog name stays one glance away"
  );
  assert.equal(ui.byAttr("data-locality", "device").length, 1);
  assert.equal(ui.byAttr("role", "radiogroup").length, 0, "the picker starts closed");
});

test("a short disk is said before the download, with real numbers", async (t) => {
  const { ui } = await voice(t, { profile: profile({ freeDiskBytes: 412e6 }) });
  const [note] = ui.byAttr("role", "note");
  assert.ok(note.textContent.includes("setupFlow.voice.diskShort"));
  assert.ok(note.textContent.includes("412"));
});

test("an unsupported language opens the picker and names the block", async (t) => {
  const { ui } = await voice(t, {
    profile: profile({ locales: ["he-IL"] }),
    props: { compatible: false },
  });
  expectKey(ui, "setupFlow.voice.unsupportedTitle");
  assert.equal(ui.byAttr("role", "radiogroup").length, 1);
  assert.ok(
    ui.byAttr("id", "onb-voice-blocked")[0].textContent.includes("setupFlow.voice.blocked.none")
  );
});

test("the picker lists every voice and blocks the ones that can't hear you", async (t) => {
  const { ui, events } = await voice(t, { props: { language: "ja-JP" } });
  await ui.click(ui.byAttr("aria-expanded", "false")[0]);
  const radios = ui.byAttr("role", "radio");
  assert.equal(radios.length, 5);
  for (const name of [
    "Orukeet",
    "Parakeet TDT 0.6B",
    "Parakeet Unified EN 0.6B",
    "Nemotron Speech Streaming EN 0.6B",
    "Nemotron 3.5 ASR Streaming 0.6B",
  ]) {
    assert.ok(ui.text().includes(name), name);
  }
  assert.equal(
    radios.find((r) => r.attributes["data-value"] === "parakeet-unified-en-0.6b").attributes[
      "aria-disabled"
    ],
    "true"
  );
  await ui.click(
    radios.find((r) => r.attributes["data-value"] === "nemotron-3.5-asr-streaming-0.6b")
  );
  assert.deepEqual(events, [["select", "nemotron-3.5-asr-streaming-0.6b"]]);
});

test("while a transfer runs, voice and language are locked with a reason, and Cancel is right there", async (t) => {
  const busy = {
    status: "downloading",
    percent: 42,
    downloadedBytes: 264e6,
    totalBytes: 631e6,
    bytesPerSecond: 8e6,
    etaSeconds: 46,
  };
  const { ui, events } = await voice(t, { props: { download: busy, languageLocked: true } });
  await ui.click(ui.byAttr("aria-expanded", "false")[0]);
  assert.ok(
    ui.byAttr("role", "radio").every((radio) => radio.attributes["aria-disabled"] === "true")
  );
  assert.ok(
    "disabled" in ui.findAll((node) => node.tagName === "FIELDSET")[0].attributes,
    "language is locked (I03)"
  );
  expectKey(ui, "setupFlow.voice.languageLocked");
  assert.equal(ui.byAttr("role", "progressbar")[0].attributes["aria-valuenow"], "42");
  expectKey(ui, "setupFlow.download.received");
  await ui.click("setupFlow.download.cancel");
  assert.deepEqual(events, [["cancel"]]);
});

test("a stopped download says whether its progress was kept, and offers Retry", async (t) => {
  const { ui, events } = await voice(t, {
    props: {
      download: { status: "error", message: "Network timeout", percent: 42, progressKept: true },
    },
  });
  expectKey(ui, "setupFlow.download.stoppedKept", { percent: 42 });
  await ui.rerender({
    download: { status: "error", message: "HTTP 404", percent: 42, progressKept: false },
  });
  expectKey(ui, "setupFlow.download.stoppedRestart", { percent: 42 });
  await ui.click("setupFlow.download.retry");
  assert.deepEqual(events, [["start"]]);
});

test("the footer chip truncates, says what happened, and restarts a cancelled download", async (t) => {
  const started = [];
  const ui = await mountComponent(t, "/components/onboarding/DownloadChip.tsx", {
    exportName: "DownloadChip",
    props: {
      state: {
        status: "downloading",
        percent: 42,
        downloadedBytes: 1,
        totalBytes: 2,
        bytesPerSecond: 8e6,
        etaSeconds: 46,
      },
      onStart: () => started.push(1),
    },
  });
  expectKey(ui, "setupFlow.download.chip", { percent: 42 });
  await ui.rerender({
    state: {
      status: "downloading",
      percent: 42,
      downloadedBytes: 1,
      totalBytes: 2,
      bytesPerSecond: null,
      etaSeconds: null,
    },
  });
  expectKey(ui, "setupFlow.download.chipNoEta", { percent: 42 });
  await ui.rerender({ state: { status: "cancelled" } });
  await ui.click("setupFlow.download.downloadAgain");
  assert.deepEqual(started, [1]);
  await ui.rerender({ state: { status: "idle" } });
  assert.equal(ui.byAttr("data-status").length, 0);
});

test("every spoken language participates in the picker compatibility check", async (t) => {
  const { ui, events } = await voice(t, { props: { spokenLanguages: ["en-US", "ja-JP"] } });
  await ui.click(ui.byAttr("aria-expanded", "false")[0]);
  const radios = ui.byAttr("role", "radio");
  assert.equal(
    radios.find((r) => r.attributes["data-value"] === "parakeet-unified-en-0.6b").attributes[
      "aria-disabled"
    ],
    "true"
  );
  assert.equal(
    radios.find((r) => r.attributes["data-value"] === "orukeet-v0.1.0").attributes["aria-disabled"],
    "true"
  );
  expectKey(ui, "setupFlow.voice.cantHear", { language: "Japanese" });
  await ui.click(radios.find((r) => r.attributes["data-value"] === "orukeet-v0.1.0"));
  assert.deepEqual(events, []);
  await ui.click(
    radios.find((r) => r.attributes["data-value"] === "nemotron-3.5-asr-streaming-0.6b")
  );
  assert.deepEqual(events, [["select", "nemotron-3.5-asr-streaming-0.6b"]]);
});
