const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const React = require("react");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");
const { createProbeRoot, findElement } = require("../lib/probeRoot");
const { rendererServer } = require("../lib/routeTestApi");
const { realCredentialEnv } = require("../helpers/harness/realCredentialEnv");
const { fakeCodexFs } = require("../helpers/harness/fakeCredentialEnv");
const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority");
const { registerPersonalInferenceIPC } = require("../../src/helpers/personalInference");
const button = (tree) => findElement(tree, (node) => node.props?.["data-action"] === "list-models");
const props = {
  baseUrl: "https://models.fixture.test/v1",
  credentialRef: "custom:chatIntelligence",
  apiKey: "",
  model: "",
  saveApiKey: async () => ({ ok: false, error: "unavailable" }),
  onSelectModel() {},
};

// Change-driving UI recovery (backend assertions are baseline guards): mounted production UI,
// actual registered model handler, real authority and real encrypted persistence.
for (const mutation of ["first save", "replacement", "removal"])
  test(`change-driving: mounted disclosure refuses ${mutation} until another explicit click`, async (t) => {
    const real = realCredentialEnv(t, {
      CHAT_AGENT_CUSTOM_API_KEY: mutation === "first save" ? "" : "fixture-old",
    });
    const credentials = createCredentialAuthority({
      env: real.env,
      fs: fakeCodexFs(),
      codexHome: "/fixture/codex",
      setTimer() {},
    });
    const handlers = new Map();
    const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false });
    const codex = Object.assign(new EventEmitter(), { stop() {} });
    const calls = [];
    const inference = registerPersonalInferenceIPC({
      ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler() {} },
      codex,
      credentials,
      fetchModels: async (...args) => {
        calls.push(args);
        return { ok: true, body: new Response('{"data":[]}').body };
      },
    });
    t.after(() => inference.dispose());
    const invoke = (name, input) => handlers.get("personal-inference:" + name)({ sender }, input);
    installBrowserGlobals(t, {
      window: {
        electronAPI: {
          credentials: { onChanged: (fn) => credentials.subscribe(fn) },
          personalInference: {
            describeModels: (input) => invoke("describe-models", input),
            models: (input) => invoke("models", input),
          },
        },
      },
    });
    const vite = await rendererServer(t, "loqui-mounted-recipient-");
    const Panel = (await vite.ssrLoadModule("/components/OpenAICompatiblePanel.tsx")).default;
    const probes = createProbeRoot(t);
    const tree = await probes.mount("panel", () => Panel(props));
    await probes.settle();
    assert.equal(calls.length, 0);
    assert.equal(button(tree()).props.disabled, false);
    assert.match(
      button(tree()).props.title,
      mutation === "first save" ? /listModelsNoKey/ : /listModelsSendsKey/
    );
    real.fs.holdNext(
      (op, name) =>
        op === (mutation === "removal" ? "unlink" : "rename") &&
        name === "CHAT_AGENT_CUSTOM_API_KEY.enc"
    );
    const saving =
      mutation === "removal"
        ? credentials.remove("custom:chatIntelligence")
        : credentials.save("custom:chatIntelligence", "key", "fixture-new");
    const held = await real.fs.nextHold();
    await probes.act(() => button(tree()).props.onClick());
    await probes.act(async () => {
      held.release();
      await saving;
    });
    await probes.settle();
    assert.equal(calls.length, 0, "changed committed disclosure refuses without fetch");
    assert.equal(button(tree()).props.disabled, false);
    assert.match(
      button(tree()).props.title,
      mutation === "removal" ? /listModelsNoKey/ : /listModelsSendsKey/
    );
    await probes.act(() => button(tree()).props.onClick());
    await probes.settle();
    assert.equal(calls.length, 1, "only a newly reviewed explicit click dispatches");
    assert.deepEqual(
      calls[0][1].headers,
      mutation === "removal" ? {} : { Authorization: "Bearer fixture-new" }
    );
  });

// Change-driving: a completed catalog was keyed only by host and could remain
// visible under a different task's credential slot at that same endpoint.
test("change-driving: catalog and stale button ownership include the credential slot", async (t) => {
  let update;
  let token = 0;
  const calls = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        personalInference: {
          describeModels: async (input) => ({
            recipientToken: String(++token),
            credentialId: input.credentialRef,
            host: "models.fixture.test",
            generation: 1,
            present: false,
          }),
          models: async (input) => {
            calls.push(input);
            return { data: [{ id: "old-slot-model" }] };
          },
        },
      },
    },
  });
  const vite = await rendererServer(t, "loqui-slot-catalog-");
  const Panel = (await vite.ssrLoadModule("/components/OpenAICompatiblePanel.tsx")).default;
  const probes = createProbeRoot(t);
  const tree = await probes.mount("panel", () => {
    const [ref, setRef] = React.useState(props.credentialRef);
    update = setRef;
    return Panel({ ...props, credentialRef: ref });
  });
  await probes.settle();
  const old = button(tree());
  await probes.act(() => old.props.onClick());
  await probes.settle();
  assert.ok(
    findElement(tree(), (node) =>
      node.props?.models?.some((model) => model.value === "old-slot-model")
    )
  );
  await probes.act(() => update("custom:noteFormatting"));
  await probes.settle();
  assert.equal(
    findElement(tree(), (node) =>
      node.props?.models?.some((model) => model.value === "old-slot-model")
    ),
    null
  );
  await probes.act(() => old.props.onClick());
  await probes.settle();
  assert.equal(calls.length, 1, "stale clicked closure cannot send");
});

// Baseline guard: out-of-order local descriptions and provider completions
// must not resurrect an earlier endpoint or task after its props change.
test("baseline guard: late descriptions and catalogs cannot publish into newer endpoint context", async (t) => {
  let update;
  const pending = [];
  let finishList;
  let calls = 0;
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        personalInference: {
          describeModels: (input) => new Promise((resolve) => pending.push({ input, resolve })),
          models: () => {
            calls++;
            return new Promise((resolve) => {
              finishList = resolve;
            });
          },
        },
      },
    },
  });
  const vite = await rendererServer(t, "loqui-late-discovery-");
  const Panel = (await vite.ssrLoadModule("/components/OpenAICompatiblePanel.tsx")).default;
  const probes = createProbeRoot(t);
  const tree = await probes.mount("panel", () => {
    const [baseUrl, setBaseUrl] = React.useState(props.baseUrl);
    update = setBaseUrl;
    return Panel({ ...props, baseUrl });
  });
  const resolveDescription = (entry) =>
    entry.resolve({
      recipientToken: entry.input.baseUrl,
      host: new URL(entry.input.baseUrl).host,
      credentialId: props.credentialRef,
      generation: 1,
      present: false,
    });
  await probes.act(() => update("https://new.fixture.test/v1"));
  await probes.act(() => resolveDescription(pending[0]));
  assert.equal(button(tree()).props.disabled, true, "older main reply cannot arm new endpoint");
  await probes.act(() => resolveDescription(pending[1]));
  assert.equal(button(tree()).props.disabled, false);
  await probes.act(() => button(tree()).props.onClick());
  assert.equal(calls, 1);
  await probes.act(() => update("https://third.fixture.test/v1"));
  await probes.act(() => finishList({ data: [{ id: "late-old-model" }] }));
  assert.equal(
    findElement(tree(), (node) =>
      node.props?.models?.some((model) => model.value === "late-old-model")
    ),
    null
  );
  assert.equal(button(tree()).props.disabled, true);
  await probes.act(() => resolveDescription(pending[2]));
  assert.equal(calls, 1, "metadata refresh never retries discovery");
});
