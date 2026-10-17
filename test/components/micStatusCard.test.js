const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");

// Real English strings, so interpolated copy ("On this device · Parakeet v3") is asserted
// as people read it. Same set-up as meetingTranscriptChat.test.js.
async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8")
    );
    await i18next.use(initReactI18next).init({
      lng: "en",
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
    });
  }
  return import("../../src/components/MicStatusCard.tsx");
}
const base = {
  now: 10_000,
  readLevel: () => 0,
  hotkeyLabel: "Fn",
  role: "dictation",
  route: { locality: "device", providerId: null, model: "Parakeet v3", state: { status: "ready" } },
  compact: false,
  onOpenSettings: () => {},
};
const st = (kind, over = {}) => ({
  kind,
  source: null,
  startedAt: null,
  offlineReason: null,
  ...over,
});

test("Ready shows the hotkey and where speech is processed", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, { ...base, status: st("ready") });
  assert.match(html, /data-state="ready"/);
  assert.match(html, /role="status"[^>]*>Ready</);
  assert.match(html, />Fn</);
  assert.match(html, /data-locality="device"/);
  assert.match(html, /On this device · Parakeet v3/);
  assert.doesNotMatch(
    html,
    /data-state="(?:unknown|needs\w+|off|unreachable)"/,
    "a ready route adds no state chip"
  );
});

test("Listening shows a live dot and a running clock", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, {
    ...base,
    status: st("listening", { source: "dictation", startedAt: 3_000 }),
  });
  assert.match(html, /data-state="listening"/);
  assert.match(html, /data-elapsed="0:07"/);
  assert.match(html, /Listening 0:07/);
});

test("Offline is an icon plus words, never colour alone", async () => {
  const { MicStatusCard } = await load();
  const permission = renderStatic(MicStatusCard, {
    ...base,
    status: st("offline", { offlineReason: "permission" }),
  });
  assert.match(permission, /Mic offline/);
  assert.match(permission, /Microphone access is off/);
  assert.match(permission, /<svg[^>]*class="[^"]*text-warning/);
  const device = renderStatic(MicStatusCard, {
    ...base,
    status: st("offline", { offlineReason: "device" }),
  });
  assert.match(device, /Microphone disconnected/);
});

test("compact rail form keeps the state readable to assistive tech", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, { ...base, compact: true, status: st("processing") });
  assert.match(html, /data-compact="true"/);
  assert.match(html, /class="sr-only"[^>]*>Cleaning up…/);
});

test("a route that is not ready keeps its destination and adds Plan 03's state chip", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, {
    ...base,
    route: {
      locality: "remote",
      providerId: "openai",
      model: "gpt-4o-mini-transcribe",
      state: { status: "needsKey", provider: "openai" },
    },
    status: st("ready"),
  });
  assert.match(html, /OpenAI · gpt-4o-mini-transcribe/, "where speech would go is still disclosed");
  assert.match(html, /data-state="needsKey"/);
});

test("a route main has not confirmed yet is neutral, never ready (§5.1 unknown)", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, {
    ...base,
    route: {
      locality: "device",
      providerId: null,
      model: "Parakeet v3",
      state: { status: "unknown" },
    },
    status: st("ready"),
  });
  assert.match(html, /data-state="unknown"/);
  assert.doesNotMatch(html, /text-destructive/, "checking is not a failure");
});

test("remote providers are named through providerDisplayLabel, localised for custom endpoints", async () => {
  const { MicStatusCard } = await load();
  const remote = (providerId, model) => ({
    locality: "remote",
    providerId,
    model,
    state: { status: "ready" },
  });
  assert.match(
    renderStatic(MicStatusCard, {
      ...base,
      route: remote("openai", "gpt-4o-mini-transcribe"),
      status: st("ready"),
    }),
    /OpenAI · gpt-4o-mini-transcribe/
  );
  assert.match(
    renderStatic(MicStatusCard, {
      ...base,
      route: remote("custom", "whisper-large"),
      status: st("ready"),
    }),
    /Custom endpoint · whisper-large/
  );
  assert.match(
    renderStatic(MicStatusCard, { ...base, route: remote("???", "x"), status: st("ready") }),
    /Unknown provider · x/
  );
  assert.doesNotMatch(
    renderStatic(MicStatusCard, { ...base, route: remote("???", "x"), status: st("ready") }),
    /\?\?\?/
  );
});

test("a meeting shows the meeting route, not the dictation route (I13)", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, {
    ...base,
    role: "meeting",
    route: {
      locality: "remote",
      providerId: "openai",
      model: "gpt-4o-transcribe",
      state: { status: "ready" },
    },
    status: st("listening", { source: "meeting", startedAt: 3_000 }),
  });
  assert.match(html, /Meeting<\/span>/);
  assert.match(html, /OpenAI · gpt-4o-transcribe/);
  assert.doesNotMatch(html, /Parakeet/);
});

test("an assistant capture also shows where its text goes", async () => {
  const { MicStatusCard } = await load();
  const html = renderStatic(MicStatusCard, {
    ...base,
    role: "assistant",
    textRoute: {
      locality: "remote",
      providerId: "anthropic",
      model: "Claude",
      state: { status: "ready" },
    },
    status: st("listening", { source: "dictation", inputKind: "assistant", startedAt: 3_000 }),
  });
  assert.match(html, /Dictation<\/span>[\s\S]*On this device · Parakeet v3/);
  assert.match(html, /Assistant<\/span>[\s\S]*Anthropic · Claude/);
});

test("the rail is decorative and carries its state for CSS", async () => {
  const { CaptureRail } = await load();
  const html = renderStatic(CaptureRail, { status: st("processing"), readLevel: () => 0 });
  assert.match(html, /class="capture-rail"/);
  assert.match(html, /data-state="processing"/);
  assert.match(html, /aria-hidden="true"/);
});

test("active configured speech and text are next-capture disclosures; idle keeps ordinary roles", async () => {
  const { MicStatusCard } = await load();
  for (const status of [
    st("listening", { source: "dictation", startedAt: 3000 }),
    st("processing", { source: "dictation" }),
    st("offline", { source: "meeting", offlineReason: "device" }),
  ]) {
    const html = renderStatic(MicStatusCard, {
      ...base,
      status,
      role: "assistant",
      textRoute: {
        locality: "remote",
        providerId: "anthropic",
        model: "Claude",
        state: { status: "unknown" },
      },
    });
    assert.equal((html.match(/Next capture/g) || []).length, 1);
    assert.match(html, /Next capture[\s\S]*Parakeet[\s\S]*Claude/);
    assert.match(html, /Checking…/);
  }
  for (const status of [st("ready"), st("offline", { offlineReason: "permission" })]) {
    assert.doesNotMatch(renderStatic(MicStatusCard, { ...base, status }), /Next capture/);
  }
});

test("both native card buttons have full focus rings and every status glyph stays static", async () => {
  const { MicStatusCard } = await load();
  for (const compact of [false, true]) {
    for (const kind of ["ready", "listening", "processing", "offline"]) {
      const html = renderStatic(MicStatusCard, { ...base, compact, status: st(kind) });
      const button = html.match(/<button[^>]+>/)[0];
      assert.match(button, /focus-visible:ring-2/);
      assert.match(button, /focus-visible:ring-ring(?: |")/);
      assert.doesNotMatch(html, /animate-|text-muted-foreground\/|opacity-/);
    }
  }
});

const { createRoot } = require("react-dom/client");
const { React } = require("../helpers/harness/reactSsr");
const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
const { installTree } = require("../helpers/harness/fakeDomTree");

async function mounted(t, Component, props, window = {}) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window });
  installHookDom(t);
  const tree = installTree();
  // CSSStyleDeclaration is outside this tiny tree's contract. Keep the actual
  // rail ref/effect, with an observable local style boundary rather than mocking React.
  const create = globalThis.document.createElement;
  globalThis.document.createElement = (...args) => {
    const el = create(...args);
    el.style.setProperty = (key, value) => {
      el.style[key] = value;
    };
    el.style.removeProperty = (key) => {
      delete el.style[key];
    };
    return el;
  };
  root = createRoot(tree.container);
  const render = async (props) =>
    React.act(async () => root.render(React.createElement(Component, props)));
  await render(props);
  return {
    ...tree,
    render,
    unmount: async () => {
      await React.act(async () => root.unmount());
      root = null;
    },
  };
}

test("mounted Settings A→B changes only the next configured routes during the SAME active capture", async (t) => {
  const { MicStatusCard } = await load();
  let ipcCalls = 0;
  let settingsCalls = 0;
  const capture = Object.freeze(
    st("listening", { source: "dictation", inputKind: "assistant", startedAt: 3000 })
  );
  const textRoute = Object.freeze({
    locality: "remote",
    providerId: "anthropic",
    model: "Text A",
    state: { status: "ready" },
  });
  const props = {
    ...base,
    role: "assistant",
    status: capture,
    textRoute,
    onOpenSettings: () => settingsCalls++,
  };
  const h = await mounted(t, MicStatusCard, props, {
    electronAPI: new Proxy(
      {},
      {
        get() {
          ipcCalls++;
          throw new Error("presentational card touched IPC");
        },
      }
    ),
  });
  const originalButton = h.find((n) => n.tagName === "BUTTON");
  assert.match(h.text(), /Listening 0:07Next capture.*Parakeet v3.*Text A/);
  await h.render({
    ...props,
    route: {
      locality: "remote",
      providerId: "openai",
      model: "Speech B",
      state: { status: "unknown" },
    },
    textRoute: { ...textRoute, model: "Text B" },
  });
  assert.equal(
    h.find((n) => n.tagName === "BUTTON"),
    originalButton,
    "same mounted card/capture"
  );
  assert.match(h.text(), /Listening 0:07Next capture.*Speech B.*Checking….*Text B/);
  assert.doesNotMatch(h.text(), /Parakeet|Text A/);
  assert.equal(capture.startedAt, 3000);
  assert.equal(capture.kind, "listening");
  assert.equal(ipcCalls, 0);
  assert.equal(settingsCalls, 0);
  await h.click("Next capture");
  assert.equal(settingsCalls, 1, "only explicit settings callback is dispatched");
  assert.equal(ipcCalls, 0);
});

test("mounted rail samples only listening and cleans timers/properties on transitions, replacement and unmount", async (t) => {
  const { CaptureRail } = await load();
  const intervals = new Map();
  const mediaListeners = new Set();
  let id = 0;
  let reads = 0;
  const media = {
    matches: false,
    addEventListener: (_, fn) => mediaListeners.add(fn),
    removeEventListener: (_, fn) => mediaListeners.delete(fn),
  };
  const readLevel = () => {
    reads++;
    return 1;
  };
  const h = await mounted(
    t,
    CaptureRail,
    { status: st("ready"), readLevel },
    {
      matchMedia: () => media,
      setInterval: (fn, ms) => {
        intervals.set(++id, { fn, ms });
        return id;
      },
      clearInterval: (id) => intervals.delete(id),
    }
  );
  const rail = h.find((n) => n.attributes.class === "capture-rail");
  assert.equal(intervals.size, 0);
  for (const kind of ["processing", "offline", "ready"]) {
    await h.render({ status: st("listening"), readLevel });
    assert.equal(intervals.size, 1);
    const timer = [...intervals.values()][0];
    assert.equal(timer.ms, 66);
    timer.fn();
    assert.equal(rail.style["--capture-level"], "0.65");
    await h.render({ status: st(kind), readLevel });
    assert.equal(intervals.size, 0);
    assert.equal(rail.style["--capture-level"], undefined);
  }
  assert.equal(reads, 3);
  await h.render({ status: st("listening"), readLevel });
  [...intervals.values()][0].fn();
  await h.render({ status: st("listening"), readLevel: () => 0.5 });
  assert.equal(intervals.size, 1);
  assert.equal(rail.style["--capture-level"], undefined);
  [...intervals.values()][0].fn();
  assert.equal(rail.style["--capture-level"], "0.325");
  media.matches = true;
  await React.act(async () => {
    for (const fn of mediaListeners) fn();
  });
  assert.equal(intervals.size, 0, "enabling reduced motion stops active sampling immediately");
  assert.equal(rail.style["--capture-level"], undefined);
  media.matches = false;
  await React.act(async () => {
    for (const fn of mediaListeners) fn();
  });
  assert.equal(intervals.size, 1);
  await h.unmount();
  assert.equal(intervals.size, 0);
  assert.equal(mediaListeners.size, 0);
  assert.equal(rail.style["--capture-level"], undefined);
});

test("mounted reduced-motion listening never samples, including a new reader", async (t) => {
  const { CaptureRail } = await load();
  let reads = 0;
  let timers = 0;
  const h = await mounted(
    t,
    CaptureRail,
    { status: st("listening"), readLevel: () => ++reads },
    {
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
      setInterval: () => ++timers,
      clearInterval() {},
    }
  );
  await h.render({ status: st("listening"), readLevel: () => ++reads });
  assert.equal(reads, 0);
  assert.equal(timers, 0);
  assert.equal(
    h.find((n) => n.attributes.class === "capture-rail").style["--capture-level"],
    undefined
  );
});

test("compact status discloses no route recipient, and translation uses the published text chip", async () => {
  const { MicStatusCard } = await load();
  const props = {
    ...base,
    status: st("processing", { source: "dictation", inputKind: "translation" }),
    role: "translation",
    textRoute: {
      locality: "network",
      providerId: null,
      model: "Text server",
      state: { status: "needsUrl" },
    },
  };
  const expanded = renderStatic(MicStatusCard, props);
  assert.match(
    expanded,
    /Next capture[\s\S]*Translation[\s\S]*Text server[\s\S]*data-state="needsUrl"/
  );
  const compact = renderStatic(MicStatusCard, { ...props, compact: true });
  assert.match(compact, /title="Cleaning up…"/);
  assert.doesNotMatch(compact, /Text server|Parakeet|data-locality|Sent to/);
});

test("every locale has translated next-capture copy and preserves elapsed interpolation", () => {
  const locales = ["ar", "de", "en", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"];
  for (const lang of locales) {
    const copy = JSON.parse(
      fs.readFileSync(path.join(__dirname, `../../src/locales/${lang}/translation.json`), "utf8")
    ).micCard;
    assert.equal(Object.keys(copy).length, 9);
    assert.equal(Object.keys(copy.role).length, 4);
    assert.match(copy.listeningFor, /\{\{time\}\}/);
    assert.ok(copy.nextCapture.length);
    if (lang !== "en") assert.notEqual(copy.nextCapture, "Next capture");
  }
});
