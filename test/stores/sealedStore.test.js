const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function freshSealed(t, electronAPI) {
  installBrowserGlobals(t, { window: { electronAPI } });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-sealed-store-test-" });
  return vite.ssrLoadModule("/stores/sealedStore.ts");
}

function privacy(getSealed) {
  const handle = { emit: null, fetches: 0, subscriptions: 0 };
  handle.api = {
    privacy: {
      getSealed: () => {
        handle.fetches++;
        return getSealed();
      },
      onSealedChange: (cb) => {
        handle.subscriptions++;
        handle.emit = cb;
        return () => {};
      },
    },
  };
  return handle;
}

test("[change-driving] a seal event that arrives while the first fetch is in flight wins over the fetch", async (t) => {
  // I14: event version versus fetch ordering.
  const fetch = deferred();
  const p = privacy(() => fetch.promise);
  const sealed = await freshSealed(t, p.api);
  assert.deepEqual(sealed.useSealedStore.getState(), { sealed: false, known: false });
  sealed.ensureSealedSubscribed();
  p.emit(true);
  fetch.resolve(false);
  await flush();
  assert.equal(sealed.getSealed(), true);
  assert.deepEqual(sealed.useSealedStore.getState(), { sealed: true, known: true });
  p.emit(false);
  assert.equal(sealed.getSealed(), false);
});

test("[change-driving] the fetch applies when no event arrived, and the store subscribes once", async (t) => {
  const p = privacy(async () => true);
  const sealed = await freshSealed(t, p.api);
  sealed.ensureSealedSubscribed();
  sealed.ensureSealedSubscribed();
  await flush();
  assert.deepEqual(sealed.useSealedStore.getState(), { sealed: true, known: true });
  assert.equal(p.fetches, 1);
  assert.equal(p.subscriptions, 1);
});

test("[change-driving] a failed fetch leaves the seal unknown until an event says otherwise", async (t) => {
  const p = privacy(() => Promise.reject(new Error("privacy unavailable")));
  const sealed = await freshSealed(t, p.api);
  sealed.ensureSealedSubscribed();
  await flush();
  assert.deepEqual(sealed.useSealedStore.getState(), { sealed: false, known: false });
  p.emit(true);
  assert.deepEqual(sealed.useSealedStore.getState(), { sealed: true, known: true });
});

test("[change-driving] without a privacy API nothing can be sealed, and that is known", async (t) => {
  const sealed = await freshSealed(t, {});
  sealed.ensureSealedSubscribed();
  await flush();
  assert.deepEqual(sealed.useSealedStore.getState(), { sealed: false, known: true });
});
