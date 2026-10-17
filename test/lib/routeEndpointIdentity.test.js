const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("./rendererTestHarness");
const { MIGRATED_STORAGE, TEST_COPY, testFacts, routeBaseState } = require("./routeStateFixture");
const { TEAM_A, TEAM_B, ENDPOINT_CASES, endpointState } = require("./endpointIdentityFixture");

test("change-driving: semantic endpoint identities stage every effective recipient", async (t) => {
  installBrowserGlobals(t, { initialStorage: MIGRATED_STORAGE });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-endpoint-identity-" });
  const { planPatch } = await vite.ssrLoadModule("/lib/routePlanner.ts");
  const ctx = {
    facts: testFacts({ credentials: new Map([["azure", true]]) }),
    copy: TEST_COPY,
    sealed: false,
  };
  for (const entry of ENDPOINT_CASES) {
    for (const [from, to] of [
      [TEAM_A, TEAM_B],
      [TEAM_B, TEAM_A],
    ]) {
      await t.test(`change-driving: ${entry.key} ${from} → ${to}`, () => {
        const state = endpointState(entry, from);
        const plan = planPatch(state, ctx, entry.id, { [entry.key]: to });
        assert.equal(plan.kind, "staged");
        assert.equal(plan.blocker, null);
        assert.deepEqual(
          plan.changes.map((c) => c.id),
          entry.ids
        );
        for (const change of plan.changes) {
          assert.equal(change.before.host, "gateway.example");
          assert.equal(change.after.host, "gateway.example");
          assert.equal(change.after.state.status, "ready");
          assert.equal(change.coupled, change.id !== entry.id);
        }
        assert.deepEqual(plan.patch, { [entry.key]: to });
        assert.deepEqual(plan.undoPatch, { [entry.key]: from });
        assert.equal(state[entry.key], from, "planning leaves raw canonical input intact");
      });
    }
  }
  // Added after the repair: compatibility checks, not independent original REDs.
  for (const entry of ENDPOINT_CASES) {
    await t.test(`baseline guard: unused ${entry.key} remains instant`, () => {
      const state = { ...routeBaseState(), [entry.key]: TEAM_A };
      const plan = planPatch(state, ctx, entry.id, { [entry.key]: TEAM_B });
      assert.equal(plan.kind, "instant");
      assert.deepEqual(plan.changes, []);
      assert.deepEqual(plan.undoPatch, { [entry.key]: TEAM_A });
    });
    if (entry.key !== "azureEndpoint") {
      await t.test(`baseline guard: loopback ${entry.key} remains instant`, () => {
        const from = "http://127.0.0.1:8178/team-a";
        const to = "http://127.0.0.1:8178/team-b";
        const state = endpointState(entry, from);
        const plan = planPatch(state, ctx, entry.id, { [entry.key]: to });
        assert.equal(plan.kind, "instant");
        assert.equal(plan.blocker, null);
        assert.deepEqual(plan.undoPatch, { [entry.key]: from });
      });
    }
  }
  await t.test(
    "baseline guard: endpoint normalization follows text SDK and speech executor equivalences",
    () => {
      for (const [key, from, to] of [
        ["azureEndpoint", "https://gateway.example/openai", "https://gateway.example/openai/"],
        [
          "chatAgentCloudBaseUrl",
          "https://gateway.example/team-a",
          "https://GATEWAY.example:443/team-a/",
        ],
        [
          "chatAgentRemoteUrl",
          "https://gateway.example/team-a/",
          "https://gateway.example/team-a//",
        ],
        [
          "cloudTranscriptionBaseUrl",
          "https://gateway.example/team-a",
          "https://gateway.example/team-a/audio/transcriptions",
        ],
        [
          "uploadCloudTranscriptionBaseUrl",
          "https://gateway.example/team-a",
          "https://GATEWAY.example:443/team-a///",
        ],
        [
          "remoteTranscriptionUrl",
          "https://gateway.example/team-a",
          "https://gateway.example/team-a/audio/transcriptions",
        ],
        // Azure speech's resource path is ignored when building a deployment URL.
        [
          "remoteTranscriptionUrl",
          "https://resource.openai.azure.com/team-a",
          "https://resource.openai.azure.com/team-b",
        ],
      ]) {
        const entry = ENDPOINT_CASES.find((item) => item.key === key);
        const plan = planPatch(endpointState(entry, from), ctx, entry.id, { [key]: to });
        assert.equal(plan.kind, "instant", key);
        assert.deepEqual(plan.changes, [], key);
        assert.deepEqual(plan.undoPatch, { [key]: from });
      }
      // Do not erase separators beyond what the text executor actually strips.
      const entry = ENDPOINT_CASES.find((item) => item.key === "chatAgentCloudBaseUrl");
      const plan = planPatch(endpointState(entry), ctx, entry.id, { [entry.key]: TEAM_A + "///" });
      assert.equal(plan.kind, "staged");
    }
  );
  await t.test(
    "baseline guard: explicit vision override still inherits an unset effective base URL",
    () => {
      const entry = ENDPOINT_CASES.find((item) => item.key === "dictationAgentCloudBaseUrl");
      const state = {
        ...endpointState(entry),
        useDictationAgentVisionModel: true,
        dictationAgentVisionProvider: "custom",
        dictationAgentVisionModel: "vision-model",
        dictationAgentVisionCloudBaseUrl: "",
      };
      const plan = planPatch(state, ctx, "voiceAssistant", { [entry.key]: TEAM_B });
      assert.equal(plan.kind, "staged");
      assert.deepEqual(
        plan.changes.map((change) => change.id),
        ["voiceAssistant", "assistantVision"]
      );
    }
  );
  await t.test(
    "baseline guard: disabled recipient inputs and unsupported meeting transports remain inert",
    async () => {
      const { buildRouteSnapshot, resolveRoutes } = await vite.ssrLoadModule("/lib/routes.ts");
      const entry = ENDPOINT_CASES.find((item) => item.key === "dictationAgentCloudBaseUrl");
      const state = { ...endpointState(entry), useDictationAgent: false };
      const plan = planPatch(state, ctx, entry.id, { [entry.key]: TEAM_B });
      assert.equal(plan.kind, "instant");
      assert.deepEqual(plan.changes, []);
      for (const mode of ["providers", "self-hosted"]) {
        const key =
          mode === "providers"
            ? "meetingCloudTranscriptionBaseUrl"
            : "meetingRemoteTranscriptionUrl";
        const meeting = {
          ...routeBaseState(),
          meetingTranscriptionMode: mode,
          meetingUseLocalWhisper: false,
          meetingCloudTranscriptionProvider: "custom",
          meetingCloudTranscriptionModel: "fixture-model",
          [key]: TEAM_A,
        };
        const result = planPatch(meeting, ctx, "noteRecordingStt", { [key]: TEAM_B });
        assert.equal(result.kind, "instant");
        const resolved = resolveRoutes(
          buildRouteSnapshot({ ...meeting, ...result.patch }, ctx.facts, ctx.copy, false)
        );
        assert.equal(
          resolved.find((route) => route.id === "noteRecordingStt").state.status,
          "unreachable"
        );
      }
    }
  );

  await t.test(
    "baseline guard: installed Azure and custom text SDKs preserve semantic gateway paths",
    async () => {
      const { createAzure } = await import("@ai-sdk/azure");
      const { createOpenAI } = await import("@ai-sdk/openai");
      for (const family of ["azure", "custom"]) {
        const actual = [];
        for (const baseURL of [TEAM_A, TEAM_A + "/", TEAM_B]) {
          const stop = new Error("fixture stops at injected transport");
          const fetch = async (url) => {
            actual.push(String(url));
            throw stop;
          };
          const model =
            family === "azure"
              ? createAzure({ apiKey: "fixture", baseURL, fetch })("fixture-model")
              : createOpenAI({
                  apiKey: "fixture",
                  baseURL: new URL(baseURL).href.replace(/\/$/, ""),
                  fetch,
                }).chat("fixture-model");
          await assert.rejects(
            model.doGenerate({
              prompt: [{ role: "user", content: [{ type: "text", text: "fixture" }] }],
            }),
            (error) => error === stop
          );
        }
        const suffix = family === "azure" ? "/responses" : "/chat/completions";
        assert.deepEqual(actual, [TEAM_A + suffix, TEAM_A + suffix, TEAM_B + suffix]);
      }
    }
  );
});
