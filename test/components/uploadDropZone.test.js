const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");
const { createRoot } = require("react-dom/client");

test("disabled zone preserves children and model fix, ready zone is focusable", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-upload-zone-"));
  const { UploadDropZone } = await vite.ssrLoadModule("/components/notes/UploadDropZone.tsx");
  const noop = () => {};
  const props = {
    isDragOver: false,
    onDrop: noop,
    onDragOver: noop,
    onDragLeave: noop,
    onBrowse: noop,
    onKeyDown: noop,
    onChooseModel: noop,
    children: "Drop audio here",
  };
  const disabled = renderToStaticMarkup(
    React.createElement(UploadDropZone, { ...props, disabled: true })
  );
  assert.match(disabled, /aria-disabled="true"/);
  assert.match(disabled, /tabindex="-1"/);
  assert.match(disabled, /Drop audio here/);
  assert.match(disabled, /notes.upload.chooseModel/);
  assert.doesNotMatch(disabled, /opacity-60/);
  const ready = renderToStaticMarkup(
    React.createElement(UploadDropZone, { ...props, disabled: false })
  );
  assert.match(ready, /tabindex="0"/);
  assert.doesNotMatch(ready, /aria-disabled|notes.upload.chooseModel/);
});

test("disabled pointer, Enter, Space and drag cannot invoke admission; default drop is prevented", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(t, rendererOptions("loqui-upload-zone-events-"));
  const { UploadDropZone } = await vite.ssrLoadModule("/components/notes/UploadDropZone.tsx");
  let calls = 0,
    prevented = 0;
  const invoke = () => calls++;
  const props = {
    disabled: true,
    isDragOver: true,
    onDrop: invoke,
    onDragOver: invoke,
    onDragLeave: invoke,
    onBrowse: invoke,
    onKeyDown: invoke,
    onChooseModel: invoke,
    children: "Audio",
  };
  root = createRoot(tree.container);
  await React.act(async () => root.render(React.createElement(UploadDropZone, props)));
  const zone = tree.find((n) => tree.props(n)?.role === "button");
  const p = tree.props(zone);
  p.onClick?.({});
  for (const key of ["Enter", " "]) p.onKeyDown?.({ key, preventDefault: () => prevented++ });
  for (const name of ["onDrop", "onDragOver"]) p[name]({ preventDefault: () => prevented++ });
  p.onDragLeave?.({ preventDefault: () => prevented++ });
  assert.equal(calls, 0);
  assert.equal(prevented, 4);
  assert.doesNotMatch(p.className, /scale-|hover:|drag-pulse/);
});
