const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const summary = {
  totalWords: 12840,
  totalDictations: 214,
  averageWpm: 126,
  wpmCoveragePercent: 90,
  currentStreakDays: 3,
  longestStreakDays: 7,
  daily: [],
};
async function mount(t, { read = async () => summary, retention = true } = {}) {
  let root,
    changed,
    disposed = 0;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getAnalyticsSummary: read,
        onAnalyticsChanged: (fn) => {
          changed = fn;
          return () => disposed++;
        },
      },
    },
  });
  installHookDom(t);
  const tree = installTree();
  const calls = [];
  const { document } = globalThis;
  const create = document.createElement;
  document.createElement = (tag) =>
    Object.assign(create(tag), {
      style: {
        setProperty(name, value) {
          this[name] = value;
        },
        removeProperty(name) {
          delete this[name];
        },
      },
      scrollIntoView(options) {
        calls.push(["scroll", this, options]);
      },
      focus() {
        calls.push(["focus", this]);
      },
    });
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-insights-", {
      "/hooks/useSettings": `export const useSettings = () => ({ dataRetentionEnabled: ${retention} });`,
    })
  );
  const { default: Insights } = await vite.ssrLoadModule("/components/InsightsView.tsx");
  const home = await vite.ssrLoadModule("/stores/homeViewStore.ts");
  const { WorkspaceNavigationProvider, INERT_WORKSPACE_NAVIGATION } = await vite.ssrLoadModule(
    "/components/workspaceNavigation.tsx"
  );
  home.useHomeViewStore.setState({ filter: "notes", query: "old unmatched search" });
  const unsubscribeHome = home.useHomeViewStore.subscribe((state) =>
    calls.push(["home", { ...state }])
  );
  t.after(unsubscribeHome);
  const nav = {
    ...INERT_WORKSPACE_NAVIGATION,
    openView(view) {
      calls.push(["navigation", view, { ...home.useHomeViewStore.getState() }]);
    },
  };
  root = createRoot(tree.container);
  await React.act(async () =>
    root.render(
      React.createElement(
        WorkspaceNavigationProvider,
        { value: nav },
        React.createElement(Insights)
      )
    )
  );
  return {
    ...tree,
    vite,
    home,
    calls,
    changed: () => React.act(async () => changed()),
    disposed: () => disposed,
    unmount: () => React.act(async () => root.unmount()),
  };
}
for (const [label, filter] of [
  ["wordsSpoken", "all"],
  ["wordsPerMinute", "all"],
  ["dictations", "dictations"],
]) {
  test(`${label} clears old query before opening the promised History filter`, async (t) => {
    const h = await mount(t);
    await h.click(`insights.${label}`);
    const navigation = h.calls.find(([kind]) => kind === "navigation");
    assert.ok(navigation);
    assert.equal(navigation[1], "home");
    assert.equal(navigation[2].query, "");
    assert.equal(navigation[2].filter, filter);
    const transitions = h.calls.filter(([kind]) => kind === "home");
    assert.deepEqual(
      transitions.map(([, state]) => [state.query, state.filter]),
      [
        ["", "notes"],
        ["", filter],
      ]
    );
  });
}
test("Streak scrolls and focuses the mounted group without changing Home", async (t) => {
  const h = await mount(t);
  const before = h.home.useHomeViewStore.getState();
  await h.click("insights.currentStreak");
  assert.deepEqual(
    h.calls.map(([kind]) => kind),
    ["scroll", "focus"]
  );
  assert.equal(h.props(h.calls[0][1]).role, "group");
  assert.equal(h.calls[0][1], h.calls[1][1]);
  assert.deepEqual(h.calls[0][2], { block: "center" });
  assert.equal(h.home.useHomeViewStore.getState(), before);
});
test("loading, local error/retry and analytics subscription cleanup survive", async (t) => {
  const first = deferred();
  let reads = 0;
  const h = await mount(t, {
    read: () => (++reads === 1 ? first.promise : Promise.resolve(summary)),
    retention: false,
  });
  assert.match(h.text(), /controlPanel.loading/);
  await React.act(async () => first.reject(new Error("synthetic local read failure")));
  assert.match(h.text(), /insights.loadError/);
  assert.doesNotMatch(h.text(), /insights.wordsSpoken/);
  await h.click("common.retry");
  assert.match(h.text(), /insights.wordsSpoken/);
  assert.match(h.text(), /insights.dataRetentionDisabled/);
  await h.unmount();
  assert.equal(h.disposed(), 1);
});
for (const outcome of ["success", "failure"]) {
  test(`newest analytics generation wins over older ${outcome}`, async (t) => {
    const old = deferred(),
      newest = deferred();
    let reads = 0;
    const h = await mount(t, { read: () => (++reads === 1 ? old.promise : newest.promise) });
    await h.changed();
    await React.act(async () => newest.resolve({ ...summary, totalWords: 99000 }));
    assert.match(h.text(), /99K/);
    await React.act(async () =>
      outcome === "failure"
        ? old.reject(new Error("superseded failure"))
        : old.resolve({ ...summary, totalWords: 10 })
    );
    assert.match(h.text(), /99K/);
    assert.doesNotMatch(h.text(), /insights.loadError/);
  });
}

test("heatmap preserves every local calendar label, intensity, today and group semantics", async (t) => {
  const localKey = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const daily = [0, 20, 40, 60, 80].map((words, index) => {
    const date = new Date();
    date.setDate(date.getDate() - 4 + index);
    return { date: localKey(date), words };
  });
  const h = await mount(t, { read: async () => ({ ...summary, daily }) });
  const { buildAnalyticsActivityDays } = await h.vite.ssrLoadModule("/helpers/analytics.js");
  const days = buildAnalyticsActivityDays(daily);
  const cells = [];
  const walk = (node) => {
    if (h.props(node)?.role === "img") cells.push(h.props(node));
    for (const child of node.childNodes) walk(child);
  };
  walk(h.container);
  assert.deepEqual(
    cells.map((cell) => cell["aria-label"]),
    days.map((day) => `insights.dayTooltip(date=${day.date},count=${day.words})`)
  );
  assert.deepEqual(
    cells.map((cell) => cell["data-intensity"]),
    days.map((day) => (day.words === 0 ? 0 : Math.max(1, Math.ceil((day.words / 80) * 4))))
  );
  assert.equal(cells.filter((cell) => cell["data-today"]).length, 1);
  assert.equal(cells.at(-1)["data-today"], true);
  assert.ok(cells.every((cell) => cell.tabIndex === undefined));
  const group = h.find((node) => h.props(node)?.role === "group");
  assert.equal(h.props(group).tabIndex, 0);
  assert.equal(h.props(group)["aria-label"], "insights.activityLabel");
});
