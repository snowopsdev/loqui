const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { bridgeFixture } = require("./harness/onboardingBridgeFixture");

test("assistant demo stream and completion preserve the originating take through the real publish bridge", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const f = bridgeFixture();
  const requests = [];
  globalThis.__assistantDemoBridge = { requests };
  t.after(() => {
    delete globalThis.__assistantDemoBridge;
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-assistant-demo-correlation-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": "const t = (key) => key; export const useTranslation = () => ({ t });",
      "/components/chat/useChatStreaming": `
        const sendToAI = async (_request, _messages, options) => { globalThis.__assistantDemoBridge.requests.push(options); };
        export const useChatStreaming = ({ setMessages }) => {
          globalThis.__assistantDemoBridge.setMessages = setMessages;
          return { agentState: 'streaming', activeToolName: '', sendToAI };
        };
      `,
    },
  });
  const { useOnboardingAssistantDemo } = await vite.ssrLoadModule(
    "/hooks/useOnboardingAssistantDemo.ts"
  );
  let run;
  const published = [];
  const publish = (event) => {
    published.push(event);
    return f.overlayApi.publishOnboardingDemoEvent({ ...event, kind: "assistant" });
  };
  function Harness() {
    run = useOnboardingAssistantDemo(publish);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  const admit = async (id) => {
    await f.setupApi.beginOnboardingDemo({ id, kind: "assistant" });
    f.manager.sendToggleVoiceAgent();
    const take = f.sent.findLast(([name]) => name === "prepare-dictation")[1].onboardingTake;
    assert.equal(
      await f.overlayApi.publishOnboardingDemoEvent({
        ...take,
        kind: "assistant",
        status: "listening",
      }),
      true
    );
    return take;
  };
  const old = await admit("A");
  await React.act(async () => run({ text: "A", attachment: null, onboardingTake: old }));
  await React.act(async () =>
    globalThis.__assistantDemoBridge.setMessages((messages) => [
      ...messages,
      { id: "reply-A", role: "assistant", content: "draft A", isStreaming: true },
    ])
  );
  assert.equal(published.at(-1).takeId, old.takeId);
  const next = await admit("B");
  await React.act(async () => run({ text: "B", attachment: null, onboardingTake: next }));
  const count = f.broadcasts.length;
  await React.act(async () => requests[0].onComplete({ content: "late A" }));
  assert.equal(f.broadcasts.length, count);
  await React.act(async () => requests[1].onComplete({ content: "reply B" }));
  assert.equal(f.broadcasts.at(-1)[1].demoId, "B");
  assert.equal(f.broadcasts.at(-1)[1].text, "reply B");
});
