const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/stores/policyRules.ts");

const policy = {
  version: 1,
  transcription: {
    allowedModes: ["openwhispr", "local"],
    allowedByokProviders: ["openai"],
  },
  llm: {
    allowedModes: ["openwhispr", "providers"],
    allowedByokProviders: ["openai"],
    allowedEnterpriseProviders: [],
  },
  features: { agentEnabled: true, webSearchEnabled: true },
  sharing: { externalLinkSharing: "allowed" },
  dataRetention: {
    audioRetentionMaxDays: null,
    localHistoryMode: "user_choice",
    cloudBackupAllowed: true,
  },
  minAppVersion: null,
};

test("allows guests and resolved unmanaged accounts", async () => {
  const { isPolicyActionAllowed } = await load();

  assert.equal(isPolicyActionAllowed({ status: "idle", policy: null, appVersion: null }), true);
  assert.equal(
    isPolicyActionAllowed({ status: "unmanaged", policy: null, appVersion: null }),
    true
  );
});

test("blocks authenticated actions while policy is loading or unavailable", async () => {
  const { isPolicyActionAllowed } = await load();

  assert.equal(
    isPolicyActionAllowed({ status: "loading", policy: null, appVersion: "1.8.1" }),
    false
  );
  assert.equal(
    isPolicyActionAllowed({ status: "error", policy: null, appVersion: "1.8.1" }),
    false
  );
});

test("enforces the managed minimum app version", async () => {
  const { isPolicyActionAllowed } = await load();
  const versionedPolicy = { ...policy, minAppVersion: "1.9.0" };

  assert.equal(
    isPolicyActionAllowed({ status: "managed", policy: versionedPolicy, appVersion: "1.8.1" }),
    false
  );
  assert.equal(
    isPolicyActionAllowed({ status: "managed", policy: versionedPolicy, appVersion: "1.9.0" }),
    true
  );
  assert.equal(
    isPolicyActionAllowed({ status: "managed", policy: versionedPolicy, appVersion: null }),
    false
  );
});

test("mode and provider decisions fail closed for empty allowlists", async () => {
  const { isModeAllowedByPolicy, isProviderAllowedByPolicy } = await load();
  const emptyPolicy = {
    ...policy,
    transcription: { allowedModes: [], allowedByokProviders: [] },
  };
  const snapshot = { status: "managed", policy: emptyPolicy, appVersion: "1.8.1" };

  assert.equal(isModeAllowedByPolicy(snapshot, "transcription", "local"), false);
  assert.equal(isProviderAllowedByPolicy(snapshot, "transcription", "openai"), false);
});

test("empty managed scope allowlists make that scope unavailable", async () => {
  const { isLlmSelectionAllowed } = await load();
  const emptyLlmPolicy = {
    ...policy,
    llm: { allowedModes: [], allowedByokProviders: [], allowedEnterpriseProviders: [] },
  };
  const snapshot = { status: "managed", policy: emptyLlmPolicy, appVersion: "1.8.1" };

  assert.equal(isLlmSelectionAllowed(snapshot, { mode: "providers", provider: "openai" }), false);
  assert.equal(
    isLlmSelectionAllowed(
      { status: "unmanaged", policy: null, appVersion: null },
      { mode: "providers", provider: "openai" }
    ),
    true
  );
});

test("LLM dispatch requires an allowed mode and provider", async () => {
  const { isLlmSelectionAllowed } = await load();
  const noProviderPolicy = {
    ...policy,
    llm: {
      allowedModes: ["providers", "local"],
      allowedByokProviders: [],
      allowedEnterpriseProviders: [],
    },
  };
  const snapshot = { status: "managed", policy: noProviderPolicy, appVersion: "1.8.1" };

  assert.equal(isLlmSelectionAllowed(snapshot, { mode: "providers", provider: "openai" }), false);
  assert.equal(isLlmSelectionAllowed(snapshot, { mode: "local", provider: "local" }), true);
  assert.equal(isLlmSelectionAllowed(snapshot, { mode: "enterprise", provider: "bedrock" }), false);
});

test("blocks transcription contexts whose stored mode is disallowed", async () => {
  const { isTranscriptionSelectionAllowed } = await load();
  const snapshot = { status: "managed", policy, appVersion: "1.8.1" };

  assert.equal(
    isTranscriptionSelectionAllowed(snapshot, { mode: "self-hosted", provider: "" }),
    false
  );
  assert.equal(isTranscriptionSelectionAllowed(snapshot, { mode: "local", provider: "" }), true);
});

test("blocks BYOK transcription when no provider is allowed", async () => {
  const { isTranscriptionSelectionAllowed } = await load();
  const noProviderPolicy = {
    ...policy,
    transcription: { allowedModes: ["providers"], allowedByokProviders: [] },
  };
  const snapshot = { status: "managed", policy: noProviderPolicy, appVersion: "1.8.1" };

  assert.equal(
    isTranscriptionSelectionAllowed(snapshot, { mode: "providers", provider: "openai" }),
    false
  );
});

test("does not require a BYOK provider for local transcription", async () => {
  const { isTranscriptionSelectionAllowed } = await load();
  const localOnlyPolicy = {
    ...policy,
    transcription: { allowedModes: ["local"], allowedByokProviders: [] },
  };
  const snapshot = { status: "managed", policy: localOnlyPolicy, appVersion: "1.8.1" };

  assert.equal(
    isTranscriptionSelectionAllowed(snapshot, { mode: "local", provider: "openai" }),
    true
  );
});

test("domain-only sharing permits only private recovery and domain visibility", async () => {
  const { isShareActionAllowed, isShareVisibilityAllowed } = await load();
  const snapshot = {
    status: "managed",
    policy: {
      ...policy,
      sharing: { externalLinkSharing: "domain_only" },
    },
    appVersion: "1.8.1",
  };

  assert.equal(isShareVisibilityAllowed(snapshot, "private"), true);
  assert.equal(isShareVisibilityAllowed(snapshot, "domain"), true);
  assert.equal(isShareVisibilityAllowed(snapshot, "invited"), false);
  assert.equal(isShareVisibilityAllowed(snapshot, "link"), false);
  assert.equal(isShareActionAllowed(snapshot, "copy-link", "link"), false);
  assert.equal(isShareActionAllowed(snapshot, "rotate-link", "link"), false);
  assert.equal(isShareActionAllowed(snapshot, "invite", "private"), false);
});

test("sharing recovery remains available when exposure-increasing actions are blocked", async () => {
  const { isShareActionAllowed } = await load();
  const blockedSnapshots = [
    { status: "loading", policy: null, appVersion: "1.8.1" },
    {
      status: "managed",
      policy: { ...policy, sharing: { externalLinkSharing: "disabled" } },
      appVersion: "1.8.1",
    },
    {
      status: "managed",
      policy: { ...policy, minAppVersion: "2.0.0" },
      appVersion: "1.8.1",
    },
  ];

  for (const snapshot of blockedSnapshots) {
    assert.equal(isShareActionAllowed(snapshot, "make-private", "link"), true);
    assert.equal(isShareActionAllowed(snapshot, "revoke-invitation", "invited"), true);
    assert.equal(isShareActionAllowed(snapshot, "remove-grant", "invited"), true);
    assert.equal(isShareActionAllowed(snapshot, "create-link", "private"), false);
  }
});

test("minimum-version enforcement preserves recovery and maintenance surfaces", async () => {
  const { isDesktopActionAllowed } = await load();
  const snapshot = {
    status: "managed",
    policy: { ...policy, minAppVersion: "2.0.0" },
    appVersion: "1.8.1",
  };

  for (const action of [
    "history",
    "retention-settings",
    "updater",
    "diagnostics",
    "permissions",
    "account",
    "sign-out",
  ]) {
    assert.equal(isDesktopActionAllowed(snapshot, action), true, action);
  }
  for (const action of ["capture", "inference", "agent", "sharing", "cloud-backup"]) {
    assert.equal(isDesktopActionAllowed(snapshot, action), false, action);
  }
});

test("derives local history from policy without changing the personal preference", async () => {
  const { effectiveLocalHistoryEnabled } = await load();
  const unmanaged = { status: "unmanaged", policy: null, appVersion: "1.8.1" };
  const alwaysOn = {
    status: "managed",
    policy: {
      ...policy,
      dataRetention: { ...policy.dataRetention, localHistoryMode: "always_on" },
    },
    appVersion: "1.8.1",
  };
  const alwaysOff = {
    status: "managed",
    policy: {
      ...policy,
      dataRetention: { ...policy.dataRetention, localHistoryMode: "always_off" },
    },
    appVersion: "1.8.1",
  };

  assert.equal(effectiveLocalHistoryEnabled(unmanaged, false), false);
  assert.equal(effectiveLocalHistoryEnabled(unmanaged, true), true);
  assert.equal(effectiveLocalHistoryEnabled(alwaysOn, false), true);
  assert.equal(effectiveLocalHistoryEnabled(alwaysOff, true), false);
});

test("caps effective audio retention while preserving disabled and raw values", async () => {
  const { effectiveAudioRetentionDays } = await load();
  const unmanaged = { status: "unmanaged", policy: null, appVersion: "1.8.1" };
  const capped = {
    status: "managed",
    policy: {
      ...policy,
      dataRetention: { ...policy.dataRetention, audioRetentionMaxDays: 7 },
    },
    appVersion: "1.8.1",
  };

  assert.equal(effectiveAudioRetentionDays(unmanaged, 90), 90);
  assert.equal(effectiveAudioRetentionDays(capped, 90), 7);
  assert.equal(effectiveAudioRetentionDays(capped, 3), 3);
  assert.equal(effectiveAudioRetentionDays(capped, 0), 0);
});

test("an enabled cloud-backup preference can always be turned off", async () => {
  const { canChangeCloudBackupPreference } = await load();

  assert.equal(canChangeCloudBackupPreference(false, true), true);
  assert.equal(canChangeCloudBackupPreference(false, false), false);
  assert.equal(canChangeCloudBackupPreference(true, false), true);
});

test("re-entering providers mode replaces a dormant policy-disallowed provider", async () => {
  const { reconcileCloudProviderSelection } = await load();
  const allowedProviders = [
    { id: "openai", models: [{ id: "whisper-1" }] },
    { id: "mistral", models: [{ id: "voxtral-mini" }] },
  ];

  assert.deepEqual(
    reconcileCloudProviderSelection({
      selectedProvider: "groq",
      selectedModel: "whisper-large-v3",
      allowedProviders,
      customAllowed: false,
      hasCustomUrl: false,
    }),
    { provider: "openai", model: "whisper-1" }
  );
  assert.equal(
    reconcileCloudProviderSelection({
      selectedProvider: "mistral",
      selectedModel: "voxtral-mini",
      allowedProviders,
      customAllowed: false,
      hasCustomUrl: false,
    }),
    null
  );
});

test("active control-panel views reroute on their specific policy capability", async () => {
  const { isControlPanelViewAllowed } = await load();

  assert.equal(isControlPanelViewAllowed("chat", false, true), false);
  assert.equal(isControlPanelViewAllowed("chat", true, true), true);
  assert.equal(isControlPanelViewAllowed("upload", true, false), false);
  assert.equal(isControlPanelViewAllowed("upload", false, true), true);
  assert.equal(isControlPanelViewAllowed("home", false, false), true);
});
