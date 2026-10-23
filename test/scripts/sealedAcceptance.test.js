// Task 16 (07a): the independent egress observer and the acceptance launcher's
// own logic, executed for real in Node. Only exact owned 127.0.0.1 listeners
// are used. Electron is never required, launched, rebuilt or downloaded here;
// the launcher's "not-run" path is driven against temporary fake repo roots.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

const {
  startEgressFixture,
  FIXTURE_DOMAIN,
  EGRESS_TAG_HEADER,
} = require("../../scripts/lib/egressFixture.cjs");
const acceptance = require("../../scripts/sealed-acceptance.cjs");

const repoRoot = path.join(__dirname, "../..");
const remoteHost = (kind, port) => `${kind}.${FIXTURE_DOMAIN}:${port}`;

function get(port, { host, target = "/", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: target,
        agent: false,
        headers: { ...(host ? { host } : {}), ...headers },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("test request timed out")));
  });
}

function upgrade(port, host, target) {
  return new Promise((resolve) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: target,
      agent: false,
      headers: {
        host,
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });
    req.on("upgrade", (_res, socket) => {
      socket.destroy();
      resolve("upgraded");
    });
    req.on("response", (res) => {
      res.resume();
      resolve("response");
    });
    req.on("error", (error) => resolve(error.code || "error"));
    req.setTimeout(5000, () => req.destroy(new Error("test upgrade timed out")));
    req.end();
  });
}

function bareConnection(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => resolve(socket));
    socket.on("error", reject);
  });
}

async function until(predicate, message, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out: ${message}`);
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `loqui-sealed-accept-test-${prefix}-`));
}

// A fake repository root with exactly the launch prerequisites asked for.
function fakeRoot({
  electron = true,
  electronAbi = "149",
  sqlite = "napi_register_module_v1",
  sqliteAt = "prebuilds/linux-x64.node",
  renderer = true,
  playwright = true,
} = {}) {
  const root = tempDir("root");
  const write = (relative, content, mode) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, mode ? { mode } : undefined);
  };
  if (electron) {
    write("node_modules/electron/path.txt", "electron");
    write("node_modules/electron/dist/electron", "#!/bin/sh\nexit 99\n", 0o755);
  }
  if (electronAbi !== null) write("node_modules/electron/abi_version", electronAbi);
  if (sqlite !== null)
    write(
      `node_modules/better-sqlite3/${sqliteAt}`,
      Buffer.concat([Buffer.alloc(64, 0x7f), Buffer.from(`\0${sqlite}\0`, "latin1")])
    );
  if (renderer) write("src/dist/index.html", "<!doctype html>");
  if (playwright) write("node_modules/playwright/package.json", "{}");
  return root;
}

// An xvfb-run display: xvfb-run points XAUTHORITY into its own xvfb-run.* directory.
const XVFB_ENV = { DISPLAY: ":99", XAUTHORITY: "/tmp/xvfb-run.AbC123/Xauthority" };
const LINUX = { platform: "linux", arch: "x64", libc: "glibc", env: XVFB_ENV };
const OPT_IN = "--i-understand-this-launches-electron";
const HONEST_SEALED = {
  sealed: true,
  phase: "sealing",
  effectiveSince: null,
  nothingLeaves: false,
  failures: ["NATIVE_BOUNDARY_UNAVAILABLE"],
  isolation: { mechanism: "none" },
};

// Every mandatory observer check passes; both sealed runs record the native block.
function completeRun(record) {
  for (const name of acceptance.MANDATORY_CHECKS) record.verify(name, true, null);
  record.recordNativeBlock("toggle", HONEST_SEALED);
  record.recordNativeBlock("boot", HONEST_SEALED);
}

function electronLoaded() {
  return Object.keys(require.cache).some((key) =>
    /[\\/]node_modules[\\/](electron|playwright|playwright-core)[\\/]/.test(key)
  );
}

// --- The fixture: the independent observer --------------------------------------------------

test("the fixture binds only an owned 127.0.0.1 port and logs requests with host and path", async (t) => {
  const fixture = await startEgressFixture();
  t.after(() => fixture.close());
  assert.equal(fixture.host, "127.0.0.1");
  assert.ok(Number.isInteger(fixture.port) && fixture.port > 0);
  const response = await get(fixture.port, {
    host: remoteHost("api", fixture.port),
    target: "/net-fetch-open",
  });
  assert.equal(response.status, 200);
  assert.equal(response.body, "ok");
  const seen = fixture.seenSince(0);
  assert.equal(seen.requests.length, 1);
  assert.equal(seen.requests[0].host, remoteHost("api", fixture.port));
  assert.equal(seen.requests[0].path, "/net-fetch-open");
  assert.equal(seen.requests[0].method, "GET");
  assert.equal(seen.requests[0].upgrade, false);
  assert.equal(seen.requests[0].egressTagged, false);
  assert.equal(seen.connections, 1);
});

test("the fixture logs a bare TCP connection that never sends a request (a preconnect)", async (t) => {
  const fixture = await startEgressFixture();
  t.after(() => fixture.close());
  const socket = await bareConnection(fixture.port);
  t.after(() => socket.destroy());
  await until(() => fixture.seenSince(0).connections === 1, "bare connection logged");
  const seen = fixture.seenSince(0);
  assert.equal(seen.requests.length, 0, "no request was sent");
  assert.equal(seen.connections, 1, "the connection alone is still seen");
});

test("the fixture logs WebSocket upgrades as hits and refuses them", async (t) => {
  const fixture = await startEgressFixture();
  t.after(() => fixture.close());
  const outcome = await upgrade(fixture.port, remoteHost("stream", fixture.port), "/ws-open");
  assert.notEqual(outcome, "upgraded", "the fixture never completes an upgrade");
  await until(() => fixture.seenSince(0).requests.length === 1, "upgrade logged");
  const [hit] = fixture.seenSince(0).requests;
  assert.equal(hit.path, "/ws-open");
  assert.equal(hit.upgrade, true);
  assert.equal(hit.host, remoteHost("stream", fixture.port));
  assert.deepEqual(acceptance.probeKinds([hit]), ["ws"]);
});

test("the fixture serves an updater manifest for .yml and records Loqui's egress tag by header name only", async (t) => {
  const fixture = await startEgressFixture();
  t.after(() => fixture.close());
  const manifest = await get(fixture.port, {
    host: remoteHost("updates", fixture.port),
    target: "/latest-linux.yml",
    headers: { [EGRESS_TAG_HEADER]: "secret-ticket-value" },
  });
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers["content-type"], /yaml/);
  assert.match(manifest.body, /^version: 0\.0\.1$/m);
  const [hit] = fixture.seenSince(0).requests;
  assert.equal(hit.egressTagged, true);
  assert.ok(!JSON.stringify(hit).includes("secret-ticket-value"), "no header values are logged");
  assert.deepEqual(acceptance.probeKinds([hit]), ["updates"]);
});

test("the egress tag header the observer looks for is the one the gate sends", () => {
  const gate = fs.readFileSync(path.join(repoRoot, "src/helpers/privacy/egressGate.js"), "utf8");
  assert.ok(gate.includes(`const EGRESS_TAG_HEADER = "${EGRESS_TAG_HEADER}";`));
  const boot = fs.readFileSync(path.join(repoRoot, "src/helpers/privacy/privacyBoot.js"), "utf8");
  assert.ok(boot.includes(`const UNAVAILABLE = "${acceptance.NATIVE_BOUNDARY_UNAVAILABLE}";`));
});

test("seenSince windows include hits and connections at or after the mark only", async (t) => {
  let clock = 1000;
  const fixture = await startEgressFixture({ now: () => clock });
  t.after(() => fixture.close());
  await get(fixture.port, { host: remoteHost("api", fixture.port), target: "/node-http-open" });
  clock = 2000;
  await get(fixture.port, { host: remoteHost("api", fixture.port), target: "/node-http-toggled" });
  clock = 3000;
  const socket = await bareConnection(fixture.port);
  t.after(() => socket.destroy());
  await until(() => fixture.seenSince(0).connections === 3, "third connection logged");

  assert.deepEqual(
    fixture.seenSince(0).requests.map((hit) => hit.path),
    ["/node-http-open", "/node-http-toggled"]
  );
  assert.equal(fixture.seenSince(0).connections, 3);
  const atMark = fixture.seenSince(2000);
  assert.deepEqual(
    atMark.requests.map((hit) => hit.path),
    ["/node-http-toggled"],
    "a hit exactly at the mark counts"
  );
  assert.equal(atMark.connections, 2);
  const afterRequests = fixture.seenSince(2001);
  assert.equal(afterRequests.requests.length, 0);
  assert.equal(afterRequests.connections, 1, "the bare connection alone is in the late window");
  const empty = fixture.seenSince(3001);
  assert.deepEqual([empty.requests.length, empty.connections], [0, 0]);
  // seenSince returns copies: callers cannot erase the log.
  fixture.seenSince(0).requests.length = 0;
  assert.equal(fixture.seenSince(0).requests.length, 2);
});

test("the local fixture redirects /redirect out of loopback to the remote fixture's name", async (t) => {
  const remote = await startEgressFixture();
  t.after(() => remote.close());
  const redirectTo = `http://api.${FIXTURE_DOMAIN}:${remote.port}`;
  const local = await startEgressFixture({ redirectTo });
  t.after(() => local.close());

  const first = await get(local.port, { target: "/redirect" });
  assert.equal(first.status, 302);
  assert.equal(first.headers.location, `${redirectTo}/after-redirect`);
  assert.equal(remote.seenSince(0).requests.length, 0, "the redirect itself sends nothing remote");

  // Following the redirect: the remote name resolves to the remote fixture.
  const location = new URL(first.headers.location);
  const second = await get(remote.port, { host: location.host, target: location.pathname });
  assert.equal(second.status, 200);
  const [hit] = remote.seenSince(0).requests;
  assert.equal(hit.path, "/after-redirect");
  assert.equal(hit.host, remoteHost("api", remote.port));
  assert.deepEqual(acceptance.probeKinds([hit]), ["after-redirect"]);
  assert.equal(local.seenSince(0).requests[0].path, "/redirect");
});

test("a fixture without redirectTo answers /redirect itself, and bad redirect targets are refused", async (t) => {
  const plain = await startEgressFixture();
  t.after(() => plain.close());
  const response = await get(plain.port, { target: "/redirect" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.location, undefined);
  assert.throws(() => startEgressFixture({ redirectTo: "file:///etc/passwd" }), /http/);
  assert.throws(() => startEgressFixture({ redirectTo: "http://x.test/path" }), /origin/);
  assert.throws(() => startEgressFixture({ redirectTo: "not a url" }));
});

test("closing a fixture is idempotent and drops held-open connections", async (t) => {
  const fixture = await startEgressFixture();
  t.after(() => fixture.close());
  const socket = await bareConnection(fixture.port);
  t.after(() => socket.destroy());
  const closed = new Promise((resolve) => socket.once("close", resolve));
  await until(() => fixture.seenSince(0).connections === 1, "connection logged");
  assert.equal(fixture.listening, true);
  await Promise.all([fixture.close(), fixture.close()]);
  await closed;
  assert.equal(fixture.listening, false);
  await fixture.close();
});

// --- The launcher's own logic -----------------------------------------------------------------

test("probe settlement is bounded: a hung probe is a timeout, never reached", async () => {
  const started = Date.now();
  assert.equal(await acceptance.settleWithin(new Promise(() => {}), 50), "timeout");
  assert.ok(Date.now() - started < 2000);
  assert.equal(await acceptance.settleWithin(Promise.resolve("anything"), 50), "reached");
  const refused = Object.assign(new Error("refused"), { code: "SEALED_MODE" });
  assert.equal(await acceptance.settleWithin(Promise.reject(refused), 50), "SEALED_MODE");
  assert.equal(await acceptance.settleWithin(Promise.reject(new TypeError("x")), 50), "TypeError");
  // An error cannot impersonate a success or a timeout.
  const fake = Object.assign(new Error("x"), { code: "reached" });
  assert.equal(await acceptance.settleWithin(Promise.reject(fake), 50), "error:reached");
});

test("probe kinds match exact probe paths and hosts without cross-matching", () => {
  const port = 4321;
  const hits = [
    { host: remoteHost("api", port), path: "/net-fetch-open" },
    { host: remoteHost("api", port), path: "/net-request-open" },
    { host: remoteHost("api", port), path: "/node-http-open" },
    { host: remoteHost("stream", port), path: "/ws-open", upgrade: true },
    { host: remoteHost("api", port), path: "/after-redirect" },
    { host: remoteHost("img", port), path: "/img-open.png" },
    { host: remoteHost("api", port), path: "/renderer-fetch-open" },
    { host: remoteHost("updates", port), path: "/latest-linux.yml" },
  ];
  assert.deepEqual(acceptance.probeKinds(hits), acceptance.EXPECTED_REMOTE);
  assert.deepEqual(acceptance.probeKinds([hits[6]]), ["renderer-fetch"]);
  assert.deepEqual(acceptance.probeKinds([{ host: "x", path: "/news" }]), []);
  assert.deepEqual(acceptance.probeKinds([]), []);
});

test("refusal check: reached, hung, missing or setup-failed probes are not refusals", () => {
  const refused = {
    netFetch: "SEALED_MODE",
    netRequest: "ERR_BLOCKED_BY_CLIENT",
    nodeHttp: "SEALED_MODE",
    ws: "SEALED_MODE",
    redirect: "ERR_BLOCKED_BY_CLIENT",
    updater: "SEALED_MODE",
    rendererLoad: "reached",
    loopback: "reached",
  };
  assert.deepEqual(acceptance.refusalProblems(refused), []);
  const problems = acceptance.refusalProblems({
    ...refused,
    netFetch: "reached",
    ws: "timeout",
    updater: "setup:Error",
    nodeHttp: undefined,
  });
  assert.deepEqual(problems.map((p) => p.probe).sort(), ["netFetch", "nodeHttp", "updater", "ws"]);
  assert.deepEqual(
    acceptance.refusalProblems({ ...refused, updater: "setup:Error" }, { excluded: ["updater"] }),
    []
  );
});

test("an updater the platform cannot point at the fixture is excluded by name, never silently", () => {
  const normal = acceptance.expectedRemote({ updater: "reached" });
  assert.deepEqual(normal.kinds, acceptance.EXPECTED_REMOTE);
  assert.deepEqual(normal.excluded, []);
  const refusedSetup = acceptance.expectedRemote({ updater: "setup:Error" });
  assert.ok(!refusedSetup.kinds.includes("updates"));
  assert.deepEqual(refusedSetup.excluded, [
    { probe: "updater", kind: "updates", reason: "setup:Error" },
  ]);
});

test("Step 5 leak drill: a request reaching the remote fixture while sealed fails the observer", async (t) => {
  const remote = await startEgressFixture();
  t.after(() => remote.close());
  const record = acceptance.createAcceptanceRecord({ platform: "linux", log: () => {} });
  record.attachRemote(remote);

  // A clean sealed window passes the observer check, but the run can never pass.
  const quietSince = Date.now();
  record.verify(
    acceptance.CHECKS.toggleNothingLeft,
    record.nothingLeft(quietSince),
    record.leaked(quietSince)
  );
  assert.deepEqual(record.report.observer.passed, [acceptance.CHECKS.toggleNothingLeft]);
  // One clean check is not a completed run.
  assert.equal(record.finalize(), "INCOMPLETE");
  assert.equal(record.report.observerChecksComplete, false);

  // The drill: the Node backstop is "missing", so node-http leaves.
  const sealedAt = Date.now();
  await get(remote.port, {
    host: remoteHost("api", remote.port),
    target: "/node-http-toggled",
  });
  assert.throws(
    () =>
      record.verify(
        acceptance.CHECKS.toggleNothingLeft,
        record.nothingLeft(sealedAt),
        record.leaked(sealedAt)
      ),
    /no request and no connection after sealing/
  );
  const [failure] = record.report.observer.failed;
  assert.equal(failure.name, acceptance.CHECKS.toggleNothingLeft);
  assert.deepEqual(
    failure.detail.requests.map((hit) => hit.path),
    ["/node-http-toggled"]
  );
  assert.equal(record.finalize(), "FAIL");
  assert.equal(acceptance.exitCodeFor(record.report.status), acceptance.EXIT.FAIL);
  assert.deepEqual(acceptance.honestyViolations(record.report), []);
});

test("Step 5 leak drill: a bare preconnect or a WebSocket upgrade while sealed also fails", async (t) => {
  const remote = await startEgressFixture();
  t.after(() => remote.close());

  const preconnect = acceptance.createAcceptanceRecord({ log: () => {} });
  preconnect.attachRemote(remote);
  const since = Date.now();
  const socket = await bareConnection(remote.port);
  t.after(() => socket.destroy());
  await until(() => remote.seenSince(since).connections === 1, "preconnect logged");
  assert.equal(remote.seenSince(since).requests.length, 0);
  assert.equal(preconnect.nothingLeft(since), false);
  assert.throws(() =>
    preconnect.verify(
      acceptance.CHECKS.bootNothingLeft,
      preconnect.nothingLeft(since),
      preconnect.leaked(since)
    )
  );
  assert.equal(preconnect.finalize(), "FAIL");

  const websocket = acceptance.createAcceptanceRecord({ log: () => {} });
  websocket.attachRemote(remote);
  const wsSince = Date.now();
  await upgrade(remote.port, remoteHost("stream", remote.port), "/ws-toggled");
  await until(() => remote.seenSince(wsSince).requests.length === 1, "upgrade logged");
  assert.throws(() =>
    websocket.verify(
      acceptance.CHECKS.toggleNothingLeft,
      websocket.nothingLeft(wsSince),
      websocket.leaked(wsSince)
    )
  );
  assert.equal(websocket.report.observer.failed[0].detail.requests[0].upgrade, true);
  assert.equal(websocket.finalize(), "FAIL");
});

test("07a attestation honesty: a nothing-leaves claim, an effective date or a missing native failure is a problem", () => {
  const honest = {
    sealed: true,
    phase: "sealing",
    effectiveSince: null,
    nothingLeaves: false,
    failures: [acceptance.NATIVE_BOUNDARY_UNAVAILABLE, "timeout:dns"],
    isolation: { mechanism: "none", selfTest: "unavailable" },
  };
  assert.deepEqual(acceptance.evaluate07aAttestation(honest), []);
  assert.equal(acceptance.evaluate07aAttestation({ ...honest, nothingLeaves: true }).length, 1);
  assert.equal(
    acceptance.evaluate07aAttestation({ ...honest, nothingLeaves: undefined }).length,
    1
  );
  assert.equal(acceptance.evaluate07aAttestation({ ...honest, effectiveSince: 5 }).length, 1);
  assert.equal(acceptance.evaluate07aAttestation({ ...honest, failures: [] }).length, 1);
  assert.equal(acceptance.evaluate07aAttestation({ ...honest, phase: "sealed" }).length, 1);
  assert.equal(
    acceptance.evaluate07aAttestation({ ...honest, isolation: { mechanism: "netns" } }).length,
    1
  );
  assert.ok(acceptance.evaluate07aAttestation(null).length > 0);

  // The summary kept in the report never carries the raw field.
  const summary = acceptance.summarizeAttestation({ ...honest, nothingLeaves: true });
  assert.equal(summary.claimsNothingLeaves, true);
  assert.ok(!("nothingLeaves" in summary));
});

test("every platform records the native boundary as NOT VERIFIED, under its own gate", () => {
  for (const [platform, gate] of [
    ["darwin", "D16"],
    ["linux", "D14/D15"],
    ["win32", "D14"],
  ]) {
    const record = acceptance.createAcceptanceRecord({ platform, log: () => {} });
    assert.equal(record.report.nativeBoundary.status, "NOT VERIFIED");
    assert.equal(record.report.nativeBoundary.gate, gate);
    record.recordNativeBlock("toggle", {
      sealed: true,
      phase: "sealing",
      effectiveSince: null,
      nothingLeaves: false,
      failures: [acceptance.NATIVE_BOUNDARY_UNAVAILABLE],
    });
    assert.deepEqual(
      record.report.nativeBoundary.blocked.map((entry) => [entry.run, entry.gate, entry.status]),
      [["toggle", gate, "NOT VERIFIED"]]
    );
    for (const name of acceptance.MANDATORY_CHECKS) record.verify(name, true, null);
    assert.equal(record.finalize(), "NOT VERIFIED");
    assert.equal(record.report.observerChecksComplete, true);
    assert.equal(acceptance.exitCodeFor("NOT VERIFIED"), acceptance.EXIT.NOT_VERIFIED);
    assert.notEqual(acceptance.EXIT.NOT_VERIFIED, 0);
  }
});

test("status is exact for every combination, and nothing finalizes to a pass or exits 0", () => {
  const seen = new Set();
  for (const notRun of [null, { reasons: [{ code: "x", detail: "y" }] }])
    for (const failed of [[], [{ name: "x", detail: null }]])
      for (const error of [null, "boom"])
        for (const complete of [false, true]) {
          const record = acceptance.createAcceptanceRecord({ log: () => {} });
          if (complete)
            for (const name of acceptance.MANDATORY_CHECKS) record.verify(name, true, null);
          record.report.notRun = notRun;
          record.report.observer.failed.push(...failed);
          record.report.error = error;
          const status = record.finalize();
          let expected;
          if (notRun) expected = "not-run";
          else if (failed.length) expected = "FAIL";
          else if (error || !complete) expected = "INCOMPLETE";
          else expected = "NOT VERIFIED";
          assert.equal(status, expected, JSON.stringify({ notRun, failed, error, complete }));
          assert.equal(record.report.observerChecksComplete, complete && !notRun);
          assert.notEqual(acceptance.exitCodeFor(status), 0);
          seen.add(status);
        }
  assert.deepEqual([...seen].sort(), ["FAIL", "INCOMPLETE", "NOT VERIFIED", "not-run"]);
  // Each outcome has its own exit code, so CI can tell a crash from a clean run.
  const codes = ["not-run", "FAIL", "INCOMPLETE", "NOT VERIFIED"].map(acceptance.exitCodeFor);
  assert.deepEqual(codes, [2, 1, 4, 3]);
  assert.equal(new Set(codes).size, 4);
  assert.notEqual(acceptance.exitCodeFor("PASS"), 0);
  assert.notEqual(acceptance.exitCodeFor(undefined), 0);
});

test("a run that errored after every check is INCOMPLETE, never a clean NOT VERIFIED", () => {
  const record = acceptance.createAcceptanceRecord({ platform: "linux", log: () => {} });
  completeRun(record);
  record.report.error = "Electron exited during cleanup";
  assert.equal(record.finalize(), "INCOMPLETE");
  assert.equal(acceptance.exitCodeFor(record.report.status), acceptance.EXIT.INCOMPLETE);
  assert.equal(acceptance.finalizeStatus(record.report), "INCOMPLETE");
  // The same run without the error is the best 07a outcome.
  record.report.error = null;
  assert.equal(acceptance.finalizeStatus(record.report), "NOT VERIFIED");
});

test("only the conditional update-tag check is optional for completeness", () => {
  const all = Object.values(acceptance.CHECKS);
  assert.deepEqual(
    all.filter((name) => !acceptance.MANDATORY_CHECKS.includes(name)),
    [acceptance.CHECKS.controlUpdateTag]
  );
  const record = acceptance.createAcceptanceRecord({ log: () => {} });
  for (const name of acceptance.MANDATORY_CHECKS.slice(1)) record.verify(name, true, null);
  assert.equal(record.finalize(), "INCOMPLETE", "one mandatory check missing");
  record.verify(acceptance.MANDATORY_CHECKS[0], true, null);
  assert.equal(record.finalize(), "NOT VERIFIED");
});

test("renderer findings are recorded without aborting the run, and still fail it", () => {
  const lines = [];
  const record = acceptance.createAcceptanceRecord({ log: (line) => lines.push(line) });
  assert.equal(
    record.check(acceptance.CHECKS.rendererPopups, false, { window: "?panel=true" }),
    false
  );
  assert.equal(record.check(acceptance.CHECKS.rendererFrames, true, null), true);
  assert.deepEqual(
    record.report.observer.failed.map((entry) => [entry.name, entry.finding]),
    [[acceptance.CHECKS.rendererPopups, true]]
  );
  assert.ok(record.report.observer.passed.includes(acceptance.CHECKS.rendererFrames));
  // The run carries on to the sealed checks; a recorded finding still fails it.
  for (const name of acceptance.MANDATORY_CHECKS)
    if (name !== acceptance.CHECKS.rendererPopups) record.verify(name, true, null);
  assert.equal(record.finalize(), "FAIL");
  assert.equal(record.report.observerChecksComplete, true);
  assert.ok(lines.some((line) => line.startsWith("FINDING ")));
});

test("report honesty: nothingLeaves true, positive verified wording and a native pass are rejected", () => {
  const clean = acceptance.createAcceptanceRecord({ log: () => {} }).report;
  assert.deepEqual(acceptance.honestyViolations(clean), []);
  const cases = [
    { ...clean, runs: { boot: { attestation: { nothingLeaves: true } } } },
    { ...clean, scope: "the seal is verified" },
    { ...clean, nativeBoundary: { ...clean.nativeBoundary, reason: "Verified" } },
    { ...clean, observer: { ...clean.observer, passed: ["isolation verified"] } },
    { ...clean, observer: { ...clean.observer, failed: [{ name: "0 bytes left", detail: null }] } },
    { ...clean, runs: { verifiedSeal: true } },
    { ...clean, runs: { child: { isolated: true } } },
    { ...clean, runs: { child: { networkFree: true } } },
    { ...clean, status: "PASS" },
    { ...clean, status: "VERIFIED" },
    { ...clean, nativeBoundary: { ...clean.nativeBoundary, status: "PASS" } },
  ];
  for (const report of cases) assert.ok(acceptance.honestyViolations(report).length > 0);
  assert.deepEqual(
    acceptance.honestyViolations({
      ...clean,
      scope: "NOT VERIFIED; unverified; not verified",
    }),
    []
  );
});

test("echoed fixture data containing 'verified' or '0 bytes' does not discard the evidence", () => {
  const output = tempDir("echo");
  const record = acceptance.createAcceptanceRecord({ output, log: () => {} });
  completeRun(record);
  const hit = { at: 1, host: "api.loqui-fixture.test:1", path: "/verified-0 bytes", method: "GET" };
  record.report.remoteLog = { requests: [hit], connections: 1 };
  record.report.runs.open = { probes: { netFetch: "verified" }, note: "0 bytes" };
  record.report.observer.failed.push({
    name: acceptance.CHECKS.toggleNothingLeft,
    detail: { requests: [hit], connections: 1 },
  });
  record.report.error = `${acceptance.CHECKS.toggleNothingLeft}: {"path":"/verified"}`;
  record.finalize();
  assert.deepEqual(acceptance.honestyViolations(record.report), []);
  const written = acceptance.writeReport(output, record.report);
  assert.equal(written, record.report, "the report is written as-is");
  const saved = JSON.parse(fs.readFileSync(path.join(output, "report.json"), "utf8"));
  assert.equal(saved.status, "FAIL");
  assert.equal(saved.remoteLog.requests[0].path, "/verified-0 bytes");
  assert.equal(saved.observer.failed[0].detail.requests[0].path, "/verified-0 bytes");
  fs.rmSync(output, { recursive: true, force: true });
});

test("a dishonest report is never written as-is: it is replaced by a FAIL report", () => {
  const output = tempDir("honesty");
  const record = acceptance.createAcceptanceRecord({ output, log: () => {} });
  record.report.runs.boot = { attestation: { nothingLeaves: true, phase: "verified" } };
  record.finalize();
  const written = acceptance.writeReport(output, record.report);
  const text = fs.readFileSync(path.join(output, "report.json"), "utf8");
  assert.equal(written.status, "FAIL");
  assert.equal(JSON.parse(text).status, "FAIL");
  assert.doesNotMatch(text, /"nothingLeaves":\s*true/);
  assert.deepEqual(acceptance.honestyViolations(JSON.parse(text)), []);
  fs.rmSync(output, { recursive: true, force: true });
});

test("module registration is read from the binary without loading it", () => {
  const read = (text) =>
    acceptance.readModuleRegistration(Buffer.from(`\x7fELF\0\0${text}\0\0`, "latin1"));
  assert.deepEqual(read("napi_register_module_v1"), { kind: "napi", version: 1 });
  assert.deepEqual(read("node_register_module_v137"), { kind: "node", version: 137 });
  assert.equal(read("nothing here"), null);
});

test("prerequisites: a complete fake root with an N-API binding is ready", () => {
  const root = fakeRoot();
  const result = acceptance.inspectLaunchPrerequisites({ repoRoot: root, ...LINUX });
  assert.deepEqual(result.reasons, []);
  assert.equal(result.ready, true);
  assert.equal(
    result.electron.executablePath,
    path.join(root, "node_modules/electron/dist/electron")
  );
  assert.equal(result.electron.abi, 149);
  assert.deepEqual(result.sqlite.registration, { kind: "napi", version: 1 });
  assert.equal(electronLoaded(), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("prerequisites: missing Electron dist, mismatched SQLite ABI and the rest are named reasons", () => {
  const codes = (options, context = LINUX) => {
    const root = fakeRoot(options);
    try {
      return acceptance
        .inspectLaunchPrerequisites({ repoRoot: root, ...context })
        .reasons.map((reason) => reason.code);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
  assert.deepEqual(codes({ electron: false }), ["electron-binary-missing"]);
  assert.deepEqual(codes({ sqlite: "node_register_module_v137" }), ["sqlite-abi-mismatch"]);
  assert.deepEqual(codes({ sqlite: "node_register_module_v149" }), []);
  assert.deepEqual(
    codes({ sqlite: "node_register_module_v149", sqliteAt: "build/Release/better_sqlite3.node" }),
    []
  );
  assert.deepEqual(codes({ sqlite: "node_register_module_v149", electronAbi: null }), [
    "electron-abi-unknown",
  ]);
  assert.deepEqual(codes({ sqlite: "garbage" }), ["sqlite-abi-unknown"]);
  assert.deepEqual(codes({ sqlite: null }), ["sqlite-binding-missing"]);
  assert.deepEqual(codes({ renderer: false }), ["renderer-not-built"]);
  assert.deepEqual(codes({ playwright: false }), ["playwright-missing"]);
  assert.deepEqual(codes({}, { ...LINUX, env: {} }), ["display-missing"]);
  // The libc picks the prebuild, as better-sqlite3's loader does.
  assert.deepEqual(codes({}, { ...LINUX, libc: "musl" }), ["sqlite-binding-missing"]);
  assert.deepEqual(
    codes({ sqliteAt: "prebuilds/linuxmusl-x64.node" }, { ...LINUX, libc: "musl" }),
    []
  );
  // The prebuild wins over a stale node-gyp build, as better-sqlite3 loads it.
  const stale = fakeRoot();
  const release = path.join(stale, "node_modules/better-sqlite3/build/Release/better_sqlite3.node");
  fs.mkdirSync(path.dirname(release), { recursive: true });
  fs.writeFileSync(release, "\0node_register_module_v137\0");
  const preferred = acceptance.inspectLaunchPrerequisites({ repoRoot: stale, ...LINUX });
  assert.deepEqual(preferred.reasons, []);
  assert.equal(preferred.sqlite.file, "node_modules/better-sqlite3/prebuilds/linux-x64.node");
  fs.rmSync(stale, { recursive: true, force: true });
  // path.txt names a binary that is not there: still missing, never downloaded.
  const root = fakeRoot();
  fs.rmSync(path.join(root, "node_modules/electron/dist"), { recursive: true });
  assert.deepEqual(
    acceptance.inspectLaunchPrerequisites({ repoRoot: root, ...LINUX }).reasons.map((r) => r.code),
    ["electron-binary-missing"]
  );
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(electronLoaded(), false);
});

test("not-run: missing prerequisites exit non-zero with NOT RUN and a non-pass report", async () => {
  const output = tempDir("notrun");
  const root = tempDir("empty-root");
  const lines = [];
  const code = await acceptance.main({
    argv: ["--output-dir", output],
    repoRoot: root,
    env: {},
    platform: "linux",
    arch: "x64",
    libc: "glibc",
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  });
  assert.equal(code, acceptance.EXIT.NOT_RUN);
  assert.notEqual(code, 0);
  const notRunLine = lines.find((line) => line.startsWith("NOT RUN: "));
  assert.ok(notRunLine, lines.join("\n"));
  assert.match(notRunLine, /electron-binary-missing/);

  const text = fs.readFileSync(path.join(output, "report.json"), "utf8");
  const report = JSON.parse(text);
  assert.equal(report.status, "not-run");
  assert.deepEqual(report.notRun.reasons.map((reason) => reason.code).sort(), [
    "display-missing",
    "electron-binary-missing",
    "launch-not-authorized",
    "playwright-missing",
    "renderer-not-built",
    "sqlite-binding-missing",
  ]);
  assert.equal(report.observerChecksComplete, false);
  assert.equal(report.nativeBoundary.status, "NOT VERIFIED");
  assert.deepEqual(report.observer.passed, []);
  assert.deepEqual(report.nativeBoundary.blocked, []);
  assert.deepEqual(acceptance.honestyViolations(report), []);
  assert.doesNotMatch(text, /"nothingLeaves":\s*true/);
  assert.doesNotMatch(text, /"status":\s*"PASS"/);
  // The documented manual items travel with every report.
  const ids = report.pendingManual.map((item) => item.id);
  for (const id of [
    "STEP-4",
    "STEP-5",
    "STEP-5A",
    "T7a",
    "T7a-M2",
    "T11-M7",
    "T11a",
    "T9a-C5",
    "T10",
    "T7a-SMOKE",
    "OBS-PACKET",
  ])
    assert.ok(ids.includes(id), id);
  assert.equal(electronLoaded(), false, "the not-run path never loads Electron or Playwright");
  fs.rmSync(output, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test("not-run: an ABI-mismatched better-sqlite3 alone is detected up front", async () => {
  const output = tempDir("abi");
  const root = fakeRoot({ sqlite: "node_register_module_v137" });
  const lines = [];
  const code = await acceptance.main({
    argv: ["--output-dir", output, OPT_IN],
    repoRoot: root,
    ...LINUX,
    uid: 1000,
    runAcceptance: () => assert.fail("the runner must not start"),
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  });
  assert.equal(code, acceptance.EXIT.NOT_RUN);
  const report = JSON.parse(fs.readFileSync(path.join(output, "report.json"), "utf8"));
  assert.equal(report.status, "not-run");
  assert.deepEqual(
    report.notRun.reasons.map((reason) => reason.code),
    ["sqlite-abi-mismatch"]
  );
  assert.match(report.notRun.reasons[0].detail, /native:electron/);
  assert.equal(electronLoaded(), false);
  fs.rmSync(output, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test("cleanup runs every step in reverse, bounded, even when a step fails or hangs", async (t) => {
  const order = [];
  const cleanup = acceptance.createCleanup();
  cleanup.add("first", () => order.push("first"));
  cleanup.add("throws", () => {
    throw new Error("boom");
  });
  cleanup.add("hangs", () => new Promise(() => {}), 50);
  cleanup.add("last", async () => order.push("last"));
  const errors = await cleanup.run();
  assert.deepEqual(order, ["last", "first"]);
  assert.deepEqual(
    errors.map((entry) => entry.label),
    ["hangs", "throws"]
  );
  assert.deepEqual(await cleanup.run(), [], "steps run once");

  const fixture = await startEgressFixture();
  t.after(() => fixture.close());
  const guarded = acceptance.createCleanup();
  guarded.add("fixture", () => fixture.close());
  await assert.rejects(async () => {
    try {
      throw new Error("run failed");
    } finally {
      await guarded.run();
    }
  }, /run failed/);
  assert.equal(fixture.listening, false);
});

test("Chromium/Node URL parity table flags any host that parses differently", () => {
  const cases = acceptance.LOOPBACK_PARSE_CASES;
  assert.ok(cases.length >= 8);
  const same = cases.map((input) => acceptance.nodeUrlHost(input));
  assert.deepEqual(acceptance.compareUrlParsing(cases, same).mismatches, []);
  const skewed = [...same];
  skewed[0] = "evil.example";
  const { mismatches } = acceptance.compareUrlParsing(cases, skewed);
  assert.deepEqual(
    mismatches.map((row) => row.input),
    [cases[0]]
  );
  // A missing Chromium answer is a mismatch, never a match.
  assert.equal(acceptance.compareUrlParsing(cases, same.slice(0, -1)).mismatches.length, 1);
  assert.equal(acceptance.compareUrlParsing(cases, null).mismatches.length, cases.length);
});

test("the package script runs the acceptance launcher with Node", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:sealed-electron"], "node scripts/sealed-acceptance.cjs");
});

test("the acceptance script installs no network blockers of its own and owns no webRequest listener", () => {
  const source = fs.readFileSync(path.join(repoRoot, "scripts/sealed-acceptance.cjs"), "utf8");
  assert.doesNotMatch(source, /globalThis\.fetch\s*=/);
  assert.doesNotMatch(source, /client\[method\]\s*=/);
  assert.doesNotMatch(source, /webRequest\.on[A-Z]/);
  // Only the Electron bootstrap requires electron: under Node, requiring it
  // would run its installer and download a missing binary.
  const requires = [...source.matchAll(/require\("electron"\)/g)].map((match) => match.index);
  const bootstrap = source.indexOf("function bootstrapElectron(");
  const bootstrapEnd = source.indexOf("\n}\n", bootstrap);
  assert.equal(requires.length, 1);
  assert.ok(requires[0] > bootstrap && requires[0] < bootstrapEnd);
  const fixture = fs.readFileSync(path.join(repoRoot, "scripts/lib/egressFixture.cjs"), "utf8");
  assert.match(fixture, /listen\(0, "127\.0\.0\.1"/);
});

// --- Fix round 1: resolver rules, child gate, child env, launch gate, run exits ----------------

test("Chromium host-resolver rules map only fixture names and never touch numeric loopback", () => {
  assert.equal(
    acceptance.HOST_RESOLVER_RULES,
    `MAP *.${FIXTURE_DOMAIN} 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, ` +
      "EXCLUDE 127.0.0.1, EXCLUDE ::1, EXCLUDE [::1]"
  );
  // The exact argument the bootstrap appends to Electron's command line.
  assert.deepEqual(acceptance.chromiumSwitches(), [
    ["host-resolver-rules", acceptance.HOST_RESOLVER_RULES],
  ]);
  const map = (host) => acceptance.hostMappingFor(host);
  for (const host of ["127.0.0.1", "::1", "[::1]", "localhost"])
    assert.equal(map(host), null, host);
  for (const kind of ["api", "stream", "img", "updates", "preconnect"])
    assert.equal(map(`${kind}.${FIXTURE_DOMAIN}`), "127.0.0.1", kind);
  for (const host of ["example.com", "api.openai.com", FIXTURE_DOMAIN, "127.0.0.2"])
    assert.equal(map(host), "~NOTFOUND", host);
  // The model keeps Chromium's precedence: an exclusion beats every MAP rule.
  assert.equal(acceptance.hostMappingFor("127.0.0.1", "MAP * ~NOTFOUND"), "~NOTFOUND");
  assert.equal(acceptance.hostMappingFor("127.0.0.1", "MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"), null);
  const source = fs.readFileSync(path.join(repoRoot, "scripts/sealed-acceptance.cjs"), "utf8");
  assert.match(source, /for \(const \[name, value\] of chromiumSwitches\(\)\)/);
  assert.match(source, /appendSwitch\(name, value\)/);
});

test("child probes are allowed only when the profile says unsealed", () => {
  assert.equal(acceptance.childProbeAllowed(null), true, "no privacy.json: the default is open");
  assert.equal(acceptance.childProbeAllowed(JSON.stringify({ sealed: false })), true);
  for (const saved of [
    JSON.stringify({ sealed: true, sealedSince: 1 }),
    JSON.stringify({}),
    JSON.stringify({ sealed: "false" }),
    "null",
    "{not json",
    "",
  ])
    assert.equal(acceptance.childProbeAllowed(saved), false, saved);
  // The bootstrap consults the gate before it spawns anything.
  const source = fs.readFileSync(path.join(repoRoot, "scripts/sealed-acceptance.cjs"), "utf8");
  const start = source.indexOf("function startStubbornChild(");
  const gate = source.indexOf("childProbeAllowed(", start);
  const spawn = source.indexOf("spawn(", start);
  assert.ok(start > 0 && gate > start && spawn > gate, "gate before spawn");
});

test("the app under test gets an allowlisted environment with a temporary HOME and XDG dirs", () => {
  const base = {
    PATH: "/usr/bin",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    DISPLAY: ":99",
    XAUTHORITY: "/tmp/xvfb-run.AbC123/Xauthority",
    HOME: "/home/someone",
    XDG_CONFIG_HOME: "/home/someone/.config",
    XDG_DATA_HOME: "/home/someone/.local/share",
    XDG_RUNTIME_DIR: "/run/user/1000",
    WAYLAND_DISPLAY: "wayland-1",
    HYPRLAND_INSTANCE_SIGNATURE: "abc",
    HYPRLAND_CONFIG: "/home/someone/.config/hypr/hyprland.conf",
    XDG_CURRENT_DESKTOP: "Hyprland",
    XDG_SESSION_TYPE: "wayland",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    NODE_OPTIONS: "--require=/somewhere/safety.cjs",
    ELECTRON_RUN_AS_NODE: "1",
    OPENAI_API_KEY: "sk-test",
    CUSTOM_REASONING_API_KEY: "x",
    GH_TOKEN: "t",
    GITHUB_TOKEN: "t",
    AWS_SECRET_ACCESS_KEY: "s",
    SSH_AUTH_SOCK: "/run/user/1000/ssh",
    LOQUI_CHANNEL: "dev",
  };
  const frozen = JSON.stringify(base);
  const homeBefore = process.env.HOME;
  const sandbox = "/tmp/loqui-accept-sandbox";
  const { env, directories, runtimeDir } = acceptance.buildChildEnv({
    baseEnv: base,
    sandbox,
    profile: `${sandbox}/profile`,
    remotePort: 4001,
    localPort: 4002,
  });
  assert.equal(JSON.stringify(base), frozen, "the launcher's env is not changed");
  assert.equal(process.env.HOME, homeBefore, "the test runner's HOME is never repurposed");
  assert.deepEqual(Object.keys(env).sort(), [
    "DBUS_SESSION_BUS_ADDRESS",
    "DISPLAY",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOQUI_ACCEPT_LOCAL_PORT",
    "LOQUI_ACCEPT_PORT",
    "LOQUI_ACCEPT_SANDBOX",
    "LOQUI_CACHE_ROOT",
    "LOQUI_PROFILE_DIR",
    "NODE_ENV",
    "PATH",
    "TMPDIR",
    "XAUTHORITY",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
    "XDG_STATE_HOME",
  ]);
  for (const key of [
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "XDG_RUNTIME_DIR",
    "TMPDIR",
  ]) {
    assert.ok(env[key].startsWith(`${sandbox}/`), `${key}=${env[key]}`);
    assert.ok(directories.includes(env[key]), key);
  }
  assert.equal(runtimeDir, env.XDG_RUNTIME_DIR);
  assert.equal(env.DBUS_SESSION_BUS_ADDRESS, "disabled:");
  assert.equal(env.LOQUI_PROFILE_DIR, `${sandbox}/profile`);
  assert.equal(env.LOQUI_ACCEPT_PORT, "4001");
  assert.equal(env.LOQUI_ACCEPT_LOCAL_PORT, "4002");
  assert.doesNotMatch(JSON.stringify(env), /someone|sk-test|wayland|Hyprland|safety\.cjs/);

  const withBus = acceptance.buildChildEnv({
    baseEnv: { ...base, DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/dbus-XYZ,guid=1" },
    sandbox,
    profile: `${sandbox}/profile`,
    remotePort: 1,
    localPort: 2,
    allowSessionBus: true,
  });
  assert.equal(withBus.env.DBUS_SESSION_BUS_ADDRESS, "unix:path=/tmp/dbus-XYZ,guid=1");
});

test("the launch gate needs the explicit opt-in and an isolated display, and refuses root", () => {
  const codes = (argv, env, platform = "linux", uid = 1000) =>
    acceptance.assessLaunchSafety({ argv, env, platform, uid }).reasons.map((r) => r.code);
  assert.deepEqual(codes([OPT_IN], XVFB_ENV), []);
  assert.deepEqual(codes([], XVFB_ENV), ["launch-not-authorized"]);
  assert.deepEqual(codes(["--allow-launch"], XVFB_ENV), ["launch-not-authorized"]);
  // The live desktop: Wayland or Hyprland markers, or an X display without xvfb-run.
  assert.deepEqual(codes([OPT_IN], { ...XVFB_ENV, WAYLAND_DISPLAY: "wayland-1" }), [
    "live-session-display",
  ]);
  assert.deepEqual(codes([OPT_IN], { ...XVFB_ENV, HYPRLAND_INSTANCE_SIGNATURE: "abc" }), [
    "live-session-display",
  ]);
  assert.deepEqual(codes([OPT_IN], { DISPLAY: ":0" }), ["display-not-isolated"]);
  assert.deepEqual(codes([OPT_IN], { DISPLAY: ":0", XAUTHORITY: "/home/u/.Xauthority" }), [
    "display-not-isolated",
  ]);
  assert.deepEqual(codes([OPT_IN], { DISPLAY: ":1" }), ["display-not-isolated"]);
  // Chromium must never run as root (it would need its sandbox disabled).
  assert.deepEqual(codes([OPT_IN], XVFB_ENV, "linux", 0), ["running-as-root"]);
  // The session bus is forwarded only on request, and never the user's own bus.
  assert.deepEqual(
    codes([OPT_IN, "--allow-session-bus"], {
      ...XVFB_ENV,
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    }),
    ["session-bus-is-live"]
  );
  const privateBus = acceptance.assessLaunchSafety({
    argv: [OPT_IN, "--allow-session-bus"],
    env: { ...XVFB_ENV, DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/dbus-XYZ,guid=1" },
    platform: "linux",
    uid: 1000,
  });
  assert.deepEqual(privateBus.reasons, []);
  assert.equal(privateBus.allowSessionBus, true);
  // No Xvfb off Linux: a dedicated, disposable desktop user must be acknowledged.
  assert.deepEqual(codes([OPT_IN], {}, "darwin", 501), ["desktop-not-isolated"]);
  assert.deepEqual(codes([OPT_IN, "--dedicated-desktop-user"], {}, "darwin", 501), []);
  // Reason details name variables only, never their values.
  const live = acceptance.assessLaunchSafety({
    argv: [OPT_IN],
    env: { ...XVFB_ENV, HYPRLAND_INSTANCE_SIGNATURE: "secret-signature" },
    platform: "linux",
    uid: 1000,
  });
  assert.doesNotMatch(JSON.stringify(live), /secret-signature/);
});

test("Playwright launches Electron with Chromium's sandbox on and the allowlisted env", () => {
  const env = { PATH: "/usr/bin" };
  const options = acceptance.electronLaunchOptions({
    executablePath: "/x/electron",
    platform: "linux",
    env,
    root: "/repo",
    script: "/repo/scripts/sealed-acceptance.cjs",
  });
  assert.equal(options.chromiumSandbox, true);
  assert.ok(!options.args.includes("--no-sandbox"));
  assert.deepEqual(options.args, [
    "--lang=en-US",
    "--ozone-platform=x11",
    "/repo/scripts/sealed-acceptance.cjs",
  ]);
  assert.equal(options.env, env);
  assert.equal(options.executablePath, "/x/electron");
  assert.ok(options.timeout > 0);
  const mac = acceptance.electronLaunchOptions({
    executablePath: "/x/Electron",
    platform: "darwin",
    env,
    root: "/repo",
    script: "/s.cjs",
  });
  assert.deepEqual(mac.args, ["--lang=en-US", "/s.cjs"]);
});

test("every Playwright evaluate is bounded: a hung evaluate rejects and cleanup still runs", async () => {
  const hung = { evaluate: () => new Promise(() => {}) };
  const started = Date.now();
  await assert.rejects(
    acceptance.evaluateWithin(hung, () => 1, undefined, "hung attestation", 50),
    /hung attestation timed out/
  );
  assert.ok(Date.now() - started < 2000);
  const throwsSync = {
    evaluate: () => {
      throw new Error("target closed");
    },
  };
  await assert.rejects(
    acceptance.evaluateWithin(throwsSync, () => 1, undefined, "x", 50),
    /closed/
  );
  const echo = { evaluate: async (fn, arg) => ({ fn: typeof fn, arg }) };
  assert.deepEqual(await acceptance.evaluateWithin(echo, () => 1, "a", "echo", 50), {
    fn: "function",
    arg: "a",
  });
  const order = [];
  const cleanup = acceptance.createCleanup();
  cleanup.add("app", () => order.push("closed"));
  await assert.rejects(async () => {
    try {
      await acceptance.evaluateWithin(hung, () => 1, undefined, "frames", 50);
    } finally {
      await cleanup.run();
    }
  }, /frames timed out/);
  assert.deepEqual(order, ["closed"]);
  // The run path itself calls evaluate only through the bounded helper.
  const source = fs.readFileSync(path.join(repoRoot, "scripts/sealed-acceptance.cjs"), "utf8");
  const begin = source.indexOf("async function runElectronAcceptance(");
  const end = source.indexOf("\n}\n", begin);
  const runner = source.slice(begin, end);
  assert.ok(begin > 0 && runner.length > 1000);
  assert.doesNotMatch(runner, /\.evaluate\(/);
  assert.match(runner, /evaluateWithin\(/);
});

test("on abort the app closes before its netlog is copied", async () => {
  const order = [];
  const cleanup = acceptance.createCleanup();
  cleanup.add("remote fixture", () => order.push("fixture"));
  acceptance.registerLaunchCleanup(cleanup, "open", {
    close: async () => order.push("close open"),
    copyNetlog: () => order.push("netlog open"),
  });
  await cleanup.run();
  assert.deepEqual(order, ["close open", "netlog open", "fixture"]);
});

test("force-kill goes through the owned process handle and group, never a bare PID", () => {
  const calls = [];
  const handle = (state) => ({
    pid: 4242,
    exitCode: null,
    signalCode: null,
    ...state,
    kill: (signal) => calls.push(["handle", signal]),
  });
  const kill = (pid, signal) => calls.push(["group", pid, signal]);
  assert.equal(acceptance.forceKillOwnedGroup(handle({}), { platform: "linux", kill }), true);
  assert.deepEqual(calls, [
    ["group", -4242, "SIGKILL"],
    ["handle", "SIGKILL"],
  ]);
  calls.length = 0;
  // Once the handle has seen the exit, the PID may belong to someone else: no signal at all.
  assert.equal(acceptance.forceKillOwnedGroup(handle({ exitCode: 0 }), { kill }), false);
  assert.equal(acceptance.forceKillOwnedGroup(handle({ signalCode: "SIGKILL" }), { kill }), false);
  assert.equal(acceptance.forceKillOwnedGroup(null, { kill }), false);
  assert.deepEqual(calls, []);
  const source = fs.readFileSync(path.join(repoRoot, "scripts/sealed-acceptance.cjs"), "utf8");
  assert.doesNotMatch(source, /process\.kill\(pid,\s*"SIGKILL"\)/);
  assert.doesNotMatch(source, /process\.kill\(\s*(?!-)[a-zA-Z_.]*pid\b[^,]*,\s*"SIG(KILL|TERM)"/i);
});

test("the checklist carries the Task 7a desktop smoke (fixture-only downloads) and packet capture", () => {
  const byId = Object.fromEntries(acceptance.MANUAL_CHECKLIST.map((item) => [item.id, item]));
  const smoke = byId["T7a-SMOKE"];
  assert.ok(smoke, "T7a-SMOKE present");
  for (const words of [
    /Settings/,
    /notes/,
    /chat/,
    /History playback/,
    /upload/,
    /drag-and-drop/,
    /image attachments/,
    /model downloads/i,
    /sandbox/,
    /web security/,
    /temporary profile/,
  ])
    assert.match(smoke.check, words);
  assert.match(smoke.check, /fixture only/i);
  assert.match(smoke.check, /never a real model host/i);
  const packet = byId["OBS-PACKET"];
  assert.ok(packet, "OBS-PACKET present");
  assert.match(packet.check, /packet/i);
  assert.match(packet.check, /real hostnames/i);
  assert.match(byId["STEP-4"].check, /controlLoopback|loopback/);
  assert.match(byId["STEP-4"].check, /--i-understand-this-launches-electron/);
});

// --- main(): the completed-run, crashed-run and refused paths, with an injected runner ---------

async function runMain({ argv = [OPT_IN], env = XVFB_ENV, uid = 1000, runAcceptance } = {}) {
  const output = tempDir("main");
  const root = fakeRoot();
  const lines = [];
  let calls = 0;
  try {
    const code = await acceptance.main({
      argv: ["--output-dir", output, ...argv],
      repoRoot: root,
      env,
      platform: "linux",
      arch: "x64",
      libc: "glibc",
      uid,
      runAcceptance: async (context) => {
        calls += 1;
        return runAcceptance(context);
      },
      log: (line) => lines.push(line),
      error: (line) => lines.push(String(line)),
    });
    const report = JSON.parse(fs.readFileSync(path.join(output, "report.json"), "utf8"));
    return { code, report, lines, calls };
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("main: a completed clean run is NOT VERIFIED with exit 3, complete checks and native blocks", async () => {
  const { code, report, calls } = await runMain({
    runAcceptance: ({ record, safety }) => {
      assert.equal(safety.allowSessionBus, false);
      completeRun(record);
    },
  });
  assert.equal(calls, 1);
  assert.equal(code, acceptance.EXIT.NOT_VERIFIED);
  assert.equal(code, 3);
  assert.equal(report.status, "NOT VERIFIED");
  assert.equal(report.observerChecksComplete, true);
  assert.equal(report.error, null);
  assert.deepEqual(report.observer.failed, []);
  assert.deepEqual(
    report.nativeBoundary.blocked.map((entry) => [entry.run, entry.status]),
    [
      ["toggle", "NOT VERIFIED"],
      ["boot", "NOT VERIFIED"],
    ]
  );
  assert.deepEqual(acceptance.honestyViolations(report), []);
});

test("main: a crash after every check is INCOMPLETE with exit 4 and the error recorded", async () => {
  const { code, report } = await runMain({
    runAcceptance: ({ record }) => {
      completeRun(record);
      throw new Error("Electron exited unexpectedly");
    },
  });
  assert.equal(code, acceptance.EXIT.INCOMPLETE);
  assert.equal(code, 4);
  assert.equal(report.status, "INCOMPLETE");
  assert.match(report.error, /Electron exited unexpectedly/);
  assert.equal(report.observerChecksComplete, true);
});

test("main: an early crash or a runner that stops early is INCOMPLETE, not NOT VERIFIED", async () => {
  const crashed = await runMain({
    runAcceptance: () => {
      throw new Error("launch timed out");
    },
  });
  assert.equal(crashed.code, 4);
  assert.equal(crashed.report.status, "INCOMPLETE");
  assert.equal(crashed.report.observerChecksComplete, false);
  const partial = await runMain({
    runAcceptance: ({ record }) => record.verify(acceptance.CHECKS.controlStartsOpen, true, null),
  });
  assert.equal(partial.code, 4);
  assert.equal(partial.report.status, "INCOMPLETE");
  assert.equal(partial.report.error, null);
  assert.equal(partial.report.observerChecksComplete, false);
});

test("main: an observer failure is FAIL with exit 1, even when the run then crashes", async () => {
  const { code, report } = await runMain({
    runAcceptance: ({ record }) => {
      record.verify(acceptance.CHECKS.controlStartsOpen, true, null);
      record.verify(acceptance.CHECKS.toggleNothingLeft, false, { requests: [{ path: "/ws-x" }] });
    },
  });
  assert.equal(code, acceptance.EXIT.FAIL);
  assert.equal(code, 1);
  assert.equal(report.status, "FAIL");
  assert.equal(report.observer.failed[0].name, acceptance.CHECKS.toggleNothingLeft);
  assert.match(report.error, /no request and no connection after sealing/);
});

test("main: without the opt-in, on the live desktop or as root nothing is launched", async () => {
  const never = () => assert.fail("the runner must not start");
  const cases = [
    [{ argv: [] }, "launch-not-authorized"],
    [{ env: { ...XVFB_ENV, WAYLAND_DISPLAY: "wayland-1" } }, "live-session-display"],
    [{ env: { DISPLAY: ":0" } }, "display-not-isolated"],
    [{ uid: 0 }, "running-as-root"],
  ];
  for (const [options, reason] of cases) {
    const { code, report, calls, lines } = await runMain({ ...options, runAcceptance: never });
    assert.equal(calls, 0, reason);
    assert.equal(code, acceptance.EXIT.NOT_RUN, reason);
    assert.equal(report.status, "not-run");
    assert.deepEqual(
      report.notRun.reasons.map((entry) => entry.code),
      [reason]
    );
    assert.ok(lines.some((line) => line.startsWith("NOT RUN: ") && line.includes(reason)));
  }
  assert.equal(electronLoaded(), false);
});
