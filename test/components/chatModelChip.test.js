const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const route = (over = {}) => ({
  locality: "device",
  providerId: null,
  model: "Qwen3.5 2B",
  state: { status: "ready" },
  settingsPath: "llms/chatIntelligence",
  ...over,
});
async function load(t) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-chat-model-chip-" });
  const [{ default: i18n }, { initReactI18next }] = await Promise.all([
    vite.ssrLoadModule("i18next"),
    vite.ssrLoadModule("react-i18next"),
  ]);
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: require("../../src/locales/en/translation.json") } },
    interpolation: { escapeValue: false },
  });
  return vite.ssrLoadModule("/components/chat/ChatModelChip.tsx");
}
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test("next-message destination uses published locality/provider/model labels", async (t) => {
  const { ChatModelChip } = await load(t);
  for (const [over, label] of [
    [{}, "On this device · Qwen3.5 2B"],
    [{ locality: "network", model: "Llama 3.1 8B" }, "On your server · Llama 3.1 8B"],
    [{ locality: "remote", providerId: "openai", model: "GPT-5.6" }, "OpenAI · GPT-5.6"],
    [{ locality: "remote", providerId: "custom", model: "llama-3" }, "Custom endpoint · llama-3"],
    [{ locality: "remote", providerId: "???", model: "m" }, "Unknown provider · m"],
  ]) {
    const html = render(ChatModelChip, { route: route(over), onOpenSettings: () => {} });
    assert.ok(html.includes(label), html);
    assert.match(html, new RegExp(`data-locality="${over.locality ?? "device"}"`));
    assert.doesNotMatch(html, /data-state=|\?\?\?/);
    assert.match(html, /class="sr-only">Change in Settings</);
    assert.match(html, /data-settings-path="llms\/chatIntelligence"/);
    assert.match(html, /focus-visible:ring-2/);
    assert.match(html, /locality-ring&gt;span\]:text-\[12px\]/);
    assert.match(html, /focus-visible:ring-ring/);
    assert.doesNotMatch(html, /ring-ring\/|text-muted-foreground\//);
  }
});

test("not-ready routes retain visible state words and unknown stays neutral", async (t) => {
  const { ChatModelChip } = await load(t);
  for (const [state, words] of [
    [{ status: "unknown" }, "Checking…"],
    [{ status: "needsKey", provider: "openai" }, "Add API key"],
    [{ status: "unreachable", detail: "sealed" }, "Sealed"],
  ]) {
    const html = render(ChatModelChip, { route: route({ state }), onOpenSettings: () => {} });
    assert.match(html, new RegExp(`data-state="${state.status}"`));
    assert.ok(html.includes(words), html);
    assert.doesNotMatch(html, /data-state="ready"/);
    if (state.status === "unknown") assert.doesNotMatch(html, /text-destructive/);
  }
});

test("answer tags use the stored stamp without readiness or current Settings", async (t) => {
  const { RouteTag, toMessageRoute } = await load(t);
  const stored = toMessageRoute(route());
  assert.deepEqual(stored, { model: "Qwen3.5 2B", providerId: null, locality: "device" });
  const html = render(RouteTag, { route: stored });
  assert.match(html, /data-locality="device"/);
  assert.ok(html.includes("On this device · Qwen3.5 2B"));
  assert.doesNotMatch(html, /data-state|button/);
  assert.match(html, /locality-ring&gt;span\]:text-\[12px\]/);
});
