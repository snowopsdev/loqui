const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/ui/editor/slashItems.ts");
const t = (key) => `t(${key})`;
const actions = [
  {
    id: 1,
    name: "Generate Notes",
    translation_key: "notes.actions.builtin.generateNotes",
    sort_order: 0,
  },
  { id: 7, name: "Pricing digest", translation_key: null, sort_order: 1 },
];

test("Text, AI and Insert groups in that order; AI lists the user's real actions", async () => {
  const { buildSlashItems, groupSlashItems } = await load();
  const groups = groupSlashItems(buildSlashItems({ actions, aiAvailable: true, t }));
  assert.deepEqual(
    groups.map((g) => g.group),
    ["text", "ai", "insert"]
  );
  assert.deepEqual(
    groups[0].items.map((i) => i.id),
    ["h1", "h2", "h3", "bullet", "numbered", "todo", "quote", "code"]
  );
  assert.deepEqual(
    groups[1].items.map((i) => [i.id, i.label]),
    [
      ["action-1", "t(notes.actions.builtin.generateNotes.name)"],
      ["action-7", "Pricing digest"],
      ["manageActions", "t(notes.slash.manageActions)"],
    ]
  );
  assert.deepEqual(
    groups[2].items.map((i) => i.id),
    ["timestamp", "dictation", "mention"]
  );
});

test("without an AI model, AI items stay visible but disabled with the reason", async () => {
  const { buildSlashItems } = await load();
  const items = buildSlashItems({
    actions,
    aiAvailable: false,
    aiUnavailableReason: "Add an API key in Settings",
    t,
  });
  const ai = items.filter(
    (i) => i.group === "ai" && i.id !== "manageActions" && i.id !== "setupAi"
  );
  assert.ok(ai.length > 0);
  for (const item of ai) assert.equal(item.disabledReason, "Add an API key in Settings");
  assert.equal(items.filter((i) => i.group === "ai")[0].id, "setupAi", "the fix leads the group");
  assert.equal(
    buildSlashItems({ actions, aiAvailable: true, t }).some((i) => i.id === "setupAi"),
    false
  );
  assert.equal(
    buildSlashItems({
      actions,
      aiAvailable: false,
      aiUnavailableReason: "Checking…",
      aiNeedsSetup: false,
      t,
    }).some((i) => i.id === "setupAi"),
    false,
    "while the route is unknown there is nothing to set up yet"
  );
});

test("AI readiness follows the resolved note-formatting route, not the cleanup-model selection (I09)", async () => {
  const { noteAiReadiness } = await load();
  // A fresh install: local route, model chosen by default but not downloaded.
  assert.deepEqual(noteAiReadiness({ status: "needsModel", sizeBytes: 1_300_000_000 }), {
    available: false,
    reasonKey: "notes.slash.ai.needsModel",
    needsSetup: true,
  });
  // A remote route with no saved key.
  assert.deepEqual(noteAiReadiness({ status: "needsKey", provider: "openai" }), {
    available: false,
    reasonKey: "notes.slash.ai.needsKey",
    needsSetup: true,
  });
  // Ready, local or remote alike.
  assert.deepEqual(noteAiReadiness({ status: "ready" }), {
    available: true,
    reasonKey: null,
    needsSetup: false,
  });
  // Main has not confirmed yet (§5.1 rule 1): not ready, but nothing to set up either.
  assert.deepEqual(noteAiReadiness({ status: "unknown" }), {
    available: false,
    reasonKey: "notes.slash.ai.unknown",
    needsSetup: false,
  });
  assert.equal(
    noteAiReadiness({ status: "unreachable", detail: "sealed" }).reasonKey,
    "notes.slash.ai.unreachable"
  );
  assert.equal(noteAiReadiness({ status: "off" }).reasonKey, "notes.slash.ai.off");
  assert.equal(noteAiReadiness({ status: "needsUrl" }).reasonKey, "notes.slash.ai.needsUrl");
});

test("PersonalNotesView takes readiness from the route", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../src/components/notes/PersonalNotesView.tsx"),
    "utf8"
  );
  assert.match(src, /useResolvedRoute\("noteFormatting"\)/);
  assert.doesNotMatch(src, /aiAvailable:\s*isLLMConfigured/);
  assert.match(
    src,
    /\.\.\.slashReadiness\(noteRoute\.state, t\)/,
    "all readiness fields cross in one spread"
  );
  assert.match(src, /onSetupAi: \(\) => onOpenSettings\?\.\(noteRoute\.settingsPath\)/);
  const editor = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../src/components/ui/RichTextEditor.tsx"),
    "utf8"
  );
  assert.match(
    editor,
    /items: slashItemsFromProp\(current, t\)/,
    "the editor forwards the prop whole"
  );
  assert.doesNotMatch(editor, /buildSlashItems\(/, "and never rebuilds the argument list by hand");
});

test("route readiness survives the Notes → editor boundary: unknown, then needsKey, then ready (I09-R2)", async () => {
  const { slashReadiness, slashItemsFromProp, applySlashItem } = await load();
  // The exact path production takes: PersonalNotesView's slash prop, then RichTextEditor's items.
  const itemsFor = (state) => slashItemsFromProp({ actions, ...slashReadiness(state, t) }, t);
  const runnable = (items) => items.filter((i) => i.actionId != null);

  const checking = itemsFor({ status: "unknown" });
  assert.equal(
    checking.some((i) => i.id === "setupAi"),
    false,
    "no setup prompt while main is checking"
  );
  for (const item of runnable(checking))
    assert.equal(item.disabledReason, "t(notes.slash.ai.unknown)");

  const missingKey = itemsFor({ status: "needsKey", provider: "openai" });
  const setup = missingKey.filter((i) => i.group === "ai")[0];
  assert.equal(setup.id, "setupAi", "a confirmed failure leads with the fix");
  const opened = [];
  assert.equal(
    applySlashItem(setup, { run: () => true }, { onSetupAi: () => opened.push("settings") }),
    true
  );
  assert.deepEqual(
    opened,
    ["settings"],
    "it runs onSetupAi, which Notes wires to onOpenSettings(noteRoute.settingsPath)"
  );
  for (const item of runnable(missingKey))
    assert.equal(item.disabledReason, "t(notes.slash.ai.needsKey)");

  const ready = itemsFor({ status: "ready" });
  assert.equal(
    ready.some((i) => i.id === "setupAi"),
    false
  );
  for (const item of runnable(ready))
    assert.equal(item.disabledReason, undefined, "actions are enabled");
});

test("typing filters by label or keyword, case-insensitively", async () => {
  const { buildSlashItems, filterSlashItems } = await load();
  const items = buildSlashItems({
    actions,
    aiAvailable: true,
    t: (key) => ({ "notes.slash.items.todo": "To-do list" })[key] ?? key,
  });
  assert.deepEqual(
    filterSlashItems(items, "TODO").map((i) => i.id),
    ["todo"]
  );
  assert.deepEqual(
    filterSlashItems(items, "checkbox").map((i) => i.id),
    ["todo"]
  );
  assert.deepEqual(
    filterSlashItems(items, "digest").map((i) => i.id),
    ["action-7"]
  );
  assert.equal(filterSlashItems(items, "zzz").length, 0);
});

test("blocks map to editor commands; AI and inserts go to callbacks", async () => {
  const { buildSlashItems, applySlashItem } = await load();
  const items = buildSlashItems({ actions, aiAvailable: true, t });
  const calls = [];
  const chain = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args) => {
          calls.push([name, ...args]);
          return chain;
        },
    }
  );
  const ctx = {
    items,
    onRunAction: (id) => calls.push(["runAction", id]),
    onManageActions: () => calls.push(["manage"]),
    onDictateHere: () => calls.push(["dictate"]),
    formatTimestamp: () => "Wed 14 Oct, 3:42 PM",
  };
  const pick = (id) => items.find((i) => i.id === id);
  applySlashItem(pick("h2"), chain, ctx);
  applySlashItem(pick("todo"), chain, ctx);
  applySlashItem(pick("timestamp"), chain, ctx);
  applySlashItem(pick("mention"), chain, ctx);
  applySlashItem(pick("action-7"), chain, ctx);
  applySlashItem(pick("dictation"), chain, ctx);
  assert.deepEqual(calls, [
    ["setNode", "heading", { level: 2 }],
    ["run"],
    ["toggleTaskList"],
    ["run"],
    ["insertContent", "Wed 14 Oct, 3:42 PM "],
    ["run"],
    ["insertContent", "@"],
    ["run"],
    ["run"],
    ["runAction", 7],
    ["run"],
    ["dictate"],
  ]);
});

test("a disabled item does nothing", async () => {
  const { buildSlashItems, applySlashItem } = await load();
  const items = buildSlashItems({ actions, aiAvailable: false, t });
  const ran = [];
  const ok = applySlashItem(
    items.find((i) => i.id === "action-1"),
    { run: () => ran.push("run") },
    { onRunAction: () => ran.push("action") }
  );
  assert.equal(ok, false);
  assert.deepEqual(ran, []);
});

test("production built-in namespaces resolve the name leaf and missing translations retain action names", async () => {
  const { buildSlashItems } = await load();
  const i18next = require("i18next").createInstance();
  const en = require("../../src/locales/en/translation.json");
  await i18next.init({ lng: "en", resources: { en: { translation: en } } });
  const items = buildSlashItems({
    actions: [
      ...actions,
      { id: 8, name: "Saved fallback", translation_key: "removed.plugin.action", sort_order: 2 },
    ],
    aiAvailable: true,
    t: i18next.t.bind(i18next),
  });
  assert.equal(
    items.find((i) => i.id === "action-1").label,
    en.notes.actions.builtin.generateNotes.name
  );
  assert.equal(items.find((i) => i.id === "action-7").label, "Pricing digest");
  assert.equal(items.find((i) => i.id === "action-8").label, "Saved fallback");
});

test("raw and enhanced notes have distinct editor mounts, with slash only on raw notes", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../src/components/notes/NoteEditor.tsx"),
    "utf8"
  );
  const editors = [...source.matchAll(/<RichTextEditor\b[^]*?\/>/g)].map((m) => m[0]);
  const raw = editors.find((s) => s.includes('key="raw"'));
  const enhanced = editors.find((s) => s.includes('key="enhanced"'));
  assert.ok(
    raw && enhanced,
    "view switches remount the extension sets; mounted production QA exercises both directions"
  );
  assert.match(raw, /slash=\{slash\}/);
  assert.doesNotMatch(enhanced, /slash=/);
});
