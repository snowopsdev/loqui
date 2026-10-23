const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderStatic } = require("../helpers/harness/reactSsr");
const { installTree } = require("../helpers/harness/fakeDomTree");
const {
  installBrowserGlobals,
  installHookDom,
  createRendererServer,
} = require("../lib/rendererTestHarness");

const receivers = "OpenAI, Anthropic, Google Gemini may have received part of this dictation.";
test("caption preserves every receiver in a focusable, wrapping, bounded scroll surface", async () => {
  const { PillCaption } = await import("../../src/components/dictation/PillCaption.tsx");
  const markup = renderStatic(PillCaption, { horizontalDirection: "right", children: receivers });
  assert.match(markup, /tabindex="0"/);
  assert.match(markup, /role="status"/);
  assert.ok(markup.includes(receivers));
  const css = fs.readFileSync(path.join(__dirname, "../../src/styles/dictation-panel.css"), "utf8");
  const rule = css.match(/\.pill-caption\s*\{([^}]+)\}/)[1];
  assert.match(rule, /overflow:\s*auto/);
  assert.match(rule, /overflow-wrap:\s*anywhere/);
  assert.match(rule, /max-height:/);
  assert.doesNotMatch(rule, /ellipsis|line-clamp/);
  assert.match(
    css,
    /\.pill-caption:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-ring\)/
  );
});

test("mounted caption fits actual viewport/anchor bounds in either dock and follows geometry until cleanup", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window: { innerWidth: 208, innerHeight: 120 } });
  installHookDom(t);
  const tree = installTree();
  const createElement = globalThis.document.createElement;
  let anchor = { x: 36, y: 68, width: 160, height: 40 };
  globalThis.document.createElement = (tag) => {
    const element = createElement(tag);
    Object.defineProperty(element, "parentElement", { get: () => element.parentNode });
    element.getBoundingClientRect = () =>
      element.attributes.class === "pill-caption"
        ? { x: 36, y: 12, width: 184, height: 48 }
        : anchor;
    return element;
  };
  const vite = await createRendererServer(t, { cachePrefix: "loqui-caption-fit-" });
  const { PillCaption } = await vite.ssrLoadModule("/components/dictation/PillCaption.tsx");
  t.mock.timers.enable({ apis: ["setInterval"] });
  root = createRoot(tree.container);
  const render = async (direction, gapPx) =>
    React.act(async () =>
      root.render(
        React.createElement(
          "div",
          null,
          React.createElement(PillCaption, { horizontalDirection: direction, gapPx }, receivers)
        )
      )
    );
  await render("right");
  const caption = tree.find((n) => n.attributes?.class === "pill-caption");
  assert.equal(caption.style.left, "-24px", "184px caption starts at viewport12, not pill36");
  assert.equal(caption.style.maxHeight, "48px", "top12 leaves full Undo/control below");
  anchor = { x: 12, y: 52, width: 160, height: 40 };
  await render("left");
  assert.equal(caption.style.left, "0px");
  assert.equal(caption.style.maxHeight, "32px", "returning panel dock also cannot clip the top");
  anchor = { x: 24, y: 68, width: 160, height: 40 };
  await React.act(async () => t.mock.timers.tick(50));
  assert.equal(caption.style.left, "-12px", "in-flight centered geometry is clamped physically");
  assert.equal(caption.style.maxHeight, "48px");
  await render("right", 14);
  assert.equal(
    caption.style.maxHeight,
    "42px",
    "Agent orbit clearance is included in the measured height"
  );
  assert.equal(caption.style.bottom, "calc(100% + 14px)");
  await render("right");
  assert.equal(caption.style.maxHeight, "48px", "ordinary disclosure/words retain the default gap");
  assert.equal(caption.style.bottom, "", "default uses the existing CSS gap");
  await React.act(async () => root.unmount());
  root = null;
  const before = { ...caption.style };
  anchor = { x: 100, y: 100, width: 100, height: 30 };
  await React.act(async () => t.mock.timers.tick(100));
  assert.deepEqual(caption.style, before, "unmount stops geometry sampling");
});
