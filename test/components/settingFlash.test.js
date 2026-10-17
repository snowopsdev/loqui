const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { readTokens } = require("../helpers/harness/cssTokens");

const root = path.join(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flash = () => import("../../src/components/settings/settingFlash.ts");

function fakeElement(extra = {}) {
  const listeners = new Map();
  const el = {
    dataset: {},
    scrolled: [],
    offsetReads: 0,
    get offsetWidth() {
      el.offsetReads += 1;
      return 0;
    },
    scrollIntoView(options) {
      el.scrolled.push(options);
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    emit(type, event) {
      listeners.get(type)?.(event);
    },
    listening: () => listeners.size > 0,
    ...extra,
  };
  return el;
}
function frames() {
  const queue = [];
  return {
    raf: (cb) => queue.push(cb),
    caf: (handle) => {
      queue[handle - 1] = null;
    },
    step: () => {
      const cb = queue.shift();
      cb?.();
    },
    pending: () => queue.filter(Boolean).length,
  };
}
const rootOf = (find) => ({ querySelector: find });

test("[change-driving] the landing waits for the anchor to mount, scrolls to it and flashes once", async () => {
  const { landOnSetting } = await flash();
  const el = fakeElement();
  const f = frames();
  let present = false;
  const done = [];
  landOnSetting("route-chat", {
    root: rootOf((selector) =>
      present && selector === '[data-setting-id="route-chat"]' ? el : null
    ),
    raf: f.raf,
    caf: f.caf,
    onDone: (landed) => done.push(landed),
  });
  f.step();
  f.step();
  assert.equal(el.scrolled.length, 0, "not mounted yet");
  present = true;
  f.step();
  assert.deepEqual(el.scrolled, [{ block: "center" }]);
  assert.equal(el.dataset.flash, "true");
  assert.deepEqual(done, [true]);
});

test("[change-driving] the landing gives up quietly when the anchor never mounts", async () => {
  const { landOnSetting } = await flash();
  const f = frames();
  const done = [];
  landOnSetting("nope", {
    root: rootOf(() => null),
    raf: f.raf,
    caf: f.caf,
    maxFrames: 3,
    onDone: (l) => done.push(l),
  });
  for (let i = 0; i < 5; i++) f.step();
  assert.deepEqual(done, [false]);
});

test("[change-driving] cancelling before the anchor mounts cancels the pending frame", async () => {
  const { landOnSetting } = await flash();
  const el = fakeElement();
  const f = frames();
  const cancel = landOnSetting("x", { root: rootOf(() => el), raf: f.raf, caf: f.caf });
  cancel();
  f.step();
  assert.equal(el.scrolled.length, 0);
  assert.equal(el.dataset.flash, undefined);
});

test("[change-driving] the flash ends on its own animationend, not on a timer, and ignores other animations", async () => {
  const { flashSetting } = await flash();
  const el = fakeElement();
  flashSetting(el);
  assert.equal(el.dataset.flash, "true");
  el.emit("animationend", { target: {}, animationName: "settings-flash" });
  el.emit("animationend", { target: el, animationName: "spin" });
  assert.equal(el.dataset.flash, "true", "a child's or another animation's end does not clear it");
  el.emit("animationend", { target: el, animationName: "settings-flash" });
  assert.equal(el.dataset.flash, undefined);
  assert.equal(el.listening(), false, "the listener is removed");
});

test("[change-driving] flashing a row that is already flashing restarts the animation", async () => {
  const { flashSetting } = await flash();
  const el = fakeElement();
  flashSetting(el);
  const before = el.offsetReads;
  flashSetting(el);
  assert.equal(
    el.offsetReads,
    before + 1,
    "a reflow is forced between removing and re-adding the flag"
  );
  assert.equal(el.dataset.flash, "true");
});

test("[change-driving] an element with no running animation is not left outlined", async () => {
  const { flashSetting } = await flash();
  const el = fakeElement({ getAnimations: () => [] });
  flashSetting(el);
  assert.equal(el.dataset.flash, undefined);
});

test("[source guard, change-driving] no JS timer and no literal duration", () => {
  for (const file of ["settingFlash.ts", "useSettingsSearch.ts"]) {
    const text = read(`src/components/settings/${file}`);
    assert.doesNotMatch(text, /setTimeout|setInterval/, file);
    assert.doesNotMatch(text, /\b1400\b|1\.4\s*s\b/, file);
  }
});

test("[change-driving] the flash duration is a documented token used by the animation", () => {
  const css = read("src/index.css");
  assert.equal(readTokens(css, ":root")["--motion-flash"], "1400ms");
  assert.equal((css.match(/--motion-flash\s*:/g) ?? []).length, 1, "defined once");
  const rule = css.match(/\[data-setting-id\]\[data-flash="true"\]\s*\{([^}]*)\}/);
  assert.ok(rule, "the flash rule exists");
  assert.match(rule[1], /animation:\s*settings-flash var\(--motion-flash\)/);
  assert.doesNotMatch(rule[1], /\b1\.4s\b|\b1400ms\b/);
  assert.match(
    css,
    /@property --settings-flash\s*\{[^}]*syntax:\s*"<number>"/,
    "animated through a registered property"
  );
  assert.match(css, /@keyframes settings-flash\s*\{[^}]*--settings-flash:\s*1/);
});

test("[change-driving] reduced motion keeps the outline cue and drops the background flash", () => {
  const css = read("src/index.css");
  const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{/g)].map((m) => {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < css.length && depth > 0; i++) depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
    return css.slice(m.index, i);
  });
  const block = blocks.find((b) => b.includes('[data-setting-id][data-flash="true"]'));
  assert.ok(block, "the flash is handled inside a reduced-motion block");
  assert.match(block, /background-color:\s*transparent/);
  // The global policy sets animation-duration: 0.01ms !important; this rule must outrank it so the
  // outline fade (and animationend) still run for the documented duration.
  assert.match(block, /animation-duration:\s*var\(--motion-flash\)\s*!important/);
});

test("[change-driving] cancellation after landing clears only its owned flash", async () => {
  const { landOnSetting, flashSetting } = await flash();
  const el = fakeElement();
  const f = frames();
  const cancel = landOnSetting("x", { root: rootOf(() => el), raf: f.raf, caf: f.caf });
  f.step();
  assert.equal(el.dataset.flash, "true");
  flashSetting(el);
  cancel();
  assert.equal(el.dataset.flash, "true", "old cancellation cannot erase a newer owner's flash");
  const g = frames();
  const current = landOnSetting("x", { root: rootOf(() => el), raf: g.raf, caf: g.caf });
  g.step();
  current();
  assert.equal(el.dataset.flash, undefined);
  assert.equal(el.listening(), false);
});

test("[change-driving] hidden kept-alive anchors wait until visible and stop after 24 frames by default", async () => {
  const { landOnSetting } = await flash();
  const el = fakeElement({ getClientRects: () => [] });
  const f = frames();
  const done = [];
  landOnSetting("x", {
    root: rootOf(() => el),
    raf: f.raf,
    caf: f.caf,
    onDone: (ok) => done.push(ok),
  });
  for (let i = 0; i < 23; i++) f.step();
  assert.deepEqual(done, []);
  f.step();
  assert.deepEqual(done, [false]);
  assert.equal(el.scrolled.length, 0);
});

test("[change-driving] unrelated running animations do not leave a cue without its own animationend", async () => {
  const { flashSetting } = await flash();
  const el = fakeElement({ getAnimations: () => [{ animationName: "spin" }] });
  flashSetting(el);
  assert.equal(el.dataset.flash, undefined);
  assert.equal(el.listening(), false);
});

test("[change-driving] gated fallback waits for the primary deadline and publishes completion once", async () => {
  const { landOnSetting } = await flash();
  const fallback = fakeElement();
  const f = frames();
  const done = [];
  const cancel = landOnSetting("screenContext", {
    root: rootOf((selector) => (selector.includes('"assistantEnabled"') ? fallback : null)),
    fallbackAnchorId: "assistantEnabled",
    raf: f.raf,
    caf: f.caf,
    onDone: (ok) => done.push(ok),
  });
  for (let i = 0; i < 23; i++) f.step();
  assert.equal(fallback.scrolled.length, 0);
  f.step();
  f.step();
  assert.equal(fallback.scrolled.length, 1);
  assert.deepEqual(done, [true]);
  cancel();
  assert.equal(fallback.dataset.flash, undefined);
});

test("[baseline guard] a primary row appearing on the final frame always wins over its fallback", async () => {
  const { landOnSetting } = await flash();
  const primary = fakeElement(),
    fallback = fakeElement();
  const f = frames();
  const done = [];
  let present = false;
  landOnSetting("screenContext", {
    root: rootOf((selector) =>
      selector.includes('"screenContext"') ? (present ? primary : null) : fallback
    ),
    fallbackAnchorId: "assistantEnabled",
    raf: f.raf,
    caf: f.caf,
    onDone: (ok) => done.push(ok),
  });
  for (let i = 0; i < 23; i++) f.step();
  present = true;
  f.step();
  assert.equal(primary.scrolled.length, 1);
  assert.equal(fallback.scrolled.length, 0);
  assert.deepEqual(done, [true]);
});
