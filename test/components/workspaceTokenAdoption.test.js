const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { WORKSPACE_GUARDED_FILES, scanFiles, scanText } = require("../helpers/workspaceTokenGuard");

test("workspace files use the ramp, the D1 colour roles and full-opacity focus rings", () => {
  assert.deepEqual(scanFiles(WORKSPACE_GUARDED_FILES), []);
});

test("the guard catches what it promises, and honours a reasoned opt-out", () => {
  const hits = (src) => scanText("x.tsx", src).map((v) => v.split(" — ")[1].split(":")[0]);
  assert.deepEqual(
    hits('<p className="text-[10px] text-muted-foreground/70 text-foreground/55">'),
    ["arbitrary-size", "faded-muted", "faded-foreground"]
  );
  assert.deepEqual(
    hits('<p className="text-foreground/80 text-foreground">'),
    [],
    "70% and above passes"
  );
  assert.deepEqual(
    hits('<div className="focus-visible:ring-ring/40 bg-primary/10 text-primary">').sort(),
    ["faded-ring", "orange-fill", "orange-text"]
  );
  assert.deepEqual(hits("<Button onClick={() => go()}>\n  <AlignLeft size={16} />"), ["icon-cta"]);
  assert.deepEqual(hits('<Button variant="secondary">\n  <AlignLeft />'), []);
  assert.deepEqual(
    hits(
      '<p className="text-foreground/50"> {/* token-guard: allow faded-foreground — confidence typography (Plan 08) */}'
    ),
    []
  );
  assert.deepEqual(
    hits('<p className="text-foreground/50"> {/* token-guard: allow faded-foreground */}'),
    ["faded-foreground"],
    "an opt-out needs a reason"
  );
});

test("the ramp adds sizes; it never redefines Tailwind's standard ones", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");
  assert.doesNotMatch(css, /--text-(?:xs|sm|base|lg|xl|[2-9]xl):/);
});

test("published rules preserve their boundaries and all colour/icon obligations", () => {
  const { LINE_RULES, LIVE_GLASS_ALLOWED } = require("../helpers/workspaceTokenGuard");
  assert.deepEqual(
    LINE_RULES.map((r) => r.id),
    [
      "arbitrary-size",
      "faded-muted",
      "faded-foreground",
      "orange-text",
      "orange-fill",
      "raw-amber",
      "glyph-icon",
      "provider-name",
      "faded-ring",
      "live-glass",
    ]
  );
  assert.deepEqual([...LIVE_GLASS_ALLOWED], ["src/components/chat/ChatInput.tsx"]);
  const ids = (src, file = "x.tsx") =>
    scanText(file, src).map((v) => v.split(" — ")[1].split(":")[0]);
  for (const [source, expected] of [
    ["text-[12.5px]", ["arbitrary-size"]],
    ["text-xs text-sm text-[1rem]", []],
    [
      "text-foreground/0 text-foreground/09 text-foreground/69 text-foreground/70 text-foreground/100",
      ["faded-foreground", "faded-foreground", "faded-foreground"],
    ],
    ["text-primary-foreground", []],
    [
      "text-amber-600 bg-amber-500 border-amber-400 ⊘ providerDisplayName (id)",
      ["raw-amber", "raw-amber", "raw-amber", "glyph-icon", "provider-name"],
    ],
    ["ring-primary/20 ring-ring/50", ["faded-ring", "faded-ring"]],
    [
      "GRADIENT_CIRCLE BRAND_GLASS_SURFACE gradient-brand-glass",
      ["live-glass", "live-glass", "live-glass"],
    ],
  ])
    assert.deepEqual(ids(source), expected, source);
  assert.deepEqual(ids("GRADIENT_CIRCLE", "src/components/chat/ChatInput.tsx"), []);
  assert.deepEqual(ids("GRADIENT_CIRCLE", "other/ChatInput.tsx"), ["live-glass"]);
  assert.deepEqual(ids("bg-primary // token-guard: allow orange-fill — decorative example"), []);
  for (const comment of [
    "token-guard: allow orange-fill",
    "token-guard: allow orange-fill — ",
    "token-guard: allow orange-fill - reason",
  ])
    assert.deepEqual(ids(`bg-primary // ${comment}`), ["orange-fill"]);
  assert.deepEqual(ids("// token-guard: allow orange-fill — previous line\nbg-primary"), [
    "orange-fill",
  ]);
  assert.deepEqual(ids("text-primary bg-primary // token-guard: allow orange-fill — decoration"), [
    "orange-text",
  ]);
  assert.deepEqual(ids('<Button variant="default"><Mic />'), ["icon-cta"]);
  assert.deepEqual(ids('<Button variant="live"><Mic />'), []);
  assert.deepEqual(ids('<Button variant="outline"><Plus />'), []);
  assert.deepEqual(ids("<Button>Text <Mic />"), []);
  assert.deepEqual(
    ids("<Button> // token-guard: allow icon-cta — decorative example\n<Mic />"),
    []
  );
  assert.deepEqual(ids("<Button onClick={() => go()}>\n<Mic />"), ["icon-cta"]);
  assert.deepEqual(ids("<Button><Mic /> // token-guard: allow icon-cta — decorative example"), []);
  assert.deepEqual(ids("<Button><Mic /> // token-guard: allow icon-cta"), ["icon-cta"]);
  assert.deepEqual(ids("<button><Mic /></button>"), [], "icon-cta is scoped to shared Buttons");
  assert.deepEqual(
    ids('<Button variant={voice ? "live" : "secondary"}><Mic />'),
    [],
    "the published guard permits explicit variant expressions"
  );
  // Omissions are a separate audit: CR-06-6 flags faded rings, not missing rings.
  assert.deepEqual(ids('<button className="outline-none">Go</button>'), []);
  assert.deepEqual(scanText("x.tsx", "ok\ntext-primary"), [
    "x.tsx:2 text-primary — orange-text: orange text on light; use text-link",
  ]);
  assert.deepEqual(scanFiles(["test/does-not-exist-task25.tsx"]), []);
});

test("the published workspace list includes its dynamically discovered owned directories", () => {
  const fixed = [
    "ControlPanel",
    "ControlPanelSidebar",
    "ControlPanelTopBar",
    "HistoryView",
    "CommandSearch",
    "UpcomingMeetings",
    "InsightsView",
    "IntegrationsView",
    "DictionaryView",
    "SnippetsView",
    "CaptureMenu",
    "CaptureControl",
    "MicStatusCard",
  ];
  for (const name of fixed)
    assert.ok(WORKSPACE_GUARDED_FILES.includes(`src/components/${name}.tsx`));
  for (const dir of ["chat", "home", "insights", "ui/editor"])
    for (const file of fs
      .readdirSync(path.join(__dirname, "../../src/components", dir))
      .filter((f) => f.endsWith(".tsx")))
      assert.ok(WORKSPACE_GUARDED_FILES.includes(`src/components/${dir}/${file}`));
});
