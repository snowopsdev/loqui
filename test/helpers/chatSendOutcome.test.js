const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function makeSender(t, { createConversation, saveUserMessage, sendToAI }) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-chat-send-outcome-" });
  const { useChatMessageSender } = await vite.ssrLoadModule(
    "/components/chat/useChatMessageSender.ts"
  );
  const thread = [];
  const persistence = {
    messages: [],
    setMessages(update) {
      thread.splice(0, thread.length, ...update(thread.slice()));
    },
    saveUserMessage: saveUserMessage ?? (async () => {}),
  };
  let send;
  function Harness() {
    send = useChatMessageSender({
      conversationId: null,
      persistence,
      streaming: { sendToAI: sendToAI ?? (async () => {}) },
      createConversation: createConversation ?? (async () => 1),
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  return { send: (text, options) => send(text, options), thread };
}

test("a failure before the conversation exists rejects, with nothing dispatched", async (t) => {
  const dispatched = [];
  const s = await makeSender(t, {
    createConversation: async () => {
      throw new Error("Conversation scope is no longer available");
    },
    sendToAI: async (text) => dispatched.push(text),
  });
  await assert.rejects(s.send("hello"), /Conversation scope is no longer available/);
  assert.deepEqual(s.thread, []);
  assert.deepEqual(dispatched, []);
});

test("a failed save rejects and takes the optimistic message back out", async (t) => {
  const dispatched = [];
  const s = await makeSender(t, {
    saveUserMessage: async () => {
      throw new Error("disk full");
    },
    sendToAI: async (text) => dispatched.push(text),
  });
  await assert.rejects(s.send("hello"), /disk full/);
  assert.deepEqual(s.thread, [], "the words live only in the composer now");
  assert.deepEqual(dispatched, [], "nothing goes to the provider unsaved");
});

test("once the message is saved, a later failure still reports it as sent", async (t) => {
  const diagnostic = t.mock.method(console, "error", () => {});
  t.after(() => assert.equal(diagnostic.mock.callCount(), 1));
  const s = await makeSender(t, {
    sendToAI: async () => {
      throw new Error("stream setup failed");
    },
  });
  assert.equal(await s.send("hello"), true);
  assert.equal(s.thread.length, 1, "the thread shows it, so the composer must not offer it again");
});

test("a provider error rendered in the thread counts as sent", async (t) => {
  const s = await makeSender(t, { sendToAI: async () => {} });
  assert.equal(await s.send("hello"), true);
});

test("final fix: a throwing acceptance observer reports its error and still infers exactly once", async (t) => {
  const saved = [],
    inferred = [];
  const error = new Error("intentional acceptance observer failure");
  const s = await makeSender(t, {
    saveUserMessage: async (...args) => saved.push(args),
    sendToAI: async (...args) => inferred.push(args),
  });
  assert.equal(
    await s.send("accepted words", {
      onAccepted(id) {
        assert.equal(id, 1);
        throw error;
      },
    }),
    true
  );
  assert.deepEqual(saved, [["accepted words", 1]]);
  assert.equal(s.thread.length, 1);
  assert.equal(inferred.length, 1);
  assert.equal(inferred[0][0], "accepted words");
  assert.equal(inferred[0][2].owner.conversationId, 1);
});
