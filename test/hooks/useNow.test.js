const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("useNow re-renders once per tick and clears its interval on unmount", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-use-now-" });
  const { useNow, NOW_TICK_MS } = await vite.ssrLoadModule("/hooks/useNow.ts");
  assert.equal(NOW_TICK_MS, 30_000);

  // Drive the interval by hand: one tick per act, so React cannot batch two
  // ticks into one render, and the clear on unmount is observable. React's
  // scheduler uses setTimeout/setImmediate, not setInterval.
  const intervals = new Map();
  const cleared = [];
  let nextId = 1;
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback, ms) => {
    const id = nextId++;
    intervals.set(id, { callback, ms });
    return id;
  };
  globalThis.clearInterval = (id) => {
    cleared.push(id);
    intervals.delete(id);
  };
  t.after(() => {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  });

  // A clock the test moves by hand, starting 30 s before local midnight.
  let clock = new Date(2026, 9, 15, 23, 59, 30).getTime();
  const readClock = () => new Date(clock);
  const seen = [];
  function Harness() {
    seen.push(useNow(NOW_TICK_MS, readClock));
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  assert.equal(intervals.size, 1, "one interval while mounted");
  const [[id, interval]] = [...intervals];
  assert.equal(interval.ms, NOW_TICK_MS);

  assert.equal(seen.at(-1).getTime(), new Date(2026, 9, 15, 23, 59, 30).getTime());

  const before = seen.length;
  clock += NOW_TICK_MS;
  await React.act(async () => interval.callback());
  assert.equal(seen.length, before + 1, "one render per tick");
  assert.equal(
    seen.at(-1).getTime(),
    new Date(2026, 9, 16, 0, 0, 0).getTime(),
    "exactly 30 s later"
  );
  assert.equal(seen.at(-1).getDate(), 16, "the date rolled over at midnight");
  clock += NOW_TICK_MS;
  await React.act(async () => interval.callback());
  assert.equal(seen.length, before + 2);
  assert.equal(seen.at(-1).getTime(), new Date(2026, 9, 16, 0, 0, 30).getTime());

  await React.act(async () => root.unmount());
  root = null;
  assert.deepEqual(cleared, [id], "the interval is cleared on unmount");
});
