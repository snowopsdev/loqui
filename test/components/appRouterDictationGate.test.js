const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { mountComponent } = require("../helpers/harness/mountComponent");

// The dictation panel lazy-loads App. Main keeps dictation gated until the
// panel reports onboarding inactive, so that report must wait until App has
// mounted and registered its recording listeners.
const NULL = "export default function Boundary() { return null; }";
const mocks = {
  "/App.jsx": `import React from "react";
await globalThis.__appRouterGate.promise;
export default function App() {
  React.useEffect(() => { globalThis.__appRouterEvents.push("app-listeners"); }, []);
  return null;
}`,
  "/hooks/useTheme": "export function useTheme() {}",
  "/hooks/useControlPanelWindowDrag": "export function useControlPanelWindowDrag() {}",
  "/dictation/AgentDictationPillOverlay": NULL,
  "/MeetingNotificationOverlay": NULL,
  "/settings/UpdateSettings": NULL,
  "/preview/BrowserPreview": NULL,
};

test("the dictation panel opens main's dictation gate only after App mounts", async (t) => {
  const events = [];
  const gate = {};
  gate.promise = new Promise((resolve) => {
    gate.resolve = resolve;
  });
  globalThis.__appRouterEvents = events;
  globalThis.__appRouterGate = gate;
  t.after(() => {
    delete globalThis.__appRouterEvents;
    delete globalThis.__appRouterGate;
  });

  await mountComponent(t, "/AppRouter.jsx", {
    mocks,
    windowProps: { location: { search: "" } },
    storage: { onboardingCompleted: "true" },
    api: {
      setOnboardingActive: async (active) => {
        events.push(`onboarding-active:${active}`);
      },
    },
  });
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.deepEqual(events, [], "the gate stays closed while the App chunk loads");

  gate.resolve();
  for (let i = 0; i < 50 && events.length < 2; i++) {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  assert.deepEqual(events, ["app-listeners", "onboarding-active:false"]);
});
