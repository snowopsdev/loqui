const assert = require("node:assert/strict");
const test = require("node:test");
const { bridgeFixture } = require("./harness/onboardingBridgeFixture");
const request = (f) => f.sent.findLast(([name]) => name === "onboarding-demo-admission")[1];
const begin = (f, id = "A") => f.setupApi.beginOnboardingDemo({ id, kind: "dictation" });
const reply = (f, value = request(f), accepted = true) =>
  f.overlayApi.replyOnboardingDemoAdmission({ ...value, accepted });
const fixture = (t, options = {}) => {
  const f = bridgeFixture({ admissionOwner: false, admissionTimeoutMs: 30, ...options });
  t.after(() => f.dispose());
  return f;
};

test("actual IPC/preload admission validates both senders and exact nonce, with a valid positive", async (t) => {
  const f = fixture(t);
  assert.equal(await f.overlayApi.beginOnboardingDemo({ id: "forged", kind: "dictation" }), false);
  assert.equal(await f.overlayApi.setOnboardingActive(false), false);
  const pending = begin(f),
    value = request(f);
  assert.equal(await f.setupApi.replyOnboardingDemoAdmission({ ...value, accepted: true }), false);
  assert.equal(await reply(f, { ...value, requestId: "wrong" }), false);
  assert.equal(await reply(f), true);
  assert.equal(await pending, true);
  assert.equal(f.manager._onboardingDemoSession.requestId, value.requestId);
  assert.equal(await f.overlayApi.endOnboardingDemo("A"), false);
  assert.equal(await f.overlayApi.toggleOnboardingDemo("A"), false);
  assert.equal(await f.overlayApi.cancelOnboardingDemo("A"), false);
  assert.equal(await f.overlayApi.stopOnboardingDemo("A"), false);
  assert.equal(f.manager._onboardingDemoSession.id, "A");
  assert.equal(await reply(f), false, "duplicate reply");
  await f.setupApi.endOnboardingDemo("A");
});

for (const outcome of [
  "missing",
  "false",
  "setup destroyed",
  "overlay destroyed",
  "dispose",
  "end",
  "exit",
]) {
  test(`pending ${outcome} admission cleans up boundedly and never installs a session`, async (t) => {
    const f = fixture(t);
    const pending = begin(f),
      value = request(f);
    if (outcome === "false") assert.equal(await reply(f, value, false), false);
    if (outcome === "setup destroyed") f.setupSender.emit("destroyed");
    if (outcome === "overlay destroyed") f.overlaySender.emit("destroyed");
    if (outcome === "dispose") f.dispose();
    if (outcome === "end") await f.setupApi.endOnboardingDemo("A");
    if (outcome === "exit") await f.setupApi.setOnboardingActive(false);
    assert.equal(await pending, false);
    assert.equal(f.manager._onboardingDemoSession, null);
    assert.equal(f.context._onboardingDemoSession, null);
    assert.equal(await reply(f, value), false, "late reply is inert");
    assert.equal(f.setupSender.listenerCount("destroyed"), 0);
    assert.equal(f.overlaySender.listenerCount("destroyed"), 0);
    assert.equal(
      f.sent.filter(([name]) => name === "onboarding-demo-reservation").at(-1)[1].action,
      "release"
    );
  });
}

test("superseded pending begin, old end and old acknowledgement cannot replace the newer admitted demo", async (t) => {
  const f = fixture(t);
  const a = begin(f),
    old = request(f);
  const b = begin(f, "B"),
    next = request(f);
  assert.equal(await a, false);
  assert.notEqual(next.requestId, old.requestId);
  await f.setupApi.endOnboardingDemo("A");
  assert.equal(await reply(f, old), false);
  assert.equal(await reply(f, next), true);
  assert.equal(await b, true);
  assert.equal(await f.overlayApi.invalidateOnboardingDemoAdmission(old), false);
  assert.equal(f.manager._onboardingDemoSession.id, "B");
  assert.equal(await f.setupApi.invalidateOnboardingDemoAdmission(next), false);
  assert.equal(await f.overlayApi.invalidateOnboardingDemoAdmission(next), true);
  assert.equal(f.manager._onboardingDemoSession, null);
  assert.equal(await f.overlayApi.invalidateOnboardingDemoAdmission(next), false);
});

for (const owner of ["setup", "overlay"])
  test(`admitted ${owner} destruction retires only matching reservation`, async (t) => {
    const f = fixture(t);
    const a = begin(f);
    await reply(f);
    assert.equal(await a, true);
    f[`${owner}Sender`].emit("destroyed");
    assert.equal(f.manager._onboardingDemoSession, null);
    assert.equal(f.context._onboardingDemoSession, null);
    assert.equal(f.setupSender.listenerCount("destroyed"), 0);
    assert.equal(f.overlaySender.listenerCount("destroyed"), 0);
  });

for (const phase of ["request", "commit"])
  test(`actual ${phase} delivery failure fails closed and cleans up`, async (t) => {
    const f = fixture(t);
    const send = f.overlaySender.send;
    f.overlaySender.send = (channel, payload) => {
      if (
        (phase === "request" && channel === "onboarding-demo-admission") ||
        (phase === "commit" &&
          channel === "onboarding-demo-reservation" &&
          payload.action === "commit")
      )
        throw new Error("fixture destroyed transport");
      return send(channel, payload);
    };
    const pending = begin(f);
    if (phase === "commit") assert.equal(await reply(f), false);
    assert.equal(await pending, false);
    assert.equal(f.manager._onboardingDemoSession, null);
    assert.equal(f.context._onboardingDemoSession, null);
    assert.equal(f.setupSender.listenerCount("destroyed"), 0);
    assert.equal(f.overlaySender.listenerCount("destroyed"), 0);
  });

test("replacement of the setup window while reply is pending cannot install its old admission", async (t) => {
  const f = fixture(t),
    pending = begin(f);
  f.manager.controlPanelWindow = {
    webContents: { isDestroyed: () => false },
    isDestroyed: () => false,
  };
  assert.equal(await reply(f), false);
  assert.equal(await pending, false);
  assert.equal(f.manager._onboardingDemoSession, null);
});
