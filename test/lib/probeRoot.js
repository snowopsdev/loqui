// Mounted behaviour harness in the personalWorkspace pattern
// (test/components/personalWorkspace.test.js:18-41): every probe calls a
// component as a plain function and returns null, so hooks and effects run
// but no host element is ever committed to installHookDom's fake DOM.
const React = require("react");
const { createRoot } = require("react-dom/client");
const { installHookDom } = require("./rendererTestHarness");

function createProbeRoot(t, { wrap } = {}) {
  const container = installHookDom(t);
  const root = createRoot(container);
  const slots = new Map();
  // Browser cleanup was registered before this helper. Keep the captured DOM
  // available while unmounting, then restore the already-cleaned global state.
  const mountedGlobals = Object.fromEntries(
    ["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, globalThis[key]])
  );
  t.after(async () => {
    const previous = Object.fromEntries(
      Object.keys(mountedGlobals).map((key) => [key, globalThis[key]])
    );
    Object.assign(globalThis, mountedGlobals);
    try {
      await React.act(async () => root.unmount());
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    }
  });

  function Probe({ slot }) {
    slot.tree = slot.render();
    return null;
  }

  async function draw() {
    const probes = [...slots.entries()].map(([name, slot]) =>
      React.createElement(Probe, { key: `${name}:${slot.generation}`, slot })
    );
    const tree = React.createElement(React.Fragment, null, ...probes);
    await React.act(async () => root.render(wrap ? wrap(tree) : tree));
  }

  return {
    // Mounting a name again remounts it (fresh hooks).
    async mount(name, render) {
      const generation = (slots.get(name)?.generation ?? 0) + 1;
      slots.set(name, { render, tree: null, generation });
      await draw();
      return () => slots.get(name).tree;
    },
    async act(fn) {
      await React.act(async () => {
        await fn();
      });
    },
    // Lets queued promises (flushSecretSaves, requestRouteChange) finish.
    async settle() {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
}

function findAll(node, predicate, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) findAll(item, predicate, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  if (predicate(node)) found.push(node);
  findAll(node.props?.children, predicate, found);
  return found;
}

function findElement(node, predicate) {
  return findAll(node, predicate)[0] ?? null;
}

module.exports = { createProbeRoot, findAll, findElement };
