const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");

const OLD = { id: 9, title: "Synthetic typography note", note_type: "personal" };
const FRESH = { id: 11, title: "Standup meeting", note_type: "meeting" };
const act = (fn) =>
  React.act(async () => {
    await fn();
    await new Promise((r) => setTimeout(r, 0));
  });

// Real ChatView, ChatInput, entity search and MentionSuggestions; synthetic
// sources/stream and leaf views keep this current-intent test isolated.
async function mount(t) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const calls = { sends: 0, writes: 0, searches: [] };
  let resolveSearch;
  const pending = new Promise((resolve) => {
    resolveSearch = resolve;
  });
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        createAgentConversation: async () => ({ id: 21 }),
        addAgentMessage: async () => {
          calls.writes++;
          return { id: calls.writes };
        },
      },
    },
  });
  installHookDom(t);
  const originalStyle = globalThis.getComputedStyle;
  const originalObserver = globalThis.ResizeObserver;
  globalThis.getComputedStyle = () => ({ direction: "ltr" });
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  t.after(() => {
    globalThis.getComputedStyle = originalStyle;
    globalThis.ResizeObserver = originalObserver;
    delete globalThis.__contextIntentFixture;
  });
  const tree = installTree();
  const { document } = globalThis;
  document.body = tree.container;
  const create = document.createElement;
  document.createElement = (tag) =>
    Object.assign(create(tag), {
      clientWidth: 1000,
      querySelector: (selector) =>
        selector === "textarea" ? tree.find((n) => n.tagName === "TEXTAREA") : null,
      getBoundingClientRect: () => ({ top: 500, left: 0, right: 1000, width: 262, height: 200 }),
      setSelectionRange(start, end) {
        this.selectionStart = start;
        this.selectionEnd = end;
      },
    });
  const sources = {
    recentNotes: [OLD],
    transcriptions: [],
    folders: [],
    people: [],
    searchNotes: (query) => {
      calls.searches.push(query);
      return pending;
    },
    searchContacts: async () => [],
    describe: { note: () => "", meeting: () => "", folder: () => "", dictation: () => "" },
  };
  globalThis.__contextIntentFixture = { sources, calls };
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-context-intent-", {
      "/ui/useToast": TOAST_MOCK,
      "/useVoiceDraft": `export const useVoiceDraft = () => ({ status: "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0 });`,
      "/useMentionSources": `import { useRef } from "react"; export const useMentionSources = () => useRef(globalThis.__contextIntentFixture.sources);`,
      "/ConversationList": `export default function ConversationList() { return null; }`,
      "/ChatMessages": `export function ChatMessages() { return null; }`,
      "/ChatEmptyIllustration": `export function ChatEmptyIllustration() { return null; }`,
      "/ui/dialog": `export function ConfirmDialog() { return null; }`,
      "/useChatStreaming": `export const useChatStreaming = () => ({ agentState: "idle", cancelStream() {}, async sendToAI() { globalThis.__contextIntentFixture.calls.sends++; } });`,
      "/chatRouteKey": `export const useChatRouteKey = () => "route-a";`,
    })
  );
  const { default: ChatView } = await vite.ssrLoadModule("/components/chat/ChatView.tsx");
  root = createRoot(tree.container);
  await act(() => root.render(React.createElement(ChatView)));
  const box = () => tree.find((n) => n.tagName === "TEXTAREA");
  const option = () => tree.find((n) => tree.props(n)?.role === "option");
  const change = (text, caret = text.length) => {
    box().value = text;
    box().selectionStart = caret;
    tree.props(box()).onChange({ target: box() });
  };
  const select = (caret) => {
    box().selectionStart = caret;
    tree.props(box()).onSelect({ currentTarget: box() });
  };
  const key = (key) => {
    let prevented = false;
    tree.props(box()).onKeyDown({
      key,
      nativeEvent: { key, isComposing: false, keyCode: 0 },
      preventDefault() {
        prevented = true;
      },
    });
    return prevented;
  };
  return {
    ...tree,
    calls,
    box,
    option,
    change,
    select,
    key,
    type: (text, caret) => act(() => change(text, caret)),
    add: () => tree.click("chat.rail.addContext"),
    fresh: () => act(() => resolveSearch([FRESH])),
    value: () => tree.props(box()).value,
    noSend: () => {
      assert.equal(calls.sends, 0);
      assert.equal(calls.writes, 0);
    },
    pins: () => tree.find((n) => tree.props(n)?.["aria-label"]?.startsWith("chat.rail.unpin")),
    noPin: () =>
      assert.ok(!tree.find((n) => tree.props(n)?.["aria-label"]?.startsWith("chat.rail.unpin"))),
  };
}

test("Add context replaced by @standup rejects old rows before deferred fresh results and selects only fresh results", async (t) => {
  const v = await mount(t);
  await v.type("original draft");
  await v.add();
  assert.match(v.option().textContent, /Synthetic typography/);
  await act(() => {
    v.change("@standup");
    assert.equal(v.key("Enter"), true);
  });
  v.noPin();
  v.noSend();
  assert.ok(!v.option(), "old empty-query rows become ineligible immediately");
  await act(() => assert.equal(v.key("Enter"), true));
  v.noPin();
  v.noSend();
  assert.equal(v.value(), "@standup");
  assert.deepEqual(v.calls.searches, ["standup"]);
  await v.fresh();
  assert.match(v.option().textContent, /Standup meeting/);
  await act(() => v.key("Enter"));
  assert.equal(v.props(v.pins())["aria-label"], "chat.rail.unpin(label=Standup meeting)");
  assert.equal(v.value(), "");
  v.noSend();
});

for (const source of ["button", "typed"]) {
  test(`${source} held pointer command cannot pin or seed after a same-stack draft change`, async (t) => {
    const v = await mount(t);
    await v.type(source === "button" ? "original draft" : "@");
    if (source === "button") await v.add();
    const held = v.props(v.option()).onClick;
    await act(() => {
      v.change("@standup");
      held();
    });
    v.noPin();
    v.noSend();
    assert.equal(v.value(), "@standup");
    await v.fresh();
    assert.match(v.option().textContent, /Standup meeting/);
    await act(() => held());
    v.noPin();
    v.noSend();
    assert.equal(v.value(), "@standup");
  });
  test(`${source} held command revalidates the textarea before a delayed selection notification`, async (t) => {
    const v = await mount(t);
    await v.type(source === "button" ? "original draft" : "before @");
    if (source === "button") await v.add();
    const held = v.props(v.option()).onClick;
    await act(() => {
      v.box().selectionStart = 2; // Native selection changed; onSelect has not arrived.
      held();
    });
    v.noPin();
    v.noSend();
    assert.ok(!v.option());
    assert.equal(v.value(), source === "button" ? "original draft" : "before @");
    assert.equal(v.box().selectionStart, 2);
  });
  test(`${source} caret-only change retires its held pointer command without changing draft or sending`, async (t) => {
    const v = await mount(t);
    await v.type(source === "button" ? "original draft" : "before @");
    if (source === "button") await v.add();
    const held = v.props(v.option()).onClick;
    await act(() => {
      v.select(2);
      held();
    });
    v.noPin();
    v.noSend();
    assert.ok(!v.option());
    assert.equal(v.value(), source === "button" ? "original draft" : "before @");
    assert.equal(v.box().selectionStart, 2);
  });
}

test("unchanged Add context pick preserves exact draft and caret", async (t) => {
  const v = await mount(t);
  const text = "  original\n    draft  \n  ";
  await v.type(text, 5);
  await v.add();
  await act(() => v.props(v.option()).onClick());
  assert.equal(v.props(v.pins())["aria-label"], "chat.rail.unpin(label=Synthetic typography note)");
  assert.equal(v.value(), text);
  assert.equal(v.box().selectionStart, 5);
  v.noSend();
});
