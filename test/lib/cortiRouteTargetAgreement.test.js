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

test("change-driving fix1: unused invalid Corti options preserve explicit self-hosted routes and instant plans", async (t) => {
  installBrowserGlobals(t, { initialStorage: MIGRATED_STORAGE });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-task6-corti-effective-transport-",
  });
  const routes = await vite.ssrLoadModule("/lib/routes.ts");
  const planner = await vite.ssrLoadModule("/lib/routePlanner.ts");
  const { resolveTranscriptionRoute } = await vite.ssrLoadModule("/helpers/transcriptionRoute.ts");
  const { resolveMeetingTranscriptionOptions } = await vite.ssrLoadModule(
    "/helpers/meetingTranscriptionRouting.js"
  );
  const ctx = {
    facts: testFacts({ credentials: new Map([["corti:speech", true]]) }),
    copy: TEST_COPY,
    sealed: false,
  };
  const ids = ["dictationStt", "noteRecordingStt", "uploadStt"];
  for (const remoteUrl of ["http://localhost:8178", "https://stt.fixture.example/v1"]) {
    await t.test(`change-driving: retained Corti selection at ${remoteUrl}`, () => {
      const settings = {
        ...routeBaseState(),
        transcriptionMode: "self-hosted",
        useLocalWhisper: false,
        meetingTranscriptionMode: "self-hosted",
        meetingUseLocalWhisper: false,
        uploadTranscriptionMode: "self-hosted",
        uploadUseLocalWhisper: false,
        cloudTranscriptionProvider: "corti",
        cloudTranscriptionModel: "corti-transcribe",
        remoteTranscriptionUrl: remoteUrl,
        remoteTranscriptionModel: "fixture-whisper",
      };
      const snapshot = routes.buildRouteSnapshot(settings, ctx.facts, TEST_COPY, false);
      const before = routes.resolveRoutes(snapshot).filter((route) => ids.includes(route.id));
      for (const context of ["dictation", "upload"]) {
        const input = snapshot.stt[context];
        const actual = resolveTranscriptionRoute({
          settings: {
            transcriptionMode: input.mode,
            useLocalWhisper: false,
            remoteTranscriptionUrl: input.remoteUrl,
            remoteTranscriptionModel: input.remoteModel,
            cloudTranscriptionProvider: input.cloudProvider,
            cloudTranscriptionModel: input.cloudModel,
            cortiEnvironment: "EU",
            cortiTenant: "bad/path",
          },
        });
        assert.equal(actual.transport, "http-batch", context);
        assert.equal(actual.provider, "self-hosted", context);
        assert.equal(new URL(actual.endpoint).host, new URL(remoteUrl).host, context);
      }
      assert.throws(
        () => resolveMeetingTranscriptionOptions({ transcriptionMode: snapshot.stt.meeting.mode }),
        /unsupportedSelfHosted/,
        "note recording preserves its existing self-hosted refusal"
      );
      for (const route of before) {
        assert.equal(route.providerId, null, route.id);
        assert.equal(route.host, new URL(remoteUrl).host, route.id);
        assert.equal(
          route.locality,
          remoteUrl.startsWith("http://localhost") ? "device" : "network",
          route.id
        );
        assert.equal(
          route.state.status,
          route.id === "noteRecordingStt" ? "unreachable" : "ready",
          route.id
        );
      }
      for (const patch of [
        { cortiTenant: "bad/path" },
        { cortiEnvironment: "EU" },
        { cortiEnvironment: "moon", cortiTenant: "bad/path" },
      ]) {
        const after = routes
          .resolveRoutes(
            routes.buildRouteSnapshot({ ...settings, ...patch }, ctx.facts, TEST_COPY, false)
          )
          .filter((route) => ids.includes(route.id));
        assert.deepEqual(
          after,
          before,
          `unused ${JSON.stringify(patch)} cannot replace effective self-hosted destinations`
        );
        const plan = planner.planPatch(settings, ctx, "dictationStt", patch);
        assert.equal(plan.kind, "instant");
        assert.equal(plan.blocker, null);
        assert.deepEqual(plan.changes, [], "unused options add no recipient");
      }
    });
  }
});

test("change-driving fix1: actual Corti transport validates despite a retained server URL; retired modes keep their state", async (t) => {
  installBrowserGlobals(t, { initialStorage: MIGRATED_STORAGE });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-task6-corti-transport-guards-",
  });
  const routes = await vite.ssrLoadModule("/lib/routes.ts");
  const { resolveTranscriptionRoute } = await vite.ssrLoadModule("/helpers/transcriptionRoute.ts");
  const base = {
    ...routeBaseState(),
    transcriptionMode: "providers",
    useLocalWhisper: false,
    meetingTranscriptionMode: "providers",
    meetingUseLocalWhisper: false,
    uploadTranscriptionMode: "providers",
    uploadUseLocalWhisper: false,
    cloudTranscriptionProvider: "corti",
    cloudTranscriptionModel: "corti-transcribe",
    remoteTranscriptionUrl: "http://localhost:8178",
    cortiTenant: "bad/path",
  };
  assert.equal(resolveTranscriptionRoute({ settings: base }).transport, "proxied");
  assert.equal(
    resolveTranscriptionRoute({ settings: base }).provider,
    "corti",
    "a remembered remote URL does not select its transport"
  );
  const facts = testFacts({ credentials: new Map([["corti:speech", true]]) });
  for (const route of routes
    .resolveRoutes(routes.buildRouteSnapshot(base, facts, TEST_COPY, false))
    .filter((route) => ["dictationStt", "noteRecordingStt", "uploadStt"].includes(route.id))) {
    assert.equal(route.host, null, route.id);
    assert.deepEqual(route.state, { status: "unreachable", detail: "unsupported" }, route.id);
  }
  for (const mode of ["openwhispr", "retired-invalid-mode"]) {
    const settings = { ...base, transcriptionMode: mode, uploadTranscriptionMode: mode };
    assert.equal(resolveTranscriptionRoute({ settings }).code, "UNSUPPORTED_TRANSCRIPTION_MODE");
    for (const route of routes
      .resolveRoutes(routes.buildRouteSnapshot(settings, facts, TEST_COPY, false))
      .filter((route) => ["dictationStt", "uploadStt"].includes(route.id))) {
      assert.deepEqual(
        route.state,
        { status: "unreachable", detail: mode === "openwhispr" ? "retired" : "unsupported" },
        route.id
      );
    }
  }
});
