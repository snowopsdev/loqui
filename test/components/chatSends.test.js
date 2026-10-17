const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createElement } = React;
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");

const COMPOSER_MOCKS = {
  "/useVoiceDraft": `export const useVoiceDraft = () => ({ status: "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0, streamingOnlyProvider: false });`,
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Mounts render(modules, props) on the fake tree and drives the composer's
// handlers directly. Every helper yields a macrotask inside act, so async
// sends settle before the test reads the box.
async function mount(t, render, initialProps) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(t, rendererOptions("loqui-chat-sends-", COMPOSER_MOCKS));
  const modules = {
    ChatInput: (await vite.ssrLoadModule("/components/chat/ChatInput.tsx")).ChatInput,
    useChatMessageSender: (await vite.ssrLoadModule("/components/chat/useChatMessageSender.ts"))
      .useChatMessageSender,
  };
  let props = initialProps;
  const act = (fn) =>
    React.act(async () => {
      await fn();
      await settle();
    });
  const rerender = (next = {}) => {
    props = { ...props, ...next };
    return act(() => root.render(render(modules, props)));
  };
  root = createRoot(tree.container);
  await rerender();
  const textarea = () => tree.find((node) => node.tagName === "TEXTAREA");
  return {
    ...tree,
    rerender,
    run: act,
    type: (value) => act(() => tree.props(textarea()).onChange({ target: { value } })),
    press: (key) =>
      act(() =>
        tree.props(textarea()).onKeyDown({
          key,
          shiftKey: false,
          nativeEvent: { isComposing: false, keyCode: key === "Enter" ? 13 : 27 },
          preventDefault() {},
        })
      ),
    clickText: (label) =>
      act(() =>
        tree
          .props(tree.find((node) => node.tagName === "BUTTON" && node.textContent.includes(label)))
          .onClick()
      ),
    stop: () =>
      act(() =>
        tree
          .props(tree.find((node) => node.attributes?.["aria-label"] === "common.cancel"))
          .onClick()
      ),
    value: () => tree.props(textarea()).value,
  };
}

const composer = ({ ChatInput }, props) =>
  createElement(ChatInput, { partialTranscript: "", onCancel() {}, ...props });

test("a queued draft sends on idle and Stop cancels the queue", async (t) => {
  const sent = [];
  const c = await mount(t, composer, {
    agentState: "thinking",
    queueKey: "chat|1|route-a",
    onTextSubmit: async (text) => {
      sent.push(text);
      return true;
    },
  });
  await c.type("next question");
  await c.press("Enter");
  assert.deepEqual(sent, [], "nothing is sent while the agent is busy");
  assert.match(c.text(), /agentMode\.input\.queued/);
  assert.equal(c.value(), "next question", "the queued draft stays visible");
  await c.rerender({ agentState: "idle" });
  assert.deepEqual(sent, ["next question"]);
  assert.equal(c.value(), "");

  await c.rerender({ agentState: "streaming" });
  await c.type("never mind");
  await c.press("Enter");
  await c.stop();
  await c.rerender({ agentState: "idle" });
  assert.deepEqual(sent, ["next question"], "Stop never sends the queued draft");
  assert.equal(c.value(), "never mind", "and the draft stays in the box");
});

for (const [change, nextKey] of [
  ["another conversation is selected", "chat|2|route-a"],
  ["New Chat is opened", "chat|new|route-a"],
  ["the route changes", "chat|1|route-b"],
]) {
  test(`a queued draft is not sent after ${change}`, async (t) => {
    const sent = [];
    const c = await mount(t, composer, {
      agentState: "thinking",
      queueKey: "chat|1|route-a",
      onTextSubmit: async (text) => {
        sent.push(text);
        return true;
      },
    });
    await c.type("follow-up for A");
    await c.press("Enter");
    await c.rerender({ queueKey: nextKey });
    await c.rerender({ agentState: "idle" });
    assert.deepEqual(sent, [], "never sent to a destination it was not queued for");
    assert.equal(c.value(), "follow-up for A", "the words stay for a deliberate send");
    assert.match(c.text(), /agentMode\.input\.queueDropped/);
  });
}

test("without a queue key, Enter while busy keeps the draft and queues nothing", async (t) => {
  const sent = [];
  const c = await mount(t, composer, {
    agentState: "thinking",
    onTextSubmit: async (text) => {
      sent.push(text);
      return true;
    },
  });
  await c.type("held");
  await c.press("Enter");
  await c.rerender({ agentState: "idle" });
  assert.deepEqual(sent, []);
  assert.equal(c.value(), "held");
});

test("a refused send puts the draft back into an empty box", async (t) => {
  const c = await mount(t, composer, {
    agentState: "idle",
    queueKey: "k",
    onTextSubmit: async () => false,
  });
  await c.type("hello");
  await c.press("Enter");
  assert.equal(c.value(), "hello");
  assert.doesNotMatch(c.text(), /agentMode\.input\.unsent/, "an empty box is refilled, not held");
});

test("a rejected send puts the draft back into an empty box", async (t) => {
  const c = await mount(t, composer, {
    agentState: "idle",
    queueKey: "k",
    onTextSubmit: async () => {
      throw new Error("offline");
    },
  });
  await c.type("hello");
  await c.press("Enter");
  assert.equal(c.value(), "hello");
  assert.doesNotMatch(c.text(), /agentMode\.input\.unsent/);
});

for (const [outcome, settleSend] of [
  ["refusal", (pending) => pending.resolve(false)],
  ["rejection", (pending) => pending.reject(new Error("offline"))],
]) {
  test(`a ${outcome} while a newer draft exists keeps both drafts`, async (t) => {
    const pending = deferred();
    const c = await mount(t, composer, {
      agentState: "idle",
      queueKey: "k",
      onTextSubmit: () => pending.promise,
    });
    await c.type("original words");
    await c.press("Enter");
    assert.equal(c.value(), "", "the box clears while the send is in flight");
    await c.type("new words");
    await c.run(() => settleSend(pending));
    assert.equal(c.value(), "new words", "the newer draft is untouched");
    assert.match(c.text(), /agentMode\.input\.unsent/);
    await c.clickText("agentMode.input.restoreUnsent");
    assert.equal(c.value(), "original words\n\nnew words", "nothing was lost");
  });
}

// The real sender behind the real composer: the failure contract end to end.
function SenderHost({ modules, createConversation, sendToAI, thread }) {
  const persistence = {
    messages: [],
    setMessages(update) {
      thread.splice(0, thread.length, ...update(thread.slice()));
    },
    async saveUserMessage() {},
  };
  const send = modules.useChatMessageSender({
    conversationId: null,
    persistence,
    streaming: { sendToAI },
    createConversation,
  });
  return createElement(modules.ChatInput, {
    partialTranscript: "",
    agentState: "idle",
    onTextSubmit: send,
    queueKey: "chat|new|route-a",
  });
}
const senderHost = (modules, props) => createElement(SenderHost, { modules, ...props });

test("with the real sender, a failure before the save restores the draft", async (t) => {
  const thread = [];
  const c = await mount(t, senderHost, {
    thread,
    createConversation: async () => {
      throw new Error("Conversation scope is no longer available");
    },
    sendToAI: async () => {},
  });
  await c.type("hello");
  await c.press("Enter");
  assert.equal(c.value(), "hello");
  assert.doesNotMatch(c.text(), /agentMode\.input\.unsent/);
  assert.deepEqual(thread, []);
});

test("with the real sender, a failure after the save keeps the box clear and the message in the thread", async (t) => {
  const diagnostic = t.mock.method(console, "error", () => {});
  t.after(() => assert.equal(diagnostic.mock.callCount(), 1));
  const thread = [];
  const c = await mount(t, senderHost, {
    thread,
    createConversation: async () => 7,
    sendToAI: async () => {
      throw new Error("stream setup failed");
    },
  });
  await c.type("hello");
  await c.press("Enter");
  assert.equal(c.value(), "", "no duplicate offered");
  assert.equal(thread.length, 1);
  assert.equal(thread[0].content, "hello");
});

for (const cancel of ["Escape", "button", "clear"]) {
  test(`${cancel} unqueues without sending on idle`, async (t) => {
    const sent = [];
    const c = await mount(t, composer, {
      agentState: "thinking",
      queueKey: "A",
      onTextSubmit: (text) => {
        sent.push(text);
      },
    });
    await c.type("keep this");
    await c.press("Enter");
    if (cancel === "Escape") await c.press("Escape");
    else if (cancel === "button") await c.clickText("agentMode.input.unqueue");
    else await c.type("");
    await c.rerender({ agentState: "idle" });
    assert.deepEqual(sent, []);
    assert.equal(c.value(), cancel === "clear" ? "" : "keep this");
  });
}

test("simultaneous route change and idle never admits the queued send", async (t) => {
  const sent = [];
  const c = await mount(t, composer, {
    agentState: "thinking",
    queueKey: "A",
    onTextSubmit: (text) => {
      sent.push(text);
    },
  });
  await c.type("for A");
  await c.press("Enter");
  await c.rerender({ agentState: "idle", queueKey: "B" });
  assert.deepEqual(sent, []);
  assert.equal(c.value(), "for A");
  await c.press("Enter");
  assert.deepEqual(sent, ["for A"], "deliberate Enter authorizes B");
});

test("further failed drafts accumulate and discard preserves the newer draft", async (t) => {
  const pending = [];
  const c = await mount(t, composer, {
    agentState: "idle",
    queueKey: "A",
    onTextSubmit: () => {
      const send = deferred();
      pending.push(send);
      return send.promise;
    },
  });
  await c.type("first");
  await c.press("Enter");
  await c.type("second");
  await c.press("Enter");
  await c.type("newest");
  await c.run(() => pending[0].resolve(false));
  await c.run(() => pending[1].reject(new Error("not saved")));
  await c.clickText("agentMode.input.restoreUnsent");
  assert.equal(c.value(), "first\n\nsecond\n\nnewest");
  await c.press("Enter");
  await c.type("keep newest");
  await c.run(() => pending[2].resolve(false));
  await c.clickText("agentMode.input.discardUnsent");
  assert.equal(c.value(), "keep newest");
  assert.doesNotMatch(c.text(), /agentMode\.input\.unsent/);
});
