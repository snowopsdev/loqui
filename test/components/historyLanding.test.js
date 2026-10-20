const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { row } = require("../helpers/harness/historyFixture");

// A DOM host for the actual HistoryView and its production children, not a
// second implementation of landing. Frames and IPC alone are controllable.
async function mountHistory(t) {
  let resolvePage;
  const timers = new Map();
  let timerId = 0;
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, {
    initialStorage: { useLocalWhisper: "true", uploadUseLocalWhisper: "true" },
    window: {
      setTimeout: (callback) => {
        timers.set(++timerId, callback);
        return timerId;
      },
      clearTimeout: (id) => timers.delete(id),
      clearInterval() {},
      matchMedia: () => ({ matches: false }),
    },
  });
  installHookDom(t);
  const document = globalThis.document;
  class Node extends globalThis.window.HTMLElement {
    constructor(tag, type = 1) {
      super();
      this.nodeType = type;
      this.nodeName = this.tagName = tag.toUpperCase();
      this.ownerDocument = document;
      this.namespaceURI = "http://www.w3.org/1999/xhtml";
      this.childNodes = [];
      this.attributes = {};
      this.style = { setProperty() {}, removeProperty() {} };
    }
    appendChild(child) {
      delete this.text;
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    removeChild(child) {
      this.childNodes.splice(this.childNodes.indexOf(child), 1);
      child.parentNode = null;
    }
    insertBefore(child, before) {
      delete this.text;
      child.parentNode = this;
      this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
    }
    setAttributeNS(_ns, key, value) {
      this.setAttribute(key, value);
    }
    removeAttribute(key) {
      delete this.attributes[key];
    }
    getAttribute(key) {
      return this.attributes[key] ?? null;
    }
    addEventListener() {}
    removeEventListener() {}
    get firstChild() {
      return this.childNodes[0] ?? null;
    }
    get textContent() {
      return this.text ?? this.childNodes.map((n) => n.textContent).join("");
    }
    set textContent(value) {
      this.text = value;
      this.childNodes = [];
    }
    querySelector(selector) {
      return walk(
        this,
        (n) => selector === `[data-transcript-id="${n.attributes?.["data-transcript-id"]}"]`
      );
    }
    scrollIntoView(options) {
      scrolls.push([Number(this.attributes["data-transcript-id"]), options]);
    }
    getBoundingClientRect() {
      return { top: 0, left: 0, width: 500, height: 30 };
    }
  }
  const walk = (node, predicate) =>
    predicate(node) ? node : node.childNodes?.map((n) => walk(n, predicate)).find(Boolean);
  document.createElement = (tag) => new Node(tag);
  document.createElementNS = (_ns, tag) => new Node(tag);
  document.createTextNode = (value) => {
    const node = new Node("#text", 3);
    node.text = value;
    return node;
  };
  document.body = new Node("body");
  document.documentElement = new Node("html");
  const container = new Node("div");
  document.body.appendChild(container);
  const scrolls = [],
    notices = [],
    requests = [],
    copies = [],
    pending = new Map(),
    frames = new Map();
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++frameId, callback);
    return frameId;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  // Same Promise and result shape as ElectronAPI.getTranscriptionById.
  globalThis.window.electronAPI = {
    getNotes: async () => [],
    getTranscriptions: () =>
      new Promise((resolve) => {
        resolvePage = resolve;
      }),
    getTranscriptionById: (id) => {
      requests.push(id);
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
  };
  if (!i18next.isInitialized)
    await i18next.use(initReactI18next).init({
      lng: "en",
      resources: { en: { translation: require("../../src/locales/en/translation.json") } },
      interpolation: { escapeValue: false },
    });
  const vite = await createRendererServer(t);
  const { default: HistoryView } = await vite.ssrLoadModule("/components/HistoryView.tsx");
  const home = await vite.ssrLoadModule("/stores/homeViewStore.ts");
  const store = await vite.ssrLoadModule("/stores/transcriptionStore.ts");
  const { ToastContext } = await vite.ssrLoadModule("/components/ui/useToast.ts");
  home.useHomeViewStore.setState({
    query: "",
    filter: "all",
    focusTranscriptId: null,
    focusNonce: 0,
  });
  store.useTranscriptionStore.setState({
    transcriptions: [row(20), row(19, { timestamp: "2026-10-14 19:49:00" })],
  });
  let key = 0;
  let loading = false;
  let mounted = true;
  root = createRoot(container);
  function Host() {
    const history = store.useTranscriptions();
    return React.createElement(
      ToastContext.Provider,
      { value: { toast: (notice) => notices.push(notice) } },
      React.createElement(HistoryView, {
        key,
        history,
        capture: { kind: "ready" },
        isLoading: loading,
        hotkey: "Ctrl+Space",
        aiCTADismissed: true,
        useCleanupModel: false,
        showDiscarded: false,
        setAiCTADismissed() {},
        copyToClipboard: (text) => copies.push(text),
        deleteTranscription() {},
        clearAllTranscriptions() {},
        onOpenSettings() {},
        onOpenIntegrations() {},
        onShowAudioInFolder() {},
        onRetryTranscription: async () => {},
        onToggleDiscarded() {},
      })
    );
  }
  const render = () => React.act(async () => root.render(React.createElement(Host)));
  await render();
  return {
    home,
    store,
    startPage: () =>
      React.act(async () => {
        loading = true;
        // Run the actual producer used by ControlPanel, with its loading wrapper.
        void store.initializeTranscriptions(50, false).finally(() => {
          loading = false;
          if (mounted) root.render(React.createElement(Host));
        });
        root.render(React.createElement(Host));
      }),
    page: (items) => React.act(async () => resolvePage(items)),
    reject: (id) =>
      React.act(async () => pending.get(id).reject(new Error("Temporary IPC failure"))),
    retry: () => walk(container, (n) => n.tagName === "BUTTON" && n.textContent === "Retry"),
    onClick: (node) => node[Object.keys(node).find((k) => k.startsWith("__reactProps"))].onClick,
    click: (node) =>
      React.act(async () =>
        node[Object.keys(node).find((k) => k.startsWith("__reactProps"))].onClick()
      ),
    requests,
    scrolls,
    notices,
    frames,
    container,
    walk,
    copies,
    timers,
    scheduled: () => frameId,
    unmount: () =>
      React.act(async () => {
        mounted = false;
        root.render(null);
      }),
    request: (id) => React.act(async () => home.requestTranscriptFocus(id)),
    supersedeAndResolve: (newId, oldId, value) =>
      React.act(async () => {
        home.requestTranscriptFocus(newId);
        pending.get(oldId).resolve(value);
      }),
    resolve: (id, value) => React.act(async () => pending.get(id).resolve(value)),
    remount: async () => {
      key++;
      await render();
    },
    frame: async (beforeFlush) => {
      // Capture callbacks first, so cancellation alone cannot mask a missing
      // ownership check in a callback that was already dequeued by the browser.
      const batch = [...frames.values()];
      frames.clear();
      await React.act(async () => {
        beforeFlush?.();
        batch.forEach((fn) => fn(0));
      });
    },
  };
}

test("pending A cannot reveal or scroll after unmount and new Home B", async (t) => {
  const h = await mountHistory(t);
  await h.request(1);
  await h.remount();
  await h.request(20);
  await h.resolve(1, row(1, { timestamp: "2026-09-01 08:00:00" }));
  await h.frame();
  await h.frame();
  assert.deepEqual(
    h.store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [20, 19]
  );
  assert.deepEqual(
    h.scrolls.map(([id]) => id),
    [20]
  );
  assert.deepEqual(h.notices, []);
});

test("stale missing A produces no notice after unmount or newer pending B", async (t) => {
  const h = await mountHistory(t);
  await h.request(1);
  await h.remount();
  await h.request(2);
  await h.resolve(1, null);
  assert.deepEqual(h.notices, []);
  await h.resolve(2, null);
  assert.equal(h.notices.length, 1);
});

for (const betweenFrames of [false, true])
  test(`new B immediately invalidates A ${betweenFrames ? "between nested frames" : "before its first frame"}`, async (t) => {
    const h = await mountHistory(t);
    await h.request(20);
    if (betweenFrames) await h.frame();
    const scheduled = h.scheduled();
    await h.frame(() => h.home.requestTranscriptFocus(19));
    assert.equal(h.scheduled() - scheduled, 1, "only the new request may schedule a frame");
    await h.frame();
    await h.frame();
    assert.deepEqual(
      h.scrolls.map(([id]) => id),
      [19]
    );
  });

test("current fetch completes after focus id clear, reveals older page, and repeated id re-expands/restarts ring", async (t) => {
  const h = await mountHistory(t);
  await h.request(1);
  assert.equal(h.home.useHomeViewStore.getState().focusTranscriptId, null);
  await h.resolve(1, row(1, { timestamp: "2026-09-01 08:00:00" }));
  await h.frame();
  await h.frame();
  await h.frame();
  assert.equal(h.store.useTranscriptionStore.getState().transcriptions.at(-1).id, 1);
  assert.deepEqual(
    h.scrolls.map(([id]) => id),
    [1]
  );
  await h.request(19);
  await h.frame();
  await h.frame();
  const session = () => h.walk(h.container, (n) => n.attributes?.["data-session"] === "session-20");
  const button = () => h.walk(session(), (n) => n.tagName === "BUTTON");
  assert.equal(button().getAttribute("aria-expanded"), "true");
  const firstRing = h.container.querySelector('[data-transcript-id="19"]');
  assert.equal(firstRing.getAttribute("data-focused"), "true");
  // Invoke React's real onClick on the session button to collapse it.
  const propsKey = Object.keys(button()).find((k) => k.startsWith("__reactProps"));
  await React.act(async () => button()[propsKey].onClick());
  assert.equal(button().getAttribute("aria-expanded"), "false");
  await h.request(19);
  await h.frame();
  await h.frame();
  assert.equal(button().getAttribute("aria-expanded"), "true");
  assert.notEqual(h.container.querySelector('[data-transcript-id="19"]'), firstRing);
  assert.deepEqual(h.requests, [1]);
});

test("paragraph click copies except while selecting, with a visible labelled Copy button", async (t) => {
  const h = await mountHistory(t);
  await h.request(20);
  await h.frame();
  await h.frame();
  const rowNode = h.container.querySelector('[data-transcript-id="20"]');
  const paragraph = h.walk(
    rowNode,
    (n) => n.tagName === "P" && n.textContent === "Synthetic dictation 20"
  );
  const props = (node) => node[Object.keys(node).find((k) => k.startsWith("__reactProps"))];
  props(paragraph).onClick();
  globalThis.window.getSelection = () => ({ toString: () => "selected words" });
  props(paragraph).onClick();
  const copy = h.walk(
    rowNode,
    (n) => n.tagName === "BUTTON" && n.getAttribute("aria-label") === "Copy text"
  );
  assert.ok(copy);
  props(copy).onClick();
  assert.deepEqual(h.copies, ["Synthetic dictation 20", "Synthetic dictation 20"]);
  const actions = h.walk(rowNode, (n) => n.getAttribute?.("data-row-actions") === "true");
  assert.doesNotMatch(actions.getAttribute("class"), /opacity-/);
});

test("unmount cancels owned frames and ring timer", async (t) => {
  const h = await mountHistory(t);
  await h.request(20);
  assert.ok(h.frames.size);
  assert.equal(h.timers.size, 1);
  await h.unmount();
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
});

test("a newer same-instance intent invalidates a pending fetch before effects catch up", async (t) => {
  const h = await mountHistory(t);
  await h.request(1);
  await h.supersedeAndResolve(20, 1, row(1, { timestamp: "2026-09-01 08:00:00" }));
  await h.frame();
  await h.frame();
  assert.deepEqual(
    h.store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [20, 19]
  );
  assert.deepEqual(
    h.scrolls.map(([id]) => id),
    [20]
  );
  assert.deepEqual(h.notices, []);
});

for (const fetchFirst of [true, false])
  test(`real pending page and get-by-id resolve ${fetchFirst ? "fetch first" : "page first"}: target scrolls and rings`, async (t) => {
    const h = await mountHistory(t);
    await h.startPage();
    await h.request(1);
    const target = row(1, { timestamp: "2026-09-01 08:00:00" });
    if (fetchFirst) await h.resolve(1, target);
    await h.page([row(20)]);
    if (!fetchFirst) await h.resolve(1, target);
    await h.frame();
    await h.frame();
    await h.frame();
    assert.deepEqual(
      h.scrolls.map(([id]) => id),
      [1]
    );
    assert.equal(
      h.container.querySelector('[data-transcript-id="1"]').getAttribute("data-focused"),
      "true"
    );
    assert.deepEqual(
      h.store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
      [20, 1]
    );
    assert.deepEqual(h.notices, []);
  });

for (const leave of ["newB", "unmount"])
  for (const fetched of [false, true])
    test(`pending page cannot retain old A after ${leave}, fetch ${fetched ? "already revealed" : "pending"}`, async (t) => {
      const h = await mountHistory(t);
      await h.startPage();
      await h.request(1);
      if (fetched) await h.resolve(1, row(1));
      if (leave === "newB") await h.request(20);
      else await h.unmount();
      if (!fetched) await h.resolve(1, row(1));
      await h.page([row(20)]);
      await h.frame();
      await h.frame();
      await h.frame();
      assert.deepEqual(
        h.store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
        [20]
      );
      assert.deepEqual(
        h.scrolls.map(([id]) => id),
        leave === "newB" ? [20] : []
      );
      assert.deepEqual(h.notices, []);
    });

for (const remove of ["removeTranscription", "clearTranscriptions"])
  for (const fetched of [true, false])
    test(`${remove} during pending page is authoritative ${fetched ? "after" : "before"} target fetch`, async (t) => {
      const h = await mountHistory(t);
      await h.startPage();
      await h.request(1);
      if (fetched) await h.resolve(1, row(1));
      await React.act(async () => h.store[remove](1));
      if (!fetched) await h.resolve(1, row(1));
      await h.page([row(20), row(1)]);
      await h.frame();
      await h.frame();
      await h.frame();
      assert.equal(
        h.store.useTranscriptionStore.getState().transcriptions.some((r) => r.id === 1),
        false
      );
      assert.deepEqual(h.scrolls, []);
      assert.deepEqual(h.notices, []);
    });

test("current rejection is truthful and explicit Retry publishes a fresh request that succeeds", async (t) => {
  const h = await mountHistory(t);
  await h.request(1);
  await h.reject(1);
  assert.deepEqual(h.notices, []);
  assert.match(h.container.textContent, /Could not load that dictation/);
  const retry = h.retry();
  assert.ok(retry);
  assert.match(retry.getAttribute("class"), /focus-visible:ring-2 focus-visible:ring-ring/);
  assert.deepEqual(
    h.store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [20, 19]
  );
  const nonce = h.home.useHomeViewStore.getState().focusNonce;
  await h.click(retry);
  assert.equal(h.home.useHomeViewStore.getState().focusNonce, nonce + 1);
  assert.deepEqual(h.requests, [1, 1]);
  await h.resolve(1, row(1));
  await h.frame();
  await h.frame();
  await h.frame();
  assert.deepEqual(
    h.scrolls.map(([id]) => id),
    [1]
  );
  assert.equal(h.retry(), undefined);
});

for (const leave of ["newB", "unmount"])
  test(`stale rejection and old Retry are inert after ${leave}`, async (t) => {
    const h = await mountHistory(t);
    await h.request(1);
    await h.reject(1);
    const retry = h.retry();
    assert.ok(retry);
    const oldRetry = h.onClick(retry);
    await h.request(2);
    if (leave === "newB") await h.request(20);
    else await h.unmount();
    const nonce = h.home.useHomeViewStore.getState().focusNonce;
    await React.act(async () => oldRetry());
    await h.reject(2);
    assert.equal(h.home.useHomeViewStore.getState().focusNonce, nonce);
    assert.deepEqual(h.requests, [1, 2]);
    assert.equal(h.retry(), undefined);
    assert.deepEqual(h.notices, []);
  });

for (const missing of [null, row(1, { deleted_at: "2026-10-17 12:00:00" })])
  test(`successful ${missing ? "deleted" : "null"} result uses absence notice without Retry`, async (t) => {
    const h = await mountHistory(t);
    await h.request(1);
    await h.resolve(1, missing);
    assert.equal(h.notices[0].title, "That dictation is no longer in your history.");
    assert.equal(h.retry(), undefined);
  });

test("retention ends after scroll and pending page, so subsequent pages replace normally", async (t) => {
  const h = await mountHistory(t);
  await h.startPage();
  await h.request(1);
  await h.resolve(1, row(1));
  await h.frame();
  await h.frame();
  await h.frame();
  assert.deepEqual(h.scrolls, [], "landing waits for the pending page");
  await h.page([row(20)]);
  await h.frame();
  await h.frame();
  await h.frame();
  assert.deepEqual(
    h.scrolls.map(([id]) => id),
    [1]
  );
  assert.ok(h.store.useTranscriptionStore.getState().transcriptions.some((r) => r.id === 1));
  await h.startPage();
  await h.page([row(20)]);
  assert.deepEqual(
    h.store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [20]
  );
});

test("discarded page semantics do not reinsert a retained discarded target", async (t) => {
  const h = await mountHistory(t);
  await h.startPage();
  await h.request(1);
  await h.resolve(1, row(1, { status: "discarded" }));
  await h.page([row(20)]);
  await h.frame();
  await h.frame();
  await h.frame();
  assert.deepEqual(
    h.store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [20]
  );
  assert.deepEqual(h.scrolls, []);
});

test("an already loaded current target also survives a pending page without merging old history", async (t) => {
  const h = await mountHistory(t);
  await h.startPage();
  await h.request(20);
  await h.page([row(30)]);
  await h.frame();
  await h.frame();
  await h.frame();
  assert.deepEqual(h.requests, []);
  assert.deepEqual(
    h.scrolls.map(([id]) => id),
    [20]
  );
  assert.equal(
    h.container.querySelector('[data-transcript-id="20"]').getAttribute("data-focused"),
    "true"
  );
  assert.deepEqual(
    h.store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [30, 20]
  );
});

test("a page starting between landing frames rebuilds the current session before scroll", async (t) => {
  const h = await mountHistory(t);
  await h.request(20);
  await h.frame();
  await h.startPage();
  await h.page([row(30)]);
  for (let i = 0; i < 5; i++) await h.frame();
  assert.deepEqual(
    h.scrolls.map(([id]) => id),
    [20]
  );
  assert.equal(
    h.container.querySelector('[data-transcript-id="20"]').getAttribute("data-focused"),
    "true"
  );
  assert.deepEqual(
    h.store.useTranscriptionStore.getState().transcriptions.map((r) => r.id),
    [30, 20]
  );
});
