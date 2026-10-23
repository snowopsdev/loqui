const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const i18next = require("i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");
const { readTokens } = require("../helpers/harness/cssTokens");
const { mountComponent } = require("../helpers/harness/mountComponent");

const root = path.join(__dirname, "../..");
const P = "settingsPage.privacy.sealed";
const LOCALES = ["ar", "de", "en", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"];
const resources = Object.fromEntries(
  LOCALES.map((l) => [
    l,
    JSON.parse(fs.readFileSync(path.join(root, "src/locales", l, "translation.json"), "utf8")),
  ])
);
const lookup = (json, key) => key.split(".").reduce((node, part) => node?.[part], json);
const copy = () => import("../../src/components/settings/sealedModeCopy.ts");
const panel = () => import("../../src/components/settings/SealedModePanel.tsx");
const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);
const NOW = 1_800_000_000_000;

// The only attestation shape 07a main can produce (Task 7 createAttestor):
// no native boundary on any platform, nothingLeaves false, effectiveSince null,
// paused empty. There is deliberately no positive (verified) fixture here (A19).
function attestation07a(over = {}) {
  return {
    sealed: true,
    sealedSince: NOW - 60_000,
    effectiveSince: null,
    phase: "sealing",
    failures: ["NATIVE_BOUNDARY_UNAVAILABLE"],
    notes: [],
    loadError: null,
    saveError: null,
    guards: {
      node: true,
      dns: true,
      dgram: true,
      http: true,
      webContents: true,
      sessions: 2,
      envProxy: false,
      openRemoteSockets: 0,
      chromiumInFlightRemote: 0,
      chromiumUnresolvedAfterDestroy: 0,
      pendingDns: 0,
    },
    networkChildren: [],
    activeRemote: 0,
    children: [],
    childDiagnostics: { nativeBoundaryUnavailable: true, unresolved: [] },
    isolation: {
      platform: "linux",
      mechanism: "none",
      selfTest: "unavailable",
      checkedAt: null,
      reason: "NATIVE_BOUNDARY_UNAVAILABLE",
      pauseReason: null,
    },
    paused: [],
    persistError: null,
    blockedSinceSealed: 0,
    recordFailures: 0,
    version: 1,
    at: NOW,
    nothingLeaves: false,
    ...over,
  };
}
const guards = (over) => ({ ...attestation07a().guards, ...over });

// Every key the panel can emit. Plural families are listed by their base.
const PANEL_KEYS = [
  "title",
  "description",
  "checking",
  "on",
  "buildLimit",
  "statusChecking",
  "scope",
  "unverified.guards",
  "unverified.envProxy",
  "unverified.stopFailed",
  "unverified.stopFailedUnnamed",
  "unverified.child",
  "unverified.childUnknown",
  "unverified.chromium",
  "unverified.dns",
  "unverified.active",
  "loadError",
  "saveError",
  "toggleError",
].map((k) => `${P}.${k}`);
const PLURAL_KEYS = [`${P}.blocked`];
const UPDATE_KEYS = ["updates.sealed", "updates.sealedRefused"];

test("unknown seal shows Checking only, and the switch is disabled", async () => {
  const { sealedStatusLines } = await copy();
  assert.deepEqual(
    sealedStatusLines(null, null, NOW).map((l) => l.key),
    [`${P}.checking`]
  );
  assert.deepEqual(
    sealedStatusLines(null, attestation07a(), NOW).map((l) => l.key),
    [`${P}.checking`],
    "a seal state main has not answered claims nothing, whatever the attestation says"
  );
  const { SealedModePanelView } = await panel();
  const html = renderStatic(SealedModePanelView, {
    t,
    sealed: null,
    attestation: null,
    busy: false,
    error: false,
    onToggle() {},
    now: NOW,
  });
  assert.match(html, /role="switch"[^>]*disabled=""/);
  assert.match(html, /data-sealed="false"/);
});

test("off: the description states the build limit; nothing else is claimed", async () => {
  const { sealedStatusLines } = await copy();
  const off = attestation07a({ sealed: false, sealedSince: null, phase: "open", failures: [] });
  assert.deepEqual(
    sealedStatusLines(false, off, NOW).map((l) => l.key),
    [`${P}.description`]
  );
  assert.deepEqual(
    sealedStatusLines(false, null, NOW).map((l) => l.key),
    [`${P}.description`]
  );
  assert.match(resources.en.settingsPage.privacy.sealed.description, /can't yet be isolated/);
});

test("on with main's fresh 07a claim: on, the build limit, then the scope; never a verified line", async () => {
  const { sealedStatusLines } = await copy();
  const lines = sealedStatusLines(true, attestation07a(), NOW);
  assert.deepEqual(
    lines.map((l) => l.key),
    [`${P}.on`, `${P}.buildLimit`, `${P}.scope`]
  );
  assert.equal(lines.find((l) => l.key === `${P}.buildLimit`).tone, "warn");
  for (const l of lines) assert.ok(["neutral", "warn"].includes(l.tone), l.key);
});

test("the build limit is stated while sealed even before main answers; the status says Checking", async () => {
  const { sealedStatusLines } = await copy();
  for (const a of [
    null,
    attestation07a({ at: NOW - 31_000 }),
    attestation07a({ at: NOW + 31_000 }),
    attestation07a({ at: Number.NaN }),
    // main's claim describes the other state (an older reply): not evidence
    attestation07a({ sealed: false }),
  ]) {
    assert.deepEqual(
      sealedStatusLines(true, a, NOW).map((l) => l.key),
      [`${P}.on`, `${P}.buildLimit`, `${P}.statusChecking`, `${P}.scope`],
      JSON.stringify(a && { at: a.at, sealed: a.sealed })
    );
  }
});

test("each unresolved fact names its cause, most fundamental first", async () => {
  const { sealedStatusLines } = await copy();
  const cause = (over) => {
    const lines = sealedStatusLines(true, attestation07a(over), NOW).filter((l) =>
      l.key.startsWith(`${P}.unverified.`)
    );
    assert.ok(lines.length <= 1, "one cause at a time");
    return lines[0] ?? null;
  };
  assert.equal(cause({}), null);
  assert.equal(cause({ guards: guards({ node: false }) }).key, `${P}.unverified.guards`);
  assert.equal(cause({ guards: guards({ sessions: 0 }) }).key, `${P}.unverified.guards`);
  assert.equal(
    cause({ failures: ["NATIVE_BOUNDARY_UNAVAILABLE", "sessionWatchUnavailable"] }).key,
    `${P}.unverified.guards`
  );
  assert.equal(
    cause({ failures: ["NATIVE_BOUNDARY_UNAVAILABLE", "guard:dns"] }).key,
    `${P}.unverified.guards`
  );
  assert.equal(cause({ guards: guards({ envProxy: true }) }).key, `${P}.unverified.envProxy`);
  assert.equal(
    cause({ guards: guards({ node: false, envProxy: true }) }).key,
    `${P}.unverified.guards`,
    "guards outrank the proxy"
  );
  const stop = cause({
    failures: ["NATIVE_BOUNDARY_UNAVAILABLE", "childStop"],
    networkChildren: ["yt-dlp"],
  });
  assert.equal(stop.key, `${P}.unverified.stopFailed`);
  assert.deepEqual(stop.params, { names: "⁨yt-dlp⁩" });
  for (const failure of ["codexStop", "updatesPause", "calendar:stop", "pendingCancel"])
    assert.equal(
      cause({ failures: ["NATIVE_BOUNDARY_UNAVAILABLE", failure] }).key,
      `${P}.unverified.stopFailedUnnamed`,
      failure
    );
  const child = cause({
    networkChildren: ["whisper-server", "codex"],
    failures: [
      "NATIVE_BOUNDARY_UNAVAILABLE",
      "child:yt-dlp:42:DESCENDANTS_UNVERIFIED",
      "timeout:children",
    ],
  });
  assert.equal(child.key, `${P}.unverified.child`);
  assert.deepEqual(child.params, { names: "⁨whisper-server, codex, yt-dlp⁩" });
  assert.equal(
    cause({ failures: ["NATIVE_BOUNDARY_UNAVAILABLE", "childDiagnosticsUnavailable"] }).key,
    `${P}.unverified.childUnknown`
  );
  assert.equal(
    cause({ failures: ["NATIVE_BOUNDARY_UNAVAILABLE", "timeout:children"] }).key,
    `${P}.unverified.childUnknown`
  );
  assert.equal(
    cause({ guards: guards({ chromiumInFlightRemote: 1 }) }).key,
    `${P}.unverified.chromium`
  );
  assert.equal(
    cause({ failures: ["NATIVE_BOUNDARY_UNAVAILABLE", "timeout:chromium"] }).key,
    `${P}.unverified.chromium`
  );
  assert.equal(cause({ guards: guards({ pendingDns: 1 }) }).key, `${P}.unverified.dns`);
  assert.equal(cause({ activeRemote: 2 }).key, `${P}.unverified.active`);
  assert.equal(cause({ guards: guards({ openRemoteSockets: 1 }) }).key, `${P}.unverified.active`);
  assert.equal(
    cause({ failures: ["NATIVE_BOUNDARY_UNAVAILABLE", "timeout:tickets"] }).key,
    `${P}.unverified.active`
  );
  for (const l of sealedStatusLines(true, attestation07a({ activeRemote: 1 }), NOW))
    if (l.key.startsWith(`${P}.unverified.`)) assert.equal(l.tone, "warn");
});

test("paused, verified and isolated states are unavailable in 07a, whatever main's fields hold", async () => {
  const { sealedStatusLines } = await copy();
  // Hostile inputs, not positive fixtures: a paused entry or a Darwin platform
  // must never become a paused line, and nothing renders a verified seal.
  for (const a of [
    attestation07a({
      paused: [{ kind: "whisper-server", reason: "isolation", action: "refused" }],
    }),
    attestation07a({
      paused: [{ kind: "whisper-server", reason: "isolation", action: "stopped" }],
    }),
    attestation07a({ isolation: { ...attestation07a().isolation, platform: "darwin" } }),
    attestation07a({ notes: ["codexStop", "reisolate"] }),
    attestation07a({ children: [{ kind: "llama-server", pid: 10, local: true }] }),
  ]) {
    const keys = sealedStatusLines(true, a, NOW).map((l) => l.key);
    for (const key of keys) {
      assert.doesNotMatch(key, /paused|attested|verified|note\./, key);
    }
    assert.ok(keys.includes(`${P}.buildLimit`));
  }
  const src = fs.readFileSync(path.join(root, "src/components/settings/sealedModeCopy.ts"), "utf8");
  for (const field of ["nothingLeaves", "effectiveSince", ".paused", "selfTest", "pauseReason"])
    assert.equal(src.includes(field), false, `sealedModeCopy never reads ${field}`);
  for (const l of LOCALES) {
    const sealed = resources[l].settingsPage.privacy.sealed;
    for (const absent of ["attested", "paused", "note", "unknown"])
      assert.equal(sealed[absent], undefined, `${l}: ${absent}`);
    assert.equal(sealed.unverified?.native, undefined, `${l}: unverified.native`);
    assert.equal(sealed.unverified?.draining, undefined, `${l}: unverified.draining`);
  }
});

test("load and save problems are surfaced from main's fresh claim, open or sealed", async () => {
  const { sealedStatusLines } = await copy();
  const keys = (sealed, over) =>
    sealedStatusLines(sealed, attestation07a({ sealed, ...over }), NOW).map((l) => l.key);
  for (const sealed of [true, false]) {
    const both = keys(sealed, { loadError: "corrupt", saveError: "EACCES" });
    assert.ok(both.includes(`${P}.loadError`), `load ${sealed}`);
    assert.ok(both.includes(`${P}.saveError`), `save ${sealed}`);
  }
  const lines = sealedStatusLines(true, attestation07a({ saveError: "EACCES" }), NOW);
  assert.equal(lines.find((l) => l.key === `${P}.saveError`).tone, "warn");
  assert.equal(
    JSON.stringify(lines).includes("EACCES"),
    false,
    "the error code is not shown as text"
  );
});

test("the blocked count appears only when main counted a refusal, with a plural count", async () => {
  const { sealedStatusLines } = await copy();
  assert.equal(
    sealedStatusLines(true, attestation07a(), NOW).some((l) => l.key === `${P}.blocked`),
    false
  );
  const line = sealedStatusLines(true, attestation07a({ blockedSinceSealed: 3 }), NOW).find(
    (l) => l.key === `${P}.blocked`
  );
  assert.deepEqual(line.params, { count: 3 });
  assert.equal(line.tone, "neutral");
});

test("the view: the switch reflects main, disabled while unknown or busy; errors are translated", async () => {
  const { SealedModePanelView } = await panel();
  const base = { t, attestation: attestation07a(), error: false, onToggle() {}, now: NOW };
  const on = renderStatic(SealedModePanelView, { ...base, sealed: true, busy: false });
  assert.match(on, /role="switch"[^>]*aria-checked="true"/);
  assert.doesNotMatch(on, /role="switch"[^>]*disabled=""/);
  assert.match(on, /data-sealed="true"/);
  assert.match(on, /settingsPage\.privacy\.sealed\.buildLimit/);
  assert.match(on, /var\(--color-sealed-bg\)/);
  assert.match(on, /duration-\[var\(--motion-slow\)\]/);
  const sectionClass = /^<section[^>]*class="([^"]*)"/.exec(on)[1];
  assert.doesNotMatch(
    sectionClass,
    /translate|scale|rotate|transform/,
    "no transform on the panel"
  );
  const off = renderStatic(SealedModePanelView, {
    ...base,
    sealed: false,
    attestation: null,
    busy: false,
  });
  assert.match(off, /aria-checked="false"/);
  assert.doesNotMatch(off, /var\(--color-sealed-bg\)/);
  const busy = renderStatic(SealedModePanelView, { ...base, sealed: false, busy: true });
  assert.match(busy, /role="switch"[^>]*disabled=""/);
  const failed = renderStatic(SealedModePanelView, {
    ...base,
    sealed: true,
    busy: false,
    error: true,
  });
  assert.match(failed, /role="alert"[^>]*>settingsPage\.privacy\.sealed\.toggleError</);
  // Logical properties only (RTL).
  for (const html of [on, off])
    assert.doesNotMatch(html, /\b(ml|mr|pl|pr|left|right)-\d/, "no physical inline spacing");
});

test("Privacy & Data renders the panel first, after the description and before Audio Retention", () => {
  const page = fs.readFileSync(path.join(root, "src/components/SettingsPage.tsx"), "utf8");
  assert.match(page, /import SealedModePanel from "\.\/settings\/SealedModePanel";/);
  const privacy = page.slice(page.indexOf('case "privacyData":'));
  const body = privacy.slice(0, privacy.indexOf("case ", 10));
  const header = body.indexOf('<SectionHeader description={t("personal.privacyDescription")} />');
  const sealed = body.indexOf("<SealedModePanel />");
  const audio = body.indexOf("{/* Audio Retention */}");
  assert.ok(header > 0 && sealed > header && audio > sealed, `${header} < ${sealed} < ${audio}`);
  assert.doesNotMatch(body, /<LocalSupportModels/, "support models stay in the LLM tabs");
  const src = fs.readFileSync(
    path.join(root, "src/components/settings/SealedModePanel.tsx"),
    "utf8"
  );
  assert.match(src, /from "\.\.\/\.\.\/hooks\/useSealedMode"/);
  assert.match(src, /setSealedMode/);
});

function tokenThemes() {
  const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");
  // A16: the shipped values live in :root; resolve it with @theme and .dark.
  const light = { ...readTokens(css, "@theme"), ...readTokens(css, ":root") };
  const dark = { ...light, ...readTokens(css, ".dark") };
  return { css, light, dark };
}

test("sealed colours meet contrast in light and Plum Night", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { css, light, dark } = tokenThemes();
  assert.match(
    readTokens(css, ":root")["--color-sealed-bg"] ?? "",
    /^#/,
    "the sealed palette is declared in :root"
  );
  for (const [theme, tokens] of Object.entries({ light, dark })) {
    const bg = tokens["--color-sealed-bg"];
    for (const fg of ["--color-sealed-fg", "--color-sealed-muted", "--color-sealed-warn"])
      assert.ok(contrastRatio(tokens[fg], bg) >= 4.5, `${theme} ${fg} on sealed bg`);
    // Non-text: the border separates the navy panel from both its own fill and
    // every page surface it can sit on; #2c3f6e alone fails in Plum Night.
    const border = tokens["--color-sealed-border"];
    assert.ok(contrastRatio(border, bg) >= 3, `${theme} border on sealed bg`);
    for (const surface of [
      "--color-background",
      "--color-card",
      "--color-surface-0",
      "--color-surface-1",
      "--color-surface-2",
      "--color-surface-3",
      "--color-surface-raised",
      "--color-surface-window",
    ])
      assert.ok(contrastRatio(border, tokens[surface]) >= 3, `${theme} border on ${surface}`);
    // The enabled, checked switch track on the navy fill.
    assert.ok(contrastRatio(tokens["--color-primary"], bg) >= 3, `${theme} switch track`);
    // Off: an ordinary card.
    assert.ok(contrastRatio(tokens["--color-foreground"], tokens["--color-card"]) >= 4.5, theme);
    assert.ok(
      contrastRatio(tokens["--color-muted-foreground"], tokens["--color-card"]) >= 4.5,
      `${theme} muted on card`
    );
  }
  assert.equal(readTokens(css, ".dark")["--color-sealed-bg"], undefined, "no Plum Night override");
});

test("every panel and update string exists in all 11 locales with matching placeholders and CLDR forms", () => {
  const placeholders = (s) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
  for (const key of [...PANEL_KEYS, ...UPDATE_KEYS]) {
    const en = lookup(resources.en, key);
    assert.equal(typeof en, "string", `en:${key}`);
    for (const l of LOCALES) {
      const value = lookup(resources[l], key);
      assert.equal(typeof value, "string", `${l}:${key}`);
      assert.ok(value.trim(), `${l}:${key}`);
      assert.deepEqual(placeholders(value), placeholders(en), `${l}:${key}`);
      if (l !== "en") assert.notEqual(value, en, `${l}:${key} is translated`);
    }
  }
  for (const base of PLURAL_KEYS) {
    for (const l of LOCALES) {
      const rules = new Intl.PluralRules(l);
      for (const n of [0, 1, 2, 3, 5, 11, 21, 22, 25, 100, 101, 1000]) {
        const form = lookup(resources[l], `${base}_${rules.select(n)}`);
        assert.equal(typeof form, "string", `${l}:${base}_${rules.select(n)} (${n})`);
        assert.match(form, /\{\{count\}\}/, `${l}:${base}_${rules.select(n)}`);
      }
    }
  }
});

test("the panel copy renders through i18next in every locale without a raw key", async () => {
  const { sealedStatusLines } = await copy();
  const states = [
    sealedStatusLines(null, null, NOW),
    sealedStatusLines(false, null, NOW),
    sealedStatusLines(true, null, NOW),
    sealedStatusLines(true, attestation07a({ blockedSinceSealed: 21 }), NOW),
    sealedStatusLines(true, attestation07a({ networkChildren: ["yt-dlp"] }), NOW),
    sealedStatusLines(
      true,
      attestation07a({
        failures: ["NATIVE_BOUNDARY_UNAVAILABLE", "childStop"],
        networkChildren: ["yt-dlp"],
      }),
      NOW
    ),
    sealedStatusLines(true, attestation07a({ loadError: "corrupt", saveError: "EACCES" }), NOW),
  ].flat();
  for (const l of LOCALES) {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: l,
      fallbackLng: false,
      resources: { [l]: { translation: resources[l] } },
      interpolation: { escapeValue: false },
    });
    for (const line of states) {
      const text = i18n.t(line.key, line.params);
      assert.notEqual(text, line.key, `${l}:${line.key}`);
      assert.doesNotMatch(text, /\{\{/, `${l}:${line.key}`);
      if (line.params?.count !== undefined) assert.ok(text.includes("21"), `${l}:${line.key}`);
      if (line.params?.names) assert.ok(text.includes("yt-dlp"), `${l}:${line.key}`);
    }
  }
});

test("no panel or update copy claims a verified seal, zero bytes, isolation or working local engines", () => {
  const values = (node) =>
    typeof node === "string" ? [node] : Object.values(node).flatMap((v) => values(v));
  const en = [
    ...values(resources.en.settingsPage.privacy.sealed),
    resources.en.updates.sealed,
    resources.en.updates.sealedRefused,
  ].join("\n");
  assert.doesNotMatch(
    en,
    /\bverified\b|0 bytes|zero bytes|nothing leaves|keep working|still work/i
  );
  for (const m of en.matchAll(/isolat\w*/gi)) {
    const around = en.slice(Math.max(0, m.index - 20), m.index);
    assert.match(around, /can't yet be $/, `"isolated" only as a limitation: ${around}${m[0]}`);
  }
  assert.match(
    resources.en.settingsPage.privacy.sealed.buildLimit,
    /not fully available on this build/
  );
  assert.match(
    resources.en.settingsPage.privacy.sealed.buildLimit,
    /local engines can't yet be isolated/
  );
});

// T13-N3: one term for "Sealed mode" per locale, in every string whose English
// names it, including the older route chip and its siblings.
const TERMS = {
  ar: /الوضع المغلق/,
  de: /abgeschottete/i,
  en: /sealed mode/i,
  es: /modo sellado/i,
  fr: /mode scellé/i,
  it: /modalità sigillata/i,
  ja: /シールドモード/,
  pt: /modo selado/i,
  ru: /закрыт[а-яё]* режим/iu,
  "zh-CN": /封闭模式/,
  "zh-TW": /封閉模式/,
};
const OLD_TERMS = {
  ar: /المحكم|المختوم|وضع العزل|وضع الإغلاق/,
  de: /versiegelt/i,
  ja: /シールモード|封印モード|密閉モード/,
  ru: /запечатанн|изолированн[а-яё]* режим|герметичн/iu,
  "zh-CN": /密封模式|隔离模式/,
  "zh-TW": /封存模式|密封模式|隔離模式/,
};

test("each locale uses one term for Sealed mode wherever English names it (T13-N3)", () => {
  const flat = (obj, prefix = "", out = {}) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") flat(v, key, out);
      else out[key] = v;
    }
    return out;
  };
  const en = flat(resources.en);
  const keys = Object.keys(en).filter((k) => /sealed mode/i.test(String(en[k])));
  assert.ok(keys.includes("routes.state.sealed") && keys.length > 40, String(keys.length));
  const bad = [];
  for (const l of LOCALES) {
    const values = flat(resources[l]);
    for (const key of keys) {
      if (typeof values[key] !== "string") continue;
      if (!TERMS[l].test(values[key])) bad.push(`${l}:${key}`);
      if (OLD_TERMS[l]?.test(values[key])) bad.push(`${l}:${key} (old term)`);
    }
  }
  assert.deepEqual(bad, []);
});

test("DESIGN.md documents the Sealed panel and its 07a limits", () => {
  const design = fs.readFileSync(path.join(root, "DESIGN.md"), "utf8");
  assert.match(design, /^## Sealed mode and the flight recorder$/m);
  const section = design.slice(design.indexOf("## Sealed mode and the flight recorder"));
  const body = section.slice(0, section.indexOf("\n## ", 5));
  for (const phrase of [
    "--color-sealed-bg",
    "--color-sealed-border",
    "--motion-slow",
    "not fully available on this build",
    "Checking",
    "Keep sealed",
    "07b",
  ])
    assert.ok(body.includes(phrase), phrase);
  assert.ok(design.indexOf("## Sealed mode and the flight recorder") > design.indexOf("## Motion"));
  assert.ok(design.indexOf("## Sealed mode and the flight recorder") < design.indexOf("## Shapes"));
});

// ---- Production wiring: the real panel, hook, store and toggle --------------

function privacyBridge({
  sealed = true,
  attestation = attestation07a({ at: Date.now() }),
  setSealed,
} = {}) {
  const calls = [];
  const bridge = {
    getSealed: () => (sealed === "never" ? new Promise(() => {}) : Promise.resolve(sealed)),
    getAttestation: () => Promise.resolve(attestation),
    onSealedChange: () => () => {},
    onAttestation: () => () => {},
    setSealed: (next) => {
      calls.push(next);
      return setSealed(next);
    },
  };
  return { bridge, calls };
}

async function flush() {
  await React.act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  });
}

const switchOf = (ui) => ui.find((node) => node.attributes?.role === "switch");

test("mounted: main's 07a claim renders the build limit; declining main's dialog keeps the seal without an error", async (t) => {
  let resolveSet;
  const { bridge, calls } = privacyBridge({
    setSealed: () => new Promise((resolve) => (resolveSet = resolve)),
  });
  const ui = await mountComponent(t, "/components/settings/SealedModePanel.tsx", {
    api: { privacy: bridge },
  });
  await flush();
  const section = ui.find((node) => node.attributes?.["data-sealed"] !== undefined);
  assert.equal(section.attributes["data-sealed"], "true");
  assert.equal(switchOf(ui).attributes["aria-checked"], "true");
  assert.equal(ui.props(switchOf(ui)).disabled, false);
  for (const key of ["on", "buildLimit", "scope"])
    assert.ok(ui.text().includes(`${P}.${key}`), key);
  assert.equal(ui.text().includes(`${P}.statusChecking`), false);
  await ui.click(switchOf(ui));
  assert.deepEqual(calls, [false]);
  assert.equal(ui.props(switchOf(ui)).disabled, true, "busy while main asks the user");
  await React.act(async () =>
    resolveSet({ ...attestation07a({ at: Date.now(), version: 2 }), declined: true })
  );
  await flush();
  assert.equal(switchOf(ui).attributes["aria-checked"], "true", "Keep sealed leaves the switch on");
  assert.equal(ui.props(switchOf(ui)).disabled, false);
  assert.equal(ui.findAll((node) => node.attributes?.role === "alert").length, 0);
});

test("mounted: a failed change shows translated copy, never main's raw error text", async (t) => {
  const { bridge } = privacyBridge({
    setSealed: () =>
      Promise.reject(
        new Error(
          "Error invoking remote method 'privacy:set-sealed': Error: PRIVACY_CONFIRMATION_FAILED"
        )
      ),
  });
  const ui = await mountComponent(t, "/components/settings/SealedModePanel.tsx", {
    api: { privacy: bridge },
  });
  await flush();
  await ui.click(switchOf(ui));
  await flush();
  const alerts = ui.findAll((node) => node.attributes?.role === "alert");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].textContent, `${P}.toggleError`);
  assert.equal(ui.text().includes("PRIVACY_CONFIRMATION_FAILED"), false);
  assert.equal(switchOf(ui).attributes["aria-checked"], "true");
});

test("mounted: before main answers, the switch is disabled and the panel says Checking", async (t) => {
  const { bridge } = privacyBridge({ sealed: "never", setSealed: () => Promise.resolve() });
  const ui = await mountComponent(t, "/components/settings/SealedModePanel.tsx", {
    api: { privacy: bridge },
  });
  await flush();
  assert.equal(ui.props(switchOf(ui)).disabled, true);
  assert.ok(ui.text().includes(`${P}.checking`));
  assert.equal(ui.text().includes(`${P}.buildLimit`), false);
});

test("mounted: turning Sealed mode on goes to main and adopts its answer", async (t) => {
  const { bridge, calls } = privacyBridge({
    sealed: false,
    attestation: attestation07a({
      sealed: false,
      sealedSince: null,
      phase: "open",
      failures: [],
      at: Date.now(),
    }),
    setSealed: () => Promise.resolve(attestation07a({ at: Date.now(), version: 2 })),
  });
  const ui = await mountComponent(t, "/components/settings/SealedModePanel.tsx", {
    api: { privacy: bridge },
  });
  await flush();
  assert.equal(switchOf(ui).attributes["aria-checked"], "false");
  assert.ok(ui.text().includes(`${P}.description`));
  await ui.click(switchOf(ui));
  await flush();
  assert.deepEqual(calls, [true]);
  assert.equal(switchOf(ui).attributes["aria-checked"], "true");
  assert.ok(ui.text().includes(`${P}.buildLimit`));
});

test("the panel consumes main's real attestor output", async () => {
  const { createAttestor } = require("../../src/helpers/privacy/privacyBoot.js");
  const { SealedState } = require("../../src/helpers/privacy/sealedState.js");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-sealed-panel-"));
  try {
    const state = new SealedState({ profile, now: () => NOW });
    state.set(true);
    const attest = createAttestor({
      state,
      transition: {
        snapshot: () => ({
          phase: "sealing",
          effectiveSince: null,
          failures: ["NATIVE_BOUNDARY_UNAVAILABLE"],
          notes: [],
        }),
      },
      children: {
        alive: () => [],
        diagnostics: () => ({ nativeBoundaryUnavailable: true, unresolved: [] }),
      },
      now: () => NOW,
    });
    const a = attest();
    assert.equal(a.nothingLeaves, false);
    const { sealedStatusLines } = await copy();
    const keys = sealedStatusLines(true, a, NOW).map((l) => l.key);
    assert.deepEqual(keys.slice(0, 2), [`${P}.on`, `${P}.buildLimit`]);
    assert.equal(keys.at(-1), `${P}.scope`);
    assert.equal(keys.includes(`${P}.statusChecking`), false, "main's claim is fresh");
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
