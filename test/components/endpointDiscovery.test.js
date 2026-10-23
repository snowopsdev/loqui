const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");
const { createProbeRoot, findElement } = require("../lib/probeRoot");
const { primeRouteFacts, rendererServer, routeTestApi } = require("../lib/routeTestApi");

function discoveryApi(calls) {
  return {
    personalInference: {
      describeModels: async (input) => ({
        recipientToken: "fixture-token",
        host: new URL(input.baseUrl || "https://openrouter.ai").host,
        credentialId: input.credentialRef,
        generation: 1,
        present: true,
      }),
      models: async (request) => {
        calls.push(request);
        return { data: [{ id: "model-a" }, { id: "model-b" }] };
      },
      codexModels: async () => {
        calls.push({ provider: "codex" });
        return { data: [], nextCursor: null };
      },
      onTextEvent: () => () => {},
    },
  };
}
const listButton = (tree) =>
  findElement(tree, (node) => node.props?.["data-action"] === "list-models");
const endpointField = (tree) =>
  findElement(tree, (node) => typeof node.props?.onUse === "function");

test("change-driving: authenticated discovery runs only from the List models button (C1)", async (t) => {
  const calls = [];
  installBrowserGlobals(t, { window: { electronAPI: discoveryApi(calls) } });
  const vite = await rendererServer(t, "loqui-endpoint-discovery-");
  const Panel = (await vite.ssrLoadModule("/components/OpenAICompatiblePanel.tsx")).default;
  const probes = createProbeRoot(t);
  const used = [];
  const props = (over = {}) => ({
    credentialRef: "custom:noteFormatting",
    baseUrl: "https://models.example.test/v1",
    onUseEndpoint: (url) => used.push(url),
    apiKey: "__stored__",
    saveApiKey() {},
    model: "model-a",
    onSelectModel() {},
    ...over,
  });

  // Change-driving: the panel discovered on mount (:225-237) and on a new committed base.
  await t.test(
    "change-driving: mounting, and re-rendering with another endpoint, send nothing",
    async () => {
      calls.length = 0;
      await probes.mount("panel", () => Panel(props()));
      await probes.settle();
      await probes.mount("panel", () => Panel(props({ baseUrl: "https://other.example.test/v1" })));
      await probes.settle();
      assert.equal(calls.length, 0);
    }
  );

  // Change-driving: blur committed the URL and discovered (:239-252).
  await t.test(
    "change-driving: typing, leaving the field and Use this endpoint send nothing",
    async () => {
      calls.length = 0;
      const panel = await probes.mount("panel", () => Panel(props()));
      const draft = await probes.mount("draft", () => {
        const element = endpointField(panel());
        return element.type(element.props);
      });
      const input = findElement(
        draft(),
        (node) => node.props?.dir === "ltr" && typeof node.props?.onChange === "function"
      );
      await probes.act(() =>
        input.props.onChange({ target: { value: "https://attacker.example.test/v1" } })
      );
      assert.equal(input.props.onBlur, undefined, "leaving the field commits nothing");
      await probes.act(() =>
        endpointField(panel()).props.onUse({ url: "https://other.example.test/v1", model: "" })
      );
      await probes.settle();
      assert.deepEqual(used, ["https://other.example.test/v1"]);
      assert.equal(calls.length, 0);
    }
  );

  // Change-driving: the button does not exist; it must name the host and the slot.
  await t.test(
    "[change-driving] List models names the host and saved slot, then makes exactly one call",
    async () => {
      calls.length = 0;
      const panel = await probes.mount("panel", () => Panel(props()));
      await probes.settle();
      const button = listButton(panel());
      assert.match(button.props.title, /reasoning\.custom\.listModelsSendsKey/);
      assert.match(button.props.title, /models\.example\.test/);
      assert.match(button.props.title, /reasoning\.custom\.slotCustom/);
      assert.match(button.props.title, /routes\.names\.noteFormatting/);
      await probes.act(() => button.props.onClick());
      await probes.settle();
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], {
        provider: "custom",
        baseUrl: "https://models.example.test/v1",
        credentialRef: "custom:noteFormatting",
        inferenceScope: "noteFormatting",
        recipientToken: "fixture-token",
      });
      assert.equal(JSON.stringify(calls).includes("__stored__"), false);
    }
  );

  await t.test("change-driving: without a saved key the button says no key is sent", async () => {
    globalThis.window.electronAPI.personalInference.describeModels = async () => ({
      recipientToken: "no-key-token",
      host: "models.example.test",
      credentialId: "custom:noteFormatting",
      present: false,
      generation: 2,
    });
    const panel = await probes.mount("panel-absent", () => Panel(props({ apiKey: "" })));
    await probes.settle();
    assert.match(listButton(panel()).props.title, /reasoning\.custom\.listModelsNoKey/);
  });
});

// TR-m1: a sealed refusal embeds the host, so a host with port 401 or 403 must not
// read as "unauthorized". The sealed test comes before the 401/403 mapping.
test("List models: a sealed refusal never reads as unauthorized, even for a :401 host with no key", async (t) => {
  let failure = null;
  const api = discoveryApi([]);
  api.personalInference.models = async () => {
    throw failure;
  };
  api.personalInference.describeModels = async () => ({
    recipientToken: "no-key-token",
    host: "models.example.test",
    credentialId: "custom:noteFormatting",
    present: false,
    generation: 1,
  });
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const vite = await rendererServer(t, "loqui-endpoint-sealed-401-");
  const Panel = (await vite.ssrLoadModule("/components/OpenAICompatiblePanel.tsx")).default;
  const probes = createProbeRoot(t);
  const props = {
    credentialRef: "custom:noteFormatting",
    baseUrl: "https://models.example.test/v1",
    onUseEndpoint() {},
    apiKey: "",
    saveApiKey() {},
    model: "",
    onSelectModel() {},
  };
  const alertText = async (name, error) => {
    failure = error;
    const panel = await probes.mount(name, () => Panel(props));
    await probes.settle();
    await probes.act(() => listButton(panel()).props.onClick());
    await probes.settle();
    const alert = findElement(panel(), (node) => node.props?.role === "alert");
    return alert ? String(alert.props.children) : null;
  };
  const refused =
    "Error invoking remote method 'personal-inference:models': SealedModeError: [SEALED_MODE] Sealed mode blocked customEndpoint to models.example.test:401 before any socket opened; nothing was sent.";
  assert.equal(await alertText("sealed-refused", new Error(refused)), "sealedMode.blocked.generic");
  assert.equal(
    await alertText(
      "sealed-interrupted",
      new Error("[SEALED_MODE:interrupted] Sealed mode stopped customEndpoint at host:403")
    ),
    "sealedMode.interrupted.generic"
  );
  // An ordinary 401 with no key still maps to the unauthorized copy.
  assert.equal(
    await alertText("plain-401", new Error("HTTP 401 Unauthorized")),
    "reasoning.custom.endpointUnauthorized"
  );
});

// Change-driving: the OpenRouter and custom panels discovered as soon as their tab was browsed,
// and CodexModelPicker listed models on mount.
test("change-driving: browsing ReasoningModelSelector's custom, OpenRouter and Codex tabs sends nothing", async (t) => {
  const calls = [];
  installBrowserGlobals(t, { window: { electronAPI: discoveryApi(calls) } });
  const vite = await rendererServer(t, "loqui-endpoint-discovery-selector-");
  const Selector = (await vite.ssrLoadModule("/components/ReasoningModelSelector.tsx")).default;
  const probes = createProbeRoot(t);
  const tree = await probes.mount("selector", () =>
    Selector({
      mode: "cloud",
      credentialRef: "custom:chatIntelligence",
      reasoningModel: "",
      localReasoningProvider: "custom",
      cloudReasoningBaseUrl: "https://models.example.test/v1",
      customReasoningApiKey: "__stored__",
      onCommit() {},
    })
  );
  const tabs = findElement(tree(), (node) =>
    node.props?.providers?.some?.((provider) => provider.id === "openrouter")
  );
  const mountChild = async (predicate) => {
    await probes.mount("child", () => {
      const element = findElement(tree(), predicate);
      return element.type(element.props);
    });
    await probes.settle();
  };

  await mountChild((node) => node.props?.credentialRef === "custom:chatIntelligence");
  await probes.act(() => tabs.props.onSelect("openrouter"));
  await mountChild((node) => node.props?.credentialRef === "openrouter");
  await probes.act(() => tabs.props.onSelect("codex"));
  await mountChild((node) => node.type?.name === "CodexModelPicker");
  assert.equal(calls.length, 0);
});

// Change-driving (R2-5): ReasoningModelSelector rendered OpenRouter through OpenAICompatiblePanel
// (ReasoningModelSelector.tsx:577-590), whose ApiKeyInput got no identity, so its Remove fell back to the
// permanent empty save (ApiKeyInput.tsx:164-171). Task 12 tests the Remove → toast → Undo on top of this.
test("change-driving: OpenRouter and custom slots reach ApiKeyInput as credential identities", async (t) => {
  installBrowserGlobals(t, { window: { electronAPI: discoveryApi([]) } });
  const vite = await rendererServer(t, "loqui-endpoint-identity-");
  const Selector = (await vite.ssrLoadModule("/components/ReasoningModelSelector.tsx")).default;
  const probes = createProbeRoot(t);
  const tree = await probes.mount("selector", () =>
    Selector({
      mode: "cloud",
      credentialRef: "custom:chatIntelligence",
      reasoningModel: "",
      localReasoningProvider: "custom",
      cloudReasoningBaseUrl: "https://models.example.test/v1",
      customReasoningApiKey: "__stored__",
      onCommit() {},
      onRoutePatch() {},
    })
  );
  const keyInput = async (credentialRef) => {
    const element = findElement(tree(), (node) => node.props?.credentialRef === credentialRef);
    const panel = await probes.mount(`panel-${credentialRef}`, () => element.type(element.props));
    return findElement(panel(), (node) => typeof node.props?.setApiKey === "function");
  };
  const custom = await keyInput("custom:chatIntelligence");
  assert.equal(custom.props.credentialId, "custom:chatIntelligence");
  // R2-3: without a caller-supplied saver the fallback still answers with an acknowledgement.
  assert.deepEqual(await custom.props.setApiKey("sk-test"), { ok: false, error: "unavailable" });
  const tabs = findElement(tree(), (node) =>
    node.props?.providers?.some?.((provider) => provider.id === "openrouter")
  );
  await probes.act(() => tabs.props.onSelect("openrouter"));
  assert.equal((await keyInput("openrouter")).props.credentialId, "openrouter");
});

// Change-driving (C1/I2): CodexConnection called codexStatus() on mount (CodexConnection.tsx:60-62).
// That starts the Codex app server (codexAppServer.js:359-367) and may ask GitHub to verify the
// release (codexCli.js:309-340). For a signed-in account it then called codexRateLimits() (:44-48).
// The test above stops at CodexModelPicker, so this one mounts the whole Codex tab path:
// selector → CodexModelPicker → CodexConnection.
test("change-driving: the Codex tab shows main's stored sign-in and asks ChatGPT only from its button", async (t) => {
  const calls = [];
  const listeners = [];
  // Recording spies: any call before the button is a failure.
  const spy = (name, value) => async () => {
    calls.push(name);
    return value;
  };
  installBrowserGlobals(t, {
    window: {
      electronAPI: routeTestApi({
        present: ["codex"],
        extra: {
          personalInference: {
            codexStatus: spy("codexStatus", {
              available: true,
              account: { type: "chatgpt", email: "fixture@example.invalid" },
            }),
            codexRateLimits: spy("codexRateLimits", {
              rateLimits: { primary: { usedPercent: 40 } },
            }),
            codexModels: spy("codexModels", { data: [], nextCursor: null }),
            codexLogin: spy("codexLogin", { loginId: "fixture" }),
            codexLogout: spy("codexLogout", {}),
            models: spy("models", { data: [] }),
            onTextEvent: (listener) => {
              listeners.push(listener);
              return () => listeners.splice(listeners.indexOf(listener), 1);
            },
          },
        },
      }),
    },
  });
  const vite = await rendererServer(t, "loqui-codex-settings-");
  const Selector = (await vite.ssrLoadModule("/components/ReasoningModelSelector.tsx")).default;
  await primeRouteFacts(vite);
  const probes = createProbeRoot(t);
  const selector = await probes.mount("selector", () =>
    Selector({
      mode: "cloud",
      credentialRef: "custom:chatIntelligence",
      reasoningModel: "",
      localReasoningProvider: "openai",
      cloudReasoningBaseUrl: "",
      onCommit() {},
    })
  );
  const tabs = findElement(selector(), (node) =>
    node.props?.providers?.some?.((provider) => provider.id === "codex")
  );
  await probes.act(() => tabs.props.onSelect("openrouter"));
  await probes.act(() => tabs.props.onSelect("codex"));
  const picker = await probes.mount("picker", () => {
    const element = findElement(selector(), (node) => node.type?.name === "CodexModelPicker");
    return element.type(element.props);
  });
  const connection = await probes.mount("connection", () => {
    const element = findElement(picker(), (node) => node.type?.name === "CodexConnection");
    return element.type(element.props);
  });
  await probes.settle();
  assert.deepEqual(calls, [], "mounting and browsing the Codex tab start nothing");

  const text = (pattern) =>
    findElement(
      connection(),
      (node) => typeof node.props?.children === "string" && pattern.test(node.props.children)
    );
  assert.ok(
    text(/codexConnection\.signedInStored/),
    "signed-in presence comes from credentials.list"
  );
  assert.ok(text(/codexConnection\.disconnect/));
  assert.equal(text(/codexConnection\.remaining/), null, "no quota before a check");
  const check = findElement(
    connection(),
    (node) => node.props?.["data-action"] === "codex-check-status"
  );
  assert.match(check.props.title, /codexConnection\.checkStatusTitle/);
  assert.match(String(check.props.children), /codexConnection\.checkStatus/);

  await probes.act(() => check.props.onClick());
  await probes.settle();
  assert.deepEqual(
    calls,
    ["codexStatus", "codexRateLimits"],
    "exactly one status read, then the signed-in quota"
  );
  assert.ok(text(/codexConnection\.connected/));
  assert.ok(text(/codexConnection\.remaining/));

  // An account event follows an explicit sign-in or sign-out, so it still refreshes once.
  calls.length = 0;
  await probes.act(() =>
    listeners.forEach((listener) => listener({ type: "account", method: "account/updated" }))
  );
  await probes.settle();
  assert.equal(calls.filter((name) => name === "codexStatus").length, 1);
});

// Change-driving: Connect was disabled until a status read (`disabled={busy || !status?.available}`, :127).
test("change-driving: without a stored ChatGPT sign-in, Connect is offered without a status read", async (t) => {
  const calls = [];
  const record = (name) => async () => {
    calls.push(name);
    return {};
  };
  installBrowserGlobals(t, {
    window: {
      electronAPI: routeTestApi({
        present: [],
        extra: {
          personalInference: {
            codexStatus: record("codexStatus"),
            codexRateLimits: record("codexRateLimits"),
            codexModels: record("codexModels"),
            onTextEvent: () => () => {},
          },
        },
      }),
    },
  });
  const vite = await rendererServer(t, "loqui-codex-settings-signed-out-");
  const CodexConnection = (await vite.ssrLoadModule("/components/CodexConnection.tsx")).default;
  await primeRouteFacts(vite);
  const probes = createProbeRoot(t);
  const connection = await probes.mount("connection", () => CodexConnection({}));
  await probes.settle();
  const connect = findElement(
    connection(),
    (node) =>
      typeof node.props?.onClick === "function" &&
      /codexConnection\.connect/.test(String(node.props.children))
  );
  assert.equal(connect.props.disabled, false, "an unread status no longer disables Connect");
  assert.deepEqual(calls, []);
});

// Change-driving: Tinfoil's former enabled browse hook refreshed a provider
// and could rewrite retired selections. The picker consumes its local registry.
test("change-driving: browsing Tinfoil uses the local catalog without a provider request", async (t) => {
  const calls = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        ...discoveryApi(calls),
        getTinfoilChatModels: async () => {
          calls.push("tinfoil");
          return [];
        },
      },
    },
  });
  const vite = await rendererServer(t, "loqui-tinfoil-browse-");
  const Selector = (await vite.ssrLoadModule("/components/ReasoningModelSelector.tsx")).default;
  const probes = createProbeRoot(t);
  const tree = await probes.mount("selector", () =>
    Selector({
      mode: "cloud",
      reasoningModel: "",
      localReasoningProvider: "openai",
      cloudReasoningBaseUrl: "",
      onCommit() {},
      onRoutePatch() {},
    })
  );
  const tabs = findElement(tree(), (node) =>
    node.props?.providers?.some((p) => p.id === "tinfoil")
  );
  await probes.act(() => tabs.props.onSelect("tinfoil"));
  await probes.settle();
  assert.deepEqual(calls, []);
});
