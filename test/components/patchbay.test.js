const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");
const { makeSnapshot } = require("../lib/routeFixtures");

const CREDENTIAL_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "xai",
  "mistral",
  "openrouter",
  "tinfoil",
  "deepgram",
  "assemblyai",
  "corti:text",
  "corti:speech",
  "codex",
  "bedrock",
  "azure",
  "vertex",
];
const creds = (present = []) => new Map(CREDENTIAL_IDS.map((id) => [id, present.includes(id)]));
// The same default board as patchbayDestinations.test.js, on Task 1's shared fixture.
function snapshot() {
  return makeSnapshot({
    stt: {
      upload: { mode: "providers", cloudProvider: "openai", cloudModel: "gpt-4o-mini-transcribe" },
    },
    llm: {
      dictationTranslation: {
        mode: "self-hosted",
        remoteUrl: "http://192.168.1.20:11434/v1",
        model: "llama3.1:8b",
      },
      chatIntelligence: { mode: "providers", provider: "groq", model: "openai/gpt-oss-120b" },
    },
    enabled: { cleanup: false, screenContext: false },
    facts: {
      credentials: creds(["openai", "anthropic", "corti:text"]),
      rejected: new Set(["anthropic"]),
    },
  });
}
const SPEECH = ["openai", "groq", "corti", "deepgram", "custom"];
const TEXT = ["openai", "anthropic", "groq", "corti", "custom"];
const providersFor = (id) =>
  id === "assistantVision"
    ? ["openai", "anthropic"]
    : id === "noteRecordingStt"
      ? ["openai", "corti", "deepgram"]
      : id === "dictationStt" || id === "uploadStt"
        ? SPEECH
        : TEXT;
const tr = (key, options) => (options ? `${key}${JSON.stringify(options)}` : key);

const defer = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () =>
  React.act(async () => {
    await new Promise((r) => setImmediate(r));
  });
function find(node, predicate) {
  if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}

function mountHook(_st, useHook, getProps) {
  const container = globalThis.document.documentElement;
  let latest;
  function Probe() {
    latest = useHook(getProps());
    return null;
  }
  const root = createRoot(container);
  _st.after(async () => React.act(async () => root.unmount()));
  return {
    current: () => latest,
    render: () => React.act(async () => root.render(React.createElement(Probe))),
  };
}

test("patchbay", async (t) => {
  installBrowserGlobals(t);
  installHookDom(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-patchbay-test-" }, { withOptions: true })
  );
  const graph = await vite.ssrLoadModule("/lib/routeGraph.ts");
  const d = await vite.ssrLoadModule("/components/settings/routing/destinations.ts");
  const view = await vite.ssrLoadModule("/components/settings/routing/Patchbay.tsx");
  const boardModule = await vite.ssrLoadModule("/components/settings/routing/usePatchbayBoard.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const staged = await vite.ssrLoadModule("/components/settings/routing/StagedRoutePanel.tsx");
  const section = await vite.ssrLoadModule("/components/settings/routing/RoutingSection.tsx");

  const baseSnapshot = snapshot();
  const baseRoutes = graph.resolveRoutes(baseSnapshot);

  function makeDeps(over = {}) {
    const snap = over.snapshot ?? baseSnapshot;
    const calls = [];
    const state = { next: "staged" };
    const deps = {
      routes: graph.resolveRoutes(snap),
      snapshot: snap,
      sealed: false,
      providersFor,
      copy: snap.copy,
      t: tr,
      request: async (id, target) => {
        calls.push({ id, target });
        return typeof state.next === "function" ? state.next() : state.next;
      },
      ...over,
    };
    return { deps, calls, state };
  }
  const plan = (changes, kind = "instant") => ({
    routeId: "chat",
    patch: {},
    undoPatch: {},
    changes,
    kind,
    blocker: null,
  });
  const change = (id, after, coupled = false) => ({ id, before: after, after, coupled });
  const deviceAs = (id) => ({ ...baseRoutes.find((r) => r.id === "dictationStt"), id });
  const pick = async (b, id) =>
    React.act(async () =>
      b.current().pickDestination(b.current().destinations.find((x) => x.id === id))
    );
  const selectTask = (b, id) => React.act(async () => b.current().selectTask(id));

  await t.test(
    "the view: every task and destination is a real button; cables are hidden from assistive tech",
    () => {
      // change-driving: the view does not exist yet.
      const dests = d.buildDestinations(baseSnapshot, baseRoutes);
      const html = renderToStaticMarkup(
        React.createElement(view.PatchbayView, {
          routes: baseRoutes,
          destinations: dests,
          destinationOf: d.destinationKeyOf,
          compatOf: () => null,
          keyStateOf: () => null,
          selectedId: null,
          stagedRouteId: null,
          sealed: false,
          message: null,
          onUndo: null,
          wide: true,
          cables: [{ id: "chat", d: "M 0 0 C 1 1, 2 2, 3 3", locality: "remote", paused: false }],
          onSelectTask() {},
          onPickDestination() {},
          onOpenSettings() {},
        })
      );
      assert.equal((html.match(/data-task="/g) ?? []).length, 11);
      assert.equal((html.match(/data-destination="/g) ?? []).length, dests.length);
      assert.match(html, /role="group"[^>]*aria-label="patchbay\.tasks"/);
      assert.match(html, /role="group"[^>]*aria-label="patchbay\.destinations"/);
      assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*class="patchbay-cables"/);
      assert.match(html, /data-task="speakerId"[^>]*aria-disabled="true"/);
      assert.match(html, /patchbay\.locked\.speakerId/);
      assert.match(html, /data-destination="network:192\.168\.1\.20:11434"/);
      assert.match(
        html,
        /<span[^>]*dir="ltr"[^>]*>192\.168\.1\.20:11434<\/span>/,
        "the card names the host that receives the data"
      );
      assert.match(html, /data-escape-active="false"/);
    }
  );

  await t.test(
    "the view: selecting a task marks compatible and incompatible destinations, with the key state of the slot the task uses",
    () => {
      // change-driving: PatchbayView does not exist yet.
      const dests = d.buildDestinations(baseSnapshot, baseRoutes);
      const c = d.compatContext(baseSnapshot, false, providersFor);
      const selected = baseRoutes.find((r) => r.id === "dictationStt");
      const html = renderToStaticMarkup(
        React.createElement(view.PatchbayView, {
          routes: baseRoutes,
          destinations: dests,
          destinationOf: d.destinationKeyOf,
          compatOf: (dest) => d.checkCompatibility("dictationStt", dest, c),
          keyStateOf: (dest) =>
            d.destinationKeyState(dest, baseSnapshot.facts, d.taskKind(selected.id)),
          selectedId: "dictationStt",
          stagedRouteId: null,
          sealed: false,
          message: null,
          onUndo: null,
          wide: true,
          onSelectTask() {},
          onPickDestination() {},
          onOpenSettings() {},
        })
      );
      assert.match(html, /data-task="dictationStt"[^>]*aria-pressed="true"/);
      assert.match(
        html,
        /data-destination="anthropic"[^>]*data-compat="no"[^>]*aria-disabled="true"/
      );
      assert.match(html, /data-destination="groq"[^>]*data-compat="ok"/);
      assert.match(html, /data-escape-active="true"/);
      const corti = html.split('data-destination="corti"')[1].split("</button>")[0];
      assert.match(
        corti,
        /patchbay\.dest\.noKey/,
        "Corti speech needs the client pair, which is not saved"
      );
      const openai = html.split('data-destination="openai"')[1].split("</button>")[0];
      assert.match(openai, /patchbay\.dest\.keySaved/);
    }
  );

  await t.test(
    "the view: the meter counts what stays, the footer names what leaves and where, and sealed mode says so",
    () => {
      // change-driving: PatchbayView does not exist yet.
      const dests = d.buildDestinations(baseSnapshot, baseRoutes);
      const html = renderToStaticMarkup(
        React.createElement(view.PatchbayView, {
          routes: baseRoutes,
          destinations: dests,
          destinationOf: d.destinationKeyOf,
          compatOf: () => null,
          keyStateOf: () => null,
          selectedId: null,
          stagedRouteId: null,
          sealed: true,
          message: null,
          onUndo: null,
          wide: true,
          onSelectTask() {},
          onPickDestination() {},
          onOpenSettings() {},
        })
      );
      assert.match(
        html,
        /role="img"[^>]*aria-label="patchbay\.meter\.label\{&quot;count&quot;:8,&quot;total&quot;:11\}"/
      );
      assert.match(
        html,
        /patchbay\.leaves\.item\{&quot;task&quot;:&quot;routes\.names\.chat&quot;,&quot;destination&quot;:&quot;Groq&quot;\}/
      );
      assert.match(
        html,
        /patchbay\.leaves\.item\{&quot;task&quot;:&quot;routes\.names\.translation&quot;,&quot;destination&quot;:&quot;patchbay\.dest\.serverAt\{[^<]*192\.168\.1\.20:11434/
      );
      assert.match(html, /patchbay\.sealed/);
    }
  );

  await t.test(
    "the view: a status message can carry an Undo, and narrow boards drop the cables and keep the list",
    () => {
      // change-driving: PatchbayView does not exist yet.
      const dests = d.buildDestinations(baseSnapshot, baseRoutes);
      const props = {
        routes: baseRoutes,
        destinations: dests,
        destinationOf: d.destinationKeyOf,
        compatOf: () => null,
        keyStateOf: () => null,
        selectedId: null,
        stagedRouteId: null,
        sealed: false,
        message: "moved",
        onUndo() {},
        wide: false,
        cables: [{ id: "chat", d: "M 0 0", locality: "remote", paused: false }],
        onSelectTask() {},
        onPickDestination() {},
        onOpenSettings() {},
      };
      const html = renderToStaticMarkup(React.createElement(view.PatchbayView, props));
      assert.doesNotMatch(html, /patchbay-cables/);
      assert.match(html, /data-layout="list"/);
      assert.match(html, /role="status"[^>]*>moved</);
      assert.match(html, /data-action="undo-route"/);
    }
  );

  await t.test(
    "the board: a compatible pick calls requestRouteChange with the destination's target, then clears the selection",
    async (st) => {
      // change-driving: nothing builds a planner request from a destination yet.
      const { deps, calls } = makeDeps();
      const b = mountHook(st, boardModule.usePatchbayBoard, () => deps);
      await b.render();
      await selectTask(b, "chat");
      assert.equal(b.current().selectedId, "chat");
      await pick(b, "openai");
      assert.deepEqual(calls, [{ id: "chat", target: { mode: "providers", provider: "openai" } }]);
      assert.equal(b.current().selectedId, null);
      assert.equal(
        b.current().message,
        'patchbay.hint.staged{"task":"routes.names.chat","destination":"OpenAI"}'
      );
      assert.equal(b.current().undo, null);
    }
  );

  await t.test(
    "the board: an instant change says where it went, lists coupled routes and offers one Undo",
    async (st) => {
      // change-driving (I1, I6).
      const { deps, calls, state } = makeDeps();
      const undone = { applied: true, blocker: null, plan: plan([]) };
      state.next = {
        applied: true,
        blocker: null,
        plan: plan([
          change("chat", deviceAs("chat")),
          change("assistantVision", deviceAs("assistantVision"), true),
        ]),
        undo: () => undone,
      };
      const b = mountHook(st, boardModule.usePatchbayBoard, () => deps);
      await b.render();
      await selectTask(b, "chat");
      await pick(b, "device");
      assert.deepEqual(calls, [{ id: "chat", target: { mode: "local" } }]);
      assert.equal(
        b.current().message,
        'patchbay.hint.moved{"task":"routes.names.chat","place":"patchbay.place.device"} patchbay.hint.movedAlso{"tasks":"routes.names.assistantVision"}'
      );
      assert.equal(typeof b.current().undo, "function");
      await React.act(async () => b.current().undo());
      assert.equal(b.current().message, 'patchbay.hint.undone{"task":"routes.names.chat"}');
      assert.equal(b.current().undo, null, "Undo is single-use");
    }
  );

  await t.test(
    "the board: an Undo that needs review says so instead of claiming the change was undone",
    async (st) => {
      // change-driving (I1).
      const { deps, state } = makeDeps();
      state.next = {
        applied: true,
        blocker: null,
        plan: plan([change("chat", deviceAs("chat"))]),
        undo: () => "staged",
      };
      const b = mountHook(st, boardModule.usePatchbayBoard, () => deps);
      await b.render();
      await selectTask(b, "chat");
      await pick(b, "device");
      await React.act(async () => b.current().undo());
      assert.equal(b.current().message, "patchbay.hint.undoStaged");
    }
  );

  await t.test("the board: a refused pick never reaches the planner and says why", async (st) => {
    // change-driving: usePatchbayBoard does not exist yet.
    const { deps, calls } = makeDeps();
    const b = mountHook(st, boardModule.usePatchbayBoard, () => deps);
    await b.render();
    await selectTask(b, "dictationStt");
    await pick(b, "anthropic");
    assert.deepEqual(calls, []);
    assert.equal(b.current().message, 'patchbay.no.capability{"provider":"Anthropic"}');
    assert.equal(
      b.current().selectedId,
      "dictationStt",
      "the selection stays so the user can pick again"
    );
  });

  await t.test(
    "the board: picking where a task already runs, or picking before choosing a task, sends nothing",
    async (st) => {
      // change-driving: usePatchbayBoard does not exist yet.
      const { deps, calls } = makeDeps();
      const b = mountHook(st, boardModule.usePatchbayBoard, () => deps);
      await b.render();
      await pick(b, "openai");
      assert.equal(b.current().message, "patchbay.hint.pickTaskFirst");
      await selectTask(b, "uploadStt");
      await pick(b, "openai");
      assert.equal(
        b.current().message,
        'patchbay.hint.already{"task":"routes.names.uploadStt","place":"patchbay.place.provider{\\"provider\\":\\"OpenAI\\"}"}'
      );
      assert.deepEqual(calls, []);
    }
  );

  await t.test("the board: a no-op plan reports that the task already runs there", async (st) => {
    // change-driving: usePatchbayBoard does not exist yet.
    const { deps, state } = makeDeps();
    state.next = { applied: false, blocker: null, plan: plan([], "noop") };
    const b = mountHook(st, boardModule.usePatchbayBoard, () => deps);
    await b.render();
    await selectTask(b, "chat");
    await pick(b, "device");
    assert.equal(
      b.current().message,
      'patchbay.hint.already{"task":"routes.names.chat","place":"patchbay.place.device"}'
    );
  });

  await t.test(
    "the board: a superseded request settles silently and frees the board (R2-8)",
    async (st) => {
      // change-driving: before R2-8 the board read `.plan` of every non-"staged" result and threw on a string.
      const { deps, state, calls } = makeDeps();
      state.next = "superseded";
      const b = mountHook(st, boardModule.usePatchbayBoard, () => deps);
      await b.render();
      await selectTask(b, "chat");
      await pick(b, "openai");
      assert.equal(calls.length, 1);
      assert.equal(b.current().selectedId, null);
      assert.equal(b.current().message, null);
      assert.equal(b.current().undo, null);
      state.next = "staged";
      await selectTask(b, "chat");
      await pick(b, "openai");
      assert.equal(calls.length, 2, "busy was released, so a later pick still reaches the planner");
    }
  );

  await t.test(
    "the board: sealed mode refuses off-device picks and still allows this device (I14)",
    async (st) => {
      // change-driving: usePatchbayBoard does not exist yet.
      const { deps, calls } = makeDeps({ sealed: true });
      const b = mountHook(st, boardModule.usePatchbayBoard, () => deps);
      await b.render();
      await selectTask(b, "chat");
      await pick(b, "openai");
      assert.equal(b.current().message, "patchbay.no.sealed");
      assert.deepEqual(calls, []);
      await pick(b, "device");
      assert.deepEqual(calls, [{ id: "chat", target: { mode: "local" } }]);
    }
  );

  await t.test(
    "the board: support tasks are locked and never selected; Escape clears a selection exactly once",
    async (st) => {
      // change-driving: usePatchbayBoard does not exist yet.
      const { deps } = makeDeps();
      const b = mountHook(st, boardModule.usePatchbayBoard, () => deps);
      await b.render();
      await selectTask(b, "speakerId");
      assert.equal(b.current().selectedId, null);
      assert.equal(b.current().message, "patchbay.locked.speakerId");
      await selectTask(b, "chat");
      let first;
      await React.act(async () => {
        first = b.current().clearSelection();
      });
      assert.equal(first, true);
      assert.equal(b.current().selectedId, null);
      let second;
      await React.act(async () => {
        second = b.current().clearSelection();
      });
      assert.equal(second, false, "the second Escape is the dialog's");
    }
  );

  await t.test("the board: a second click while a request is pending is ignored", async (st) => {
    // change-driving: usePatchbayBoard does not exist yet.
    const { deps, calls, state } = makeDeps();
    const gate = defer();
    state.next = () => gate.promise;
    const b = mountHook(st, boardModule.usePatchbayBoard, () => deps);
    await b.render();
    await selectTask(b, "chat");
    const openai = b.current().destinations.find((x) => x.id === "openai");
    await React.act(async () => {
      void b.current().pickDestination(openai);
      void b.current().pickDestination(openai);
    });
    assert.equal(calls.length, 1);
    gate.resolve("staged");
    await tick();
  });

  await t.test(
    "the Routing page shows the staged panel under the board only while a draft exists",
    async () => {
      // change-driving (Task 8's panel is rendered by this page).
      const store = drafts.useRouteDraftStore;
      store.getState().discard();
      async function renderSection() {
        let tree;
        const root = createRoot(globalThis.document.documentElement);
        function Probe() {
          tree = section.RoutingSection({});
          return null;
        }
        await React.act(async () => root.render(React.createElement(Probe)));
        await React.act(async () => root.unmount());
        return tree;
      }
      const without = await renderSection();
      assert.equal(
        find(without, (n) => n.type === staged.StagedRoutePanel),
        undefined
      );
      store.getState().stage({
        routeId: "chat",
        kind: "target",
        target: { mode: "providers", provider: "openai" },
      });
      const withDraft = await renderSection();
      const panel = find(withDraft, (n) => n.type === staged.StagedRoutePanel);
      assert.equal(panel.props.routeId, "chat");
      store.getState().discard();
    }
  );

  await t.test(
    "the Patchbay container sends picks through requestRouteChange and writes no settings itself",
    () => {
      // change-driving (source guard): Patchbay.tsx does not exist yet. Afterwards it pins the owner
      // rule (picks only through requestRouteChange; no provider/model/endpoint/enable-switch writes,
      // no switch of its own) and Task 3's copy hook (no zero-arg routeCopy()).
      const source = fs.readFileSync(
        path.join(__dirname, "../../src/components/settings/routing/Patchbay.tsx"),
        "utf8"
      );
      assert.match(source, /requestRouteChange\(/);
      assert.match(source, /useRouteCopy\(\)/);
      assert.match(source, /useSealedStore\(/);
      assert.match(source, /providersForRoute/);
      assert.doesNotMatch(source, /\brouteCopy\(\)/);
      assert.doesNotMatch(
        source,
        /applyRoutePatch|requestRoutePatch|useSettingsStore\.setState|settings\.set[A-Z]|providerDisplayName\(|<Switch\b|<RouteSwitch\b/
      );
    }
  );

  await t.test(
    "M3 guard: the Patchbay uses logical properties and shared motion tokens only",
    () => {
      // change-driving: the .patchbay rules do not exist yet.
      const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");
      const rules = css.match(/[^{}]*\.patchbay[^{}]*\{[^{}]*\}/g) ?? [];
      assert.ok(rules.length >= 10, "the Patchbay rules are present");
      const body = rules.join("\n");
      assert.doesNotMatch(body, /(?:^|[\s;{])(?:padding|margin)-(?:left|right)\s*:/m);
      assert.doesNotMatch(body, /(?:^|[\s;{])(?:left|right)\s*:/m);
      assert.doesNotMatch(body, /text-align\s*:\s*(?:left|right)/);
      assert.doesNotMatch(body, /padding\s*:\s*\S+\s+\S+\s+\S+\s+\S+/, "no four-value padding");
      assert.doesNotMatch(
        body,
        /(?:transition|animation)[^;]*\b\d+(?:\.\d+)?m?s\b/,
        "no literal durations"
      );
      assert.match(body, /var\(--motion-/);
      for (const file of ["Patchbay.tsx", "usePatchbayBoard.ts"]) {
        const source = fs.readFileSync(
          path.join(__dirname, "../../src/components/settings/routing", file),
          "utf8"
        );
        assert.doesNotMatch(
          source,
          /(?:^|[\s"'`])(?:-?m[lr]-|p[lr]-|left-|right-|text-left\b|text-right\b|rounded-[lr]-|border-[lr]\b)/m,
          file
        );
        assert.doesNotMatch(source, /\bduration-\d/, file);
      }
    }
  );
});
