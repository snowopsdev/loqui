const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { installClickableTree } = require("../lib/clickableTree");

const TRANSLATION_SOURCE = `
const t = (key, options) => (options && "count" in options ? key + ":" + options.count : key);
export const useTranslation = () => ({ t });
`;

const WORDS = "Hey Maya, can you move the design review to Thursday at 2?";

async function mountStack(t, { electronAPI = {}, webClipboard } = {}) {
  // Registered first, so it runs before the globals it needs are restored.
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window: { electronAPI } });
  installHookDom(t);
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: webClipboard ? { clipboard: webClipboard } : {},
    configurable: true,
    writable: true,
  });
  t.after(() => {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  });
  const tree = installClickableTree();
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-words-card-actions-",
    noExternal: ["react-i18next"],
    mockModules: { "react-i18next": TRANSLATION_SOURCE },
  });
  const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
  notices.__setNoticeClockForTests();
  t.after(() => notices.__setNoticeClockForTests());
  const { NoticeStack } = await vite.ssrLoadModule("/components/ui/NoticeStack.tsx");
  root = createRoot(tree.container);
  const render = (props = {}) =>
    React.act(async () =>
      root.render(React.createElement(NoticeStack, { placement: "panel", ...props }))
    );
  const copyButton = () =>
    tree.find((node) => node.tagName === "BUTTON" && "data-copy" in node.attributes);
  return { ...tree, notices, render, copyButton };
}

const showCard = (notices) =>
  notices.notify({
    id: "dictation-recovery:rec-1",
    kind: "alert",
    title: "Couldn't paste into Slack",
    words: WORDS,
  });

for (const [label, electronAPI, webClipboard] of [
  [
    "the bridge rejects and there is no web clipboard",
    {
      writeClipboard: async () => {
        throw new Error("denied");
      },
    },
    undefined,
  ],
  [
    "the bridge returns { success: false }",
    { writeClipboard: async () => ({ success: false }) },
    undefined,
  ],
  ["there is no bridge and no web clipboard (Browser Preview)", {}, undefined],
  [
    "the bridge fails and the web clipboard rejects too",
    { writeClipboard: async () => ({ success: false }) },
    {
      writeText: async () => {
        throw new Error("Document is not focused");
      },
    },
  ],
]) {
  test(`Copy shows a failure and keeps the words when ${label} (R2-I3)`, async (t) => {
    const stack = await mountStack(t, { electronAPI, webClipboard });
    showCard(stack.notices);
    await stack.render();
    await stack.clickNode(stack.copyButton());
    assert.equal(stack.copyButton().attributes["data-copy-state"], "failed");
    assert.match(stack.text(), /notices\.wordsCard\.copyFailedHint/);
    assert.doesNotMatch(stack.text(), /notices\.wordsCard\.copied/);
    assert.equal(stack.notices.getNotices()[0].words, WORDS, "the words stay in the store");
    assert.match(stack.text(), /Hey Maya, can you move the design review/, "and on screen");
  });
}

test("Copy without a bridge uses the web Clipboard API, and says Copied only after it resolves", async (t) => {
  const writes = [];
  const stack = await mountStack(t, {
    electronAPI: {},
    webClipboard: {
      writeText: async (text) => {
        writes.push(text);
      },
    },
  });
  showCard(stack.notices);
  await stack.render();
  await stack.clickNode(stack.copyButton());
  assert.deepEqual(writes, [WORDS]);
  assert.equal(stack.copyButton().attributes["data-copy-state"], "copied");
});

test("Copy through the bridge confirms on { success: true } and keeps the card", async (t) => {
  const writes = [];
  const stack = await mountStack(t, {
    electronAPI: {
      writeClipboard: async (text) => {
        writes.push(text);
        return { success: true };
      },
    },
  });
  showCard(stack.notices);
  await stack.render();
  await stack.clickNode(stack.copyButton());
  assert.deepEqual(writes, [WORDS]);
  assert.equal(stack.copyButton().attributes["data-copy-state"], "copied");
  assert.match(stack.text(), /notices\.wordsCard\.copied/);
  assert.equal(stack.notices.getNotices().length, 1, "copying is not discarding");
});

test("'N more' cycles through every held transcript (R2-C3)", async (t) => {
  const stack = await mountStack(t);
  stack.notices.notify({
    id: "dictation-recovery:rec-1",
    kind: "alert",
    title: "A",
    words: "first words",
  });
  stack.notices.notify({
    id: "dictation-recovery:rec-2",
    kind: "alert",
    title: "B",
    words: "second words",
  });
  await stack.render();
  assert.match(stack.text(), /second words/);
  await stack.click("notices.wordsCard.more:1");
  assert.match(stack.text(), /first words/);
  assert.doesNotMatch(stack.text(), /second words/);
  await stack.click("notices.wordsCard.more:1");
  assert.match(stack.text(), /second words/);
  assert.equal(
    stack.notices.wordsNotices(stack.notices.getNotices()).length,
    2,
    "cycling drops nothing"
  );
});

test("a failed Copy can recover on the same retained card", async (t) => {
  let success = false;
  const stack = await mountStack(t, { electronAPI: { writeClipboard: async () => ({ success }) } });
  showCard(stack.notices);
  await stack.render();
  await stack.clickNode(stack.copyButton());
  assert.equal(stack.copyButton().attributes["data-copy-state"], "failed");
  success = true;
  await stack.clickNode(stack.copyButton());
  assert.equal(stack.copyButton().attributes["data-copy-state"], "copied");
  assert.doesNotMatch(stack.text(), /notices\.wordsCard\.copyFailedHint/);
  assert.equal(stack.notices.getNotices()[0].words, WORDS);
});

test("a pending clipboard confirmation never reports copied, nor labels replacement words copied", async (t) => {
  let confirm;
  const stack = await mountStack(t, {
    electronAPI: {
      writeClipboard: () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    },
  });
  showCard(stack.notices);
  await stack.render();
  await stack.clickNode(stack.copyButton());
  assert.equal(stack.copyButton().attributes["data-copy-state"], "idle");
  await React.act(async () =>
    stack.notices.notify({
      id: "dictation-recovery:rec-1",
      kind: "alert",
      title: "New recovery",
      words: "replacement words",
    })
  );
  await React.act(async () => confirm({ success: true }));
  assert.equal(stack.copyButton().attributes["data-copy-state"], "idle");
  assert.match(stack.text(), /replacement words/);
});

test("More reveals and runs the real secondary action", async (t) => {
  const stack = await mountStack(t);
  let calls = 0;
  stack.notices.notify({
    kind: "notice",
    title: "Cleanup skipped",
    persistent: true,
    actions: [
      { label: "Retry cleanup", primary: true, onClick() {} },
      {
        label: "Settings",
        keepOpen: true,
        onClick() {
          calls += 1;
        },
      },
    ],
  });
  await stack.render();
  assert.doesNotMatch(stack.text(), /Settings/);
  await stack.clickNode(stack.find((node) => node.attributes?.class === "notice-chip__more"));
  assert.equal(
    stack.find((node) => node.attributes?.class === "notice-chip__more").attributes[
      "aria-expanded"
    ],
    "true"
  );
  await stack.click("Settings");
  assert.equal(calls, 1);
});

test("the pill stack sends observed card content height to the native resize bridge", async (t) => {
  let resize;
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resize = callback;
    }
    observe() {}
    disconnect() {}
  };
  const heights = [];
  const stack = await mountStack(t, {
    electronAPI: {
      resizeDictationErrorWindowToContent: async (height) => {
        heights.push(height);
      },
    },
  });
  t.after(() => {
    if (original === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = original;
  });
  showCard(stack.notices);
  await stack.render({ placement: "pill" });
  const card = stack.find((node) => node.attributes?.class === "words-card");
  card.offsetHeight = 120;
  card.scrollHeight = 137;
  await React.act(async () => resize());
  assert.deepEqual(heights, [137]);
});
