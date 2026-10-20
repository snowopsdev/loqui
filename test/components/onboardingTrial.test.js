const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");

const trialState = (patch = {}) => ({
  phase: "idle",
  text: "",
  rawText: null,
  cleanup: null,
  level: 0,
  heardVoice: false,
  recordingSinceMs: null,
  errorKind: null,
  errorMessage: null,
  successes: 0,
  takeId: 0,
  cleanupRetry: "idle",
  cancelled: null,
  ...patch,
});

async function view(t, patch = {}) {
  const calls = [];
  const ui = await mountComponent(t, "/components/onboarding/HotkeyTrial.tsx", {
    exportName: "HotkeyTrial",
    props: {
      platform: "darwin",
      trial: trialState(),
      nowMs: 0,
      hotkeyLabel: "fn",
      activationMode: "tap",
      keycap: { pressed: false, downAtMs: null, lastStyle: null, presses: 0 },
      usedHotkey: false,
      accessibilityMissing: false,
      onToggle: () => calls.push("toggle"),
      onCancel: () => calls.push("cancel"),
      onUndo: () => calls.push("undo"),
      undoAvailable: true,
      onGrantAccessibility: () => calls.push("grant"),
      onRetryCleanup: () => calls.push("retryCleanup"),
      onTurnCleanupOff: () => calls.push("cleanupOff"),
      onBackToVoice: () => calls.push("voice"),
      onChangeMicrophone: () => calls.push("mic"),
      ...patch,
    },
  });
  return { ui, calls };
}

test("idle teaches the real shortcut in the user's activation mode", async (t) => {
  const { ui } = await view(t);
  expectKey(ui, "setupFlow.try.idle.tap", { key: "fn" });
  expectKey(ui, "setupFlow.try.privacyLine");
  expectKey(ui, "setupFlow.try.useButton");
  await ui.rerender({ activationMode: "push" });
  expectKey(ui, "setupFlow.try.idle.push", { key: "fn" });
});

test("recording lights the keycap and fills the field as you speak", async (t) => {
  const { ui } = await view(t, {
    trial: trialState({ phase: "recording", text: "Remind me", heardVoice: true }),
  });
  assert.equal(ui.byAttr("data-pressed", "true").length, 1);
  const [field] = ui.byAttr("aria-live", "polite");
  assert.ok(field.textContent.includes("setupFlow.try.listening"));
  assert.ok(field.textContent.includes("Remind me"));
});

test("a hotkey success says the shortcut works; a button success does not claim it", async (t) => {
  const { ui } = await view(t, {
    trial: trialState({ phase: "success", text: "Hello.", successes: 1 }),
    usedHotkey: true,
  });
  expectKey(ui, "setupFlow.try.shortcutWorks");
  await ui.rerender({ usedHotkey: false });
  assert.equal(ui.text().includes("setupFlow.try.shortcutWorks"), false);
  expectKey(ui, "setupFlow.try.heardYou");
});

test("a failed cleanup keeps the original words; Retry shows running, then a failed retry says so (ONB-Q7, I08)", async (t) => {
  const failedTake = {
    phase: "success",
    text: "um hi",
    rawText: "um hi",
    cleanup: "failed",
    successes: 1,
    takeId: 1,
  };
  const { ui, calls } = await view(t, { trial: trialState(failedTake) });
  assert.ok(ui.text().includes("um hi"));
  expectKey(ui, "setupFlow.try.cleanupFailed");
  await ui.click("setupFlow.try.retryCleanup");
  await ui.click("setupFlow.try.cleanupOff");
  assert.deepEqual(calls, ["retryCleanup", "cleanupOff"]);
  await ui.rerender({ trial: trialState({ ...failedTake, cleanupRetry: "running" }) });
  const retry = ui.findAll(
    (node) => node.tagName === "BUTTON" && node.textContent.includes("setupFlow.try.retryCleanup")
  )[0];
  assert.ok("disabled" in retry.attributes);
  await ui.rerender({ trial: trialState({ ...failedTake, cleanupRetry: "failed" }) });
  expectKey(ui, "setupFlow.try.retryFailed");
});

test("one toggle button, and Stop is the live primary (ONB-Q5)", async (t) => {
  const { ui, calls } = await view(t);
  await ui.click("setupFlow.try.useButton");
  let [toggle] = ui.byAttr("data-variant", "live");
  assert.ok(toggle.textContent.includes("setupFlow.try.start"));
  await ui.rerender({ trial: trialState({ phase: "recording" }) });
  [toggle] = ui.byAttr("data-variant", "live");
  assert.ok(toggle.textContent.includes("setupFlow.try.stop"));
  assert.equal(
    ui.findAll((node) => node.tagName === "BUTTON" && "disabled" in node.attributes).length,
    0,
    "no disabled Listening… button"
  );
  await ui.click(toggle);
  assert.deepEqual(calls, ["toggle"]);
});

test("a terminal discard has no fictional Undo window", async (t) => {
  const { ui } = await view(t, { trial: trialState({ phase: "cancelled" }), nowMs: 1000 });
  expectKey(ui, "setupFlow.try.discarded");
  assert.equal(ui.text().includes("setupFlow.try.undo"), false);
});

test("each failure has its own fix", async (t) => {
  const { ui, calls } = await view(t, {
    trial: trialState({ phase: "error", errorKind: "microphone" }),
  });
  assert.equal(ui.byAttr("role", "alert").length, 1);
  expectKey(ui, "setupFlow.hello.deniedTitle");
  await ui.rerender({ trial: trialState({ phase: "error", errorKind: "memory" }) });
  await ui.click("setupFlow.try.chooseSmaller");
  await ui.rerender({ trial: trialState(), accessibilityMissing: true });
  expectKey(ui, "setupFlow.try.accessibilityTitle");
  await ui.click("setupFlow.try.grantAccess");
  assert.deepEqual(calls, ["voice", "grant"]);
});

test("silence for a while suggests checking the microphone", async (t) => {
  const { ui } = await view(t, {
    trial: trialState({ phase: "recording", recordingSinceMs: 0 }),
    nowMs: 3000,
  });
  expectKey(ui, "setupFlow.try.silent");
});

test("nothing heard leads back to the microphone picker", async (t) => {
  const { ui, calls } = await view(t, {
    trial: trialState({ phase: "error", errorKind: "noAudio" }),
  });
  await ui.click("setupFlow.try.changeMic");
  assert.deepEqual(calls, ["mic"]);
});

test("the success band offers Make it yours first, then Start using Loqui", async (t) => {
  const picks = [];
  const ui = await mountComponent(t, "/components/onboarding/SuccessBand.tsx", {
    exportName: "SuccessBand",
    props: { onPersonalize: () => picks.push("personalize"), onFinish: () => picks.push("finish") },
  });
  const buttons = ui.findAll((node) => node.tagName === "BUTTON");
  assert.deepEqual(
    buttons.map((node) => node.attributes["data-variant"]),
    ["default", "ghost"]
  );
  await ui.click("setupFlow.try.makeItYours");
  await ui.click("setupFlow.try.startUsing");
  assert.deepEqual(picks, ["personalize", "finish"]);
});

const { bridgeFixture } = require("../helpers/harness/onboardingBridgeFixture");
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function sessionHarness(t, overrides = {}, { strict = false } = {}) {
  let root;
  t.after(() => root && React.act(async () => root.unmount()));
  const f = bridgeFixture();
  const binding = { hotkey: "F7", activationMode: "tap" };
  f.manager.hotkeyManager.slots = new Map([["dictation", { hotkeys: ["F7"], callback() {} }]]);
  f.manager._cachedActivationMode = "tap";
  const api = { ...f.setupApi, ...overrides };
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, rendererOptions("trial-session-proof-"));
  const { useTrialSession } = await vite.ssrLoadModule("/components/onboarding/useTrialSession.ts");
  const { useDictationHotkey } = await vite.ssrLoadModule(
    "/components/onboarding/useDictationHotkey.ts"
  );
  const box = {};
  function Harness({ active, context, expected }) {
    box.session = useTrialSession(active, context, expected);
    box.keycap = useDictationHotkey(active, expected);
    return null;
  }
  root = createRoot(container);
  let props = { active: true, context: "context-A", expected: binding };
  const render = (patch = {}) =>
    React.act(async () => {
      props = { ...props, ...patch };
      const element = React.createElement(Harness, props);
      root.render(strict ? React.createElement(React.StrictMode, null, element) : element);
    });
  await render();
  const admitted = () =>
    f.sent.findLast(([name]) => name === "prepare-dictation")?.[1].onboardingTake;
  const publish = (event) =>
    React.act(async () => {
      await f.overlayApi.publishOnboardingDemoEvent({
        ...admitted(),
        context: props.context,
        kind: "dictation",
        ...event,
      });
    });
  const toggle = () => React.act(async () => box.session.toggle());
  return { box, f, api, render, admitted, publish, toggle, props: () => props };
}

test("real session→preload→main admission stays idle until listening, rejects duplicates/out of order, and ends on leave", async (t) => {
  const h = await sessionHarness(t);
  assert.equal(h.box.session.available, true);
  await h.toggle();
  assert.equal(typeof h.admitted().takeId, "string");
  assert.equal(h.box.session.state.phase, "idle", "preparation is not fictional recording");
  await h.publish({ status: "success", text: "too early" });
  assert.equal(h.box.session.state.successes, 0);
  await h.publish({ status: "listening" });
  const numericTake = h.box.session.state.takeId;
  await h.publish({ status: "listening" });
  assert.equal(h.box.session.state.takeId, numericTake);
  await h.publish({ status: "success", text: "original", rawText: "um original" });
  await h.publish({ status: "success", text: "duplicate" });
  assert.equal(h.box.session.state.successes, 1);
  assert.equal(h.box.session.usedHotkey, false, "button success does not prove a shortcut");
  const old = h.admitted();
  await h.render({ active: false });
  await h.render({ active: true });
  await h.toggle();
  assert.notEqual(old.demoId, h.admitted().demoId);
  await h.publish({ ...old, status: "error", code: "NotAllowedError" });
  assert.equal(h.box.session.state.phase, "idle");
  await h.publish({ status: "error", code: "NotAllowedError" });
  assert.equal(
    h.box.session.state.errorKind,
    "microphone",
    "current prelistening failure is actionable"
  );
});

test("StrictMode effect replay uses distinct demo identities", async (t) => {
  const ids = [];
  const h = await sessionHarness(
    t,
    {
      beginOnboardingDemo: async (session) => {
        ids.push(session.id);
        return true;
      },
    },
    { strict: true }
  );
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  assert.equal(h.box.session.state.phase, "idle");
});

for (const value of [undefined, false, "reject"])
  test(`actual optional begin ${String(value)} cannot enable a trial`, async (t) => {
    const h = await sessionHarness(t, {
      beginOnboardingDemo:
        value === "reject"
          ? async () => {
              throw Error("fixture");
            }
          : value === false
            ? async () => false
            : undefined,
    });
    await h.toggle();
    assert.equal(h.box.session.available, false);
    assert.equal(h.box.session.state.phase, "error");
    assert.equal(h.admitted(), undefined);
  });

for (const action of ["toggleOnboardingDemo", "cancelOnboardingDemo"]) {
  for (const result of [undefined, false, "reject"])
    test(`${action} ${String(result)} is a safe refusal`, async (t) => {
      const h = await sessionHarness(t, {
        [action]:
          result === "reject"
            ? async () => {
                throw Error("native body");
              }
            : result === false
              ? async () => false
              : undefined,
      });
      await React.act(async () =>
        h.box.session[action === "toggleOnboardingDemo" ? "toggle" : "cancel"]()
      );
      assert.equal(h.box.session.state.phase, "error");
      assert.equal(h.box.session.state.errorMessage, null);
    });
}

test("proof belongs to the actual admitted binding; A→ack B stays unproven and failed ack cannot prove B", async (t) => {
  const h = await sessionHarness(t);
  await React.act(async () => h.f.manager.createHotkeyCallback()("F7"));
  await h.publish({ status: "listening" });
  await h.publish({ status: "success", text: "A" });
  assert.equal(h.box.session.usedHotkey, true);
  assert.equal(h.box.session.lastTake.binding.hotkey, "F7");
  const B = { hotkey: "F8", activationMode: "push" };
  h.f.manager.hotkeyManager.slots.get("dictation").hotkeys = ["F8"];
  h.f.manager._cachedActivationMode = "push";
  await h.render({ expected: B });
  assert.equal(h.box.keycap.binding.hotkey, "F8");
  assert.equal(h.box.session.usedHotkey, false);
  h.f.manager.hotkeyManager.slots.get("dictation").hotkeys = ["F7"];
  await h.render({ expected: { hotkey: "F9", activationMode: "tap" } });
  assert.equal(h.box.keycap.binding, null);
  assert.equal(h.box.session.usedHotkey, false);
  assert.equal(h.box.session.lastTake.text, "A", "history stays associated with A");
});

test("completed and deferred old takes cannot prove a new route/device context", async (t) => {
  const h = await sessionHarness(t);
  await h.toggle();
  await h.publish({ status: "listening" });
  await h.publish({ status: "success", text: "historical", rawText: "um historical" });
  const proof = h.box.session.lastTake;
  await h.render({ context: "device-B" });
  assert.equal(h.box.session.lastTake, proof);
  assert.notEqual(h.box.session.lastTake.context, h.props().context);
  await h.toggle();
  await h.publish({ status: "listening" });
  const old = h.admitted();
  await h.render({ context: "route-C" });
  await h.toggle();
  await h.publish({ ...old, context: "device-B", status: "success", text: "late B" });
  assert.equal(h.box.session.state.phase, "idle");
  assert.equal(h.box.session.lastTake.text, "historical");
});

test("actual foundation relay retry applies only the original operation; running duplicates and stale replies are ignored", async (t) => {
  const h = await sessionHarness(t);
  await h.toggle();
  await h.publish({ status: "listening" });
  const take = h.admitted();
  const identity = { demoId: take.demoId, takeId: take.takeId, operationId: "original-operation" };
  h.f.context.onboardingCleanup.bind(h.f.overlaySender, identity, "fixture-token");
  await h.publish({
    status: "success",
    text: "um raw",
    rawText: "um raw",
    cleanup: "failed",
    cleanupOperationId: identity.operationId,
  });
  let request;
  h.f.overlayApi.onOnboardingCleanupRetry((value) => {
    request = value;
  });
  let pending;
  await React.act(async () => {
    pending = h.box.session.retryCleanup();
    await Promise.resolve();
  });
  assert.equal(h.box.session.state.cleanupRetry, "running");
  const first = request;
  await React.act(async () => h.box.session.retryCleanup());
  assert.equal(request, first);
  await React.act(async () => {
    await h.f.overlayApi.replyOnboardingCleanup({ ...request, text: "Clean." });
    await pending;
  });
  assert.equal(h.box.session.state.text, "Clean.");
  assert.equal(h.box.session.state.rawText, "um raw");
  await h.toggle();
  await h.publish({ status: "listening" });
  assert.equal(h.box.session.state.cleanupRetry, "idle");
  await h.publish({
    status: "success",
    text: "new raw",
    rawText: "new raw",
    cleanup: "failed",
    cleanupOperationId: identity.operationId,
  });
  await React.act(async () => h.box.session.retryCleanup());
  assert.equal(h.box.session.cleanupCode, "CLEANUP_OPERATION_UNAVAILABLE");
  assert.equal(h.box.session.state.text, "new raw");
});

test("cleanup retry retired during a new actual main admission cannot mutate the new take", async (t) => {
  const h = await sessionHarness(t);
  await h.toggle();
  await h.publish({ status: "listening" });
  const take = h.admitted(),
    identity = { demoId: take.demoId, takeId: take.takeId, operationId: "retiring-operation" };
  h.f.context.onboardingCleanup.bind(h.f.overlaySender, identity, "fixture-token");
  await h.publish({
    status: "success",
    text: "old raw",
    rawText: "old raw",
    cleanup: "failed",
    cleanupOperationId: identity.operationId,
  });
  let request;
  h.f.overlayApi.onOnboardingCleanupRetry((value) => {
    request = value;
  });
  let run;
  await React.act(async () => {
    run = h.box.session.retryCleanup();
    await Promise.resolve();
  });
  assert.ok(request);
  await h.toggle();
  await h.publish({ status: "listening" });
  await React.act(async () => {
    assert.equal(
      await h.f.overlayApi.replyOnboardingCleanup({ ...request, text: "stale clean" }),
      false
    );
    await run;
  });
  assert.equal(h.box.session.state.phase, "recording");
  assert.equal(h.box.session.state.text, "");
  assert.equal(h.box.session.state.cleanupRetry, "idle");
});

async function gateHarness(t, api, initial = { active: true, platform: "darwin" }) {
  let root;
  t.after(() => root && React.act(async () => root.unmount()));
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const container = installHookDom(t),
    box = {};
  const vite = await createRendererServer(t, rendererOptions("trial-accessibility-"));
  const { useAccessibilityGate } = await vite.ssrLoadModule(
    "/components/onboarding/useAccessibilityGate.ts"
  );
  function Harness(props) {
    box.gate = useAccessibilityGate(props.platform, props.active);
    return null;
  }
  root = createRoot(container);
  let props = initial;
  const render = (patch) =>
    React.act(async () => {
      props = { ...props, ...patch };
      root.render(React.createElement(Harness, props));
    });
  await render({});
  return {
    box,
    render,
    unmount: () =>
      React.act(async () => {
        root.unmount();
        root = null;
      }),
  };
}
for (const result of [undefined, false, "reject", "truthy", true])
  test(`Accessibility strictly grants only actual true: ${String(result)}`, async (t) => {
    const calls = [];
    const { box } = await gateHarness(t, {
      checkAccessibilityPermission:
        result === undefined
          ? undefined
          : async () => {
              if (result === "reject") throw Error("fixture");
              return result;
            },
      markMacAccessibilityFeaturesReady: () => calls.push("ready"),
    });
    assert.equal(box.gate.granted, result === true);
    assert.deepEqual(calls, result === true ? ["ready"] : []);
  });

test("late Accessibility grant cannot mark ready after leaving; off mac is defined true", async (t) => {
  const wait = deferred(),
    calls = [];
  const h = await gateHarness(t, {
    checkAccessibilityPermission: () => wait.promise,
    markMacAccessibilityFeaturesReady: () => calls.push("ready"),
  });
  await h.render({ active: false });
  await React.act(async () => wait.resolve(true));
  assert.equal(h.box.gate.granted, null);
  assert.deepEqual(calls, []);
  await h.render({ platform: "linux" });
  assert.equal(h.box.gate.granted, true);
});

test("component cancel and unsupported cleanup recovery are explicit and preserve raw words", async (t) => {
  const { ui, calls } = await view(t, { trial: trialState({ phase: "processing" }) });
  await ui.click("setupFlow.try.cancel");
  assert.deepEqual(calls, ["cancel"]);
  await ui.rerender({
    trial: trialState({
      phase: "success",
      text: "original words",
      rawText: "original words",
      cleanup: "failed",
    }),
    cleanupCode: "UNSUPPORTED_AUTH_SOURCE",
  });
  expectKey(ui, "setupFlow.try.cleanupUnsupported");
  assert.ok(ui.text().includes("original words"));
});

test("Accessibility recovery exposes a single Use a button action", async (t) => {
  const { ui } = await view(t, { accessibilityMissing: true });
  assert.equal(
    ui.findAll((n) => n.tagName === "BUTTON" && n.textContent.includes("setupFlow.try.useButton"))
      .length,
    1
  );
});

test("generic failed retry says it failed again and native error bodies never render", async (t) => {
  const { ui } = await view(t, {
    trial: trialState({
      phase: "success",
      text: "original",
      cleanup: "failed",
      cleanupRetry: "failed",
    }),
    cleanupCode: "CLEANUP_FAILED",
  });
  expectKey(ui, "setupFlow.try.retryFailed");
  await ui.rerender({
    trial: trialState({
      phase: "error",
      errorKind: "other",
      errorMessage: "fixture native/provider body",
    }),
  });
  expectKey(ui, "setupFlow.try.otherBody");
  assert.equal(ui.text().includes("fixture native/provider body"), false);
});

for (const failure of [undefined, false, "reject"])
  test(`end optional ${String(failure)} falls back to the existing cancel owner without rejection`, async (t) => {
    const calls = [];
    const h = await sessionHarness(t, {
      endOnboardingDemo:
        failure === undefined
          ? undefined
          : async () => {
              if (failure === "reject") throw Error("fixture");
              return false;
            },
      cancelOnboardingDemo: async (id) => {
        calls.push(id);
        return false;
      },
    });
    const id = h.f.manager._onboardingDemoSession.id;
    await h.render({ active: false });
    assert.deepEqual(calls, [id]);
    assert.equal(h.box.session.state.phase, "idle");
  });

test("a delayed old preparation announcement cannot replace a newer admitted take", async (t) => {
  const h = await sessionHarness(t);
  await h.toggle();
  const old = h.admitted();
  await h.publish({ status: "error", code: "NO_AUDIO" });
  await h.toggle();
  const next = h.admitted();
  await h.publish({ status: "listening" });
  await React.act(async () =>
    h.f.manager.controlPanelWindow.webContents.send("onboarding-demo-event", {
      ...old,
      kind: "dictation",
      status: "preparing",
    })
  );
  assert.equal(h.box.session.state.phase, "recording");
  await h.publish({ ...next, status: "success", text: "new" });
  assert.equal(h.box.session.state.text, "new");
});

test("a missing demo observation capability cannot begin an unobservable recording demo", async (t) => {
  const h = await sessionHarness(t, { onOnboardingDemoEvent: undefined });
  assert.equal(h.box.session.available, false);
  assert.equal(h.box.session.state.phase, "error");
  assert.equal(h.f.manager._onboardingDemoSession, null);
});

test("a rejected cancel cannot pretend the observed recording stopped", async (t) => {
  const h = await sessionHarness(t, { cancelOnboardingDemo: async () => false });
  await h.toggle();
  await h.publish({ status: "listening" });
  await React.act(async () => h.box.session.cancel());
  assert.equal(h.box.session.state.phase, "recording");
  assert.equal(h.box.session.controlError, true);
});

test("a retained Accessibility request cannot invoke settings after unmount", async (t) => {
  const calls = [];
  const h = await gateHarness(t, {
    checkAccessibilityPermission: async () => false,
    openAccessibilitySettings: () => calls.push("settings"),
  });
  const request = h.box.gate.request;
  await h.unmount();
  request();
  assert.deepEqual(calls, []);
});

for (const order of ["event-before-false", "false-before-event"]) {
  test(`retained same-session Undo reconciles ${order} and refuses duplicate requests`, async (t) => {
    const pending = deferred();
    const calls = [];
    const h = await sessionHarness(t, {
      undoOnboardingDemoCancel: (...args) => {
        calls.push(args);
        return pending.promise;
      },
    });
    await h.toggle();
    await h.publish({ status: "listening" });
    const cancelled = {
      sessionId: "original-recording",
      undoUntil: Date.now() + 5000,
      remainingMs: 5000,
      paused: false,
      remoteAlreadySent: {
        target: "Speech",
        payload: "audio",
        evidence: "dispatched",
        alsoSentTo: ["Cleanup", "Second"],
      },
    };
    const event = { status: "cancelled", sessionId: cancelled.sessionId, cancelled };
    await h.publish(event);
    assert.equal(h.box.session.undoAvailable, true);
    let request;
    await React.act(async () => {
      request = h.box.session.undo();
      await Promise.resolve();
    });
    await React.act(async () => h.box.session.undo());
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [h.admitted().demoId, h.admitted().takeId, cancelled.sessionId]);
    if (order === "event-before-false") await h.publish(event);
    await React.act(async () => {
      pending.resolve(false);
      await request;
    });
    if (order === "false-before-event") {
      assert.equal(h.box.session.undoAvailable, false);
      await h.publish(event);
    }
    assert.equal(h.box.session.undoAvailable, true);
    assert.deepEqual(h.box.session.state.cancelled.remoteAlreadySent.alsoSentTo, [
      "Cleanup",
      "Second",
    ]);
    await h.publish({
      ...event,
      sessionId: "foreign",
      cancelled: { ...cancelled, sessionId: "foreign" },
    });
    assert.equal(h.box.session.state.cancelled.sessionId, "original-recording");
    await h.publish({ status: "cancelClosed", sessionId: cancelled.sessionId, reason: "expired" });
    assert.equal(h.box.session.undoAvailable, false);
    await h.publish(event);
    assert.equal(
      h.box.session.undoAvailable,
      false,
      "terminal take cannot reopen from stale state"
    );
  });
}

test("rich discarded UI names all recipients and only offers Undo in a live window", async (t) => {
  const cancelled = {
    sessionId: "recording",
    undoUntil: 6000,
    remainingMs: 5000,
    paused: false,
    remoteAlreadySent: {
      target: "Speech",
      payload: "audio",
      evidence: "dispatched",
      alsoSentTo: ["Cleanup", "Second"],
    },
  };
  const { ui, calls } = await view(t, {
    trial: trialState({ phase: "cancelled", cancelled }),
    nowMs: 1000,
  });
  expectKey(ui, "setupFlow.try.undo");
  for (const target of ["Speech", "Cleanup", "Second"])
    assert.ok(ui.text().includes(target), target);
  await ui.click("setupFlow.try.undo");
  assert.deepEqual(calls, ["undo"]);
  await ui.rerender({ nowMs: 6000 });
  assert.equal(ui.text().includes("setupFlow.try.undo"), false);
  await ui.rerender({ nowMs: 1000, undoAvailable: false });
  assert.equal(ui.text().includes("setupFlow.try.undo"), false);
});
