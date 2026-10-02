const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

const signedOut = { available: true, account: null };
const signedIn = {
  available: true,
  account: { type: "chatgpt", email: "fixture@example.invalid" },
};

async function mount(t, onSignedInChange, readStatus) {
  let root = null;
  const unmount = async () => {
    if (root) await React.act(async () => root.unmount());
    root = null;
  };
  t.after(unmount);
  let status = signedOut;
  const listeners = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        personalInference: {
          codexStatus: () => (readStatus ? readStatus() : Promise.resolve(status)),
          codexRateLimits: async () => ({}),
          onTextEvent: (listener) => {
            listeners.push(listener);
            return () => listeners.splice(listeners.indexOf(listener), 1);
          },
        },
      },
    },
  });
  const container = installHookDom(t);
  // The shared fake DOM only hosts a root; this component renders real elements.
  const document = globalThis.document;
  const node = (type, props) => ({
    nodeType: type,
    ownerDocument: document,
    style: {},
    childNodes: [],
    firstChild: null,
    appendChild() {},
    insertBefore() {},
    removeChild() {},
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    ...props,
  });
  document.createElement = (tag) =>
    node(1, {
      nodeName: tag.toUpperCase(),
      tagName: tag.toUpperCase(),
      namespaceURI: "http://www.w3.org/1999/xhtml",
    });
  document.createTextNode = (data) => node(3, { nodeName: "#text", data, textContent: data });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-codex-connection-test-" });
  const { default: CodexConnection } = await vite.ssrLoadModule("/components/CodexConnection.tsx");
  root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(CodexConnection, { onSignedInChange }));
  });
  return {
    unmount,
    listeners,
    async account(next) {
      status = next;
      await React.act(async () => {
        for (const listener of listeners) listener({ type: "account", method: "account/updated" });
      });
    },
  };
}

test("signing in or out after the first status read is reported to the owner", async (t) => {
  const changes = [];
  const connection = await mount(t, (value) => changes.push(value));
  assert.deepEqual(changes, [], "the initial read only sets the baseline");

  await connection.account(signedIn);
  assert.deepEqual(changes, [true]);

  await connection.account(signedIn);
  assert.deepEqual(changes, [true], "an unchanged account is not reported again");

  await connection.account(signedOut);
  assert.deepEqual(changes, [true, false]);
});

test("the connection component works without an owner callback", async (t) => {
  const connection = await mount(t, undefined);
  await assert.doesNotReject(connection.account(signedIn));
});

function deferredReads() {
  const reads = [];
  return {
    read: () => new Promise((resolve) => reads.push(resolve)),
    reads,
  };
}

test("a status read that settles after unmount never reports an account change", async (t) => {
  const changes = [];
  const pending = deferredReads();
  let first = true;
  const connection = await mount(
    t,
    (value) => changes.push(value),
    () => {
      if (first) {
        first = false;
        return Promise.resolve(signedOut);
      }
      return pending.read();
    }
  );
  // A sign-in event starts a second read; the user then leaves the step.
  await React.act(async () => {
    for (const listener of connection.listeners) listener({ type: "account" });
  });
  assert.equal(pending.reads.length, 1);
  await connection.unmount();
  await React.act(async () => pending.reads[0](signedIn));
  assert.deepEqual(changes, []);
});

test("only the newest status read can report an account change", async (t) => {
  const changes = [];
  const pending = deferredReads();
  let first = true;
  const connection = await mount(
    t,
    (value) => changes.push(value),
    () => {
      if (first) {
        first = false;
        return Promise.resolve(signedOut);
      }
      return pending.read();
    }
  );
  await React.act(async () => {
    for (const listener of connection.listeners) listener({ type: "account" });
    for (const listener of connection.listeners) listener({ type: "account" });
  });
  assert.equal(pending.reads.length, 2);
  await React.act(async () => pending.reads[1](signedOut));
  await React.act(async () => pending.reads[0](signedIn));
  assert.deepEqual(changes, [], "the older read finished last but is superseded");
});
