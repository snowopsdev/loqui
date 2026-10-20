const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function render(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-chat-document-" });
  const mod = await vite.ssrLoadModule("/components/chat/ChatMessage.tsx");
  return renderToStaticMarkup(
    createElement(mod.ChatMessage, { variant: "document", isStreaming: false, ...props })
  );
}
const search = {
  id: "t1",
  name: "search_notes",
  arguments: '{"query":"pricing"}',
  status: "completed",
  result: 'Found 2 notes for "pricing"',
  metadata: [
    {
      id: 38,
      title: "Pricing review",
      date: "2026-10-09",
      type: "meeting",
      quote: "so Thursday, not Monday",
    },
    {
      id: 5,
      title: "Product catch-up",
      date: "2026-10-14",
      type: "personal",
      quote: "Maya owns FAQ copy",
    },
  ],
};

test("the user turn is a neutral raised surface, never orange", async (t) => {
  const html = await render(t, { role: "user", content: "What did we decide about pricing?" });
  assert.match(html, /data-variant="document"/);
  assert.match(html, /bg-surface-3/);
  assert.doesNotMatch(html, /bg-primary/);
});

test("answers are unbubbled prose at 68ch with numbered citations and a Sources row", async (t) => {
  const html = await render(t, {
    role: "assistant",
    content: "Thursday, not Monday [note:38]. Maya owns the FAQ [note:5].",
    toolCalls: [search],
  });
  assert.match(html, /max-w-\[68ch\]/);
  assert.doesNotMatch(html, /data-chat-bubble/);
  assert.match(html, /<sup[^>]*data-citation="1"/);
  assert.match(html, /<sup[^>]*data-citation="2"/);
  assert.match(html, /data-sources/);
  assert.match(html, /agentMode\.tools\.summary/);
});

test("the streaming turn carries the Agent rail; a finished one does not", async (t) => {
  const streaming = await render(t, { role: "assistant", content: "Thurs", isStreaming: true });
  assert.match(streaming, /border-agent/);
  const done = await render(t, { role: "assistant", content: "Thursday." });
  assert.doesNotMatch(done, /border-agent/);
});

test("thinking is three dots with a text twin", async (t) => {
  const html = await render(t, { role: "assistant", content: "", isStreaming: true });
  assert.match(html, /class="thinking-dots"/);
  assert.match(html, /agentMode\.input\.thinking/);
});

test("the chat loops use the shared cadence tokens, never literal durations (N03)", () => {
  const css = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../src/index.css"),
    "utf8"
  );
  const dots = css.slice(css.indexOf(".thinking-dots {"), css.indexOf("@keyframes thinking-dot"));
  assert.match(dots, /animation:\s*thinking-dot var\(--motion-loop-pulse\)/);
  assert.match(dots, /animation-delay:\s*calc\(var\(--motion-stagger\) \* 2\)/);
  assert.doesNotMatch(dots, /\d(?:ms|s)\b/);
  const message = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../src/components/chat/ChatMessage.tsx"),
    "utf8"
  );
  assert.match(
    message,
    /agent-cursor-blink var\(--motion-loop-blink\)/,
    "the document branch's cursor"
  );
});

test("actual Markdown composition numbers only eligible known prose and orders Sources to match", async (t) => {
  const html = await render(t, {
    role: "assistant",
    content:
      "`[note:17]` [link [note:5]](https://example.test)\n\nReal [note:38], again [note:38], unknown [note:999].\n\n| Claim | Evidence |\n| --- | --- |\n| **FAQ** | [note:5] |",
    toolCalls: [search],
    context: {
      ragNotes: [{ id: 17, title: "Code only", type: null, date: null, quote: "literal" }],
    },
  });
  assert.deepEqual(
    [...html.matchAll(/<sup[^>]*data-citation="(\d+)"/g)].map((m) => m[1]),
    ["1", "1", "2"]
  );
  assert.match(html, /<code[^>]*>\[note:17\]<\/code>/);
  assert.match(html, /link \[note:5\]/);
  assert.doesNotMatch(html, /\[note:999\]|Code only/);
  const row = html.slice(html.indexOf("data-sources"));
  assert.ok(row.indexOf("Pricing review") < row.indexOf("Product catch-up"));
  assert.match(html, /<table/);
});

test("stored RAG and pinned refs are citable and uncited fallback is deduplicated and capped at five", async (t) => {
  const refs = Array.from({ length: 7 }, (_, i) => ({
    id: i + 1,
    title: `Stored ${i + 1}`,
    type: null,
    date: null,
    quote: "persisted excerpt",
  }));
  const html = await render(t, {
    role: "assistant",
    content: "Known [note:7] then [note:2].",
    context: { ragNotes: refs.slice(0, 3), pinnedNotes: refs.slice(3) },
  });
  assert.deepEqual(
    [...html.matchAll(/data-citation="(\d+)"/g)].map((m) => m[1]),
    ["1", "2"]
  );
  assert.ok(html.indexOf("Stored 7") < html.indexOf("Stored 2"));
  const fallback = await render(t, {
    role: "assistant",
    content: "No markers.",
    context: { ragNotes: refs, pinnedNotes: refs },
  });
  assert.equal((fallback.match(/data-kind="note"/g) ?? []).length, 5);
  assert.doesNotMatch(fallback, /data-citation/);
});

test("activity names the executing tool rather than the last completed tool", async (t) => {
  const html = await render(t, {
    role: "assistant",
    content: "",
    isStreaming: true,
    toolCalls: [
      { ...search, name: "get_note", status: "executing" },
      { ...search, id: "done" },
    ],
  });
  assert.match(html, />get_note<\/button>/);
  assert.doesNotMatch(html, /agentMode.tools.search_notesStatus|agentMode.tools.summary/);
});

test("non-search work never claims Searched zero notes and default hosts still render bubbles", async (t) => {
  const html = await render(t, {
    role: "assistant",
    content: "Copied.",
    toolCalls: [
      {
        id: "copy",
        name: "copy_to_clipboard",
        arguments: "{}",
        status: "completed",
        result: "Clipboard ready",
      },
    ],
  });
  assert.doesNotMatch(html, /agentMode.tools.summary/);
  assert.match(html, /copiedToClipboard/);
  const bubble = await render(t, {
    variant: undefined,
    role: "assistant",
    content: "Bubble answer.",
  });
  assert.match(bubble, /data-chat-bubble/);
  assert.doesNotMatch(bubble, /data-variant="document"|data-sources/);
});

test("document copy has a localized accessible name, keyboard visibility and opaque focus ring", async (t) => {
  const html = await render(t, { role: "assistant", content: "Answer." });
  assert.match(html, /aria-label="[^"]+"/);
  assert.match(html, /focus-visible:opacity-100/);
  assert.match(html, /focus-visible:ring-2/);
  assert.doesNotMatch(html, /ring-ring\/|text-muted-foreground\//);
});

test("summary counts valid completed search notes only, with actual locale plural copy", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t);
  const { ChatMessage } = await vite.ssrLoadModule("/components/chat/ChatMessage.tsx");
  const { createInstance } = await import("i18next");
  const { I18nextProvider } = await import("react-i18next");
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    resources: { en: { translation: require("../../src/locales/en/translation.json") } },
  });
  const html = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(ChatMessage, {
        variant: "document",
        role: "assistant",
        content: "",
        isStreaming: false,
        toolCalls: [
          search,
          { ...search, id: "invalid", metadata: [{ id: -1 }, { id: 9007199254740992 }] },
          { ...search, id: "error", status: "executing", name: "get_note" },
        ].slice(0, 2),
        context: { ragNotes: [{ id: 80, title: "RAG", quote: "Extra", date: null, type: null }] },
      })
    )
  );
  assert.match(html, />Searched 2 notes<\/button>/);
});

test("document header shows only recorded answer routes and preserves unstamped legacy history", async (t) => {
  const props = {
    role: "assistant",
    content: "Saved answer",
    context: { route: { model: "Recorded model", providerId: "custom", locality: "remote" } },
  };
  const stamped = await render(t, props);
  assert.match(stamped, /Recorded model/);
  assert.match(stamped, /data-locality="remote"/);
  assert.match(stamped, /flex-wrap/);
  for (const context of [undefined, { route: null }]) {
    const legacy = await render(t, { ...props, context });
    assert.doesNotMatch(legacy, /data-locality|Recorded model/);
  }
});
