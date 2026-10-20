const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../../lib/rendererTestHarness");
const { installTree } = require("./fakeDomTree");
const { rendererOptions, TOAST_MOCK } = require("./rendererMocks");

// Unknown methods are fixture convenience, never proof of real preload support (R9).
// Preserve explicit undefined/null boundaries for tests of unsupported actual APIs.
// Logs every electronAPI call, including nested objects (personalInference.*),
// so flow tests can assert that nothing implicit (accounts, downloads) ran.
function electronApiProxy(api, calls = [], prefix = "") {
  const unknown = (name) =>
    new Proxy(function stub() {}, {
      apply(_target, _this, args) {
        calls.push([name, ...args]);
        return /(^|\.)on[A-Z]/.test(name) ? () => {} : Promise.resolve();
      },
      get(_target, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        return unknown(`${name}.${String(key)}`);
      },
    });
  return new Proxy(api, {
    get(target, key) {
      if (typeof key === "symbol" || key === "then") return target[key];
      const name = `${prefix}${String(key)}`;
      const value = target[key];
      if (typeof value === "function") {
        return (...args) => {
          calls.push([name, ...args]);
          return value.apply(target, args);
        };
      }
      if (value && typeof value === "object") return electronApiProxy(value, calls, `${name}.`);
      return key in target ? value : unknown(name);
    },
  });
}

async function mountComponent(
  t,
  modulePath,
  {
    api = {},
    props = {},
    exportName = "default",
    storage = {},
    mocks = {},
    reducedMotion = false,
    windowProps = {},
  } = {}
) {
  let root = null;
  const calls = [];
  const unmount = async () => {
    if (!root) return;
    const current = root;
    root = null;
    await React.act(async () => current.unmount());
  };
  t.after(unmount);
  const globals = installBrowserGlobals(t, {
    initialStorage: storage,
    window: {
      electronAPI: electronApiProxy(api, calls),
      matchMedia: (query) => ({
        matches: reducedMotion && query.includes("reduce"),
        addEventListener() {},
        removeEventListener() {},
      }),
      ...windowProps,
    },
  });
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-onboarding-ui-test-", { "/ui/useToast": TOAST_MOCK, ...mocks })
  );
  const Component = (await vite.ssrLoadModule(modulePath))[exportName];
  let currentProps = props;
  root = createRoot(tree.container);
  await React.act(async () => root.render(React.createElement(Component, currentProps)));
  return {
    ...tree,
    vite,
    calls,
    storage: globals.storage,
    unmount,
    async rerender(next) {
      currentProps = { ...currentProps, ...next };
      await React.act(async () => root.render(React.createElement(Component, currentProps)));
    },
  };
}

// Match an exact rendered key and one complete interpolation record. Special
// punctuation uses JSON in I18N_KEYS_MOCK, so values cannot forge extra entries.
function expectKey(ui, key, values) {
  const leaves = [];
  const collect = (node) => {
    if (node.nodeType === 3) leaves.push(node.textContent);
    else for (const child of node.childNodes ?? []) collect(child);
  };
  if (ui.container) collect(ui.container);
  const text = ui.container ? leaves.join("\n") : ui.text();
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const occurrences = [
    ...text.matchAll(new RegExp(`(^|[^\\w.-])${escapedKey}(?=$|[^\\w.-])`, "g")),
  ];
  assert.ok(occurrences.length > 0, `${key} is rendered`);
  if (!values) return;
  const records = occurrences.flatMap((match) => {
    const tail = text.slice(match.index + match[0].length);
    if (tail.startsWith("{")) {
      for (let i = 2; i <= tail.length; i++) {
        if (tail[i - 1] !== "}") continue;
        try {
          return [JSON.parse(tail.slice(0, i))];
        } catch {
          /* incomplete record */
        }
      }
      return [];
    }
    const legacy = /^\(([^()]*)\)/.exec(tail);
    if (!legacy) return [];
    const entries = legacy[1].split(",").map((entry) => entry.split("="));
    if (entries.some((entry) => entry.length !== 2)) return [];
    return [Object.fromEntries(entries)];
  });
  assert.ok(
    records.some((record) =>
      Object.entries(values).every(
        ([name, value]) => Object.hasOwn(record, name) && String(record[name]) === String(value)
      )
    ),
    `${key} carries ${JSON.stringify(values)} in one interpolation`
  );
}

module.exports = { mountComponent, expectKey, electronApiProxy };
