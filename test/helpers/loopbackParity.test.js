const assert = require("node:assert/strict");
const net = require("node:net");
const test = require("node:test");
const cases = require("../fixtures/loopbackCases.json");
const { isLoopbackHost, hostOf } = require("../../src/helpers/privacy/egressPolicy");
const { makeSnapshot } = require("../lib/routeFixtures");

// Plan 07 Task 11a: one loopback rule. Main's egress policy decides what Sealed
// mode lets through; the renderer's locality rule decides which routes are the
// device. Both read the same table, and a generated corpus of adversarial
// spellings holds the two implementations equal beyond it.
const main = (url) => isLoopbackHost(hostOf(url));
const locality = () => import("../../src/lib/locality.ts");

test("main and the route graph agree on every shared loopback case", async () => {
  const { isLoopbackUrl, isLoopbackHostname } = await locality();
  for (const [list, expected] of [
    [cases.urls.loopback, true],
    [cases.urls.notLoopback, false],
  ]) {
    for (const url of list) {
      assert.equal(main(url), expected, `main: ${JSON.stringify(url)}`);
      assert.equal(isLoopbackUrl(url), expected, `renderer: ${JSON.stringify(url)}`);
    }
  }
  for (const [list, expected] of [
    [cases.hosts.loopback, true],
    [cases.hosts.notLoopback, false],
  ]) {
    for (const host of list) {
      assert.equal(isLoopbackHost(host), expected, `main: ${JSON.stringify(host)}`);
      assert.equal(isLoopbackHostname(host), expected, `renderer: ${JSON.stringify(host)}`);
    }
  }
  for (const empty of [null, undefined, ""]) {
    assert.equal(isLoopbackUrl(empty), false);
    assert.equal(isLoopbackHostname(empty), false);
  }
});

const SCHEMES = ["http://", "https://", "ws://", "HTTP://", "http:", "http:/", "ftp://"];
const USERINFO = ["", "u@", "u:p@", "127.0.0.1@", "evil.example@", "localhost:1@", "@"];
const HOSTS = [
  "localhost",
  "LocalHost",
  "localhost.",
  "LOCALHOST.",
  "foo.localhost",
  "a.b.localhost",
  ".localhost",
  "localhost..",
  "localhost.evil.example",
  "xn--localhost-",
  "\u24dbocalhost",
  "local\thost",
  "local%68ost",
  "127.0.0.1",
  "127.0.0.2",
  "127.255.255.255",
  "127.0.0.1.",
  "127.1",
  "127.0.1",
  "0x7f.0.0.1",
  "0x7f000001",
  "2130706433",
  "0177.0.0.1",
  "127.000.0.1",
  "017700000001",
  "%31%32%37.0.0.1",
  "127.0.0.1.nip.io",
  "128.0.0.1",
  "192.168.1.5",
  "10.0.0.1",
  "0.0.0.0",
  "0",
  "evil.example",
  "[::1]",
  "[0:0:0:0:0:0:0:1]",
  "[0000:0000:0000:0000:0000:0000:0000:0001]",
  "[::0:1]",
  "[::ffff:127.0.0.1]",
  "[::ffff:127.1.2.3]",
  "[::ffff:7f00:1]",
  "[::ffff:7f00:ffff]",
  "[::FFFF:7F00:1]",
  "[0:0:0:0:0:ffff:7f00:1]",
  "[::ffff:192.168.0.1]",
  "[::ffff:a00:1]",
  "[::ffff:8000:1]",
  "[::127.0.0.1]",
  "[64:ff9b::127.0.0.1]",
  "[::2]",
  "[::]",
  "[::1].",
  "[::1",
  "[::1%25lo]",
  "[fe80::1%25eth0]",
  "[2001:db8::1]",
  "localhost\\",
  "127.0.0.1\\@evil.example",
  "",
];
const PORTS = ["", ":", ":0", ":8080", ":65535", ":65536", ":bad", ":08080"];
const SUFFIXES = ["", "/", "/v1?q=1", "#f", "\\v1", "\\@evil.example/", " "];

function* corpus() {
  for (const scheme of SCHEMES)
    for (const userinfo of USERINFO)
      for (const host of HOSTS)
        for (const port of PORTS)
          for (const suffix of SUFFIXES) yield `${scheme}${userinfo}${host}${port}${suffix}`;
}

test("main and the route graph agree on a generated corpus of adversarial URLs", async () => {
  const { isLoopbackUrl } = await locality();
  let count = 0;
  let loopback = 0;
  const disagreements = [];
  for (const url of corpus()) {
    count++;
    const expected = main(url);
    if (expected) loopback++;
    if (isLoopbackUrl(url) !== expected && disagreements.length < 20)
      disagreements.push({ url, main: expected });
  }
  assert.deepEqual(disagreements, []);
  // The corpus must exercise both answers, or agreement proves nothing.
  assert.ok(count > 100000, `corpus size ${count}`);
  assert.ok(loopback > 1000, `loopback cases ${loopback}`);
  assert.ok(count - loopback > 1000, `non-loopback cases ${count - loopback}`);
});

test("main and the renderer agree on bare hosts, and the renderer's IP grammar is Node's", async () => {
  const { isLoopbackHostname, ipLiteralVersion } = await locality();
  const extras = [
    "::1%lo",
    "::1%",
    "fe80::1%eth0",
    "::ffff:127.0.0.1%lo",
    "1::",
    "1:2:3:4:5:6:7:8",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:1.2.3.4",
    "::1.2.3.4",
    ":::1",
    "1::2::3",
    "::ffff:127.0.0.01",
    "::ffff:256.0.0.1",
    "00127.0.0.1",
    "255.255.255.255",
    "256.0.0.0",
    "1.2.3",
    "1.2.3.4.5",
    "01.2.3.4",
  ];
  const hosts = new Set(extras);
  for (const host of HOSTS)
    for (const port of PORTS) {
      hosts.add(`${host}${port}`);
      hosts.add(` ${host}${port}`);
      hosts.add(`${host}${port}.`);
      if (host.startsWith("[")) hosts.add(host.slice(1, -1));
    }
  const disagreements = [];
  for (const host of hosts) {
    if (isLoopbackHostname(host) !== isLoopbackHost(host))
      disagreements.push({ host, main: isLoopbackHost(host) });
    if (ipLiteralVersion(host) !== net.isIP(host))
      disagreements.push({ host, isIP: net.isIP(host), renderer: ipLiteralVersion(host) });
  }
  assert.deepEqual(disagreements, []);
});

test("a self-hosted server on any loopback form is the device, so Sealed mode keeps it", async () => {
  const { resolveLocality } = await locality();
  for (const url of cases.urls.loopback)
    assert.equal(resolveLocality({ mode: "self-hosted", remoteUrl: url }).locality, "device", url);
  // Like the route graph and the executors, locality reads the trimmed URL.
  for (const url of cases.urls.notLoopback)
    assert.equal(
      resolveLocality({ mode: "self-hosted", remoteUrl: url }).locality,
      main(url.trim()) ? "device" : "network",
      JSON.stringify(url)
    );
  assert.equal(
    resolveLocality({ mode: "self-hosted", remoteUrl: " http://127.0.0.1/" }).locality,
    "device"
  );
});

test("the route graph keeps a valid endpoint only when main would let it through sealed", async () => {
  const { resolveRoutes, isValidTextEndpoint } = await import("../../src/lib/routeGraph.ts");
  const translation = (remoteUrl, sealed) =>
    resolveRoutes(
      makeSnapshot({
        sealed,
        llm: { dictationTranslation: { mode: "self-hosted", remoteUrl, model: "llama3.1:8b" } },
      })
    ).find((route) => route.id === "translation");
  let checked = 0;
  for (const url of [...cases.urls.loopback, ...cases.urls.notLoopback]) {
    // Validity (HTTPS or a private host for plain HTTP) is the executors' own
    // separate question; locality only applies to an endpoint they accept.
    if (!isValidTextEndpoint(url.trim())) continue;
    checked++;
    const route = translation(url, true);
    assert.equal(route.locality === "device", main(url.trim()), JSON.stringify(url));
    if (main(url.trim())) {
      assert.deepEqual(route.state, { status: "ready" }, `sealed keeps ${url}`);
      assert.equal(route.host, new URL(url.trim()).host, `configured host kept for ${url}`);
    } else {
      assert.deepEqual(route.state, { status: "unreachable", detail: "sealed" }, url);
    }
  }
  assert.ok(checked >= 10, `valid endpoints checked: ${checked}`);

  // Change-driving cases where Plan 01's rule disagreed with main.
  for (const url of [
    "http://127.0.0.2:9000/v1",
    "https://[::ffff:127.0.0.1]:8443/v1",
    "https://[0:0:0:0:0:0:0:1]:8443/v1",
    "https://localhost.:8443/v1",
  ]) {
    const route = translation(url, true);
    assert.equal(route.locality, "device", url);
    assert.deepEqual(route.state, { status: "ready" }, url);
  }
  // 127.1 is a valid private HTTP host for the executors, but main refuses the
  // spelling while sealed, so the graph must not promise it.
  const octets = translation("http://127.1:8080/v1", false);
  assert.equal(octets.locality, "network");
  assert.deepEqual(octets.state, { status: "ready" });
  assert.deepEqual(translation("http://127.1:8080/v1", true).state, {
    status: "unreachable",
    detail: "sealed",
  });
});
