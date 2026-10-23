const assert = require("node:assert/strict");
const test = require("node:test");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const load = () => import("../../src/preview/previewPrivacy.ts");

const EVENT_KEYS = [
  "attributed",
  "bytesIn",
  "bytesOut",
  "endedAt",
  "errorClass",
  "host",
  "hosts",
  "id",
  "kind",
  "model",
  "operationId",
  "opaque",
  "outcome",
  "status",
  "task",
  "ts",
].sort();
const BARE_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const startOfDay = (ms) => {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};
// Noon of a fixed day keeps every relative timestamp inside that day.
const NOON = new Date(2026, 5, 15, 12, 0, 0).getTime();

test("the preview attestation is never positive, in either state, and always fresh", async () => {
  const { createPreviewPrivacyAPI } = await load();
  let clock = NOON;
  const api = createPreviewPrivacyAPI(() => clock);
  for (const sealed of [false, true]) {
    await api.setSealed(sealed);
    clock += 1000;
    const a = await api.getAttestation();
    assert.equal(a.sealed, sealed);
    assert.equal(a.nothingLeaves, false);
    assert.equal(a.effectiveSince, null);
    assert.equal(a.at, clock, "at is the time of this call");
    assert.equal(a.isolation.mechanism, "none");
    assert.equal(a.isolation.selfTest, "unavailable");
    assert.equal(a.isolation.checkedAt, null);
    assert.equal(a.isolation.reason, "NATIVE_BOUNDARY_UNAVAILABLE");
    assert.equal(a.childDiagnostics.nativeBoundaryUnavailable, true);
    assert.deepEqual(a.paused, []);
    assert.deepEqual(a.children, []);
    assert.equal(a.phase, sealed ? "sealing" : "open", "never reaches the sealed phase in 07a");
    assert.equal(a.failures.includes("NATIVE_BOUNDARY_UNAVAILABLE"), sealed);
    // No guard is claimed: the preview installs none.
    const { sessions, ...flags } = a.guards;
    assert.equal(sessions, 0);
    assert.ok(Object.values(flags).every((value) => value === false || value === 0));
  }
  const first = await api.getAttestation();
  clock += 5000;
  const second = await api.getAttestation();
  assert.ok(second.version > first.version);
  assert.equal(second.at - first.at, 5000);
});

test("toggling updates in memory and notifies both listeners, then stops when unsubscribed", async () => {
  const { createPreviewPrivacyAPI } = await load();
  const api = createPreviewPrivacyAPI(() => NOON);
  const sealedEvents = [];
  const attestations = [];
  const offSealed = api.onSealedChange((value) => sealedEvents.push(value));
  const offAttestation = api.onAttestation((value) => attestations.push(value));
  assert.equal(await api.getSealed(), false);

  const sealedResult = await api.setSealed(true);
  assert.equal(sealedResult.sealed, true);
  assert.equal(sealedResult.declined, undefined);
  assert.equal(sealedResult.sealedSince, NOON);
  assert.equal(await api.getSealed(), true);
  assert.deepEqual(sealedEvents, [true]);
  assert.equal(attestations.length, 1);
  assert.equal(attestations[0].sealed, true);

  await api.setSealed(true);
  assert.deepEqual(sealedEvents, [true], "no change, no notification");

  const open = await api.setSealed(false);
  assert.equal(open.sealed, false);
  assert.equal(open.sealedSince, null);
  assert.deepEqual(sealedEvents, [true, false]);
  assert.deepEqual(
    attestations.map((a) => a.sealed),
    [true, false]
  );

  offSealed();
  offAttestation();
  await api.setSealed(true);
  assert.deepEqual(sealedEvents, [true, false]);
  assert.equal(attestations.length, 2);
  await assert.rejects(api.setSealed("yes"), /boolean/);
});

test("sample rows are metadata only and cover every required kind of record", async () => {
  const { createPreviewPrivacyAPI, createSampleEgress } = await load();
  const rows = createSampleEgress(NOON);
  const midnight = startOfDay(NOON);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), EVENT_KEYS);
    assert.ok(row.hosts.length >= 1 && row.hosts.length <= 8);
    assert.equal(row.host, row.hosts[0]);
    for (const host of row.hosts) assert.match(host, BARE_HOST, "bare host, no URL or path");
    assert.ok(row.errorClass === null || /^[A-Z0-9_]+$/.test(row.errorClass));
    assert.ok(row.model === null || /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(row.model));
    for (const key of ["bytesOut", "bytesIn", "status"])
      assert.ok(row[key] === null || Number.isInteger(row[key]), key);
    assert.ok(row.endedAt === null || row.endedAt >= row.ts);
    assert.ok(row.ts <= NOON && (row.endedAt ?? row.ts) <= NOON, "never in the future");
    assert.ok(row.ts >= midnight - 60_000);
  }
  const serialized = JSON.stringify(rows);
  assert.doesNotMatch(serialized, /:\/\/|\?|https?|message|prompt|token|key/i);

  const completed = rows.find((r) => r.outcome === "ok" && r.kind === "request" && r.bytesOut > 0);
  assert.ok(completed && completed.bytesIn > 0, "completed request with measured bytes");
  const blocked = rows.find((r) => r.outcome === "blocked");
  assert.equal(blocked.bytesOut, 0);
  assert.equal(blocked.errorClass, "SEALED_MODE");
  const interrupted = rows.find((r) => r.outcome === "cancelled" && r.errorClass === "SEALED_MODE");
  assert.equal(interrupted.bytesOut, null);
  assert.equal(interrupted.bytesIn, null);
  const opaque = rows.find((r) => r.kind === "session");
  assert.equal(opaque.opaque, true);
  assert.equal(opaque.bytesOut, null);
  assert.equal(opaque.bytesIn, null);
  assert.ok(
    rows.some((r) => r.kind === "connection"),
    "realtime connection"
  );
  const overnight = rows.find((r) => r.ts < midnight);
  assert.ok(overnight.endedAt >= midnight, "started before midnight, ended after it");
  assert.equal(rows.filter((r) => r.ts < midnight).length, 1);

  // Through the bridge: today's window includes the overnight row; the day
  // before does not need it; summary agrees with the list.
  const api = createPreviewPrivacyAPI(() => NOON);
  const listed = await api.listEgress({ since: midnight, limit: 500 });
  assert.equal(listed.length, rows.length);
  assert.ok(listed.every((r, i) => i === 0 || listed[i - 1].ts >= r.ts));
  const summary = await api.egressSummary({ since: midnight });
  assert.equal(summary.blocked, 1);
  assert.equal(summary.opaqueSessions, 1);
  assert.equal(summary.connections, 1);
  assert.equal(summary.left, summary.observed + summary.connections + summary.opaqueSessions);
  assert.ok(summary.unknownBytes >= 1);
  assert.equal((await api.listEgress({ since: midnight, limit: 2 })).length, 2);
});

test("rows stay inside today's window just after midnight", async () => {
  const { createSampleEgress } = await load();
  const justAfter = new Date(2026, 5, 15, 0, 0, 10).getTime();
  const midnight = startOfDay(justAfter);
  for (const row of createSampleEgress(justAfter)) {
    assert.ok(row.ts >= midnight - 60_000);
    assert.ok((row.endedAt ?? row.ts) >= midnight);
    assert.ok((row.endedAt ?? row.ts) <= justAfter);
  }
});

test("clear and export work in memory", async () => {
  const { createPreviewPrivacyAPI } = await load();
  const api = createPreviewPrivacyAPI(() => NOON);
  let cleared = 0;
  api.onEgressCleared(() => cleared++);
  assert.deepEqual(await api.exportEgressCsv(), { saved: true });
  assert.equal(await api.clearEgress(), true);
  assert.equal(cleared, 1);
  assert.deepEqual(await api.listEgress({ since: 0 }), []);
  const summary = await api.egressSummary({ since: 0 });
  assert.equal(summary.left, 0);
  assert.equal(summary.blocked, 0);
  // A returned row is a copy: editing it does not change the bridge.
  const fresh = createPreviewPrivacyAPI(() => NOON);
  const [row] = await fresh.listEgress({ since: 0 });
  row.hosts.push("changed.example");
  row.bytesOut = -1;
  const [again] = await fresh.listEgress({ since: 0 });
  assert.equal(again.hosts.includes("changed.example"), false);
  assert.notEqual(again.bytesOut, -1);
});

test("installed browser preview exposes the privacy bridge and keeps an existing API", async (t) => {
  let installedBridge;
  // Registered before the globals, as the sibling integration test does, so
  // the reset still sees a window.
  t.after(() => installedBridge?.reset());
  const url = new URL("http://127.0.0.1:5186/");
  installBrowserGlobals(t, {
    window: {
      electronAPI: undefined,
      location: url,
      history: { replaceState() {} },
    },
  });
  const vite = await createRendererServer(t, rendererOptions("loqui-preview-privacy-"));
  const { installBrowserPreview } = await vite.ssrLoadModule("/preview/browserPreview.ts");
  installBrowserPreview();
  installedBridge = globalThis.window.loquiPreviewBridge;
  const api = globalThis.window.electronAPI;
  for (const name of [
    "getSealed",
    "setSealed",
    "getAttestation",
    "onSealedChange",
    "onAttestation",
    "listEgress",
    "egressSummary",
    "clearEgress",
    "exportEgressCsv",
    "onEgress",
    "onEgressCleared",
  ])
    assert.equal(typeof api.privacy[name], "function", name);
  assert.equal((await api.privacy.getAttestation()).nothingLeaves, false);
  assert.equal(await api.privacy.getSealed(), false);
  installBrowserPreview();
  assert.equal(globalThis.window.electronAPI, api);
});
