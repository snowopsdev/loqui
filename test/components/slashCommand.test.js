const assert = require("node:assert/strict");
const test = require("node:test");

// The installed suggestion plugin's state/transactions, with the production
// extension and schema. Mounted DOM/renderer behavior is also exercised in QA.
async function harness({ text = "", code = false, inline = false, editable = true } = {}) {
  globalThis.React = require("react");
  const { getSchema } = await import("@tiptap/core");
  const { default: StarterKit } = await import("@tiptap/starter-kit");
  const { EditorState, TextSelection } = await import("@tiptap/pm/state");
  const { createSlashCommand, SLASH_PLUGIN_KEY } =
    await import("../../src/components/ui/editor/SlashCommand.ts");
  const schema = getSchema([StarterKit]);
  const editor = { isEditable: editable, view: { composing: false } };
  const extension = createSlashCommand(() => ({ items: [] }));
  const [plugin] = extension.config.addProseMirrorPlugins.call({ editor });
  const doc = schema.node("doc", null, [
    schema.node(
      code ? "codeBlock" : "paragraph",
      null,
      text ? [schema.text(text, inline ? [schema.mark("code")] : [])] : []
    ),
  ]);
  let state = EditorState.create({ schema, doc, plugins: [plugin] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, text.length + 1)));
  return {
    active: () => SLASH_PLUGIN_KEY.getState(state),
    type: (value) => {
      state = state.apply(state.tr.insertText(value));
    },
    escape: () =>
      plugin.props.handleKeyDown(
        {
          get state() {
            return state;
          },
          dispatch: (tr) => {
            state = state.apply(tr);
          },
        },
        { key: "Escape" }
      ),
    text: () => state.doc.textContent,
  };
}

test("installed slash plugin triggers at start or after a space, excluding URLs/dates and code", async () => {
  for (const [options, expected] of [
    [{ text: "/" }, true],
    [{ text: "words /he" }, true],
    [{ text: "https://" }, false],
    [{ text: "14/10/2026" }, false],
    [{ text: "/", code: true }, false],
    [{ text: "/", inline: true }, false],
    [{ text: "/", editable: false }, false],
  ]) {
    assert.equal((await harness(options)).active().active, expected, JSON.stringify(options));
  }
});

test("Escape exits without modifying text; a new slash can reopen", async () => {
  const h = await harness({ text: "/" });
  assert.equal(h.active().active, true);
  assert.equal(h.escape(), true);
  assert.equal(h.active().active, false);
  assert.equal(h.text(), "/");
  h.type(" /h");
  assert.equal(h.active().active, true);
  assert.equal(h.active().query, "h");
});

test("a visible command revalidates the latest action/readiness before deleting the trigger", async (t) => {
  const { createRendererServer } = require("../lib/rendererTestHarness");
  const vite = await createRendererServer(t, {
    noExternal: ["@tiptap/suggestion"],
    mockModules: {
      "@tiptap/suggestion": "export default options => options;",
    },
  });
  const { createSlashCommand } = await vite.ssrLoadModule("/components/ui/editor/SlashCommand.ts");
  const oldItem = {
    id: "action-7",
    actionId: 7,
    group: "ai",
    label: "Pricing digest",
    keywords: [],
  };
  const calls = [];
  let currentItems = [{ ...oldItem, disabledReason: "Checking…" }];
  const context = () => ({
    items: currentItems,
    onRunAction: (id) => calls.push(["currentAction", id]),
  });
  const extension = createSlashCommand(context);
  const [options] = extension.config.addProseMirrorPlugins.call({ editor: {} });
  const chain = new Proxy(
    {},
    {
      get:
        (_, name) =>
        (...args) => {
          calls.push([name, ...args]);
          return name === "run" ? true : chain;
        },
    }
  );
  const editor = { isEditable: true, chain: () => chain };
  const choose = () => options.command({ editor, range: { from: 1, to: 8 }, props: oldItem });
  choose();
  assert.deepEqual(calls, [], "unknown blocks the stale ready item before document mutation");
  currentItems = [];
  choose();
  assert.deepEqual(calls, [], "removed actions cannot run");
  currentItems = [oldItem];
  editor.isEditable = false;
  choose();
  assert.deepEqual(calls, [], "an editor disabled since opening cannot run");
  editor.isEditable = true;
  choose();
  assert.deepEqual(calls, [
    ["focus"],
    ["deleteRange", { from: 1, to: 8 }],
    ["run"],
    ["currentAction", 7],
  ]);
});
