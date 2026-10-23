const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent } = require("../helpers/harness/mountComponent");

const nav = () => import("../../src/components/onboarding/radioNavigation.ts");

test("arrow keys follow reading direction, skip disabled options and wrap", async () => {
  const { nextRadioIndex, rovingTabIndex } = await nav();
  const disabled = [false, false, true];
  assert.equal(nextRadioIndex(1, "ArrowDown", disabled), 0);
  assert.equal(nextRadioIndex(0, "ArrowLeft", disabled), 1);
  assert.equal(nextRadioIndex(0, "ArrowLeft", disabled, "rtl"), 1, "in RTL, left moves forward");
  assert.equal(nextRadioIndex(1, "ArrowRight", disabled, "rtl"), 0);
  assert.equal(nextRadioIndex(2, "Home", [true, false, false]), 1);
  assert.equal(nextRadioIndex(0, "End", [false, false, true]), 1);
  assert.equal(nextRadioIndex(0, "Tab", disabled), null);
  assert.equal(nextRadioIndex(0, "ArrowDown", [true, true]), null);
  assert.equal(rovingTabIndex(2, -1, [true, true, false]), 0);
});

const options = () => [
  { value: "a", label: "Fast and English" },
  { value: "b", label: "Many languages" },
  { value: "c", label: "Live captions", disabledReason: "Doesn't hear Japanese" },
];

async function group(t, props = {}) {
  const chosen = [];
  const ui = await mountComponent(t, "/components/onboarding/RadioCardGroup.tsx", {
    exportName: "RadioCardGroup",
    props: {
      label: "Voices",
      idPrefix: "voice",
      value: "b",
      onChange: (value) => chosen.push(value),
      options: options(),
      ...props,
    },
  });
  return { ui, chosen };
}

test("renders a named radio group with one tab stop and readable disabled reasons", async (t) => {
  const { ui } = await group(t);
  assert.equal(ui.byAttr("role", "radiogroup")[0].attributes["aria-label"], "Voices");
  const radios = ui.byAttr("role", "radio");
  assert.deepEqual(
    radios.map((radio) => [radio.attributes["aria-checked"], radio.attributes.tabindex]),
    [
      ["false", "-1"],
      ["true", "0"],
      ["false", "-1"],
    ]
  );
  assert.equal(radios[2].attributes["aria-disabled"], "true");
  assert.ok(
    ui
      .byAttr("id", radios[2].attributes["aria-describedby"])[0]
      .textContent.includes("Doesn't hear Japanese")
  );
});

test("arrow keys select and move focus; disabled options are skipped and never chosen", async (t) => {
  const { ui, chosen } = await group(t);
  const radios = ui.byAttr("role", "radio");
  await ui.press(radios[1], "ArrowDown");
  assert.equal(globalThis.document.activeElement, radios[0], "focus follows the selection (M03)");
  await ui.click(radios[2]);
  assert.deepEqual(chosen, ["a"]);
});

test("the segmented variant is marked for styling", async (t) => {
  const { ui } = await group(t, { variant: "segmented" });
  assert.equal(ui.byAttr("role", "radiogroup")[0].attributes["data-variant"], "segmented");
});

test("navigation covers both reading directions, vertical keys and empty/disabled groups", async () => {
  const { nextRadioIndex, rovingTabIndex } = await nav();
  const disabled = [false, true, false, false];
  assert.equal(nextRadioIndex(0, "ArrowRight", disabled), 2);
  assert.equal(nextRadioIndex(0, "ArrowLeft", disabled), 3);
  assert.equal(nextRadioIndex(0, "ArrowLeft", disabled, "rtl"), 2);
  assert.equal(nextRadioIndex(0, "ArrowRight", disabled, "rtl"), 3);
  assert.equal(nextRadioIndex(0, "ArrowUp", disabled, "rtl"), 3);
  assert.equal(nextRadioIndex(3, "ArrowDown", disabled, "rtl"), 0);
  assert.equal(nextRadioIndex(0, "Home", []), null);
  assert.equal(nextRadioIndex(0, "End", [true, true]), null);
  assert.deepEqual(
    disabled.map((_, index) => rovingTabIndex(index, 1, disabled)),
    [0, -1, -1, -1]
  );
  assert.deepEqual(
    [true, true].map((_, index, flags) => rovingTabIndex(index, -1, flags)),
    [-1, -1]
  );
});

test("RTL horizontal keys select in reading order and focus the selected button", async (t) => {
  const { ui, chosen } = await group(t, {
    value: "a",
    options: [
      { value: "a", label: "One" },
      { value: "b", label: "Two" },
      { value: "c", label: "Three" },
    ],
  });
  globalThis.document.documentElement.dir = "rtl";
  const radios = ui.byAttr("role", "radio");
  let prevented = 0;
  await ui.press(radios[0], "ArrowLeft", {
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(globalThis.document.activeElement, radios[1]);
  assert.deepEqual(chosen, ["b"]);
  assert.equal(prevented, 1);
  await ui.rerender({ value: chosen.at(-1) });
  assert.equal(radios[1].getAttribute("aria-checked"), "true");
  assert.equal(radios[1].getAttribute("tabindex"), "0");
  await ui.press(radios[1], "ArrowRight");
  assert.equal(globalThis.document.activeElement, radios[0]);
  assert.deepEqual(chosen, ["b", "a"]);
});

test("Home/End focus enabled choices; Tab passes through without selection", async (t) => {
  const { ui, chosen } = await group(t);
  const radios = ui.byAttr("role", "radio");
  await ui.press(radios[0], "End");
  assert.equal(globalThis.document.activeElement, radios[1]);
  await ui.press(radios[1], "Home");
  assert.equal(globalThis.document.activeElement, radios[0]);
  let prevented = false;
  await ui.press(radios[0], "Tab", {
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
  assert.equal(globalThis.document.activeElement, radios[0]);
  assert.deepEqual(chosen, ["b", "a"]);
});

test("missing selection falls back to first enabled, disabled selection/all disabled never tab stops", async (t) => {
  const { ui, chosen } = await group(t, { value: null });
  const radios = ui.byAttr("role", "radio");
  assert.deepEqual(
    radios.map((node) => node.getAttribute("tabindex")),
    ["0", "-1", "-1"]
  );
  await ui.rerender({ value: "c" });
  assert.deepEqual(
    radios.map((node) => node.getAttribute("tabindex")),
    ["0", "-1", "-1"]
  );
  await ui.rerender({
    options: options().map((option) => ({ ...option, disabledReason: "Unavailable" })),
  });
  assert.deepEqual(
    radios.map((node) => node.getAttribute("tabindex")),
    ["-1", "-1", "-1"]
  );
  await ui.click(radios[1]);
  await ui.press(radios[0], "ArrowDown");
  assert.deepEqual(chosen, []);
});

test("enabled clicks select, controlled rerenders update tab stop and optional content is readable", async (t) => {
  const { ui, chosen } = await group(t, {
    className: "custom-group",
    options: [
      { value: "a", label: "One", description: "Description", meta: "Metadata", badge: "Badge" },
      { value: "b", label: "Two" },
    ],
  });
  const radios = ui.byAttr("role", "radio");
  assert.equal(radios[0].getAttribute("type"), "button");
  assert.equal(radios[0].getAttribute("data-value"), "a");
  assert.match(ui.text(), /DescriptionMetadata/);
  assert.match(ui.text(), /Badge/);
  assert.match(ui.byAttr("role", "radiogroup")[0].getAttribute("class"), /custom-group/);
  await ui.click(radios[0]);
  assert.deepEqual(chosen, ["a"]);
  await ui.rerender({ value: "a" });
  assert.deepEqual(
    radios.map((node) => [node.getAttribute("aria-checked"), node.getAttribute("tabindex")]),
    [
      ["true", "0"],
      ["false", "-1"],
    ]
  );
});
