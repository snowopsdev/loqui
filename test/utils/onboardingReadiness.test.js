const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingReadiness.ts");
const route = (id, patch = {}) => ({
  id,
  kind: id.endsWith("Stt") ? "speech" : "text",
  locality: "device",
  provider: null,
  providerId: null,
  host: null,
  model: id === "dictationStt" ? "Parakeet Unified EN 0.6B" : null,
  state: { status: "ready" },
  sends: null,
  settingsPath:
    id === "noteRecordingStt"
      ? "stt/noteRecording"
      : id === "dictationStt"
        ? "stt/dictation"
        : "llms/dictationCleanup",
  ...patch,
});
const input = (patch = {}) => ({
  speechRoute: route("dictationStt"),
  noteRoute: route("noteRecordingStt"),
  localVoiceActive: true,
  voiceDownload: "ready",
  microphone: "granted",
  micHeard: true,
  trialSucceeded: true,
  platform: "darwin",
  accessibilityGranted: true,
  shortcutProven: true,
  shortcutLabel: "fn",
  activationMode: "tap",
  cleanupChoice: "none",
  cleanupStatus: "skipped",
  cleanupRoute: route("dictationCleanup", { state: { status: "off" } }),
  cleanupProviderLabel: "OpenAI",
  ...patch,
});
const statuses = (summary) => summary.rows.map((row) => [row.key, row.status]);

test("everything proven: ready, with cleanup off as optional, in the agreed order", async () => {
  const { summarizeReadiness } = await load();
  const summary = summarizeReadiness(input());
  assert.deepEqual(statuses(summary), [
    ["speech", "ready"],
    ["microphone", "ready"],
    ["shortcut", "ready"],
    ["cleanup", "optional"],
  ]);
  assert.deepEqual([summary.pending, summary.proven, summary.allLocal], [0, true, true]);
});

test("set up but never tried is configured, not ready (I07)", async () => {
  const { summarizeReadiness } = await load();
  const summary = summarizeReadiness(
    input({ trialSucceeded: false, micHeard: false, shortcutProven: false })
  );
  assert.deepEqual(statuses(summary).slice(0, 3), [
    ["speech", "configured"],
    ["microphone", "configured"],
    ["shortcut", "configured"],
  ]);
  assert.deepEqual([summary.pending, summary.proven], [0, false]);
});

test("a microphone counts as working only once it was heard (I07)", async () => {
  const { summarizeReadiness } = await load();
  assert.equal(
    summarizeReadiness(input({ trialSucceeded: false, micHeard: true })).rows[1].status,
    "ready"
  );
  assert.equal(
    summarizeReadiness(input({ trialSucceeded: false, micHeard: false })).rows[1].detail,
    "microphone.allowed"
  );
  assert.equal(
    summarizeReadiness(input({ microphone: "unknown", trialSucceeded: false, micHeard: false }))
      .rows[1].status,
    "pending"
  );
});

test("unknown Accessibility on macOS is pending, never ready (I07)", async () => {
  const { summarizeReadiness } = await load();
  const unknown = summarizeReadiness(input({ accessibilityGranted: null, shortcutProven: false }));
  assert.deepEqual(
    [unknown.rows[2].status, unknown.rows[2].detail],
    ["pending", "shortcut.checkAccessibility"]
  );
  const linux = summarizeReadiness(
    input({ platform: "linux", accessibilityGranted: null, shortcutProven: false })
  );
  assert.equal(linux.rows[2].status, "configured");
});

test("pending rows name what is missing and where it is fixed", async () => {
  const { summarizeReadiness } = await load();
  const summary = summarizeReadiness(
    input({
      speechRoute: route("dictationStt", { state: { status: "needsModel" } }),
      localVoiceActive: false,
      voiceDownload: "downloading",
      microphone: "denied",
      micHeard: false,
      trialSucceeded: false,
      accessibilityGranted: false,
      shortcutProven: false,
    })
  );
  assert.deepEqual(
    summary.rows.slice(0, 3).map((row) => [row.status, row.detail, row.step]),
    [
      ["pending", "speech.downloading", "speech"],
      ["pending", "microphone.denied", "welcome"],
      ["pending", "shortcut.needsAccessibility", "shortcuts"],
    ]
  );
  assert.equal(summary.pending, 3);
});

test("Ready waits for a ready route: unknown reads Checking…, never ready (§5.1 rule 1)", async () => {
  const { summarizeReadiness } = await load();
  const unknown = summarizeReadiness(
    input({ speechRoute: route("dictationStt", { state: { status: "unknown" } }) })
  );
  assert.deepEqual(
    [unknown.rows[0].status, unknown.rows[0].detail, unknown.proven],
    ["pending", "speech.checking", false]
  );
  const justInstalled = summarizeReadiness(
    input({
      speechRoute: route("dictationStt", { state: { status: "needsModel" } }),
      localVoiceActive: true,
    })
  );
  assert.deepEqual(
    [justInstalled.rows[0].status, justInstalled.rows[0].detail],
    ["pending", "speech.checking"],
    "a finished download still waits for the route"
  );
  const cleanupUnknown = summarizeReadiness(
    input({
      cleanupChoice: "local",
      cleanupStatus: "ready",
      cleanupRoute: route("dictationCleanup", { state: { status: "unknown" } }),
    })
  );
  assert.deepEqual(
    [cleanupUnknown.rows[3].status, cleanupUnknown.rows[3].detail],
    ["pending", "cleanup.checking"]
  );
});

// Plan 07 fix round 1 (I1): Ready stays only for a ready dictation route; a
// local engine main attests unavailable while sealed says so, with its fix.
test("Sealed mode's attested native unavailability is pending with its own words, never ready", async () => {
  const { summarizeReadiness } = await load();
  const state = { status: "unreachable", detail: "nativeUnavailable" };
  const summary = summarizeReadiness(
    input({
      speechRoute: route("dictationStt", { state }),
      cleanupChoice: "local",
      cleanupStatus: "ready",
      cleanupRoute: route("dictationCleanup", { state }),
    })
  );
  assert.deepEqual(
    [summary.rows[0].status, summary.rows[0].detail, summary.rows[0].settingsPath, summary.proven],
    ["pending", "speech.nativeUnavailable", "stt/dictation", false]
  );
  assert.deepEqual(
    [summary.rows[3].status, summary.rows[3].detail],
    ["pending", "cleanup.nativeUnavailable"]
  );
  const { cleanupSituation } = await import("../../src/utils/onboardingCleanupPreview.ts");
  assert.equal(
    cleanupSituation("local", "ready", route("dictationCleanup", { state })),
    "nativeUnavailable"
  );
});

test("a chosen but unavailable cleanup is pending with a real Settings destination (I05)", async () => {
  const { summarizeReadiness } = await load();
  const summary = summarizeReadiness(input({ cleanupChoice: "provider", cleanupStatus: "failed" }));
  const row = summary.rows[3];
  assert.deepEqual(
    [row.status, row.detail, row.values, row.settingsPath],
    ["pending", "cleanup.needsKey", { provider: "OpenAI" }, "llms/dictationCleanup"]
  );
  assert.equal(summary.pending, 1);
  const remote = summarizeReadiness(
    input({
      cleanupChoice: "provider",
      cleanupStatus: "ready",
      cleanupRoute: route("dictationCleanup", { locality: "remote", providerId: "openai" }),
    })
  );
  assert.deepEqual([remote.rows[3].status, remote.allLocal], ["configured", false]);
});

test("the all-local claim includes the note route independently of dictation and cleanup", async () => {
  const { summarizeReadiness } = await load();
  for (const locality of ["device", "remote", "network", "unknown"]) {
    const summary = summarizeReadiness(
      input({ noteRoute: route("noteRecordingStt", { locality }) })
    );
    assert.deepEqual([summary.pending, summary.proven], [0, true], "dictation remains proven");
    assert.equal(summary.allLocal, locality === "device", locality);
  }
});

test("the note action follows its own route and the microphone (I06)", async () => {
  const { noteActionState } = await load();
  const note = (patch = {}, extra = {}) =>
    noteActionState({ route: route("noteRecordingStt", patch), microphone: "granted", ...extra });
  assert.deepEqual(note(), {
    status: "ready",
    block: null,
    locality: "device",
    providerId: null,
    model: null,
    settingsPath: "stt/noteRecording",
  });
  assert.equal(
    note({ state: { status: "unreachable", detail: "unsupported" } }).block,
    "unsupported",
    "§5.1 rule 9: self-hosted notes"
  );
  assert.equal(note({ state: { status: "unreachable", detail: "sealed" } }).block, "sealed");
  // Plan 07 fix round 1 (I1): main's settled "unavailable on this build", not Checking.
  assert.deepEqual(
    [
      note({ state: { status: "unreachable", detail: "nativeUnavailable" } }).status,
      note({ state: { status: "unreachable", detail: "nativeUnavailable" } }).block,
    ],
    ["blocked", "nativeUnavailable"]
  );
  assert.deepEqual(
    [note({ state: { status: "unknown" } }).status, note({ state: { status: "unknown" } }).block],
    ["checking", null],
    "§5.1 rule 1"
  );
  assert.equal(note({ state: { status: "needsKey", provider: "openai" } }).block, "needsKey");
  assert.equal(note({ state: { status: "needsModel" } }).block, "needsModel");
  assert.equal(note({}, { microphone: "denied" }).block, "microphone");
  const remote = note({ locality: "remote", providerId: "openai" });
  assert.deepEqual(
    [remote.status, remote.locality, remote.providerId],
    ["ready", "remote", "openai"]
  );
});

test("the after-setup intent is taken exactly once", async () => {
  const { setAfterSetupIntent, takeAfterSetupIntent } =
    await import("../../src/utils/afterSetupIntent.ts");
  assert.equal(takeAfterSetupIntent(), null);
  setAfterSetupIntent({ kind: "open-settings", path: "stt/noteRecording" });
  assert.deepEqual(takeAfterSetupIntent(), { kind: "open-settings", path: "stt/noteRecording" });
  assert.equal(takeAfterSetupIntent(), null);
});

test("current microphone denial overrides historical heard and take proof", async () => {
  const { summarizeReadiness } = await load();
  const row = summarizeReadiness(
    input({ microphone: "denied", micHeard: true, trialSucceeded: true })
  ).rows[1];
  assert.deepEqual([row.status, row.detail], ["pending", "microphone.denied"]);
});

test("advisory local voice flag cannot override any route locality for allLocal", async () => {
  const { summarizeReadiness } = await load();
  for (const locality of ["remote", "network", "unknown"]) {
    for (const field of ["speechRoute", "cleanupRoute", "noteRoute"]) {
      const id =
        field === "speechRoute"
          ? "dictationStt"
          : field === "noteRoute"
            ? "noteRecordingStt"
            : "dictationCleanup";
      const summary = summarizeReadiness(
        input({
          localVoiceActive: true,
          cleanupChoice: "local",
          cleanupStatus: "ready",
          [field]: route(id, { locality }),
        })
      );
      assert.equal(summary.allLocal, false, field + locality);
    }
  }
});

test("a configured cleanup check is not evidence that its provider executed", async () => {
  const { summarizeReadiness } = await load();
  for (const providerId of ["openai", "codex", "tinfoil", "bedrock", "vertex"]) {
    const summary = summarizeReadiness(
      input({
        cleanupChoice: "provider",
        cleanupStatus: "ready",
        cleanupRoute: route("dictationCleanup", { locality: "remote", providerId }),
      })
    );
    assert.equal(summary.rows[3].status, "configured", providerId);
  }
  const network = summarizeReadiness(
    input({
      cleanupChoice: "local",
      cleanupStatus: "ready",
      cleanupRoute: route("dictationCleanup", {
        locality: "network",
        host: "10.0.0.7:8080",
        model: "server-model",
      }),
      cleanupProviderLabel: "10.0.0.7:8080",
    })
  );
  assert.deepEqual(network.rows[3].values, { name: "server-model", provider: "10.0.0.7:8080" });
});

test("unknown microphone may reach existing recorder prompt; unknown route never can", async () => {
  const { noteActionState } = await load();
  assert.equal(
    noteActionState({ route: route("noteRecordingStt"), microphone: "unknown" }).status,
    "ready"
  );
  assert.equal(
    noteActionState({
      route: route("noteRecordingStt", { state: { status: "unknown" } }),
      microphone: "unknown",
    }).status,
    "checking"
  );
});

test("advisory installation cannot mask a provider route's missing key or server failure", async () => {
  const { summarizeReadiness } = await load();
  for (const status of ["needsKey", "needsUrl", "unreachable"]) {
    const row = summarizeReadiness(
      input({
        localVoiceActive: true,
        speechRoute: route("dictationStt", { locality: "remote", state: { status } }),
      })
    ).rows[0];
    assert.deepEqual(
      [row.status, row.detail, row.settingsPath],
      ["pending", "speech.unavailable", "stt/dictation"]
    );
  }
});

test("connected Codex without acknowledged models returns to Cleanup's explicit model setup", async () => {
  const { summarizeReadiness } = await load();
  const row = summarizeReadiness(input({ cleanupChoice: "codex", cleanupStatus: "modelSetup" }))
    .rows[3];
  assert.equal(row.status, "pending");
  assert.equal(row.detail, "cleanup.modelSetup");
  assert.equal(row.step, "cleanup");
  assert.equal(
    row.settingsPath,
    undefined,
    "do not route to the prior committed local provider's Settings"
  );
});
