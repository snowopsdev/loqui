const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("renderer fails closed when a managed-unresolvable refresh supersedes unmanaged", async (t) => {
  const originalWindow = globalThis.window;
  let policyRequestCount = 0;
  let policyChanged;
  globalThis.window = {
    addEventListener() {},
    setInterval() {
      return 1;
    },
    electronAPI: {
      getAppVersion: async () => ({ version: "1.8.1" }),
      getWorkspacePolicy: async () => {
        policyRequestCount += 1;
        if (policyRequestCount === 1) {
          return {
            success: true,
            status: "network",
            revision: 1,
            accountId: "account-a",
            authGeneration: 1,
            managed: false,
            policy: null,
            policyUpdatedAt: null,
            endpointSupported: true,
          };
        }
        return {
          success: false,
          status: "error",
          code: "POLICY_UNRESOLVABLE",
          error: "Organization policy could not be resolved.",
        };
      },
      onWorkspacePolicyChanged(callback) {
        policyChanged = callback;
      },
    },
  };

  const { createServer } = await import("vite");
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-policy-transition-test-"));
  const vite = await createServer({
    root: path.resolve(__dirname, "../../src"),
    cacheDir,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
    plugins: [
      {
        name: "policy-transition-test-app-version",
        enforce: "pre",
        resolveId(source) {
          if (source.endsWith("/helpers/appVersion.js")) return "\0policy-transition-app-version";
          if (source.endsWith("/utils/logger")) return "\0policy-transition-logger";
          return null;
        },
        load(id) {
          if (id === "\0policy-transition-logger") {
            return "export default { error() {} };";
          }
          if (id !== "\0policy-transition-app-version") return null;
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
  });

  const { usePolicyStore } = await vite.ssrLoadModule("/stores/policyStore.ts");
  await usePolicyStore.getState().fetchPolicy("account-a", 1);
  assert.equal(usePolicyStore.getState().status, "unmanaged");

  policyChanged({
    success: false,
    status: "error",
    revision: 1,
    accountId: "account-a",
    authGeneration: 1,
    code: "POLICY_UNRESOLVABLE",
    error: "Organization policy could not be resolved.",
  });
  await Promise.resolve();
  assert.equal(usePolicyStore.getState().status, "error");

  await usePolicyStore.getState().fetchPolicy("account-a", 1);
  assert.equal(usePolicyStore.getState().status, "error");
  assert.equal(usePolicyStore.getState().loaded, true);
});
