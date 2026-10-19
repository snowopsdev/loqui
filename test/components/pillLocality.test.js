const assert = require("node:assert/strict");
const test = require("node:test");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const t = (key, opts) => (opts ? `${key}|${Object.values(opts).join("|")}` : key);
async function load(ctx, mockModules = {}) {
  installBrowserGlobals(ctx);
  const vite = await createRendererServer(ctx, {
    cachePrefix: "loqui-pill-locality-",
    mockModules,
    noExternal: ["react-i18next"],
  });
  return vite.ssrLoadModule("/components/dictation/pillLocality.ts");
}
const route = (id, locality, provider, state = { status: "ready" }) => ({
  id,
  kind: "speech",
  locality,
  provider,
  providerId: null,
  recipient: null,
  model: null,
  state,
  sends: null,
  settingsPath: id,
});

test("the pill discloses the most remote active stage", async (ctx) => {
  const { combinePillLocality } = await load(ctx);
  const both = combinePillLocality(
    [route("dictationStt", "device", null), route("dictationCleanup", "remote", "OpenAI")],
    t
  );
  assert.equal(both.locality, "remote");
  assert.equal(both.provider, "OpenAI");
  assert.equal(both.blocked, false);
  const local = combinePillLocality(
    [route("dictationStt", "device", null), route("dictationCleanup", "device", null)],
    t
  );
  assert.equal(local.locality, "device");
});

test("a cleanup step that is turned off does not colour the ring", async (ctx) => {
  const { combinePillLocality } = await load(ctx);
  const off = combinePillLocality(
    [
      route("dictationStt", "network", null),
      route("dictationCleanup", "remote", "Anthropic", { status: "off" }),
    ],
    t
  );
  assert.equal(off.locality, "network");
  assert.match(off.routeLine, /pill\.route\.cleanupOff/);
});

test("provider names go through providerDisplayLabel when the route carries an id (CCR-7)", async (ctx) => {
  const { combinePillLocality } = await load(ctx);
  const custom = combinePillLocality(
    [
      route("dictationStt", "device", null),
      { ...route("dictationCleanup", "remote", "Custom endpoint"), providerId: "custom" },
    ],
    t
  );
  assert.equal(custom.provider, "locality.customEndpoint");
  const openai = combinePillLocality(
    [{ ...route("dictationStt", "remote", "OpenAI"), providerId: "openai" }],
    t
  );
  assert.equal(openai.provider, "OpenAI");
});

test("Sealed mode marks a remote route as blocked (§5.4)", async (ctx) => {
  const { combinePillLocality } = await load(ctx);
  const sealed = combinePillLocality(
    [
      route("dictationStt", "remote", "OpenAI", { status: "unreachable", detail: "sealed" }),
      route("dictationCleanup", "device", null),
    ],
    t
  );
  assert.equal(sealed.blocked, true);
  assert.equal(sealed.label, "pill.locality.sealed");
});

const snapshot = ({ settings = {}, intents = {}, routes = {} } = {}) =>
  Object.freeze({
    settings: Object.freeze({ useCleanupModel: true, voiceAgentScreenContext: false, ...settings }),
    intents: Object.freeze({ voiceAgentRequested: false, translationRequested: false, ...intents }),
    routes:
      routes === null
        ? null
        : Object.freeze({
            dictationStt: Object.freeze(route("dictationStt", "device", null)),
            dictationCleanup: Object.freeze(route("dictationCleanup", "device", null)),
            voiceAssistant: Object.freeze(route("voiceAssistant", "remote", "Anthropic")),
            assistantVision: Object.freeze(route("assistantVision", "remote", "OpenAI")),
            translation: Object.freeze(route("translation", "remote", "Gemini")),
            ...routes,
          }),
  });

test("only the frozen session's enabled Agent, vision and translation intents colour the ring", async (ctx) => {
  const { sessionPillRoutes, combinePillLocality } = await load(ctx);
  const cases = [
    [snapshot(), "device", null, ["dictationStt", "dictationCleanup"]],
    [
      snapshot({ intents: { voiceAgentRequested: true } }),
      "remote",
      "Anthropic",
      ["dictationStt", "dictationCleanup", "voiceAssistant"],
    ],
    [
      snapshot({
        settings: { voiceAgentScreenContext: true },
        intents: { voiceAgentRequested: true },
        routes: { voiceAssistant: route("voiceAssistant", "device", null) },
      }),
      "remote",
      "OpenAI",
      ["dictationStt", "dictationCleanup", "voiceAssistant", "assistantVision"],
    ],
    [
      snapshot({ intents: { translationRequested: true } }),
      "remote",
      "Gemini",
      ["dictationStt", "dictationCleanup", "translation"],
    ],
    [
      snapshot({ settings: { voiceAgentScreenContext: true } }),
      "device",
      null,
      ["dictationStt", "dictationCleanup"],
    ],
  ];
  for (const [session, locality, provider, ids] of cases) {
    const routes = sessionPillRoutes(session);
    assert.deepEqual(
      routes.map((r) => r.id),
      ids
    );
    const pill = combinePillLocality(routes, t);
    assert.equal(pill.locality, locality);
    assert.equal(pill.provider, provider);
    for (const [id, key] of [
      ["voiceAssistant", "agent"],
      ["assistantVision", "vision"],
      ["translation", "translation"],
    ]) {
      assert.equal(pill.routeLine.includes(`pill.route.${key}|`), ids.includes(id));
    }
  }
  const disabledCleanup = snapshot({
    settings: { useCleanupModel: false },
    routes: { dictationCleanup: route("dictationCleanup", "remote", "OpenAI") },
  });
  assert.equal(combinePillLocality(sessionPillRoutes(disabledCleanup), t).locality, "device");
});

test("missing frozen routes fail toward disclosure and never claim on-device work", async (ctx) => {
  const { sessionPillRoutes, combinePillLocality } = await load(ctx);
  for (const session of [
    null,
    snapshot({ routes: null }),
    snapshot({
      intents: { translationRequested: true },
      routes: { translation: undefined },
    }),
  ]) {
    const pill = combinePillLocality(sessionPillRoutes(session), t);
    assert.equal(pill.locality, "remote");
    assert.equal(pill.provider, "locality.unknownProvider");
  }
});

test("recording, processing and Undo use frozen routes; idle uses live routes; Sealed gates the same destination", async (ctx) => {
  globalThis.__pillLiveRoutes = {
    dictationStt: route("dictationStt", "remote", "OpenAI"),
    dictationCleanup: route("dictationCleanup", "device", null),
  };
  globalThis.__pillSealed = false;
  globalThis.__pillTranslate = t;
  ctx.after(() => {
    delete globalThis.__pillLiveRoutes;
    delete globalThis.__pillSealed;
    delete globalThis.__pillTranslate;
  });
  const { usePillLocality } = await load(ctx, {
    "/lib/routes": "export const useResolvedRoute = (id) => globalThis.__pillLiveRoutes[id];",
    "/stores/sealedStore":
      "export const useSealedStore = (select) => select({ sealed: globalThis.__pillSealed });",
    "react-i18next": "export const useTranslation = () => ({ t: globalThis.__pillTranslate });",
  });
  let result;
  function Harness({ session, busy }) {
    result = usePillLocality(session, busy);
    return null;
  }
  const sample = (session, busy) => {
    renderToStaticMarkup(createElement(Harness, { session, busy }));
    return result;
  };
  const local = snapshot();
  assert.equal(
    sample(local, true).locality,
    "device",
    "recording stays local after live Settings move remote"
  );
  globalThis.__pillLiveRoutes.dictationStt = route("dictationStt", "remote", "Gemini");
  assert.equal(sample(local, true).locality, "device", "processing uses the same snapshot");
  assert.equal(sample(null, false).provider, "Gemini", "idle returns to live Settings");
  assert.equal(sample(local, true).locality, "device", "Undo republishes that original session");
  const remote = snapshot({ intents: { voiceAgentRequested: true } });
  globalThis.__pillLiveRoutes.dictationStt = route("dictationStt", "device", null);
  assert.equal(
    sample(remote, true).provider,
    "Anthropic",
    "remote Agent stays disclosed after live Settings move local"
  );
  globalThis.__pillSealed = true;
  assert.equal(sample(remote, true).blocked, true);
  assert.equal(
    sample(remote, true).provider,
    "Anthropic",
    "Sealed never substitutes the live destination"
  );
  assert.equal(sample(local, true).blocked, false);
  globalThis.__pillSealed = false;
  assert.equal(sample(remote, true).blocked, false);
  assert.equal(
    sample(null, true).locality,
    "remote",
    "a missing busy session cannot fall back to live local routes"
  );
  assert.equal(sample(null, false).locality, "device");
});
