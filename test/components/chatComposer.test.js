const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");

const loadKeys = () => import("../../src/components/chat/chatInputKeys.ts");
const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/chat/ChatInput.tsx"),
  "utf8"
);
const COMPOSER_MOCKS = {
  "/ui/useToast": TOAST_MOCK,
  "/useVoiceDraft": `export const useVoiceDraft = () => ({ status: "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0, streamingOnlyProvider: false });`,
};
const base = { shiftKey: false, isComposing: false, isBusy: false, isQueued: false, hasText: true };

test("Enter submits when idle and queues while the agent is busy", async () => {
  const { resolveComposerKey } = await loadKeys();
  assert.equal(resolveComposerKey({ ...base, key: "Enter" }), "submit");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", isBusy: true }), "queue");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", hasText: false }), "none");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", shiftKey: true }), "none");
});

test("Enter during IME composition does nothing", async () => {
  const { resolveComposerKey } = await loadKeys();
  assert.equal(resolveComposerKey({ ...base, key: "Enter", isComposing: true }), "none");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", keyCode: 229 }), "none");
  assert.equal(
    resolveComposerKey({ ...base, key: "Enter", isBusy: true, isComposing: true }),
    "none"
  );
});

test("Escape unqueues only a queued draft", async () => {
  const { resolveComposerKey } = await loadKeys();
  assert.equal(resolveComposerKey({ ...base, key: "Escape", isQueued: true }), "unqueue");
  assert.equal(resolveComposerKey({ ...base, key: "Escape" }), "none");
});

test("the textarea grows to a cap and then scrolls", async () => {
  const { composerHeight, COMPOSER_MAX_HEIGHT_PX } = await loadKeys();
  assert.deepEqual(composerHeight(40), { height: 40, overflowY: "hidden" });
  assert.deepEqual(composerHeight(400), { height: COMPOSER_MAX_HEIGHT_PX, overflowY: "auto" });
  assert.deepEqual(composerHeight(Number.NaN), { height: 0, overflowY: "hidden" });
});

test("the composer stays typeable while the agent is busy", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-chat-composer-", COMPOSER_MOCKS)
  );
  const { ChatInput } = await vite.ssrLoadModule("/components/chat/ChatInput.tsx");
  const html = renderToStaticMarkup(
    createElement(ChatInput, {
      partialTranscript: "",
      agentState: "thinking",
      onTextSubmit() {},
      onCancel() {},
    })
  );
  const textarea = html.match(/<textarea[^>]*>/);
  assert.ok(textarea, "the composer is a textarea");
  assert.doesNotMatch(textarea[0], /disabled/);
  assert.match(textarea[0], /dir="auto"/);
  assert.match(textarea[0], /rows="1"/);
  assert.match(html, /aria-label="common\.cancel"/, "Stop is still offered");
});

test("the busy state is not a disabled field, and every focus ring is full opacity", () => {
  assert.doesNotMatch(source, /disabled=\{isBusy\}/);
  assert.doesNotMatch(source, /cursor-not-allowed/);
  assert.doesNotMatch(source, /ring-(ring|primary)\/\d+/);
});
