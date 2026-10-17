const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createElement } = React;
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

// i18n keys render verbatim; dropdown primitives render inline (no portal).
async function renderCapture(t, props = {}) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-capture-menu-test-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `const t = (key) => key; export const useTranslation = () => ({ t });`,
      "/ui/dropdown-menu": `
        import { createElement } from "react";
        const passthrough = (props) => createElement("div", null, props.children);
        export const DropdownMenu = passthrough;
        export const DropdownMenuTrigger = passthrough;
        export const DropdownMenuContent = passthrough;
        export const DropdownMenuItem = (props) => createElement("div", { "data-item": props["data-action"], className: props.className }, props.children);
        export const DropdownMenuSeparator = () => createElement("hr", null);
      `,
    },
  });
  const mod = await vite.ssrLoadModule("/components/CaptureMenu.tsx");
  return {
    mod,
    html: renderToStaticMarkup(
      createElement(mod.default, {
        status: { kind: "ready", source: null, startedAt: null },
        now: 10_000,
        readLevel: () => 0,
        lastAction: "dictate",
        hotkeyLabel: "Fn",
        platform: "darwin",
        showChat: true,
        onRun: () => {},
        onStop: () => {},
        ...props,
      })
    ),
  };
}

test("idle Capture is neutral and offers every capture path with its key", async (t) => {
  const { html } = await renderCapture(t);
  assert.doesNotMatch(html, /data-variant="live"/);
  assert.match(html, /capture\.short\.dictate/);
  for (const key of ["dictate", "recordMeeting", "upload", "newNote", "newChat"]) {
    assert.match(html, new RegExp(`capture\\.actions\\.${key}`));
  }
  for (const hint of ["Fn", "⌘⇧M", "⌘⇧U", "⌘N", "⌘⇧N"]) assert.ok(html.includes(hint), hint);
  assert.match(html, /aria-label="capture\.moreOptions"/);
});

test("the primary segment remembers the last action", async (t) => {
  const { html } = await renderCapture(t, { lastAction: "upload" });
  assert.match(html, /capture\.short\.upload/);
});

test("while listening the primary segment is the live Stop with a level and a clock", async (t) => {
  const { html } = await renderCapture(t, {
    status: { kind: "listening", source: "dictation", startedAt: 3_000 },
  });
  assert.match(html, /data-variant="live"/);
  assert.match(html, /aria-label="capture\.stopListening"/);
  assert.match(html, /data-elapsed="0:07"/);
});

test("a live meeting says Stop recording", async (t) => {
  const { html } = await renderCapture(t, {
    status: { kind: "listening", source: "meeting", startedAt: 0 },
  });
  assert.match(html, /aria-label="capture\.stopRecording"/);
});

test("cleaning up is announced and busy, not orange", async (t) => {
  const { html } = await renderCapture(t, {
    status: { kind: "processing", source: "dictation", startedAt: null },
  });
  assert.match(html, /capture\.cleaningUp/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /data-variant="live"/);
});

test("no assistant, no New chat", async (t) => {
  const { html } = await renderCapture(t, { showChat: false });
  assert.doesNotMatch(html, /capture\.actions\.newChat/);
});

test("a stored last action is validated", async (t) => {
  const { mod } = await renderCapture(t);
  assert.equal(mod.readLastCaptureAction({ getItem: () => "upload" }), "upload");
  assert.equal(mod.readLastCaptureAction({ getItem: () => "launchRockets" }), "dictate");
  assert.equal(mod.readLastCaptureAction(null), "dictate");
});

test("a hidden remembered chat falls back to dictation and non-Mac hints use Control", async (t) => {
  const { html } = await renderCapture(t, {
    showChat: false,
    lastAction: "newChat",
    platform: "linux",
  });
  assert.match(html, /capture\.short\.dictate/);
  assert.doesNotMatch(html, /capture\.short\.newChat/);
  for (const hint of ["Ctrl+Shift+M", "Ctrl+Shift+U", "Ctrl+N"])
    assert.ok(html.includes(hint), hint);
});

test("every native Capture button and menu item has a full effective focus ring", async (t) => {
  for (const kind of ["ready", "listening", "processing"]) {
    const { html } = await renderCapture(t, {
      status: { kind, source: "dictation", startedAt: 0 },
    });
    for (const tag of html.matchAll(/<button\b[^>]*>/g)) {
      assert.match(tag[0], /focus-visible:ring-2/);
      assert.match(tag[0], /focus-visible:ring-ring(?: |&quot;|")/);
      assert.doesNotMatch(tag[0], /focus-visible:ring-(?:1|ring\/|primary\/)/);
    }
    for (const item of html.matchAll(/<div data-item=[^>]*>/g)) {
      assert.match(item[0], /focus-visible:ring-2/);
      assert.match(item[0], /focus-visible:ring-ring /);
    }
    assert.doesNotMatch(html, /tabindex="0"/, "Radix owns composite tab stops");
  }
});

test("invalid, absent and throwing action storage defaults safely", async (t) => {
  const { mod } = await renderCapture(t);
  assert.equal(mod.readLastCaptureAction(undefined), "dictate");
  assert.equal(
    mod.readLastCaptureAction({
      getItem() {
        throw new Error("fixture denied");
      },
    }),
    "dictate"
  );
});

test("mounted Capture handlers dispatch the remembered primary, each menu action and live Stop", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const { mod } = await renderCapture(t);
  const container = installHookDom(t);
  let tree;
  const calls = [];
  let status = { kind: "ready", source: null, startedAt: null };
  function Probe() {
    tree = mod.default({
      status,
      now: 10000,
      readLevel: () => 0,
      lastAction: "upload",
      hotkeyLabel: "Fn",
      platform: "darwin",
      showChat: true,
      onRun: (action) => calls.push(action),
      onStop: () => calls.push("stop"),
    });
    return null;
  }
  function find(node, predicate) {
    if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
    if (!node || typeof node !== "object") return null;
    return predicate(node) ? node : find(node.props?.children, predicate);
  }
  root = createRoot(container);
  await React.act(async () => root.render(createElement(Probe)));
  tree.props.children[0].props.onClick();
  assert.deepEqual(calls, ["upload"]);
  for (const action of mod.CAPTURE_ACTIONS) {
    const item = find(tree, (node) => node.props?.["data-action"] === action);
    item.props.onSelect();
    assert.equal(calls.at(-1), action);
  }
  let prevented = false;
  find(tree, (node) => !!node.props?.onCloseAutoFocus).props.onCloseAutoFocus({
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true, "New chat keeps focus with its composer");
  prevented = false;
  find(tree, (node) => !!node.props?.onCloseAutoFocus).props.onCloseAutoFocus({
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, false, "dismissal returns focus through Radix");
  find(tree, (node) => node.props?.["data-action"] === "upload").props.onSelect();
  find(tree, (node) => !!node.props?.onCloseAutoFocus).props.onCloseAutoFocus({
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, false, "Upload retains Radix focus return");
  status = { kind: "listening", source: "dictation", startedAt: 0 };
  await React.act(async () => root.render(createElement(Probe)));
  tree.props.children[0].props.onClick();
  assert.equal(calls.at(-1), "stop");
  status = { kind: "processing", source: "dictation", startedAt: null };
  await React.act(async () => root.render(createElement(Probe)));
  assert.equal(tree.props.children[0].props.disabled, true);
  assert.equal(tree.props.children[0].props.onClick, undefined);
});
