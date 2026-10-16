const assert = require("node:assert/strict");
const test = require("node:test");
const { getCortiToken } = require("../../src/helpers/cortiAuth");
const { createRendererServer, installBrowserGlobals } = require("./rendererTestHarness");
const { routeBaseState, testFacts, TEST_COPY, MIGRATED_STORAGE } = require("./routeStateFixture");

test("change-driving: Corti speech readiness agrees with actual token target validation", async (t) => {
  installBrowserGlobals(t, { initialStorage: MIGRATED_STORAGE });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-task6-corti-agreement-" });
  const routes = await vite.ssrLoadModule("/lib/routes.ts");
  for (const [environment, tenant] of [
    ["EU", "base"],
    [" eu", "base"],
    ["moon", "base"],
    ["us", "bad/path"],
  ]) {
    await t.test(
      `change-driving: ${JSON.stringify([environment, tenant])} refuses readiness and token dispatch`,
      async () => {
        const settings = {
          ...routeBaseState(),
          transcriptionMode: "providers",
          useLocalWhisper: false,
          cloudTranscriptionProvider: "corti",
          cloudTranscriptionModel: "corti-transcribe",
          cortiEnvironment: environment,
          cortiTenant: tenant,
        };
        const normalized = {
          environment: settings.cortiEnvironment || "us",
          tenant: String(settings.cortiTenant || "").trim() || "base",
        };
        let fetches = 0;
        await assert.rejects(
          getCortiToken(
            { ...normalized, clientId: "fixture", clientSecret: "fixture" },
            async () => {
              fetches++;
              throw new Error("unexpected fetch");
            }
          ),
          /Invalid Corti/
        );
        assert.equal(fetches, 0);
        const snapshot = routes.buildRouteSnapshot(
          settings,
          testFacts({ credentials: new Map([["corti:speech", true]]) }),
          TEST_COPY,
          false
        );
        const route = routes.resolveRoutes(snapshot).find((route) => route.id === "dictationStt");
        assert.notEqual(
          route.state.status,
          "ready",
          `executor-invalid ${JSON.stringify(normalized)} was shown ready at ${route.host}`
        );
      }
    );
  }
});

test("baseline guard: valid Corti defaults and trimmed tenants match actual token paths on all inherited speech routes", async (t) => {
  installBrowserGlobals(t, { initialStorage: MIGRATED_STORAGE });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-task6-corti-valid-" });
  const routes = await vite.ssrLoadModule("/lib/routes.ts");
  for (const [environment, tenant] of [
    ["", ""],
    ["eu", " acme-1 "],
    ["us", "tenant_2"],
  ]) {
    const settings = {
      ...routeBaseState(),
      transcriptionMode: "providers",
      useLocalWhisper: false,
      meetingTranscriptionMode: "providers",
      meetingUseLocalWhisper: false,
      uploadTranscriptionMode: "providers",
      uploadUseLocalWhisper: false,
      cloudTranscriptionProvider: "corti",
      cloudTranscriptionModel: "corti-transcribe",
      cortiEnvironment: environment,
      cortiTenant: tenant,
    };
    const normalized = {
      environment: environment || "us",
      tenant: String(tenant || "").trim() || "base",
    };
    let url;
    await getCortiToken(
      { ...normalized, clientId: `valid-${environment}-${tenant}`, clientSecret: "fixture" },
      async (value) => {
        url = value;
        return { ok: true, json: async () => ({ access_token: "fixture", expires_in: 300 }) };
      }
    );
    assert.equal(
      url,
      `https://auth.${normalized.environment}.corti.app/realms/${normalized.tenant}/protocol/openid-connect/token`
    );
    const snapshot = routes.buildRouteSnapshot(
      settings,
      testFacts({ credentials: new Map([["corti:speech", true]]) }),
      TEST_COPY,
      false
    );
    for (const route of routes
      .resolveRoutes(snapshot)
      .filter((route) => ["dictationStt", "noteRecordingStt", "uploadStt"].includes(route.id))) {
      assert.equal(route.host, `api.${normalized.environment}.corti.app`, route.id);
      assert.equal(route.state.status, "ready", route.id);
    }
    const invalid = routes.buildRouteSnapshot(
      { ...settings, cortiTenant: "bad/path" },
      testFacts({ credentials: new Map([["corti:speech", true]]) }),
      TEST_COPY,
      false
    );
    for (const route of routes
      .resolveRoutes(invalid)
      .filter((route) => ["dictationStt", "noteRecordingStt", "uploadStt"].includes(route.id))) {
      assert.equal(route.host, null, route.id);
      assert.deepEqual(route.state, { status: "unreachable", detail: "unsupported" }, route.id);
    }
  }
});
