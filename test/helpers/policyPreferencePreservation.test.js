const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("managed policy gates preserve the user's raw preferences", async (t) => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map([
    ["transcriptionMode", "local"],
    ["useLocalWhisper", "true"],
    ["cloudBackupEnabled", "true"],
    ["dataRetentionEnabled", "true"],
    ["audioRetentionDays", "90"],
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const policy = {
    version: 1,
    transcription: { allowedModes: ["openwhispr"], allowedByokProviders: [] },
    llm: {
      allowedModes: ["openwhispr"],
      allowedByokProviders: [],
      allowedEnterpriseProviders: [],
    },
    features: { agentEnabled: false, webSearchEnabled: false },
    sharing: { externalLinkSharing: "disabled" },
    dataRetention: {
      audioRetentionMaxDays: 7,
      localHistoryMode: "always_off",
      cloudBackupAllowed: false,
    },
    minAppVersion: null,
  };
  globalThis.localStorage = storage;
  globalThis.window = {
    localStorage: storage,
    addEventListener() {},
    setInterval() {
      return 1;
    },
    electronAPI: {
      getAppVersion: async () => ({ version: "1.8.1" }),
      getWorkspacePolicy: async () => ({
        success: true,
        status: "network",
        revision: 1,
        accountId: "account-a",
        authGeneration: 1,
        managed: true,
        policy,
        policyUpdatedAt: "2026-08-05T00:00:00.000Z",
        endpointSupported: true,
      }),
      onWorkspacePolicyChanged() {},
    },
  };

  const { createServer } = await import("vite");
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-policy-prefs-test-"));
  const vite = await createServer({
    root: path.resolve(__dirname, "../../src"),
    cacheDir,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
    plugins: [
      {
        name: "policy-preferences-test-app-version",
        enforce: "pre",
        resolveId(source) {
          return source.endsWith("/helpers/appVersion.js") ? "\0policy-prefs-app-version" : null;
        },
        load(id) {
          if (id !== "\0policy-prefs-app-version") return null;
          return `
            export function parseCanonicalAppVersion(value) {
              const match = typeof value === "string" ? /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/.exec(value) : null;
              return match ? match.slice(1).map(Number) : null;
            }
            export function isCanonicalAppVersion(value) {
              return parseCanonicalAppVersion(value) !== null;
            }
          `;
        },
      },
    ],
    server: { middlewareMode: true },
  });
  t.after(async () => {
    await vite.close();
    fs.rmSync(cacheDir, { recursive: true, force: true });
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  });

  const { usePolicyStore } = await vite.ssrLoadModule("/stores/policyStore.ts");
  const { isCloudBackupAllowed, lockedLocalHistoryValue } =
    await vite.ssrLoadModule("/stores/policyRules.ts");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const before = useSettingsStore.getState();
  assert.equal(before.transcriptionMode, "local");
  assert.equal(before.cloudBackupEnabled, true);

  await usePolicyStore.getState().fetchPolicy("account-a", 1);

  const after = useSettingsStore.getState();
  assert.equal(after.transcriptionMode, "local");
  assert.equal(after.cloudBackupEnabled, true);
  assert.equal(after.dataRetentionEnabled, true);
  assert.equal(after.audioRetentionDays, 90);
  assert.equal(isCloudBackupAllowed(usePolicyStore.getState()), false);
  assert.equal(lockedLocalHistoryValue(usePolicyStore.getState()), false);
});
