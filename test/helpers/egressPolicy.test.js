const assert = require("node:assert/strict");
const test = require("node:test");
const policy = require("../../src/helpers/privacy/egressPolicy");

test("task ids: the 11 route ids first, then the non-route purposes", () => {
  assert.deepEqual(policy.ROUTE_TASKS, [
    "dictationStt",
    "noteRecordingStt",
    "uploadStt",
    "dictationCleanup",
    "voiceAssistant",
    "assistantVision",
    "translation",
    "noteFormatting",
    "chat",
    "speakerId",
    "semanticSearch",
  ]);
  assert.deepEqual(policy.PURPOSE_TASKS, [
    "providerCheck",
    "modelDownload",
    "runtimeDownload",
    "urlImport",
    "appUpdate",
    "codex",
    "calendar",
    "unattributed",
  ]);
  assert.equal(policy.EGRESS_TASKS.length, 19);
  assert.ok(policy.EGRESS_TASKS.includes("unattributed"));
});

test("inference scopes map to route tasks; unknown scopes are unattributed", () => {
  assert.equal(policy.taskForScope("dictationCleanup"), "dictationCleanup");
  assert.equal(policy.taskForScope("dictationAgent"), "voiceAssistant");
  assert.equal(policy.taskForScope("dictationAgentVision"), "assistantVision");
  assert.equal(policy.taskForScope("noteFormatting"), "noteFormatting");
  assert.equal(policy.taskForScope("chatIntelligence"), "chat");
  assert.equal(policy.taskForScope("dictationTranslation"), "translation");
  assert.equal(policy.taskForScope("somethingNew"), "unattributed");
});

test("hostOf reduces valid targets to a bare lowercase host", () => {
  assert.equal(
    policy.hostOf("https://user:pw@API.OpenAI.com/v1/chat?q=secret#x"),
    "api.openai.com"
  );
  assert.equal(policy.hostOf(new URL("http://[::1]:8080/v1")), "::1");
  assert.equal(policy.hostOf("http://[0:0:0:0:0:0:0:1]/"), "::1");
  assert.equal(policy.hostOf("http://[::ffff:127.0.0.1]/"), "::ffff:7f00:1");
  assert.equal(policy.hostOf({ hostname: "Example.COM." }), "example.com");
  assert.equal(policy.hostOf({ host: "example.com:443" }), "example.com");
  for (const malformed of [
    "not a url",
    "http://127.0.0.1:bad/",
    "http://127.0.0.1:99999/",
    "http://user@/",
  ]) {
    assert.equal(policy.hostOf(malformed), null, malformed);
  }
  assert.equal(policy.hostOf(undefined), null);
  assert.equal(policy.hostOf({ host: "user@127.0.0.1/path?x" }), null);
  assert.equal(policy.hostOf({ hostname: "example.com" }), "example.com");
});

test("hostOf rejects authorities whose raw spelling disagrees with WHATWG URL parsing", () => {
  const ambiguous = [
    String.raw`https://remote.invalid\@localhost/`,
    "https://remote.invalid\n@localhost/",
    "https://remote.invalid\t@localhost/",
  ];
  for (const target of ambiguous) {
    assert.equal(policy.hostOf(target), null, target);
    assert.deepEqual(policy.decideEgress({ sealed: true, target }), {
      allow: false,
      host: "unknown",
      loopback: false,
      reason: "sealed",
    });
  }
  assert.equal(policy.hostOf("https://user:pw@localhost:8080/path"), "localhost");
});

test("loopback classification covers canonical IPv6 and mapped IPv4 127/8 only", () => {
  for (const host of [
    "localhost",
    "LOCALHOST.",
    "app.localhost",
    "127.0.0.2",
    "127.255.255.254",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "0:0:0:0:0:ffff:127.0.0.1",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:7f00:1",
    "::ffff:7f00:ffff",
  ])
    assert.equal(policy.isLoopbackHost(host), true, host);
  for (const host of [
    "192.168.1.5",
    "localhost.evil.example",
    "127.0.0.1.nip.io",
    "0.0.0.0",
    "::",
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "2001:db8::1",
    "127.0.0.1:bad",
  ])
    assert.equal(policy.isLoopbackHost(host), false, host);
  assert.equal(policy.isLoopbackHost(null), false);
  assert.equal(policy.isLoopbackHost(""), false);
});

test("decideEgress: validated loopback is allowed; malformed fails closed sealed", () => {
  assert.deepEqual(policy.decideEgress({ sealed: true, target: "http://127.0.0.1:8080/v1" }), {
    allow: true,
    host: "127.0.0.1",
    loopback: true,
    reason: "loopback",
  });
  assert.deepEqual(policy.decideEgress({ sealed: true, target: "https://api.groq.com/x" }), {
    allow: false,
    host: "api.groq.com",
    loopback: false,
    reason: "sealed",
  });
  assert.deepEqual(policy.decideEgress({ sealed: false, target: "https://api.groq.com/x" }), {
    allow: true,
    host: "api.groq.com",
    loopback: false,
    reason: "unsealed",
  });
  assert.equal(policy.decideEgress({ sealed: true, target: "%%%" }).allow, false);
  assert.equal(policy.decideEgress({ sealed: true, target: "%%%" }).host, "unknown");
  assert.equal(policy.decideEgress({ sealed: true, target: "http://127.0.0.1:bad" }).allow, false);
  assert.equal(
    policy.decideEgress({ sealed: true, target: "http://127.0.0.1:99999" }).allow,
    false
  );
});

test("SealedModeError survives IPC message-only serialization and fetch causes", () => {
  const error = new policy.SealedModeError({ task: "chat", host: "api.groq.com" });
  assert.equal(error.code, "SEALED_MODE");
  assert.equal(error.messageKey, "sealedMode.blocked.generic");
  assert.deepEqual(error.details, { task: "chat", host: "api.groq.com", phase: "refused" });
  assert.match(error.message, /\[SEALED_MODE\]/);
  assert.equal(
    policy.isSealedModeError(new Error(`Error invoking remote method: ${error.message}`)),
    true
  );
  assert.equal(policy.isSealedModeError(new TypeError("fetch failed", { cause: error })), true);
  assert.equal(policy.isSealedModeError(new Error("ECONNREFUSED")), false);
  assert.equal(policy.isSealedModeError(null), false);
  const deep = new Error("outer", {
    cause: new Error("middle", { cause: new Error("inner", { cause: error }) }),
  });
  assert.equal(policy.isSealedModeError(deep), true);
});

test("interrupted phase survives wrappers and never claims nothing was sent", () => {
  const cut = new policy.SealedModeError({
    task: "chat",
    host: "api.groq.com",
    phase: "interrupted",
  });
  assert.equal(cut.messageKey, "sealedMode.interrupted.generic");
  assert.match(cut.message, /\[SEALED_MODE:interrupted\]/);
  assert.equal(policy.sealedPhaseOf(cut), "interrupted");
  assert.equal(policy.sealedPhaseOf(new Error(`remote: ${cut.message}`)), "interrupted");
  assert.equal(
    policy.sealedPhaseOf(new policy.SealedModeError({ task: "chat", host: "x" })),
    "refused"
  );
  assert.equal(policy.sealedPhaseOf(new Error("timeout")), null);
  assert.equal(policy.sealedPhaseOf(new Error("outer", { cause: cut })), "interrupted");
  const codeOnlyWrapper = Object.assign(new Error("request failed", { cause: cut }), {
    code: policy.SEALED_MODE,
  });
  assert.equal(policy.sealedPhaseOf(codeOnlyWrapper), "interrupted");
  const explicitRefusalWrapper = Object.assign(new Error("outer [SEALED_MODE]", { cause: cut }), {
    code: policy.SEALED_MODE,
  });
  assert.equal(policy.sealedPhaseOf(explicitRefusalWrapper), "refused");
  const tooDeep = new Error("outer", {
    cause: new Error("middle", {
      cause: new Error("inner", {
        cause: new Error("deep", {
          cause: Object.assign(new Error("wrapper"), {
            code: policy.SEALED_MODE,
            cause: cut,
          }),
        }),
      }),
    }),
  });
  assert.equal(policy.sealedPhaseOf(tooDeep), null);
  assert.equal(
    policy.sealedPhaseOf(
      new Error("outer", { cause: new Error("middle", { cause: new Error(`ipc ${cut.message}`) }) })
    ),
    "interrupted"
  );
});
