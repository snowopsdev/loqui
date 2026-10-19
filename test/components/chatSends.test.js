const fs = require("node:fs");
const path = require("node:path");
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
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");

const COMPOSER_MOCKS = {
  "/ui/useToast": TOAST_MOCK,
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

// Plan 06 Task 4: composer seeds. A seed never submits (review I01, I01-R2).
const QUEUE = "chat|1|route-a";
const isArmed = (c) => /agentMode\.input\.queued/.test(c.text());

test("a palette seed disarms a queued draft and holds the words it replaced", async (t) => {
  const sent = [];
  const c = await mount(t, composer, {
    agentState: "streaming",
    queueKey: QUEUE,
    onTextSubmit: async (text) => (sent.push(text), true),
  });
  await c.type("A");
  await c.press("Enter");
  assert.ok(isArmed(c), "the queue was armed before the seed");
  await c.rerender({ seed: { nonce: 1, text: "B", resetQueue: true } });
  assert.ok(!isArmed(c));
  assert.match(c.text(), /agentMode\.input\.queueDropped/, "the user is told A was not sent");
  await c.rerender({ agentState: "idle" });
  assert.deepEqual(sent, []);
  assert.equal(c.value(), "B");
  assert.match(c.text(), /agentMode\.input\.unsent/, "A is held, not lost");
  await c.clickText("agentMode.input.restoreUnsent");
  assert.equal(c.value(), "A\n\nB");
});

test("a seed that lands in the same commit as idle still wins over the queue", async (t) => {
  const sent = [];
  const c = await mount(t, composer, {
    agentState: "thinking",
    queueKey: QUEUE,
    onTextSubmit: async (text) => (sent.push(text), true),
  });
  await c.type("A");
  await c.press("Enter");
  assert.ok(isArmed(c));
  await c.rerender({ agentState: "idle", seed: { nonce: 2, text: "B", resetQueue: true } });
  assert.deepEqual(sent, []);
  assert.equal(c.value(), "B");
});

test("a focus-only request keeps the draft and the queue the user armed", async (t) => {
  const sent = [];
  const c = await mount(t, composer, {
    agentState: "streaming",
    queueKey: QUEUE,
    onTextSubmit: async (text) => (sent.push(text), true),
  });
  await c.type("A");
  await c.press("Enter");
  assert.ok(isArmed(c));
  await c.rerender({ seed: { nonce: 3, resetQueue: false } });
  assert.ok(isArmed(c), "still armed after a focus request");
  await c.rerender({ agentState: "idle" });
  assert.deepEqual(sent, ["A"]);
});

test("an edit seed (a mention pick) keeps the queue and never holds the user's own draft", async (t) => {
  const c = await mount(t, composer, {
    agentState: "streaming",
    queueKey: QUEUE,
    onTextSubmit: async () => true,
  });
  await c.type("ask @pri");
  await c.press("Enter");
  assert.ok(isArmed(c));
  await c.rerender({ seed: { nonce: 4, text: "ask @Pricing review ", resetQueue: false } });
  assert.equal(c.value(), "ask @Pricing review ");
  assert.ok(isArmed(c));
  assert.doesNotMatch(c.text(), /agentMode\.input\.unsent/);
});

test("a refused send overtaken by a new chat is held, never refilled into the new chat", async (t) => {
  const pending = deferred();
  const c = await mount(t, composer, {
    agentState: "idle",
    queueKey: QUEUE,
    onTextSubmit: () => pending.promise,
  });
  await c.type("A");
  await c.press("Enter"); // the send starts and the box clears
  assert.equal(c.value(), "");
  await c.rerender({ queueKey: "chat|new|route-a", seed: { nonce: 5, resetQueue: true } });
  await c.run(() => pending.resolve(false));
  assert.equal(c.value(), "", "the new chat's box stays empty");
  assert.match(c.text(), /agentMode\.input\.unsent/, "A is held with Restore and Discard");
});

test("a seed present at mount fills the composer and sends nothing", async (t) => {
  const sent = [];
  const c = await mount(t, composer, {
    agentState: "idle",
    queueKey: QUEUE,
    seed: { nonce: 6, text: "“Thursday, not Monday” ", resetQueue: true },
    onTextSubmit: async (text) => (sent.push(text), true),
  });
  assert.equal(c.value(), "“Thursday, not Monday” ");
  assert.deepEqual(sent, []);
});

test("ChatView turns a request into a seed during render, not in its request effect", async () => {
  const { seedForRequest } = await import("../../src/components/chat/chatRequest.ts");
  assert.deepEqual(seedForRequest({ kind: "new", draft: "x", nonce: 7 }), {
    nonce: 7,
    text: "x",
    resetQueue: true,
  });
  assert.deepEqual(seedForRequest({ kind: "open", conversationId: 3, nonce: 8 }), {
    nonce: 8,
    resetQueue: true,
  });
  assert.deepEqual(seedForRequest({ kind: "focus", nonce: 9 }), { nonce: 9, resetQueue: false });
  const view = fs.readFileSync(
    path.join(__dirname, "../../src/components/chat/ChatView.tsx"),
    "utf8"
  );
  assert.match(
    view,
    /if \(request && request\.nonce !== seededNonce\) \{\s*setSeededNonce\(request\.nonce\);\s*setComposerSeed\(\{ \.\.\.seedForRequest\(request\), nonce: \+\+seedSequenceRef\.current \}\);/
  );
  const effect = view.slice(view.indexOf("if (!request) return;"));
  assert.doesNotMatch(
    effect.slice(0, effect.indexOf("[request?.nonce]")),
    /setComposerSeed/,
    "the effect only runs side effects"
  );
});

for (const outcome of ["refusal", "rejection"]) {
  test(`an overtaken ${outcome} stays held after a seed is cleared and its text edited`, async (t) => {
    const pending = deferred();
    const c = await mount(t, composer, {
      agentState: "idle",
      queueKey: QUEUE,
      onTextSubmit: () => pending.promise,
    });
    await c.type("original");
    await c.press("Enter");
    await c.rerender({ seed: { nonce: 10, text: "new intent", resetQueue: true } });
    await c.rerender({ seed: null });
    await c.type("");
    await c.run(() =>
      outcome === "refusal" ? pending.resolve(false) : pending.reject(new Error("offline"))
    );
    assert.equal(c.value(), "");
    assert.match(c.text(), /agentMode.input.unsent/);
    await c.clickText("agentMode.input.restoreUnsent");
    assert.equal(c.value(), "original");
  });
}

test("an open seed without text disarms but preserves the visible draft", async (t) => {
  const sent = [];
  const c = await mount(t, composer, {
    agentState: "streaming",
    queueKey: QUEUE,
    onTextSubmit: (text) => sent.push(text),
  });
  await c.type("retain these words");
  await c.press("Enter");
  assert.ok(isArmed(c));
  await c.rerender({ agentState: "idle", seed: { nonce: 11, resetQueue: true } });
  assert.equal(c.value(), "retain these words");
  assert.deepEqual(sent, []);
  assert.doesNotMatch(c.text(), /agentMode.input.unsent/);
});

test("focus and edit seeds keep the refill rule for an in-flight refused send", async (t) => {
  const pending = deferred();
  const c = await mount(t, composer, {
    agentState: "idle",
    queueKey: QUEUE,
    onTextSubmit: () => pending.promise,
  });
  await c.type("original");
  await c.press("Enter");
  await c.rerender({ seed: { nonce: 12, resetQueue: false } });
  await c.rerender({ seed: { nonce: 13, text: "", resetQueue: false } });
  await c.run(() => pending.resolve(false));
  assert.equal(c.value(), "original");
  assert.doesNotMatch(c.text(), /agentMode.input.unsent/);
});

test("repeated seed nonces preserve edits and exact replaced whitespace is restorable", async (t) => {
  const c = await mount(t, composer, { agentState: "idle", queueKey: QUEUE });
  await c.type("  words\n");
  await c.rerender({ seed: { nonce: 14, text: "words", resetQueue: true } });
  await c.type("my edit");
  await c.rerender({ seed: { nonce: 14, text: "words", resetQueue: true } });
  assert.equal(c.value(), "my edit");
  await c.clickText("agentMode.input.restoreUnsent");
  assert.equal(c.value(), "  words\n\n\nmy edit");
});

test("the shared mounted composer helper arms a destination-bound queue", async (t) => {
  const { mountComposer } = require("../helpers/harness/mountComposer");
  const sent = [];
  const c = await mountComposer(t, async (text) => (sent.push(text), true), {
    agentState: "thinking",
  });
  await c.type("helper draft");
  await c.press("Enter");
  await c.render({ agentState: "idle" });
  assert.deepEqual(sent, ["helper draft"], "the helper supplies a usable queueKey");
});

test("hiding disarms the existing queue before idle and preserves its words on reopen", async (t) => {
  const sends = [];
  const ui = await mount(t, ({ ChatInput }, props) => createElement(ChatInput, props), {
    agentState: "streaming",
    partialTranscript: "",
    active: true,
    queueKey: "note|9|1",
    onTextSubmit: (text) => sends.push(text),
  });
  await ui.type("Keep these queued words");
  await ui.press("Enter");
  await ui.rerender({ active: false, agentState: "idle" });
  assert.deepEqual(sends, []);
  assert.equal(ui.value(), "Keep these queued words");
  await ui.press("Enter");
  assert.deepEqual(sends, [], "a stale keyboard handler cannot submit while hidden");
  await ui.rerender({ active: true });
  assert.deepEqual(sends, [], "reopening never rearms a queue");
  assert.equal(ui.value(), "Keep these queued words");
});
