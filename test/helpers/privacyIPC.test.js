const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const { SealedState } = require("../../src/helpers/privacy/sealedState");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { attachPrivacyIPC } = require("../../src/helpers/privacy/privacyIPC");
const { createTrustedSender } = require("../../src/helpers/privacy/trustedSender");
const children = require("../../src/helpers/privacy/childRegistry");
const {
  createSealTransition,
  createAttestor,
  createConfirmations,
} = require("../../src/helpers/privacy/privacyBoot");

function harness(t, { approveUnseal = true, approveClear = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-privacy-ipc-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = new SealedState({ profile: dir });
  const recorder = new FlightRecorder({ now: () => 10 });
  gate._resetForTests();
  children._resetForTests();
  gate.configureEgress({ isSealed: () => state.isSealed(), recorder, now: () => 10 });
  t.after(() => gate._resetForTests());
  const handlers = new Map();
  const sent = [];
  const makeWindow = () => {
    const webContents = {
      send: (c, p) => sent.push([c, p]),
      mainFrame: { url: "file:///app/dist/index.html" },
    };
    return { webContents, isDestroyed: () => false };
  };
  const settings = makeWindow();
  const pill = makeWindow();
  const transition = createSealTransition({
    state,
    children,
    waitMs: 1,
    getInference: () => ({ stopCodex() {}, codexRunning: () => false }),
    getUpdateManager: () => ({ pauseForSeal() {}, resumeAfterSeal() {} }),
    getCalendars: () => [],
  });
  transition.applied = [];
  const apply = transition.apply;
  transition.apply = (sealed) => {
    transition.applied.push(sealed);
    return apply(sealed);
  };
  const confirms = [];
  const confirm = createConfirmations({
    BrowserWindow: { fromWebContents: () => settings },
    t: (key, params) => (params ? `${key}:${params.count}` : key),
    dialog: {
      showMessageBox: async (_window, options) => {
        const unseal = options.title.includes("confirmUnseal");
        confirms.push(unseal ? "unseal" : `clear:${options.detail.split(":").pop()}`);
        const approved = unseal ? approveUnseal : approveClear;
        return { response: (typeof approved === "function" ? await approved() : approved) ? 1 : 0 };
      },
    },
  });
  const ipc = attachPrivacyIPC({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler: (c) => handlers.delete(c) },
    BrowserWindow: { getAllWindows: () => [settings, pill] },
    dialog: {
      showSaveDialog: async () => ({ canceled: false, filePath: path.join(dir, "out.csv") }),
    },
    state,
    recorder,
    transition,
    attest: createAttestor({ state, transition, children }),
    isTrustedSender: createTrustedSender({
      getWindows: () => [settings],
      appUrlPrefixes: () => ["file:///app/dist/index.html"],
    }),
    confirm,
  });
  t.after(() => {
    ipc.dispose();
    children._resetForTests();
  });
  const invoke = (channel, win, ...args) =>
    handlers.get(channel)(
      { sender: win?.webContents ?? {}, senderFrame: win?.webContents.mainFrame },
      ...args
    );
  return {
    sent,
    settings,
    pill,
    transition,
    invoke,
    state,
    recorder,
    dir,
    confirms,
    handlers,
    ipc,
  };
}

test("sealing needs no confirmation; the broadcast follows the finished transition", async (t) => {
  const h = harness(t);
  assert.equal(await h.invoke("privacy:get-sealed", h.settings), false);
  const result = await h.invoke("privacy:set-sealed", h.settings, true);
  assert.equal(result.sealed, true);
  assert.equal(result.nothingLeaves, false);
  assert.equal(result.effectiveSince, null);
  assert.ok(result.failures.includes("NATIVE_BOUNDARY_UNAVAILABLE"));
  assert.deepEqual(h.transition.applied, [true]);
  assert.deepEqual(h.confirms, []);
  const order = h.sent.map(([c]) => c).filter((c) => c !== "privacy:egress-event");
  assert.ok(order.indexOf("privacy:attestation") < order.indexOf("privacy:sealed-changed"));
});

test("unsealing asks main's own dialog first, and a 'no' keeps the seal", async (t) => {
  const h = harness(t, { approveUnseal: false });
  await h.invoke("privacy:set-sealed", h.settings, true);
  const result = await h.invoke("privacy:set-sealed", h.settings, false);
  assert.deepEqual(h.confirms, ["unseal"]);
  assert.equal(result.declined, true);
  assert.equal(h.state.isSealed(), true);
  assert.deepEqual(h.transition.applied, [true]);
});

test("set-sealed rejects untrusted senders and non-booleans", async (t) => {
  const h = harness(t);
  await assert.rejects(
    async () => h.invoke("privacy:set-sealed", h.pill, false),
    /PRIVACY_SENDER_REFUSED/
  );
  await assert.rejects(
    async () => h.invoke("privacy:set-sealed", null, true),
    /PRIVACY_SENDER_REFUSED/
  );
  await assert.rejects(async () => h.invoke("privacy:set-sealed", h.settings, "false"), TypeError);
  assert.equal(h.state.isSealed(), false);
});

test("ledger list, summary, export, and a main-confirmed clear", async (t) => {
  const h = harness(t);
  h.recorder.record({ task: "chat", host: "api.groq.com", outcome: "ok", ts: Date.now() });
  assert.equal((await h.invoke("privacy:egress-list", h.settings, {})).length, 1);
  assert.equal((await h.invoke("privacy:egress-summary", h.settings)).left, 1);
  assert.deepEqual(await h.invoke("privacy:egress-export", h.settings), { saved: true });
  assert.match(fs.readFileSync(path.join(h.dir, "out.csv"), "utf8"), /api\.groq\.com/);
  if (process.platform !== "win32")
    assert.equal(fs.statSync(path.join(h.dir, "out.csv")).mode & 0o777, 0o600);
  await assert.rejects(
    async () => h.invoke("privacy:egress-clear", h.pill),
    /PRIVACY_SENDER_REFUSED/
  );
  assert.equal(await h.invoke("privacy:egress-clear", h.settings), true);
  assert.deepEqual(h.confirms, ["clear:1"]);
  assert.equal((await h.invoke("privacy:egress-list", h.settings, { since: 0 })).length, 0);
});

test("a declined clear deletes nothing", async (t) => {
  const h = harness(t, { approveClear: false });
  h.recorder.record({ task: "chat", host: "api.groq.com", outcome: "ok", ts: Date.now() });
  assert.equal(await h.invoke("privacy:egress-clear", h.settings), false);
  assert.equal((await h.invoke("privacy:egress-list", h.settings, { since: 0 })).length, 1);
});

test("dispatch notices and recorded events are broadcast; settled tickets refresh the attestation", async (t) => {
  const h = harness(t);
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com", payload: "text" });
  ticket.markDispatched();
  ticket.settle({ outcome: "ok" });
  await new Promise((r) => setTimeout(r, 80));
  const phases = h.sent.filter(([c]) => c === "privacy:egress-event").map(([, n]) => n.phase);
  assert.deepEqual(phases, ["dispatched", "recorded"]);
  assert.ok(h.sent.some(([c]) => c === "privacy:attestation"));
});

test("main's confirmation dialogs default to the safe button", async () => {
  const shown = [];
  const confirm = createConfirmations({
    dialog: {
      showMessageBox: async (_win, options) => {
        shown.push(options);
        return { response: 0 };
      },
    },
    BrowserWindow: { fromWebContents: () => ({}) },
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
  });
  assert.equal(await confirm.unseal({ sender: {} }), false);
  assert.equal(await confirm.clear(4, { sender: {} }), false);
  for (const options of shown) {
    assert.equal(options.defaultId, 0);
    assert.equal(options.cancelId, 0);
  }
  assert.match(shown[1].detail, /"count":4/);
});

test("all reads and mutations reject iframes, navigated and destroyed known windows", async (t) => {
  const h = harness(t);
  for (const name of [
    "get-sealed",
    "attestation",
    "egress-list",
    "egress-summary",
    "egress-clear",
    "egress-export",
    "set-sealed",
  ]) {
    const fn = h.handlers.get(`privacy:${name}`);
    assert.throws(
      () =>
        fn(
          {
            sender: h.settings.webContents,
            senderFrame: { url: h.settings.webContents.mainFrame.url },
          },
          true
        ),
      /PRIVACY_SENDER_REFUSED/
    );
    h.settings.webContents.mainFrame.url = "file:///app/dist/evil.html";
    assert.throws(() => h.invoke(`privacy:${name}`, h.settings, true), /PRIVACY_SENDER_REFUSED/);
    h.settings.webContents.mainFrame.url = "file:///app/dist/index.html";
  }
  h.settings.isDestroyed = () => true;
  assert.throws(() => h.invoke("privacy:get-sealed", h.settings), /PRIVACY_SENDER_REFUSED/);
});

test("ranges validate malformed input and cap reads; recorder errors are visible without text", async (t) => {
  const h = harness(t);
  for (const options of [
    null,
    [],
    "x",
    { since: NaN },
    { since: -1 },
    { limit: 0 },
    { limit: Infinity },
    { since: "0" },
    { extra: true },
  ]) {
    assert.throws(
      () => h.invoke("privacy:egress-list", h.settings, options),
      /INVALID_PRIVACY_RANGE/
    );
  }
  let limit;
  h.recorder.list = (options) => {
    limit = options.limit;
    return [];
  };
  h.invoke("privacy:egress-list", h.settings, { since: 0, limit: 100000 });
  assert.equal(limit, 5000);
  h.recorder._readPersistError = "READ_ERROR";
  assert.throws(
    () => h.invoke("privacy:egress-summary", h.settings),
    /PRIVACY_RECORDER_UNAVAILABLE/
  );
  await assert.rejects(
    h.invoke("privacy:egress-clear", h.settings),
    /PRIVACY_RECORDER_UNAVAILABLE/
  );
});

test("a newer seal closes admission during unseal confirmation and supersedes it", async (t) => {
  let answer;
  const h = harness(t, {
    approveUnseal: () =>
      new Promise((r) => {
        answer = r;
      }),
  });
  await h.invoke("privacy:set-sealed", h.settings, true);
  const off = h.invoke("privacy:set-sealed", h.settings, false);
  await new Promise((r) => setImmediate(r));
  const on = h.invoke("privacy:set-sealed", h.settings, true);
  assert.equal(h.state.isSealed(), true);
  assert.throws(() => gate.authorize({ task: "chat", target: "https://example.test" }), {
    code: "SEALED_MODE",
  });
  answer(true);
  assert.equal((await off).declined, true);
  assert.equal((await on).sealed, true);
  assert.equal(h.state.isSealed(), true);
});

test("concurrent clear dialogs serialize with unseal; navigation during dialog refuses", async (t) => {
  let answer;
  const h = harness(t, {
    approveClear: () =>
      new Promise((r) => {
        answer = r;
      }),
  });
  const first = h.invoke("privacy:egress-clear", h.settings);
  const second = h.invoke("privacy:egress-clear", h.settings);
  await new Promise((r) => setImmediate(r));
  assert.equal(h.confirms.length, 1);
  h.settings.webContents.mainFrame.url = "https://evil.test/";
  answer(true);
  await assert.rejects(first, /PRIVACY_SENDER_REFUSED/);
  await assert.rejects(second, /PRIVACY_SENDER_REFUSED/);
  assert.equal(h.confirms.length, 1);
});

test("dispose releases all production listeners and handlers", (t) => {
  const h = harness(t);
  const before = gate.events.listenerCount("settled");
  h.ipc.dispose();
  assert.equal(h.handlers.size, 0);
  assert.equal(h.recorder.listenerCount("event"), 0);
  assert.equal(gate.events.listenerCount("settled"), before - 1);
});

test("receipt notices preserve distinct numeric receipt IDs, numeric operation groups and string attempts", (t) => {
  const h = harness(t);
  const ticket = gate.authorize({ task: "chat", target: "https://example.test", payload: "text" });
  const first = ticket.beginAttempt("example.test");
  const second = ticket.beginAttempt("example.test");
  first.markDelivered();
  second.markDispatched();
  const notices = h.sent
    .filter(
      ([channel, notice]) => channel === "privacy:egress-event" && notice.phase === "dispatched"
    )
    .map(([, notice]) => notice);
  assert.equal(typeof notices[0].ticketId, "number");
  assert.equal(typeof notices[0].operationId, "number");
  assert.equal(typeof notices[0].attemptId, "string");
  assert.notEqual(notices[0].ticketId, notices[1].ticketId);
  assert.equal(notices[0].operationId, notices[1].operationId);
  first.settle({ outcome: "ok" });
  second.settle({ outcome: "cancelled" });
  ticket.settle();
});

test("native dialog exceptions return stable errors without leaking exception text", async () => {
  const confirm = createConfirmations({
    dialog: {
      showMessageBox: async () => {
        throw Error("private path and credentials");
      },
    },
    BrowserWindow: { fromWebContents: () => ({}) },
    t: (key) => key,
  });
  await assert.rejects(confirm.unseal({ sender: {} }), { message: "PRIVACY_CONFIRMATION_FAILED" });
  await assert.rejects(confirm.clear(1, { sender: {} }), {
    message: "PRIVACY_CONFIRMATION_FAILED",
  });
});

test("all eleven native dialog translations preserve placeholders and render every local CLDR category", async () => {
  const i18next = require("i18next");
  for (const locale of ["ar", "de", "en", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"]) {
    const translation = require(`../../src/locales/${locale}/translation.json`);
    const i18n = i18next.createInstance();
    await i18n.init({ lng: locale, fallbackLng: false, resources: { [locale]: { translation } } });
    const clear = translation.sealedMode.confirmClear;
    for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
      assert.equal(typeof clear[`detail_${category}`], "string", `${locale}/${category}`);
      assert.deepEqual(clear[`detail_${category}`].match(/{{.*?}}/g), ["{{count}}"]);
    }
    for (const count of [0, 1, 2, 3, 11, 21, 100, 1000000]) {
      const detail = i18n.t("sealedMode.confirmClear.detail", { count });
      assert.ok(detail.includes(String(count)), `${locale}/${count}`);
      assert.doesNotMatch(detail, /{{|sealedMode\./);
    }
    for (const group of ["confirmUnseal", "confirmClear"]) {
      for (const key of [
        "title",
        "message",
        "detail",
        "keep",
        group === "confirmUnseal" ? "turnOff" : "clear",
      ]) {
        assert.equal(
          typeof translation.sealedMode[group][key],
          "string",
          `${locale}/${group}/${key}`
        );
      }
    }
  }
});

test("broadcasts exclude unknown or navigated windows as well as refusing their invokes", (t) => {
  const h = harness(t);
  h.recorder.record({ task: "chat", host: "example.test", outcome: "ok" });
  assert.equal(h.sent.filter(([channel]) => channel === "privacy:egress-event").length, 1);
  h.sent.length = 0;
  h.settings.webContents.mainFrame.url = "https://evil.test/";
  h.recorder.record({ task: "chat", host: "example.test", outcome: "ok" });
  h.ipc.broadcastAttestation();
  assert.equal(h.sent.length, 0);
});

// Final review I5: a pending write failure leaves the list readable (and the
// summary says it may be incomplete); clear and export still work. Only a read
// failure makes the recorder unavailable.
test("a write failure keeps list, summary, clear and export available", async (t) => {
  const h = harness(t);
  h.recorder._pendingPersistError = "SQLITE_BUSY";
  assert.ok(Array.isArray(h.invoke("privacy:egress-list", h.settings)));
  const summary = h.invoke("privacy:egress-summary", h.settings);
  assert.equal(summary.persistError, "SQLITE_BUSY");
  h.recorder._pendingPersistError = "SQLITE_BUSY";
  const cleared = await h.invoke("privacy:egress-clear", h.settings);
  assert.equal(cleared, true);
  assert.equal(h.invoke("privacy:egress-summary", h.settings).persistError, null);
});
