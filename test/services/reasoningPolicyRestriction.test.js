const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const esTranslations = require("../../src/locales/es/translation.json");
const enTranslations = require("../../src/locales/en/translation.json");

test("reasoning policy asserts throw messages localized to the active UI language", async (t) => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  globalThis.localStorage = storage;
  globalThis.window = {
    innerWidth: 1200,
    localStorage: storage,
    addEventListener() {},
    electronAPI: {},
  };

  const { createServer } = await import("vite");
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-reasoning-policy-test-"));
  const vite = await createServer({
    root: path.resolve(__dirname, "../../src"),
    cacheDir,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
    plugins: [
      {
        name: "reasoning-policy-test-app-version",
        enforce: "pre",
        resolveId(source) {
          return source.endsWith("/helpers/appVersion.js")
            ? "\0reasoning-policy-app-version"
            : null;
        },
        load(id) {
          if (id !== "\0reasoning-policy-app-version") return null;
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
  });
  t.after(async () => {
    await vite.close();
    fs.rmSync(cacheDir, { recursive: true, force: true });
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  });

  const { assertAgentAllowedByPolicy, assertReasoningAllowedByPolicy } = await vite.ssrLoadModule(
    "/services/reasoningPolicy.ts"
  );
  const { usePolicyStore } = await vite.ssrLoadModule("/stores/policyStore.ts");
  const { default: i18n } = await vite.ssrLoadModule("/i18n.ts");

  usePolicyStore.setState({
    status: "managed",
    appVersion: "1.8.1",
    policy: {
      version: 1,
      transcription: { allowedModes: [], allowedByokProviders: [] },
      llm: { allowedModes: [], allowedByokProviders: [], allowedEnterpriseProviders: [] },
      features: { agentEnabled: false, webSearchEnabled: false },
      sharing: { externalLinkSharing: "disabled" },
      dataRetention: {
        audioRetentionMaxDays: null,
        localHistoryMode: "user_choice",
        cloudBackupAllowed: false,
      },
      minAppVersion: null,
    },
  });

  await i18n.changeLanguage("es");
  assert.notEqual(
    esTranslations.common.policyAgentRestricted,
    enTranslations.common.policyAgentRestricted,
    "the localized strings must differ so this test can prove translation happened"
  );

  assert.throws(() => assertAgentAllowedByPolicy(), {
    message: esTranslations.common.policyAgentRestricted,
  });
  assert.throws(() => assertReasoningAllowedByPolicy("openai", "providers"), {
    message: esTranslations.common.policyAiProcessingRestricted,
  });

  await i18n.changeLanguage("en");
  assert.throws(() => assertAgentAllowedByPolicy(), {
    message: enTranslations.common.policyAgentRestricted,
  });
});
