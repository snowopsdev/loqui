const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { createElement } = React;
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");

const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/ui/ModelCardList.tsx"),
  "utf8"
);

async function load(t) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-model-card-keyboard-"));
  return vite.ssrLoadModule("/components/ui/ModelCardList.tsx");
}

const LOCAL_MODELS = [
  { value: "parakeet", label: "Parakeet", isDownloaded: true },
  { value: "whisper", label: "Whisper", isDownloaded: true },
  { value: "orukeet", label: "Orukeet", isDownloaded: false },
];

test("a model list is a labelled radiogroup of named, selectable radios", async (t) => {
  const { default: ModelCardList } = await load(t);
  const html = renderToStaticMarkup(
    createElement(ModelCardList, {
      models: LOCAL_MODELS,
      selectedModel: "parakeet",
      onModelSelect() {},
      onDownload() {},
      onDelete() {},
    })
  );
  assert.match(html, /role="radiogroup" aria-label="models\.listLabel"/);
  const radios = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);
  assert.equal(radios.length, 3);
  assert.match(radios[0], /aria-checked="true"/);
  assert.match(radios[0], /aria-label="Parakeet"/);
  assert.match(radios[1], /aria-checked="false"/);
  assert.match(radios[2], /aria-disabled="true"/, "not downloaded yet");
  assert.doesNotMatch(radios[2], /\sdisabled=""/, "still focusable");
  assert.match(radios[0], /type="button"/);
  // One tab stop: the selected card.
  assert.match(radios[0], /tabindex="0"/);
  assert.match(radios[1], /tabindex="-1"/);
  assert.match(radios[2], /tabindex="-1"/);
});

test("with nothing selected in this list, the first selectable card is the tab stop", async (t) => {
  const { default: ModelCardList } = await load(t);
  const html = renderToStaticMarkup(
    createElement(ModelCardList, {
      // Orukeet first: not downloaded, so it cannot be the tab stop.
      models: [LOCAL_MODELS[2], LOCAL_MODELS[0], LOCAL_MODELS[1]],
      selectedModel: "",
      onModelSelect() {},
      onDownload() {},
      onDelete() {},
    })
  );
  const stops = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) =>
    /tabindex="0"/.test(m[0])
  );
  assert.deepEqual(stops, [false, true, false]);
});

test("the delete button is named and appears on keyboard focus, not only on hover", async (t) => {
  const { default: ModelCardList } = await load(t);
  const html = renderToStaticMarkup(
    createElement(ModelCardList, {
      models: LOCAL_MODELS,
      selectedModel: "parakeet",
      onModelSelect() {},
      onDownload() {},
      onDelete() {},
    })
  );
  const del = html.match(/<button[^>]*aria-label="models\.deleteNamed\(model=Whisper\)"[^>]*>/);
  assert.ok(del, "delete has an accessible name");
  assert.match(del[0], /group-focus-within:opacity-100/);
  assert.match(del[0], /focus-visible:opacity-100/);
});

test("a card inside a listbox option does not nest a radio", async (t) => {
  const { ModelCard } = await load(t);
  const html = renderToStaticMarkup(
    createElement(ModelCard, {
      model: { value: "gpt", label: "GPT" },
      isSelected: false,
      onSelect() {},
      selectionRole: "none",
    })
  );
  assert.doesNotMatch(html, /role="radio"/);
});

test("arrow keys move focus between cards and never select", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(t, rendererOptions("loqui-model-card-arrows-"));
  const { default: ModelCardList } = await vite.ssrLoadModule("/components/ui/ModelCardList.tsx");
  const selected = [];
  root = createRoot(tree.container);
  await React.act(async () =>
    root.render(
      createElement(ModelCardList, {
        models: LOCAL_MODELS,
        selectedModel: "parakeet",
        onModelSelect: (value) => selected.push(value),
        onDownload() {},
        onDelete() {},
      })
    )
  );
  const radios = [];
  const walk = (node) => {
    if (node.attributes?.role === "radio") radios.push(node);
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(tree.container);
  assert.equal(radios.length, 3);
  const focused = [];
  radios.forEach((radio, index) => {
    radio.focus = () => focused.push(index);
  });
  const group = tree.find((node) => node.attributes?.role === "radiogroup");
  const press = (key, from) => {
    let prevented = false;
    tree.props(group).onKeyDown({
      key,
      target: radios[from],
      currentTarget: { querySelectorAll: () => radios },
      preventDefault() {
        prevented = true;
      },
    });
    return prevented;
  };

  assert.equal(press("ArrowDown", 0), true);
  assert.equal(press("ArrowRight", 1), true, "reaches a card that is not downloaded yet");
  assert.equal(press("ArrowDown", 2), true, "wraps to the first card");
  assert.equal(press("ArrowUp", 0), true, "wraps to the last card");
  assert.equal(press("ArrowLeft", 2), true);
  assert.deepEqual(focused, [1, 2, 0, 2, 1]);
  assert.deepEqual(selected, [], "moving focus never changes the model");

  assert.equal(press("Tab", 0), false, "Tab is left to the browser");
  const del = tree.find((node) =>
    node.attributes?.["aria-label"]?.startsWith("models.deleteNamed")
  );
  tree.props(group).onKeyDown({
    key: "ArrowDown",
    target: del,
    currentTarget: { querySelectorAll: () => radios },
    preventDefault() {
      assert.fail("arrows on a card action are not intercepted");
    },
  });
  assert.equal(focused.length, 5);
});

test("Learn more never selects the model, and reads as a link", async (t) => {
  // createExternalLinkHandler only prevents navigation; the anchor's own
  // stopPropagation keeps the click from reaching the card root's onClick
  // (still present with selectionRole="none") or the radio.
  assert.match(source, /onClick=\{openSpec\}/);
  assert.match(
    source,
    /const openSpec = \(event: React\.MouseEvent\) => \{\s*event\.stopPropagation\(\);/
  );
  const { ModelCard } = await load(t);
  const html = renderToStaticMarkup(
    createElement(ModelCard, {
      model: { value: "gpt", label: "GPT", specUrl: "https://example.com/spec" },
      isSelected: false,
      onSelect() {},
      selectionRole: "none",
    })
  );
  const anchor = html.match(/<a [^>]*>/)[0];
  assert.match(anchor, /\btext-link\b/, "links use --color-link (D1)");
  assert.doesNotMatch(anchor, /text-primary/);
});

test("explicit activation selects while documentation and delete actions stay independent", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(t, rendererOptions("loqui-model-card-actions-"));
  const { ModelCard } = await vite.ssrLoadModule("/components/ui/ModelCardList.tsx");
  root = createRoot(tree.container);
  const selected = [];
  const deleted = [];
  const opened = [];
  globalThis.window.electronAPI = { openExternal: (url) => opened.push(url) };

  for (const selectionRole of ["radio", "none"]) {
    await React.act(async () =>
      root.render(
        createElement(ModelCard, {
          model: {
            value: "whisper",
            label: "Whisper",
            specUrl: "https://example.com/spec",
            isDownloaded: true,
          },
          selectionRole,
          isSelected: false,
          onSelect: (value) => selected.push(value),
          onDownload() {},
          onDelete: (value) => deleted.push(value),
        })
      )
    );
    const card = tree.container.childNodes[0];
    const click = (node) => {
      let stopped = false;
      const event = {
        stopPropagation() {
          stopped = true;
        },
        preventDefault() {},
      };
      tree.props(node).onClick(event);
      if (!stopped && node !== card) tree.props(card).onClick?.(event);
      return stopped;
    };
    const link = tree.find((node) => node.tagName === "A");
    const del = tree.find((node) =>
      node.attributes?.["aria-label"]?.startsWith("models.deleteNamed")
    );
    assert.ok(link);
    assert.equal(click(link), true, "documentation stops the root selection handler");
    assert.equal(click(del), true, "delete stops the root selection handler");
    assert.equal(selected.length, selectionRole === "radio" ? 0 : 1);
    const activation =
      selectionRole === "radio" ? tree.find((node) => node.attributes?.role === "radio") : card;
    click(activation);
    assert.equal(selected.length, selectionRole === "radio" ? 1 : 2);
  }
  assert.deepEqual(selected, ["whisper", "whisper"]);
  assert.deepEqual(deleted, ["whisper", "whisper"]);
  assert.equal(opened.length, 2);
  assert.ok(opened.every((url) => url.startsWith("https://example.com/spec?")));

  await React.act(async () =>
    root.render(
      createElement(ModelCard, {
        model: LOCAL_MODELS[2],
        isSelected: false,
        onSelect: (value) => selected.push(value),
        onDownload() {},
      })
    )
  );
  const unavailable = tree.find((node) => node.attributes?.role === "radio");
  tree.props(unavailable).onClick();
  assert.equal(selected.length, 2, "an unavailable local model cannot be selected");
});
