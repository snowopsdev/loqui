const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { bridgeFixture } = require("./harness/onboardingBridgeFixture");

const plain = (value) => JSON.parse(JSON.stringify(value));
async function begin(f, id = "demo-A", kind = "dictation") {
  assert.equal(await f.setupApi.beginOnboardingDemo({ id, kind }), true);
}
function prepared(f) {
  return f.sent.findLast(([name]) => name === "prepare-dictation")?.[1]?.onboardingTake;
}

test("real IPC/preload gates trial controls and cancels preparation plus active processing", async () => {
  const f = bridgeFixture();
  await begin(f);
  assert.equal(
    await f.setupApi.toggleOnboardingDemo("old", f.manager._onboardingDemoSession?.takeId ?? null),
    false
  );
  assert.equal(
    await f.setupApi.cancelOnboardingDemo("old", f.manager._onboardingDemoSession?.takeId ?? null),
    false
  );
  assert.equal(await f.setupApi.undoOnboardingDemoCancel("demo-A"), false, "no Plan04 authority");
  assert.equal(
    await f.setupApi.toggleOnboardingDemo(
      "demo-A",
      f.manager._onboardingDemoSession?.takeId ?? null
    ),
    true
  );
  assert.ok(prepared(f)?.takeId, "main admits a take before preparation");
  f.sent.length = 0;
  assert.equal(
    await f.setupApi.cancelOnboardingDemo(
      "demo-A",
      f.manager._onboardingDemoSession?.takeId ?? null
    ),
    true
  );
  assert.deepEqual(
    f.sent.map(([name]) => name),
    ["cancel-dictation-preparation", "cancel-dictation"]
  );
  f.sent.length = 0;
  await f.setupApi.endOnboardingDemo("demo-A");
  assert.deepEqual(
    f.sent.map(([name]) => name),
    ["onboarding-demo-reservation"]
  );
  await begin(f, "short", "shortcut");
  f.sent.length = 0;
  assert.equal(
    await f.setupApi.toggleOnboardingDemo(
      "short",
      f.manager._onboardingDemoSession?.takeId ?? null
    ),
    false
  );
  assert.equal(
    await f.setupApi.cancelOnboardingDemo(
      "short",
      f.manager._onboardingDemoSession?.takeId ?? null
    ),
    false
  );
  assert.equal(await f.setupApi.undoOnboardingDemoCancel("short"), false);
  assert.equal(f.sent.length, 0);
});

test("real publish refuses delayed old start/error/result across leave/reenter, even reused demo ID", async () => {
  const f = bridgeFixture();
  await begin(f);
  await f.setupApi.toggleOnboardingDemo("demo-A", f.manager._onboardingDemoSession?.takeId ?? null);
  const old = prepared(f);
  await f.setupApi.endOnboardingDemo("demo-A");
  await begin(f); // Deliberately reuse the caller's ID: take IDs must still differ.
  assert.equal(
    await f.overlayApi.publishOnboardingDemoEvent({
      ...old,
      kind: "dictation",
      status: "listening",
    }),
    false
  );
  await f.setupApi.toggleOnboardingDemo("demo-A", f.manager._onboardingDemoSession?.takeId ?? null);
  const current = prepared(f);
  assert.notDeepEqual(current, old);
  for (const status of ["listening", "error", "success", "processing", "cancelled"]) {
    assert.equal(
      await f.overlayApi.publishOnboardingDemoEvent({ ...old, kind: "dictation", status }),
      false,
      status
    );
  }
  assert.equal(f.broadcasts.length, 0);
  assert.equal(
    await f.overlayApi.publishOnboardingDemoEvent({
      ...current,
      kind: "dictation",
      status: "success",
    }),
    false
  );
  assert.equal(
    await f.overlayApi.publishOnboardingDemoEvent({
      ...current,
      kind: "dictation",
      status: "error",
      code: "NotAllowedError",
    }),
    true,
    "current acquisition failure arrives before listening"
  );
  assert.equal(
    await f.overlayApi.publishOnboardingDemoEvent({
      ...current,
      kind: "dictation",
      status: "listening",
    }),
    false,
    "a failed take cannot reopen"
  );
  await f.setupApi.toggleOnboardingDemo("demo-A", f.manager._onboardingDemoSession?.takeId ?? null);
  const next = prepared(f);
  assert.equal(
    await f.overlayApi.publishOnboardingDemoEvent({
      ...next,
      kind: "dictation",
      status: "listening",
    }),
    true
  );
  assert.equal(
    await f.overlayApi.publishOnboardingDemoEvent({
      ...old,
      kind: "dictation",
      status: "success",
      text: "stale",
    }),
    false
  );
  assert.equal(
    await f.overlayApi.publishOnboardingDemoEvent({
      ...next,
      kind: "dictation",
      status: "success",
      rawText: "um hi",
      text: "Hi",
      cleanup: "applied",
    }),
    true
  );
  assert.equal(plain(f.broadcasts.at(-1)[1]).rawText, "um hi");
});

// Evaluate the real main.js callback expressions without launching Electron or
// native listeners. AST selection tolerates nested blocks; callbacks are unedited.
function nativeCallbacks(f, schedule = setTimeout) {
  const source = fs.readFileSync(path.join(__dirname, "../../main.js"), "utf8");
  const ast = ts.createSourceFile(
    "main.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const expressions = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ["dispatchNativeKeyDown", "dispatchNativeKeyUp"].includes(node.name.getText(ast))
    )
      expressions.set(node.name.getText(ast), node.initializer.getText(ast));
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "globeKeyManager.on" &&
      ts.isStringLiteral(node.arguments[0])
    )
      expressions.set(node.arguments[0].text, node.arguments[1].getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const hotkeyManager = {
    slotHasHotkey: (slot) => slot === "dictation",
    getSlotHotkeys: (slot) => (slot === "dictation" ? ["GLOBE"] : []),
    getCurrentHotkey: () => "GLOBE",
  };
  const scope = {
    textEditMonitor: null,
    windowManager: f.manager,
    hotkeyManager,
    isLiveWindow: (w) => w && !w.isDestroyed(),
    isGlobeLikeHotkey: (key) => key === "GLOBE",
    isMouseButtonHotkey: (key) => key === "Mouse4",
    debugLogger: { debug() {} },
    Date,
    setTimeout: schedule,
    globeKeyIsRecording: false,
    globeKeyOnboardingTake: undefined,
    globeKeyDownTime: 0,
    globeLastStopTime: 0,
    rightModDownTime: 0,
    rightModIsRecording: false,
    rightModOnboardingTake: undefined,
    rightModLastStopTime: 0,
    rightModActiveKey: null,
    mouseButtonDownTime: 0,
    mouseButtonIsRecording: false,
    mouseButtonOnboardingTake: undefined,
    mouseButtonLastStopTime: 0,
    mouseButtonActiveButton: null,
    MIN_HOLD_DURATION_MS: 150,
    POST_STOP_COOLDOWN_MS: 300,
  };
  return Object.fromEntries(
    [...expressions].map(([name, code]) => [name, vm.runInNewContext(`(${code})`, scope)])
  );
}

test("native/global reports exclude capture mode centrally and retain native capture forwarding", async () => {
  const f = bridgeFixture();
  await begin(f, "short", "shortcut");
  const events = [];
  f.setupApi.onDictationHotkeyEvent((event) => events.push(event));
  const callbacks = nativeCallbacks(f);
  const globalCallback = f.manager.createHotkeyCallback();
  for (const listening of [true, false]) {
    f.setListening(listening);
    events.length = 0;
    assert.equal(f.manager.reportDictationHotkey("tap"), !listening);
    await globalCallback("F8");
    await callbacks["globe-down"]();
    await callbacks["globe-up"]();
    await callbacks["right-modifier-down"]("RightOption");
    await callbacks["right-modifier-up"]("RightOption");
    await callbacks["mouse-button-down"]("Mouse4");
    await callbacks["mouse-button-up"]("Mouse4");
    callbacks.dispatchNativeKeyDown("F8");
    callbacks.dispatchNativeKeyUp("F8");
    assert.deepEqual(
      events.map((e) => e.phase),
      listening ? [] : ["tap", "tap", "down", "up", "down", "up", "down", "up", "down", "up"]
    );
    assert.ok(events.every((e) => Number.isFinite(e.at)));
  }
  // Separate native capture listeners are always forwarded, including capture mode.
  f.setListening(true);
  let captures = 0;
  f.setupApi.onGlobeKeyPressed(() => {
    captures += 1;
  });
  await callbacks["globe-down"]();
  assert.equal(captures, 1);
  await f.setupApi.endOnboardingDemo("short");
  assert.equal(f.manager.reportDictationHotkey("tap"), false);
});

test("a scheduled native start cannot borrow a later demo or normal-mode preparation", async () => {
  const f = bridgeFixture();
  await begin(f);
  const oldTake = f.manager.sendPrepareDictation();
  await f.setupApi.endOnboardingDemo("demo-A");
  await begin(f, "B");
  f.sent.length = 0;
  f.manager.sendStartDictation({ onboardingTake: oldTake });
  f.manager.sendStartDictation({ onboardingTake: undefined }); // timer captured before setup
  assert.equal(f.sent.length, 0);
  const current = f.manager.sendPrepareDictation();
  f.sent.length = 0;
  f.manager.sendStartDictation({ onboardingTake: current });
  assert.equal(f.sent[0][0], "start-dictation");
  assert.deepEqual(plain(f.sent[0][1].onboardingTake), plain(current));
});

test("real native hold timer retains preparation identity across leave/reenter", async () => {
  for (const startsInDemo of [true, false]) {
    const f = bridgeFixture();
    if (startsInDemo) await begin(f);
    else await f.setupApi.setOnboardingActive(false);
    f.manager._cachedActivationMode = "push";
    const timers = [];
    const callbacks = nativeCallbacks(f, (fn) => {
      timers.push(fn);
      return timers.length;
    });
    await callbacks["globe-down"]();
    assert.equal(timers.length, 1);
    if (startsInDemo) await f.setupApi.endOnboardingDemo("demo-A");
    await begin(f, "B");
    f.sent.length = 0;
    await timers[0]();
    assert.equal(f.sent.length, 0, startsInDemo ? "old demo timer" : "pre-setup timer");
  }
});

test("fallback cancellation cannot manufacture Plan04 tracking fields", async () => {
  const f = bridgeFixture();
  await begin(f);
  f.manager.lastCancelledDictation = null;
  await f.setupApi.toggleOnboardingDemo("demo-A", f.manager._onboardingDemoSession?.takeId ?? null);
  const take = prepared(f);
  await f.setupApi.cancelOnboardingDemo("demo-A", f.manager._onboardingDemoSession?.takeId ?? null);
  assert.equal(
    await f.overlayApi.publishOnboardingDemoEvent({
      ...take,
      kind: "dictation",
      status: "cancelled",
      sessionId: "spoof",
      cancelled: { undoUntil: Date.now() + 10000 },
    }),
    true
  );
  assert.equal(f.manager.lastCancelledDictation, null);
  assert.equal("sessionId" in f.broadcasts.at(-1)[1], false);
  assert.equal("cancelled" in f.broadcasts.at(-1)[1], false);
  assert.equal(await f.setupApi.undoOnboardingDemoCancel("demo-A"), false);
});

test("setup cannot forge an overlay listening/success proof through publish", async () => {
  const f = bridgeFixture();
  await begin(f);
  await f.setupApi.toggleOnboardingDemo("demo-A", f.manager._onboardingDemoSession?.takeId ?? null);
  const take = prepared(f);
  assert.equal(
    await f.setupApi.publishOnboardingDemoEvent({
      ...take,
      kind: "dictation",
      status: "listening",
    }),
    false
  );
  assert.equal(
    await f.setupApi.publishOnboardingDemoEvent({
      ...take,
      kind: "dictation",
      status: "success",
      text: "forged",
    }),
    false
  );
  assert.equal(f.broadcasts.length, 0);
  assert.equal(
    await f.overlayApi.publishOnboardingDemoEvent({
      ...take,
      kind: "dictation",
      status: "listening",
    }),
    true
  );
});

test("a global synthetic tap while the native key is held cannot toggle a second take (ONB-16)", async () => {
  const f = bridgeFixture();
  await begin(f);
  f.manager.reportDictationHotkey("down");
  const take = f.manager.sendPrepareDictation();
  const callback = f.manager.createHotkeyCallback();
  await callback("F7");
  assert.equal(prepared(f).takeId, take.takeId);
  assert.equal(f.sent.filter(([name]) => name === "toggle-dictation").length, 0);
  f.manager.reportDictationHotkey("up");
  await callback("F7");
  assert.equal(f.sent.filter(([name]) => name === "toggle-dictation").length, 1);
});

test("native secondary shortcuts carry the key that actually fired, never the primary binding", async () => {
  const f = bridgeFixture();
  await begin(f);
  f.manager.hotkeyManager.slots = new Map([
    ["dictation", { hotkeys: ["F7", "RightOption"], callback() {} }],
  ]);
  f.manager._cachedActivationMode = "tap";
  const callbacks = nativeCallbacks(f);
  await callbacks["right-modifier-down"]("RightOption");
  assert.equal(f.manager._onboardingDemoSession.binding.hotkey, "RightOption");
});

for (const [down, up, key] of [
  ["globe-down", "globe-up", undefined],
  ["right-modifier-down", "right-modifier-up", "RightOption"],
  ["mouse-button-down", "mouse-button-up", "Mouse4"],
]) {
  test(`actual native ${up} retains its original setup take across a new demo, with matching positive`, async () => {
    const f = bridgeFixture();
    await begin(f, "A");
    f.manager._cachedActivationMode = "push";
    const timers = [];
    const callbacks = nativeCallbacks(f, (fn) => {
      timers.push(fn);
      return timers.length;
    });
    await callbacks[down](key);
    await timers[0]();
    const old = prepared(f);
    await f.setupApi.endOnboardingDemo("A");
    await begin(f, "B");
    f.sent.length = 0;
    await callbacks[up](key);
    assert.equal(
      f.sent.some(([channel]) =>
        ["stop-dictation", "cancel-dictation-preparation", "dictation-force-stopped"].includes(
          channel
        )
      ),
      false
    );
    assert.equal(f.manager._onboardingDemoSession.id, "B");
    const currentTimers = [];
    const current = nativeCallbacks(f, (fn) => {
      currentTimers.push(fn);
      return currentTimers.length;
    });
    await current[down](key);
    await currentTimers[0]();
    const take = prepared(f);
    assert.notEqual(take.takeId, old.takeId);
    await current[up](key);
    const stop = f.sent.findLast(([channel]) => channel === "stop-dictation")[1].onboardingTake;
    assert.equal(stop.demoId, "B");
    assert.equal(stop.takeId, take.takeId);
    assert.equal(stop.reservationId, take.reservationId);
    await f.setupApi.endOnboardingDemo("B");
    f.dispose();
  });
}

for (const platform of ["compound", "windows"])
  test(`original ${platform} physical press state cannot stop a later setup owner`, async (t) => {
    const f = bridgeFixture();
    t.after(() => {
      if (platform === "compound") f.manager.forceStopMacCompoundPush();
      else f.manager.resetWindowsPushState();
      f.dispose();
    });
    await begin(f, "A");
    if (platform === "compound") f.manager.startMacCompoundPushToTalk("Command+F8");
    else f.manager.startWindowsPushToTalk("F8");
    await new Promise((resolve) => setTimeout(resolve, 170));
    assert.equal(
      f.sent.some(([channel]) => channel === "start-dictation"),
      true
    );
    await f.setupApi.endOnboardingDemo("A");
    await begin(f, "B");
    f.sent.length = 0;
    if (platform === "compound") f.manager.handleMacPushModifierUp("command");
    else f.manager.handleWindowsPushKeyUp("F8", { reason: "reset" });
    assert.equal(
      f.sent.some(([channel]) =>
        ["stop-dictation", "cancel-dictation-preparation", "dictation-force-stopped"].includes(
          channel
        )
      ),
      false
    );
    assert.equal(f.manager._onboardingDemoSession.id, "B");
  });
