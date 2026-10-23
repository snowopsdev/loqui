const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { renderStatic } = require("../helpers/harness/reactSsr");
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { SealedState } = require("../../src/helpers/privacy/sealedState");
const { attachPrivacyIPC } = require("../../src/helpers/privacy/privacyIPC");

const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);
const decode = (html) =>
  html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[⁦-⁩]/g, "");

// Producer → main's IPC → the view, with the real gate, recorder and privacy
// IPC, so the view is tested against what main actually sends.
function pipeline(t2, { sealed = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-recorder-pipeline-"));
  t2.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const clock = { now: new Date(2026, 9, 15, 12, 0).getTime() };
  const recorder = new FlightRecorder({ now: () => clock.now });
  const seal = { on: sealed };
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => seal.on, recorder, now: () => clock.now });
  t2.after(() => gate._resetForTests());
  const handlers = new Map();
  const sent = [];
  const win = {
    webContents: { send: (c, p) => sent.push([c, p]), mainFrame: {} },
    isDestroyed: () => false,
  };
  let clearAnswer = true;
  const ipc = attachPrivacyIPC({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler: (c) => handlers.delete(c) },
    BrowserWindow: { getAllWindows: () => [win] },
    dialog: {},
    state: new SealedState({ profile: dir }),
    recorder,
    transition: Object.assign(new EventEmitter(), {
      apply: async () => {},
      recheck() {},
      snapshot: () => ({ phase: "open", effectiveSince: null, failures: [], notes: [] }),
    }),
    attest: () => ({}),
    isTrustedSender: () => true,
    confirm: {
      unseal: async () => true,
      clear: async () => clearAnswer,
      openLink: async () => true,
    },
    now: () => clock.now,
  });
  t2.after(() => ipc.dispose());
  const invoke = (channel, ...args) =>
    handlers.get(channel)(
      { sender: win.webContents, senderFrame: win.webContents.mainFrame },
      ...args
    );
  return {
    clock,
    recorder,
    seal,
    sent,
    invoke,
    setClearAnswer: (v) => (clearAnswer = v),
  };
}
async function render(p, props = {}) {
  const { startOfToday } = await import("../../src/components/settings/flightRecorderView.ts");
  const since = startOfToday(p.clock.now);
  const events = await p.invoke("privacy:egress-list", { since, limit: 500 });
  const summary = await p.invoke("privacy:egress-summary", { since });
  const { FlightRecorderView } =
    await import("../../src/components/settings/FlightRecorderPanel.tsx");
  const html = decode(
    renderStatic(FlightRecorderView, {
      t,
      now: p.clock.now,
      since,
      formatTime: (ms) => `T${ms}`,
      onExport() {},
      onClear() {},
      events,
      summary,
      ...props,
    })
  );
  return { html, events, summary };
}

test("a normal and an interrupted child session reach the view as sessions, not requests", async (t2) => {
  const p = pipeline(t2);
  // The producers Task 8 and Task 10 use: an opaque session settled on exit.
  const codex = gate.authorize({
    task: "codex",
    target: "https://chatgpt.com",
    provider: "codex",
    meter: "opaque",
    payload: "text",
  });
  p.clock.now += 5000;
  codex.settle({ outcome: "ok" });
  const ytdlp = gate.authorize({
    task: "urlImport",
    target: "https://www.youtube.com",
    meter: "opaque",
    payload: "metadata",
  });
  p.clock.now += 2000;
  gate.abortAllRemote(); // sealing mid-session
  ytdlp.settle({ outcome: "cancelled" });

  const { html, summary, events } = await render(p);
  assert.deepEqual([summary.observed, summary.connections, summary.opaqueSessions], [0, 0, 2]);
  assert.ok(events.every((e) => e.bytesOut === null && e.bytesIn === null));
  assert.equal(
    p.sent.filter(([c, x]) => c === "privacy:egress-event" && x.phase === "recorded").length,
    2,
    "both rows were pushed live"
  );
  assert.match(html, /observedToday\{"count":0\}/);
  assert.match(html, /sessionsToday\{"count":2\}/);
  assert.match(html, /usualHost\{"host":"chatgpt\.com"\}/);
  assert.match(html, /usualHost\{"host":"www\.youtube\.com"\}/);
  assert.match(html, /outcome\.cancelled/);
  assert.equal((html.match(/recorder\.opaque</g) || []).length, 2);
  assert.match(html, /T\d+–T\d+/, "a five-second session shows its end time");
});

test("a sealed refusal reads 'Not sent'; an interrupted request may have been partly received", async (t2) => {
  const p = pipeline(t2);
  // Unsealed: a request whose body went out, then sealing cut it off.
  const chat = gate.authorize({
    task: "chat",
    target: "https://api.groq.com/openai/v1/chat/completions?key=SECRET",
    provider: "groq",
    model: "gpt-oss-120b",
    payload: "text",
  });
  chat.markDispatched();
  p.clock.now += 1500;
  gate.abortAllRemote();
  chat.settle({ outcome: "cancelled", bytesOut: 2048 });
  // Sealed: refused before any socket.
  p.seal.on = true;
  assert.throws(() =>
    gate.authorize({ task: "translation", target: "https://api.deepl.com/v2/translate" })
  );
  const { html, summary, events } = await render(p);
  const blocked = events.find((e) => e.outcome === "blocked");
  assert.equal(blocked.bytesOut, 0, "only a refusal records 0 sent");
  assert.equal(summary.blocked, 1);
  assert.match(html, /blockedToday\{"count":1\}/);
  assert.match(html, /recorder\.notSent/);
  assert.match(html, /recorder\.outcome\.cancelled/);
  assert.doesNotMatch(html, /0 Bytes/);
  // Metadata only: a bare host, never the path or query.
  assert.doesNotMatch(html, /SECRET|chat\/completions|v2\/translate/);
  assert.match(html, /dir="ltr"[^>]*>api\.groq\.com</);
});

test("a cleared ledger reaches the view as 'no recorded requests', never as zero egress", async (t2) => {
  const p = pipeline(t2);
  const req = gate.authorize({
    task: "chat",
    target: "https://api.groq.com",
    provider: "groq",
    payload: "text",
  });
  req.markDispatched();
  req.settle({ outcome: "ok", bytesOut: 10, bytesIn: 20 });
  assert.equal(await p.invoke("privacy:egress-clear"), true);
  assert.ok(p.sent.some(([c]) => c === "privacy:egress-cleared"));
  const { html, summary } = await render(p);
  assert.equal(summary.left, 0);
  assert.match(html, /recorder\.empty/);
  assert.match(html, /recorder\.coverage/);
  assert.doesNotMatch(html, /nothing|0 bytes/i);
  // Declined in main's dialog: nothing is deleted.
  p.setClearAnswer(false);
  const kept = gate.authorize({
    task: "chat",
    target: "https://api.groq.com",
    provider: "groq",
    payload: "text",
  });
  kept.markDispatched();
  kept.settle({ outcome: "ok", bytesOut: 10, bytesIn: 20 });
  assert.equal(await p.invoke("privacy:egress-clear"), false);
  assert.equal((await p.invoke("privacy:egress-list", { since: 0 })).length, 1);
});

test("with local history off, records stay in memory only and the view says so", async (t2) => {
  const p = pipeline(t2);
  p.recorder.setPersistence(false);
  const req = gate.authorize({
    task: "chat",
    target: "https://api.groq.com",
    provider: "groq",
    payload: "text",
  });
  req.markDispatched();
  req.settle({ outcome: "ok", bytesOut: 10, bytesIn: 20 });
  assert.equal(p.recorder.memory.length, 1);
  assert.equal(p.recorder.memory[0].scope, "memory");
  const { html } = await render(p, { retention: { historyOn: false, days: 30 } });
  assert.match(html, /recorder\.retentionMemory/);
  assert.doesNotMatch(html, /recorder\.retentionDays/);
});
