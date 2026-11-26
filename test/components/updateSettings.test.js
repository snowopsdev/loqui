const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");

test("Check for Updates is not disabled by turning automatic updates off", () => {
  const ui = read("src/components/settings/UpdateSettings.tsx");
  assert.doesNotMatch(ui, /!status\?\.enabled/);
  assert.match(
    ui,
    /disabled=\{!status \|\| \["checking", "downloading"\]\.includes\(status\.phase\)\}/
  );
});

test("an available update offers the GitHub download and names the version", () => {
  const ui = read("src/components/settings/UpdateSettings.tsx");
  assert.match(
    ui,
    /status\?\.phase === "available" && \(\s*<p>\{t\("updates\.available", \{ version: status\.availableVersion \}\)\}<\/p>/
  );
  assert.match(ui, /status\?\.phase === "manual" \|\| status\?\.phase === "available" \?/);
  assert.match(read("src/types/updates.ts"), /"available"/);
});

test("no physical margin remains in the update controls", () => {
  assert.doesNotMatch(read("src/components/settings/UpdateSettings.tsx"), /\bml-2\b/);
});

test("the privacy doc explains the manual check with automatic updates off", () => {
  assert.match(
    read("docs/PRIVACY.md"),
    /With automatic updates off, \*\*Check for Updates\*\* still works/
  );
});

// Mounted: the "latest version" line answers a manual check that actually ran,
// for the channel still selected, and never a skipped or superseded check.
async function mountUpdates(t, { checkRuns = true } = {}) {
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const {
    createRendererServer,
    installBrowserGlobals,
    installHookDom,
  } = require("../lib/rendererTestHarness");
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  let state = {
    phase: "idle",
    enabled: true,
    channel: "stable",
    version: "1.0.0",
    busy: false,
    supported: true,
    releasesUrl: "https://example.invalid/releases",
  };
  const listeners = new Set();
  const publish = (patch) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  let releaseCheck = null;
  const api = {
    status: async () => state,
    onStatus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    preferences: async (patch) => {
      publish(patch);
      return state;
    },
    check: async () => {
      if (!checkRuns) return state; // skipped: dev build, not onboarded, already running
      publish({ phase: "checking" });
      await new Promise((resolve) => (releaseCheck = resolve));
      publish({ phase: "idle" });
      return state;
    },
  };
  installBrowserGlobals(t, { window: { electronAPI: { updates: api } } });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next"],
    mockModules: { "react-i18next": "export const useTranslation = () => ({ t: (key) => key });" },
  });
  const { default: UpdateSettings } = await vite.ssrLoadModule(
    "/components/settings/UpdateSettings.tsx"
  );
  let tree;
  function Probe() {
    tree = UpdateSettings({});
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  const all = (node, pred) => {
    if (Array.isArray(node)) return node.flatMap((n) => all(n, pred));
    if (!node || typeof node !== "object") return [];
    return [...(pred(node) ? [node] : []), ...all(node.props?.children, pred)];
  };
  const flush = () => React.act(async () => new Promise(setImmediate));
  return {
    latestShown: () =>
      all(tree, (n) => n.props?.children === "settingsPage.general.updates.latestVersion")
        .length === 1,
    startCheck: async () => {
      const button = all(tree, (n) => n.props?.children === "updates.check")[0];
      let done;
      await React.act(async () => {
        done = button.props.onClick();
        await new Promise(setImmediate);
      });
      return done;
    },
    finishCheck: async () => {
      await React.act(async () => {
        releaseCheck?.();
        await new Promise(setImmediate);
      });
      await flush();
    },
    switchChannel: async (channel) => {
      const select = all(tree, (n) => typeof n.props?.onValueChange === "function")[0];
      await React.act(async () => {
        select.props.onValueChange(channel);
        await new Promise(setImmediate);
      });
      await flush();
    },
    flush,
  };
}

test("a manual check that finds nothing says the version is current", async (t) => {
  const h = await mountUpdates(t);
  assert.equal(h.latestShown(), false);
  await h.startCheck();
  assert.equal(h.latestShown(), false, "nothing is claimed while the check runs");
  await h.finishCheck();
  assert.equal(h.latestShown(), true);
});

test("a skipped check never claims the latest version", async (t) => {
  const h = await mountUpdates(t, { checkRuns: false });
  await h.startCheck();
  await h.flush();
  assert.equal(h.latestShown(), false);
});

test("switching channel clears the result and outranks an in-flight check", async (t) => {
  const h = await mountUpdates(t);
  await h.startCheck();
  await h.finishCheck();
  assert.equal(h.latestShown(), true);
  await h.switchChannel("beta");
  assert.equal(h.latestShown(), false, "a stable result does not speak for beta");

  await h.startCheck();
  await h.switchChannel("stable");
  await h.finishCheck();
  assert.equal(h.latestShown(), false, "the superseded check cannot report a result");
});
