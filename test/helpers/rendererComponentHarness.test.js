const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent, expectKey, electronApiProxy } = require("./harness/mountComponent");
const { installTree } = require("./harness/fakeDomTree");
const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");

// These fixtures exercise harness convenience only. Unknown callable proxies do
// not establish that a real optional preload method or authority exists (R9).
test("API logging preserves nested methods, receivers and explicit unsupported boundaries", async () => {
  const calls = [];
  const nested = {
    status: "ready",
    codexStatus() {
      return this.status;
    },
  };
  const api = electronApiProxy(
    { personalInference: nested, unsupported: undefined, absent: null },
    calls
  );
  assert.equal(api.personalInference.codexStatus(), "ready");
  assert.equal(api.unsupported, undefined);
  assert.equal(api.absent, null);
  assert.equal("notInActualContract" in api, false);
  assert.equal(api.then, undefined);
  assert.equal(api[Symbol.iterator], undefined);
  const unsubscribe = api.personalInference.onStatus(() => {});
  assert.equal(typeof unsubscribe, "function");
  unsubscribe();
  await api.fixtureOnly.deep.action("x");
  assert.deepEqual(
    calls.map(([name, ...args]) => [name, ...args.filter((value) => typeof value !== "function")]),
    [
      ["personalInference.codexStatus"],
      ["personalInference.onStatus"],
      ["fixtureOnly.deep.action", "x"],
    ]
  );
});

test("tree retains find/props/text/click and adds scoped selectors, attributes, style and focus", async (t) => {
  installBrowserGlobals(t);
  installHookDom(t);
  const ui = installTree();
  const outer = globalThis.document.createElement("section");
  const first = globalThis.document.createElement("button");
  const child = globalThis.document.createElement("span");
  const second = globalThis.document.createElement("button");
  first.textContent = "Choose voice";
  first.setAttribute("data-test", "one");
  second.setAttribute("data-test", "two");
  child.setAttribute("role", "note");
  first.appendChild(child);
  outer.appendChild(first);
  outer.appendChild(second);
  ui.container.appendChild(outer);
  const events = [];
  first.__reactProps$fixture = {
    onClick: (event) => events.push(event),
    onKeyDown: (event) => events.push(event),
  };
  assert.equal(
    ui.find((node) => node === first),
    first
  );
  assert.equal(ui.props(first), first.__reactProps$fixture);
  assert.equal(ui.text(), "Choose voice");
  assert.deepEqual(ui.byAttr("data-test"), [first, second]);
  assert.deepEqual(ui.byAttr("data-test", "one"), [first]);
  assert.deepEqual(
    ui.findAll((node) => node.tagName === "BUTTON"),
    [first, second]
  );
  assert.equal(ui.container.querySelector("button"), first);
  assert.equal(outer.querySelector('[data-test="two"]'), second);
  assert.equal(first.querySelector("[role]"), child);
  assert.equal(outer.querySelector('span[role="note"]'), child);
  assert.equal(second.querySelector("button"), null);
  assert.equal(first.querySelector("button > span"), null);
  assert.equal(first.getAttribute("missing"), null);
  assert.equal(first.getAttribute("data-test"), "one");
  first.style.setProperty("--progress", 3);
  assert.equal(first.style["--progress"], "3");
  first.style.removeProperty("--progress");
  assert.equal(first.style["--progress"], undefined);
  child.focus();
  assert.equal(globalThis.document.activeElement, child);
  await ui.click("Choose voice");
  await ui.click(first);
  await ui.press(first, "ArrowRight", { repeat: true, shiftKey: true });
  await ui.press(first, "Home");
  for (const event of events) {
    assert.equal(event.target, first);
    assert.equal(event.currentTarget, first);
    event.preventDefault();
    event.stopPropagation();
  }
  assert.equal(events[2].key, "ArrowRight");
  assert.equal(events[2].repeat, true);
  assert.equal(events[2].shiftKey, true);
  assert.equal(events[3].repeat, false);
});

test("mountComponent merges rerenders, supports mocks/globals/storage and unmounts safely", async (t) => {
  const ui = await mountComponent(t, "/HarnessFixture", {
    exportName: "Fixture",
    storage: { seed: "initial" },
    props: { title: "before", retained: "kept" },
    api: { personalInference: { codexStatus: async () => "fixture-status" } },
    reducedMotion: true,
    windowProps: { fixtureFlag: "own-test" },
    mocks: {
      "/components/ui/notices":
        "export const notify = n => (globalThis.__fixtureNotices ??= []).push(n);",
      "/HarnessFixture": `
      import React, { useEffect } from "react";
      import { useTranslation } from "react-i18next";
      import { notify } from "/components/ui/notices";
      export function Fixture({ title, retained }) {
        const { t } = useTranslation();
        useEffect(() => { globalThis.window.electronAPI.personalInference.codexStatus(); return () => { globalThis.window.fixtureUnmounted = true; }; }, []);
        return React.createElement("button", { onClick: () => notify({ kind: "receipt", title }) }, t("fixture.key", { title, retained }));
      }
    `,
    },
  });
  t.after(() => {
    delete globalThis.__fixtureNotices;
  });
  assert.equal(globalThis.window.fixtureFlag, "own-test");
  assert.equal(globalThis.window.matchMedia("(prefers-reduced-motion: reduce)").matches, true);
  assert.equal(globalThis.window.matchMedia("(prefers-color-scheme: dark)").matches, false);
  assert.equal(ui.storage.getItem("seed"), "initial");
  ui.storage.setItem("new", 2);
  assert.equal(localStorage.getItem("new"), "2");
  expectKey(ui, "fixture.key", { retained: "kept", title: "before" });
  assert.deepEqual(ui.calls, [["personalInference.codexStatus"]]);
  await ui.rerender({ title: "after" });
  expectKey(ui, "fixture.key", { title: "after", retained: "kept" });
  await ui.click("fixture.key");
  assert.equal(globalThis.__fixtureNotices.at(-1).title, "after");
  await ui.unmount();
  assert.equal(globalThis.window.fixtureUnmounted, true);
  assert.equal(ui.text(), "");
  await ui.unmount();
});

test("expectKey binds all values to one matching key interpolation", () => {
  expectKey({ text: () => "setup.ready(count=3,provider=Local)" }, "setup.ready", {
    provider: "Local",
    count: 3,
  });
  expectKey({ text: () => "setup.ready" }, "setup.ready");
  expectKey({ text: () => "setup.ready(count=1) setup.ready(count=3)" }, "setup.ready", {
    count: 3,
  });
  for (const rendered of [
    "setup.ready(count=1) setup.other(count=3)",
    "setup.ready(count=30)",
    "setup.ready(wordcount=3)",
    "setup.ready(count=3) setup.ready(provider=Local)",
    "setup.ready(count=3,provider=Remote) setup.other(provider=Local)",
  ]) {
    assert.throws(
      () => expectKey({ text: () => rendered }, "setup.ready", { count: 3, provider: "Local" }),
      assert.AssertionError
    );
  }
  assert.throws(
    () => expectKey({ text: () => "setup.ready(count=30)" }, "setup.ready", { count: 3 }),
    assert.AssertionError
  );
  assert.throws(
    () => expectKey({ text: () => "setup.ready(wordcount=3)" }, "setup.ready", { count: 3 }),
    assert.AssertionError
  );
  assert.throws(
    () =>
      expectKey({ text: () => "setup.ready(count=1) setup.other(count=3)" }, "setup.ready", {
        count: 3,
      }),
    assert.AssertionError
  );
});

test("controlled native selects expose actual option values and update selected state", async (t) => {
  const ui = await mountComponent(t, "/SelectFixture", {
    props: { value: "usb" },
    mocks: {
      "/SelectFixture": `import React from "react"; export default function Select({ value }) { return React.createElement("select", { value, onChange() {} }, React.createElement("option", { value: "system" }, "System"), React.createElement("optgroup", { label: "Devices" }, React.createElement("option", { value: "usb" }, "USB"))); }`,
    },
  });
  const [select] = ui.findAll((node) => node.tagName === "SELECT");
  assert.deepEqual(
    select.options.map((node) => node.value),
    ["system", "usb"]
  );
  assert.equal(select.options[1].selected, true);
  await ui.rerender({ value: "system" });
  assert.equal(select.options[0].selected, true);
  assert.equal(select.options[1].selected, false);
  assert.equal(select.value, "system");
});

test("controlled text-node updates replace text inside mixed children", async (t) => {
  const ui = await mountComponent(t, "/TextNodeFixture", {
    props: { message: "kept" },
    mocks: {
      "/TextNodeFixture": `import React from "react"; export default function Fixture({ message }) { return React.createElement("p", null, message, " ", React.createElement("span", null, "details")); }`,
    },
  });
  assert.equal(ui.text(), "kept details");
  await ui.rerender({ message: "restart" });
  assert.equal(ui.text(), "restart details");
});
