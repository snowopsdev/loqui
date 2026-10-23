const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("./rendererTestHarness");

test("change-driving: route change messages", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-route-change-message-test-" });
  const { routeChangeMessage } = await vite.ssrLoadModule("/lib/routeChangeMessage.ts");
  const tr = (key, options) => `${key}${options ? JSON.stringify(options) : ""}`;
  const list = (items) => items.join(" & ");
  const route = (o) => ({
    id: "dictationStt",
    kind: "speech",
    locality: "remote",
    provider: "OpenAI",
    providerId: "openai",
    host: "api.openai.com",
    model: "gpt-4o-mini-transcribe",
    state: { status: "ready" },
    sends: "<audio>",
    settingsPath: "stt",
    ...o,
  });
  const device = (id) =>
    route({ id, locality: "device", provider: null, providerId: null, host: null, sends: null });
  const plan = (after, coupled = []) => ({
    routeId: after.id,
    changes: [
      { id: after.id, before: device(after.id), after, coupled: false },
      ...coupled.map((id) => ({ id, before: device(id), after: route({ id }), coupled: true })),
    ],
  });

  // Change-driving: the module does not exist yet.
  await t.test("change-driving: a provider destination names the provider and the payload", () => {
    assert.deepEqual(routeChangeMessage(plan(route({})), tr, list), {
      title:
        'routes.toast.sends{"task":"routes.names.dictationStt","payload":"<audio>","destination":"OpenAI"}',
    });
    const custom = routeChangeMessage(
      plan(route({ providerId: "custom", host: "llm.example.com" })),
      tr,
      list
    );
    assert.match(
      custom.title,
      /"destination":"locality.customEndpoint"/,
      "providerDisplayLabel localises custom"
    );
  });

  await t.test("change-driving: a server destination names its host", () => {
    const lan = route({
      id: "translation",
      locality: "network",
      provider: null,
      providerId: null,
      host: "192.168.1.20:11434",
      sends: "<transcript>",
    });
    assert.match(
      routeChangeMessage(plan(lan), tr, list).title,
      /"destination":"routes.toast.serverAt\{\\"host\\":\\"192.168.1.20:11434\\"\}"/
    );
  });

  await t.test(
    "change-driving: on-device moves say so, and ask for a model when one is missing",
    () => {
      const local = route({
        id: "chat",
        locality: "device",
        provider: null,
        providerId: null,
        host: null,
        sends: null,
        state: { status: "needsModel" },
      });
      assert.deepEqual(routeChangeMessage(plan(local), tr, list), {
        title: 'routes.toast.local{"task":"routes.names.chat"}',
        description: "routes.toast.chooseModel",
      });
    }
  );

  await t.test("change-driving: an off route says where it will go when turned on", () => {
    const off = route({ id: "dictationCleanup", sends: null, state: { status: "off" } });
    const configured = plan(off);
    configured.changes[0].before = { ...configured.changes[0].before, state: { status: "off" } };
    assert.deepEqual(routeChangeMessage(configured, tr, list), {
      title: 'routes.toast.whenOn{"task":"routes.names.dictationCleanup","destination":"OpenAI"}',
    });
  });

  // Change-driving (I1 follow-up): enable switches now toast through this module.
  await t.test("change-driving: switching a route off says it is off", () => {
    const off = route({ id: "dictationCleanup", sends: null, state: { status: "off" } });
    assert.deepEqual(routeChangeMessage(plan(off), tr, list), {
      title: 'routes.toast.off{"task":"routes.names.dictationCleanup"}',
    });
  });

  await t.test("change-driving: sign-in-after-switch providers say what comes next", () => {
    const codex = route({
      id: "chat",
      providerId: "codex",
      host: "chatgpt.com",
      sends: "<messages>",
      state: { status: "needsKey", provider: "ChatGPT (Codex)" },
    });
    assert.equal(
      routeChangeMessage(plan(codex), tr, list).description,
      'routes.toast.signInNext{"provider":"ChatGPT (Codex)"}'
    );
  });

  await t.test("change-driving: coupled routes are named", () => {
    const m = routeChangeMessage(plan(route({}), ["noteRecordingStt", "uploadStt"]), tr, list);
    assert.equal(
      m.description,
      'routes.toast.alsoChanges{"tasks":"routes.names.noteRecordingStt & routes.names.uploadStt"}'
    );
  });

  await t.test("change-driving: a patch that changes no route says it was saved", () => {
    assert.deepEqual(routeChangeMessage({ routeId: "chat", changes: [] }, tr, list), {
      title: 'routes.toast.saved{"task":"routes.names.chat"}',
    });
  });
});
