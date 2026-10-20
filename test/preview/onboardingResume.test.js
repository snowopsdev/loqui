const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { mountComponent } = require("../helpers/harness/mountComponent");
const { installMicCaptureGlobals } = require("../lib/rendererTestHarness");
const { MIGRATED_STORAGE } = require("../lib/routeStateFixture");

test("actual BrowserPreview and Flow restart the same step with a new demo lifetime and retire old reservations", async (t) => {
  installMicCaptureGlobals(t);
  let ui;
  t.after(async () => {
    if (ui) {
      await ui.unmount();
      globalThis.window.loquiPreviewBridge.reset();
    }
  });
  const events = new EventTarget();
  const url = new URL(
    "http://127.0.0.1:5186/?panel=true&preview=onboarding&step=shortcuts&scenario=ready&platform=linux"
  );
  globalThis.__previewBegins = [];
  globalThis.__previewEnds = [];
  globalThis.__previewAccepted = new Set();
  t.after(() => {
    delete globalThis.__previewBegins;
    delete globalThis.__previewEnds;
    delete globalThis.__previewAccepted;
  });
  ui = await mountComponent(t, "/Task19Preview", {
    storage: {
      ...MIGRATED_STORAGE,
      onboardingCompleted: "true",
      transcriptionMode: "local",
      useLocalWhisper: "true",
      localTranscriptionProvider: "nvidia",
      parakeetModel: "parakeet-unified-en-0.6b",
      microphoneSelectionMode: "system",
    },
    windowProps: {
      location: url,
      history: { replaceState() {} },
      electronAPI: undefined,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    },
    mocks: {
      "/hooks/useTheme": "export function useTheme(){return {theme:'light',setTheme(){}};}",
      "/Task19Preview": `import React from 'react';
 import {installBrowserPreview} from '/preview/browserPreview.ts';
 import BrowserPreview from '/preview/BrowserPreview.tsx';
 import '/components/OnboardingFlow.tsx';
 installBrowserPreview();
 const api=globalThis.globalThis.window.electronAPI;
 const begin=api.beginOnboardingDemo,end=api.endOnboardingDemo;
 api.beginOnboardingDemo=async(session)=>{globalThis.__previewBegins.push(session.id);const accepted=await begin(session);if(accepted)globalThis.__previewAccepted.add(session.id);return accepted;};
 api.endOnboardingDemo=(id)=>{globalThis.__previewEnds.push(id);return end(id);};
 api.listParakeetModels=async()=>({success:true,models:[{model:'parakeet-unified-en-0.6b',downloaded:true}]});
 export default function Host(){return React.createElement(React.StrictMode,null,React.createElement(BrowserPreview));}`,
    },
  });
  const wait = async (predicate) => {
    for (let i = 0; i < 200 && !predicate(); i++)
      await React.act(async () => new Promise((r) => setTimeout(r, 10)));
    assert.equal(Boolean(predicate()), true, "actual Flow admitted: " + ui.text());
  };
  await wait(() => globalThis.__previewAccepted.has(globalThis.__previewBegins.at(-1)));
  const request = (await ui.vite.ssrLoadModule("/hooks/useStartOnboarding.ts"))
    .requestStartOnboarding;
  let prior = globalThis.__previewBegins.at(-1);
  for (let i = 0; i < 2; i++) {
    await React.act(async () => request("shortcuts"));
    await wait(
      () =>
        globalThis.__previewBegins.at(-1) !== prior &&
        globalThis.__previewAccepted.has(globalThis.__previewBegins.at(-1))
    );
    const current = globalThis.__previewBegins.at(-1);
    assert.ok(globalThis.__previewEnds.includes(prior), "old original demo was released");
    assert.equal(
      await globalThis.globalThis.window.electronAPI.toggleOnboardingDemo(prior, null),
      false,
      "old callbacks cannot operate the replacement"
    );
    const events = [];
    const unsubscribe = globalThis.globalThis.window.electronAPI.onDictationHotkeyEvent((e) =>
      events.push(e)
    );
    await React.act(async () => {
      globalThis.window.loquiPreviewBridge.simulateHotkey("down");
      globalThis.window.loquiPreviewBridge.simulateHotkey("up");
    });
    unsubscribe();
    assert.deepEqual(
      events.map((e) => e.phase),
      ["down", "up"],
      "new original shortcut reservation really forwards presses"
    );
    assert.equal(
      await globalThis.globalThis.window.electronAPI.toggleOnboardingDemo(current, null),
      false,
      "shortcut remains recording free"
    );
    prior = current;
  }
  const shortcut = ui.findAll(
    (node) => node.tagName === "BUTTON" && node.textContent === "Hold shortcut"
  )[0];
  const phases = [];
  const off = globalThis.window.electronAPI.onDictationHotkeyEvent((event) =>
    phases.push(event.phase)
  );
  await ui.press(shortcut, " ");
  await React.act(async () => ui.props(shortcut).onBlur());
  // Space→Tab→keyup elsewhere: blur already released this keyboard owner.
  await React.act(async () => globalThis.window.dispatchEvent(new Event("blur")));
  assert.deepEqual(phases.splice(0), ["down", "up"]);
  await ui.press(shortcut, " ");
  await React.act(async () => ui.props(shortcut).onKeyUp({ key: " ", preventDefault() {} }));
  assert.deepEqual(phases.splice(0), ["down", "up"]);
  await React.act(async () =>
    ui.props(shortcut).onPointerDown({ pointerId: 1, currentTarget: { setPointerCapture() {} } })
  );
  await React.act(async () => ui.props(shortcut).onBlur());
  assert.deepEqual(
    phases.splice(0),
    ["down"],
    "unowned keyboard blur cannot release a pointer hold"
  );
  await React.act(async () => ui.props(shortcut).onPointerUp());
  assert.deepEqual(phases.splice(0), ["up"]);
  await ui.press(shortcut, "Enter");
  await ui.unmount();
  assert.deepEqual(phases, ["down", "up"], "unmount releases its keyboard owner once");
  off();
  assert.equal(ui.storage.getItem("onboardingCompleted"), "true");
});
