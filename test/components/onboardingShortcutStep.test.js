const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");

const keycap = (patch = {}) => ({
  pressed: false,
  downAtMs: null,
  lastStyle: null,
  presses: 0,
  ...patch,
});

async function shortcut(t, props = {}) {
  const events = [];
  const ui = await mountComponent(t, "/components/onboarding/ShortcutStep.tsx", {
    exportName: "ShortcutStep",
    props: {
      platform: "darwin",
      hotkey: "GLOBE",
      hotkeyLabel: "fn",
      activationMode: "tap",
      pushSupported: true,
      keycap: keycap(),
      accessibilityMissing: false,
      onGrantAccessibility: () => events.push("grant"),
      autoPasteEnabled: true,
      onAutoPasteChange: (value) => events.push(["paste", value]),
      onActivationModeChange: (mode) => events.push(["mode", mode]),
      onHotkeyChange: (value) => events.push(["hotkey", value]),
      ...props,
    },
    mocks: {
      "ui/HotkeyListInput":
        "export function HotkeyListInput() { return null; } export default HotkeyListInput;",
    },
  });
  return { ui, events };
}

test("before a press, the tester explains tap versus hold for the real key", async (t) => {
  const { ui } = await shortcut(t);
  const [tester] = ui.byAttr("role", "group");
  assert.equal(tester.attributes.tabindex, "0");
  assert.ok(tester.attributes["aria-label"].includes("setupFlow.shortcut.testerLabel"));
  expectKey(ui, "setupFlow.shortcut.hint", { key: "fn" });
});

test("a held press reads as Shortcut works · Hold to talk and offers to switch", async (t) => {
  const { ui, events } = await shortcut(t, { keycap: keycap({ presses: 1, lastStyle: "hold" }) });
  expectKey(ui, "setupFlow.shortcut.works");
  expectKey(ui, "setupFlow.shortcut.detected.hold");
  expectKey(ui, "setupFlow.shortcut.fills");
  await ui.click("setupFlow.shortcut.switch");
  assert.deepEqual(events, [["mode", "push"]]);
});

test("no switch is offered when the key cannot hold-to-talk", async (t) => {
  const { ui } = await shortcut(t, {
    keycap: keycap({ presses: 1, lastStyle: "hold" }),
    pushSupported: false,
  });
  assert.equal(ui.text().includes("setupFlow.shortcut.switch"), false);
});

test("macOS without Accessibility gets the fix; Linux never sees that row", async (t) => {
  const { ui, events } = await shortcut(t, { accessibilityMissing: true });
  assert.equal(ui.byAttr("role", "alert").length, 1);
  await ui.click("setupFlow.try.grantAccess");
  assert.deepEqual(events, ["grant"]);
  await ui.rerender({ platform: "linux", accessibilityMissing: true });
  assert.equal(ui.byAttr("role", "alert").length, 0);
});

test("the auto-paste switch has a name", async (t) => {
  const { ui } = await shortcut(t);
  assert.equal(ui.byAttr("aria-label", "setupFlow.shortcut.autoPaste").length, 1);
});

test("shortcut paste control and tester focus use opaque high contrast tokens in both themes", async () => {
  const fs = require("node:fs");
  const { resolveTokens } = require("../helpers/harness/cssTokens");
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const css = fs.readFileSync("src/styles/onboarding.css", "utf8");
  const themes = resolveTokens(fs.readFileSync("src/index.css", "utf8"));
  const property = (selector, name) => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, selector);
    const block = css.slice(start, css.indexOf("}", start));
    const value = block.match(new RegExp(`${name}: [^;]*var\\((--[\\w-]+)\\)`));
    assert.ok(value, `${selector} ${name}`);
    return value[1];
  };
  const control = '.onb-shortcut [role="switch"]';
  for (const [name, tokens] of Object.entries(themes)) {
    assert.ok(
      contrastRatio(tokens[property(control, "border")], tokens["--color-card"]) >= 3,
      `${name} switch outline`
    );
    const on = property(`${control}[aria-checked="true"]`, "background");
    const thumb = property(`${control}[aria-checked="true"] > span`, "background");
    assert.ok(contrastRatio(tokens[on], tokens[thumb]) >= 3, `${name} checked thumb`);
    assert.ok(
      contrastRatio(
        tokens[property(".onb-tester:focus-visible", "outline")],
        tokens["--color-card"]
      ) >= 3,
      `${name} tester focus`
    );
  }
});

test("the shared keycap has static pressed/flash feedback under the real reduced-motion CSS rule", () => {
  const fs = require("node:fs");
  const { parseRules } = require("../helpers/harness/cssRules");
  const rules = parseRules(fs.readFileSync("src/styles/onboarding.css", "utf8"));
  const reduced = rules.filter((rule) =>
    rule.atRules.includes("@media (prefers-reduced-motion: reduce)")
  );
  for (const selector of [".onb-keycap", ".onb-keycap[data-pressed]", ".onb-keycap[data-flash]"]) {
    const reset = reduced.find(
      (rule) => rule.selector.split(", ").includes(selector) && /transform:\s*none;/.test(rule.body)
    );
    assert.ok(reset, `${selector} has a reduced-motion transform reset`);
    assert.match(reset.body, /animation:\s*none;/);
    assert.match(reset.body, /transition-property:\s*background-color, box-shadow;/);
  }
  const staticFlash = reduced.find(
    (rule) =>
      rule.selector.split(", ").includes(".onb-keycap[data-flash]") && /background:/.test(rule.body)
  );
  assert.ok(staticFlash, "reduced flash retains visible static colour feedback");
});
