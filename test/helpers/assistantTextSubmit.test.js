const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("./harness/rendererMocks");

async function load(t) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-assistant-text-submit-"));
  return vite.ssrLoadModule("/components/dictation/assistantTextSubmit.ts");
}

// A stand-in for AssistantPanel's selection state and its sender.
function panel(result) {
  const log = [];
  let selected = { text: "the quoted answer", sourceMessageId: "m1" };
  const original = selected;
  return {
    log,
    original,
    get selected() {
      return selected;
    },
    select(next) {
      selected = next;
    },
    hooks: {
      send: async (text, options) => {
        log.push(["send", text, options?.selectedContext ?? null]);
        if (result instanceof Error) throw result;
        return result;
      },
      clear: () => {
        log.push(["clear"]);
        selected = null;
      },
      current: () => selected,
      restore: (context) => {
        log.push(["restore", context]);
        selected = context;
      },
    },
  };
}

test("a sent message takes its context with it, and the chip clears first", async (t) => {
  const { sendWithSelectedContext } = await load(t);
  const p = panel(true);
  assert.equal(await sendWithSelectedContext("rewrite it", p.selected, p.hooks), true);
  assert.deepEqual(p.log, [["clear"], ["send", "rewrite it", p.original]]);
  assert.equal(p.selected, null);
});

test("a send that was not made gives the context back with the words", async (t) => {
  const { sendWithSelectedContext } = await load(t);
  const p = panel(false);
  assert.equal(await sendWithSelectedContext("rewrite it", p.selected, p.hooks), false);
  assert.deepEqual(p.log.at(-1), ["restore", p.original]);
  assert.equal(p.selected, p.original, "a retry sends the same request");
});

test("a rejected send gives the context back and still rejects", async (t) => {
  const { sendWithSelectedContext } = await load(t);
  const p = panel(new Error("save failed"));
  await assert.rejects(sendWithSelectedContext("rewrite it", p.selected, p.hooks), /save failed/);
  assert.equal(p.selected, p.original);
});

test("a newer selection is never overwritten by a failed send", async (t) => {
  const { sendWithSelectedContext } = await load(t);
  const p = panel(false);
  const newer = { text: "another passage", sourceMessageId: "m1" };
  const send = p.hooks.send;
  p.hooks.send = async (...args) => {
    const result = await send(...args);
    p.select(newer); // the user selects again while the send is in flight
    return result;
  };
  assert.equal(await sendWithSelectedContext("rewrite it", p.selected, p.hooks), false);
  assert.equal(p.selected, newer);
  assert.equal(
    p.log.some(([kind]) => kind === "restore"),
    false
  );
});

test("a refusal that beats React's commit still gives the context back", async (t) => {
  const { sendWithSelectedContext } = await load(t);
  const p = panel(false);
  const sent = p.selected;
  // The panel's ref still holds the context: the clear has not committed yet.
  p.hooks.current = () => sent;
  assert.equal(await sendWithSelectedContext("rewrite it", sent, p.hooks), false);
  assert.deepEqual(p.log.at(-1), ["restore", sent]);
});

test("without a context nothing is cleared or restored", async (t) => {
  const { sendWithSelectedContext } = await load(t);
  const p = panel(false);
  p.select(null);
  assert.equal(await sendWithSelectedContext("hello", null, p.hooks), false);
  assert.deepEqual(p.log, [["send", "hello", null]]);
});
