const assert = require("node:assert/strict");
const test = require("node:test");
const gate = require("../../src/helpers/privacy/egressGate");
const { createDisclosureTracker } = require("../../src/helpers/dictationDisclosure");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");

function setup(t, { sealed = false } = {}) {
  const flags = { sealed };
  let clock = 1000;
  const recorder = new FlightRecorder({ now: () => clock });
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => clock });
  t.after(() => gate._resetForTests());
  return { flags, recorder, tick: (ms) => (clock += ms) };
}
const nextTurn = () => new Promise((r) => setImmediate(r));
const notices = () => {
  const seen = [];
  for (const phase of ["dispatched", "delivered", "undelivered"])
    gate.events.on(phase, (n) => seen.push({ phase, ...n }));
  return seen;
};

test("a sealed gate refuses a remote target and records 0 bytes", (t) => {
  const { recorder } = setup(t, { sealed: true });
  assert.throws(
    () =>
      gate.authorize({
        task: "chat",
        target: "https://api.groq.com/openai/v1",
        model: "gpt-oss-120b",
      }),
    (error) =>
      isSealedModeError(error) &&
      sealedPhaseOf(error) === "refused" &&
      error.details.host === "api.groq.com"
  );
  const [row] = recorder.list();
  assert.deepEqual(
    [row.outcome, row.bytesOut, row.bytesIn, row.errorClass, row.model],
    ["blocked", 0, 0, "SEALED_MODE", "gpt-oss-120b"]
  );
  assert.equal(gate.counters().blockedSinceSealed, 1);
});

test("loopback is allowed while sealed, never recorded and never announced", async (t) => {
  const { recorder } = setup(t, { sealed: true });
  const seen = notices();
  await gate.guard(
    { task: "dictationCleanup", target: "http://127.0.0.1:8080/v1" },
    async (ticket) => {
      await gate.meteredFetch(ticket, async () => new Response("ok"))("http://127.0.0.1:8080/v1", {
        body: "x",
      });
    }
  );
  assert.equal(recorder.list().length, 0);
  assert.deepEqual(seen, []);
});

test("a request records its own start and end, body bytes, status and host trail", async (t) => {
  const { recorder, tick } = setup(t);
  let operationId;
  await gate.guard(
    { task: "chat", target: "https://api.groq.com/x", model: "m" },
    async (ticket) => {
      operationId = ticket.id;
      tick(250);
      const res = await gate.meteredFetch(ticket, async () => {
        ticket.addHost("edge.groq.com"); // a socket the backstop saw during this request
        tick(50);
        return new Response("hello world", { status: 200 });
      })("https://api.groq.com/x", { method: "POST", body: "12345" });
      await res.text();
    }
  );
  const rows = recorder.list();
  assert.equal(rows.length, 1, "one request, one row; the operation adds none");
  assert.deepEqual(
    [
      rows[0].kind,
      rows[0].operationId,
      rows[0].ts,
      rows[0].endedAt,
      rows[0].outcome,
      rows[0].bytesOut,
      rows[0].bytesIn,
      rows[0].status,
      rows[0].hosts,
    ],
    ["request", operationId, 1250, 1300, "ok", 5, 11, 200, ["api.groq.com", "edge.groq.com"]]
  );
});

test("two requests in one operation are two rows; a failed retry never withdraws earlier delivery", async (t) => {
  const { recorder } = setup(t);
  const seen = notices();
  let calls = 0;
  const transport = async () => {
    calls++;
    if (calls === 2)
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    return new Response("{}", { status: 200 });
  };
  await assert.rejects(
    gate.guard(
      {
        task: "chat",
        target: "https://api.groq.com",
        provider: "groq",
        payload: "text",
        correlationId: "s-1",
      },
      async (ticket) => {
        await (
          await gate.meteredFetch(ticket, transport)("https://api.groq.com/a", { body: "x" })
        ).text();
        await gate.meteredFetch(ticket, transport)("https://cdn.groq.com/b", { body: "y" });
      }
    )
  );
  const rows = recorder.list().reverse(); // oldest first
  assert.deepEqual(
    rows.map((r) => [r.kind, r.host, r.outcome, r.errorClass]),
    [
      ["request", "api.groq.com", "ok", null],
      ["request", "cdn.groq.com", "error", "CONNECTION"],
    ]
  );
  assert.equal(rows[0].operationId, rows[1].operationId);
  assert.deepEqual(
    seen.map((n) => n.phase),
    ["dispatched", "delivered", "dispatched", "undelivered"],
    "only the failed attempt is withdrawn"
  );
  assert.equal(recorder.summary({ since: 0 }).observed, 2);
});

test("an operation that fails before any transport is kept, but never counted as having left", async (t) => {
  const { recorder } = setup(t);
  await assert.rejects(
    gate.guard({ task: "chat", target: "https://api.groq.com" }, async () => {
      throw new Error("model construction failed");
    })
  );
  assert.deepEqual(
    [recorder.list()[0].kind, recorder.list()[0].errorClass],
    ["operation", "OTHER"]
  );
  assert.equal(recorder.summary({ since: 0 }).left, 0);
});

test("an SDK operation that took no metered fetch is recorded as a connection, not a request", async (t) => {
  const { recorder } = setup(t);
  await gate.guard(
    { task: "noteFormatting", target: "https://bedrock-runtime.us-east-1.amazonaws.com" },
    async (ticket) => {
      ticket.noteConnection(); // what the backstop does for a socket in this context
    }
  );
  assert.equal(recorder.list()[0].kind, "connection");
  assert.deepEqual(
    [recorder.summary({ since: 0 }).observed, recorder.summary({ since: 0 }).connections],
    [0, 1]
  );
});

test("unmeasured bodies are unknown, not 0: bodyless GET, stream body, 204", async (t) => {
  const { recorder } = setup(t);
  await gate.guard({ task: "providerCheck", target: "https://api.groq.com" }, (ticket) =>
    gate.meteredFetch(
      ticket,
      async () => new Response(null, { status: 204 })
    )("https://api.groq.com/models")
  );
  await gate.guard({ task: "chat", target: "https://api.groq.com" }, (ticket) =>
    gate.meteredFetch(ticket, async () => new Response(null, { status: 204 }))(
      "https://api.groq.com/x",
      { body: new ReadableStream() }
    )
  );
  for (const row of recorder.list()) assert.deepEqual([row.bytesOut, row.bytesIn], [null, null]);
});

test("a body not fully read inside guard() is recorded as unknown, and the request as delivered", async (t) => {
  const { recorder } = setup(t);
  await gate.guard({ task: "providerCheck", target: "https://api.groq.com" }, (ticket) =>
    gate.meteredFetch(
      ticket,
      async () => new Response("a long body", { status: 200 })
    )("https://api.groq.com/models")
  );
  assert.deepEqual(
    [recorder.list()[0].bytesIn, recorder.list()[0].outcome, recorder.list()[0].status],
    [null, "ok", 200]
  );
});

test("dispatched, then delivered; a connect failure is undelivered, never delivered", async (t) => {
  setup(t);
  const seen = notices();
  const ticket = gate.authorize({
    task: "dictationStt",
    target: "https://api.openai.com",
    provider: "openai",
    payload: "audio",
    correlationId: "rec-1",
  });
  assert.deepEqual(seen, [], "authorisation alone is not dispatch");
  await gate.meteredFetch(ticket, async () => new Response("{}"))(
    "https://api.openai.com/v1/audio",
    { method: "POST", body: "abc" }
  );
  assert.deepEqual(
    seen.map((n) => [n.phase, n.targetId, n.payload, n.correlationId, n.attemptId]),
    [
      ["dispatched", "openai", "audio", "rec-1", `${ticket.id}.1`],
      ["delivered", "openai", "audio", "rec-1", `${ticket.id}.1`],
    ]
  );
  ticket.discard();

  seen.length = 0;
  const refused = gate.authorize({
    task: "chat",
    target: "http://192.168.1.5:8080/v1",
    provider: "lan",
    payload: "text",
  });
  await assert.rejects(
    gate.meteredFetch(refused, async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    })("http://192.168.1.5:8080/v1", { body: "x" })
  );
  assert.deepEqual(
    seen.map((n) => [n.phase, n.targetId]),
    [
      ["dispatched", "host:192.168.1.5"],
      ["undelivered", "host:192.168.1.5"],
    ]
  );
  refused.discard();
});

test("notice receipt ids are numeric, unique across operations, and stable across each receipt", async (t) => {
  setup(t);
  const seen = notices();
  const metered = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  const manual = gate.authorize({ task: "calendar", target: "https://graph.microsoft.com" });

  await gate.meteredFetch(
    metered,
    async () => new Response(null, { status: 204 })
  )("https://first.invalid");
  manual.markDelivered();
  await assert.rejects(
    gate.meteredFetch(metered, async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    })("https://second.invalid")
  );

  assert.equal(
    seen.every((notice) => Number.isSafeInteger(notice.ticketId)),
    true
  );
  const receipts = seen.filter((notice) => notice.phase === "dispatched");
  assert.equal(new Set(receipts.map((notice) => notice.ticketId)).size, 3);
  for (const receipt of receipts) {
    assert.equal(
      seen
        .filter((notice) => notice.ticketId === receipt.ticketId)
        .every((notice) => {
          return (
            notice.attemptId === receipt.attemptId && notice.operationId === receipt.operationId
          );
        }),
      true,
      "each phase retains the receipt, attempt and operation identity"
    );
  }
  assert.deepEqual(
    seen.map((notice) => notice.phase),
    ["dispatched", "delivered", "dispatched", "delivered", "dispatched", "undelivered"]
  );
  assert.deepEqual(
    receipts.map((notice) => [notice.operationId, notice.attemptId]),
    [
      [metered.id, `${metered.id}.1`],
      [manual.id, null],
      [metered.id, `${metered.id}.2`],
    ]
  );
});

test("Node requests never carry the tag; Electron net requests do", async (t) => {
  setup(t);
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  const seenHeaders = [];
  const capture = async (_url, init) => {
    seenHeaders.push(new Headers(init.headers ?? {}));
    return new Response("{}");
  };
  await gate.meteredFetch(ticket, capture)("https://api.groq.com/x", { headers: { a: "1" } });
  await gate.meteredFetch(ticket, capture, { tag: true })("https://api.groq.com/x", {
    headers: { a: "1" },
  });
  assert.equal(seenHeaders[0].has(gate.EGRESS_TAG_HEADER), false);
  // The tag names one request of this operation, not the operation itself.
  assert.equal(gate.ticketByTag(seenHeaders[1].get(gate.EGRESS_TAG_HEADER))?.ticket, ticket);
  assert.notEqual(seenHeaders[1].get(gate.EGRESS_TAG_HEADER), ticket.tag);
  ticket.discard();
});

test("tags identify a ticket for the Chromium backstop", (t) => {
  setup(t);
  const ticket = gate.authorize({ task: "calendar", target: "https://graph.microsoft.com" });
  const headers = gate.tagHeaders(ticket, { Accept: "application/json" });
  assert.equal(headers[gate.EGRESS_TAG_HEADER], ticket.tag);
  assert.equal(headers.Accept, "application/json");
  assert.equal(gate.ticketByTag(ticket.tag), ticket);
  ticket.discard();
  assert.equal(gate.ticketByTag(ticket.tag), null);
});

test("guardResponse keeps the ticket open until the body is read", async (t) => {
  const { recorder } = setup(t);
  const res = await gate.guardResponse(
    { task: "calendar", target: "https://graph.microsoft.com" },
    (ticket) =>
      gate.meteredFetch(
        ticket,
        async () => new Response("calendar json", { status: 200 })
      )("https://graph.microsoft.com/v1.0/me")
  );
  assert.equal(gate.activeRemoteCount(), 1, "still open after headers");
  assert.equal(recorder.list().length, 0);
  assert.equal(await res.text(), "calendar json");
  await nextTurn();
  assert.equal(gate.activeRemoteCount(), 0);
  assert.deepEqual(
    [recorder.list()[0].outcome, recorder.list()[0].bytesIn, recorder.list()[0].status],
    ["ok", 13, 200]
  );
});

test("guardResponse: a body that fails mid-read is an error, not a success", async (t) => {
  const { recorder } = setup(t);
  const broken = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode("par"));
    },
    pull(c) {
      c.error(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    },
  });
  const res = await gate.guardResponse(
    { task: "calendar", target: "https://graph.microsoft.com" },
    async () => new Response(broken, { status: 200 })
  );
  await assert.rejects(res.text());
  await nextTurn();
  assert.deepEqual(
    [recorder.list()[0].kind, recorder.list()[0].outcome, recorder.list()[0].errorClass],
    ["request", "error", "CONNECTION"]
  );
});

test("guardResponse: sealing after headers with a stalled body interrupts it", async (t) => {
  const { flags, recorder } = setup(t);
  const stalled = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
  });
  const res = await gate.guardResponse(
    { task: "calendar", target: "https://graph.microsoft.com" },
    async () => new Response(stalled)
  );
  const reading = res.text();
  flags.sealed = true;
  gate.abortAllRemote();
  await assert.rejects(reading, (e) => sealedPhaseOf(e) === "interrupted");
  assert.equal(gate.activeRemoteCount(), 0);
  assert.deepEqual(
    [recorder.list()[0].outcome, recorder.list()[0].errorClass],
    ["cancelled", "SEALED_MODE"]
  );
});

test("guardResponse: an unread body is still settled when sealing aborts it", async (t) => {
  const { flags } = setup(t);
  await gate.guardResponse(
    { task: "calendar", target: "https://graph.microsoft.com" },
    async () => new Response("never read")
  );
  flags.sealed = true;
  gate.abortAllRemote();
  assert.equal(gate.activeRemoteCount(), 0);
});

test("settle stores an error class, never a message", async (t) => {
  const { recorder } = setup(t);
  const providerError = Object.assign(new Error("Your text 'secret plans' was rejected"), {
    code: "PROVIDER_REJECTED",
    status: 400,
  });
  await assert.rejects(
    gate.guard({ task: "chat", target: "https://api.groq.com" }, async () => {
      throw providerError;
    })
  );
  const [row] = recorder.list();
  assert.deepEqual(
    [row.outcome, row.errorClass, row.status],
    ["error", "HTTP_4XX", 400],
    "a category, not the provider's code"
  );
  assert.equal(JSON.stringify(row).includes("secret"), false);
  assert.equal(JSON.stringify(row).includes("PROVIDER_REJECTED"), false);
});

test("withContext gives nested tickets the session id and canonical target, unless they set their own", async (t) => {
  setup(t);
  const seen = notices();
  await gate.withContext({ correlationId: "s-1", provider: "tinfoil" }, async () => {
    await nextTurn();
    // A provider helper deep in the call, which knows neither (Tinfoil's SDK wrapper).
    await gate.guard(
      { task: "dictationStt", target: "https://inference.tinfoil.sh", payload: "audio" },
      async (ticket) => ticket.markDelivered()
    );
    await gate.guard(
      {
        task: "dictationStt",
        target: "https://api.openai.com",
        provider: "openai",
        payload: "audio",
        correlationId: "other",
      },
      async (ticket) => ticket.markDelivered()
    );
  });
  assert.deepEqual(
    seen.filter((n) => n.phase === "delivered").map((n) => [n.correlationId, n.targetId]),
    [
      ["s-1", "tinfoil"],
      ["other", "openai"],
    ]
  );
});

test("withTask supplies the task across async boundaries", async (t) => {
  const { recorder } = setup(t);
  await gate.withTask("uploadStt", async () => {
    await nextTurn();
    await gate.guard({ target: "https://api.openai.com/v1/audio" }, async () => {});
  });
  assert.equal(recorder.list()[0].task, "uploadStt");
  await gate.guard({ target: "https://api.openai.com" }, async () => {});
  assert.equal(recorder.list()[0].task, "unattributed");
});

test("abortAllRemote interrupts in-flight remote tickets; loopback keeps running", async (t) => {
  const { flags, recorder } = setup(t);
  const pending = gate.guard(
    { task: "chat", target: "https://api.groq.com" },
    (ticket) =>
      new Promise((_resolve, reject) =>
        ticket.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        )
      )
  );
  const local = gate.authorize({ task: "dictationCleanup", target: "http://localhost:8080" });
  assert.equal(gate.activeRemoteCount(), 1);
  flags.sealed = true;
  gate.onSealChanged(true);
  assert.equal(gate.abortAllRemote(), 1);
  await assert.rejects(pending, (error) => sealedPhaseOf(error) === "interrupted");
  assert.equal(local.signal.aborted, false);
  assert.deepEqual(
    [recorder.list()[0].outcome, recorder.list()[0].errorClass],
    ["cancelled", "SEALED_MODE"]
  );
  assert.equal(gate.activeRemoteCount(), 0);
});

test("an opaque child session is recorded without bytes", (t) => {
  const { recorder } = setup(t);
  const session = gate.authorize({ task: "codex", target: "https://chatgpt.com", meter: "opaque" });
  session.addBytes({ out: 50, in: 50 });
  session.settle({ outcome: "ok" });
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.opaque, row.bytesOut, row.bytesIn], ["codex", true, null, null]);
});

test("aborting an opaque session does not settle it: only the child's exit does", (t) => {
  setup(t);
  const session = gate.authorize({ task: "codex", target: "https://chatgpt.com", meter: "opaque" });
  gate.abortAllRemote();
  assert.equal(session.settled, false);
  assert.equal(gate.activeRemoteCount(), 1);
  session.settle({ outcome: "cancelled" });
  assert.equal(gate.activeRemoteCount(), 0);
});

test("aborting a socket-metered ticket that never opened a socket settles it", (t) => {
  const { recorder } = setup(t);
  const ticket = gate.authorize({
    task: "dictationStt",
    target: "wss://api.openai.com",
    meter: "socket",
  });
  assert.equal(ticket.socketCount(), 0);
  gate.abortAllRemote();
  assert.equal(ticket.settled, true);
  assert.equal(recorder.list()[0].outcome, "cancelled");
});

test("'settled' fires for every settled remote ticket", async (t) => {
  setup(t);
  let settled = 0;
  gate.events.on("settled", () => settled++);
  await gate.guard({ task: "chat", target: "https://api.groq.com" }, async () => {});
  assert.equal(settled, 1);
});

test("a throwing isSealed fails closed", (t) => {
  setup(t);
  gate.configureEgress({
    isSealed: () => {
      throw new Error("disk");
    },
  });
  assert.equal(gate.isSealed(), true);
  assert.throws(
    () => gate.authorize({ task: "chat", target: "https://api.groq.com" }),
    isSealedModeError
  );
});

test("the test-only bypass authorises as if unsealed", (t) => {
  setup(t, { sealed: true });
  gate._setBypassForTests(true);
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  ticket.discard();
  gate._setBypassForTests(false);
  assert.throws(
    () => gate.authorize({ task: "chat", target: "https://api.groq.com" }),
    isSealedModeError
  );
});

test("unknown tasks are a programming error", (t) => {
  setup(t);
  assert.throws(
    () => gate.authorize({ task: "telemetry", target: "https://x.example" }),
    TypeError
  );
});

test("assertAllowed leaves no ticket and no ledger row when allowed", (t) => {
  const { recorder } = setup(t);
  gate.assertAllowed({ task: "codex", target: "https://chatgpt.com" });
  assert.equal(recorder.list().length, 0);
  assert.equal(gate.activeRemoteCount(), 0);
});

test("recording failures never break a request", async (t) => {
  setup(t);
  gate.attachRecorder({
    record() {
      throw new Error("disk full");
    },
  });
  await gate.guard({ task: "chat", target: "https://api.groq.com" }, async () => {});
  assert.equal(gate.counters().recordFailures, 1);
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const interrupted = (error) => sealedPhaseOf(error) === "interrupted";

for (const status of [400, 429, 503]) {
  test(`HTTP ${status} keeps its per-attempt failure after guard returns`, async (t) => {
    const { recorder } = setup(t);
    await gate.guard({ task: "chat", target: "https://api.groq.com" }, async (ticket) => {
      await (
        await gate.meteredFetch(
          ticket,
          async () => new Response("bad", { status })
        )("https://api.groq.com")
      ).text();
    });
    const [row] = recorder.list();
    assert.deepEqual(
      [row.outcome, row.status, row.errorClass, row.bytesIn],
      ["error", status, status >= 500 ? "HTTP_5XX" : "HTTP_4XX", 3]
    );
  });
}

test("metered body errors and cancellation settle each attempt once", async (t) => {
  const { recorder } = setup(t);
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  const res = await gate.meteredFetch(
    ticket,
    async () =>
      new Response(
        new ReadableStream({
          pull(c) {
            c.error(Object.assign(new Error("private body"), { code: "ECONNRESET" }));
          },
        })
      )
  )("https://api.groq.com");
  await assert.rejects(res.text());
  assert.deepEqual(
    [recorder.list()[0]?.outcome, recorder.list()[0]?.errorClass, recorder.list()[0]?.bytesIn],
    ["error", "CONNECTION", null]
  );
  const second = await gate.meteredFetch(
    ticket,
    async () => new Response("unread")
  )("https://api.groq.com");
  await second.body.cancel();
  assert.deepEqual(
    [recorder.list()[0]?.outcome, recorder.list()[0]?.errorClass, recorder.list()[0]?.bytesIn],
    ["cancelled", "BODY_CANCELLED", null]
  );
  ticket.settle({ outcome: "ok" });
  assert.equal(recorder.list().length, 2);
});

test("combined caller cancellation aborts a stalled metered read", async (t) => {
  const { recorder } = setup(t);
  const controller = new AbortController();
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  const res = await gate.meteredFetch(
    ticket,
    async () => new Response(new ReadableStream({ pull: () => new Promise(() => {}) }))
  )("https://api.groq.com", { signal: controller.signal });
  const reading = res.text();
  controller.abort(new DOMException("private", "AbortError"));
  await assert.rejects(reading, { name: "AbortError" });
  assert.deepEqual(
    [recorder.list()[0]?.outcome, recorder.list()[0]?.errorClass],
    ["cancelled", "ABORTED"]
  );
  ticket.settle({ outcome: "ok" });
});

for (const action of ["reader", "clone", "cancel"]) {
  test(`guardResponse aborts stalled ${action} without waiting on the source`, async (t) => {
    const { recorder } = setup(t);
    const res = await gate.guardResponse(
      { task: "calendar", target: "https://graph.microsoft.com" },
      async () =>
        new Response(
          new ReadableStream({
            pull: () => new Promise(() => {}),
            cancel: () => new Promise(() => {}),
          })
        )
    );
    let pending;
    if (action === "reader") pending = res.body.getReader().read();
    if (action === "clone") pending = res.clone().text();
    if (action === "cancel") pending = res.body.cancel("private reason");
    gate.abortAllRemote();
    await assert.rejects(pending, interrupted);
    assert.equal(gate.activeRemoteCount(), 0);
    assert.deepEqual(
      [recorder.list()[0]?.outcome, recorder.list()[0]?.errorClass],
      ["cancelled", "SEALED_MODE"]
    );
  });
}

test("guard aborts even when the operation ignores the signal", async (t) => {
  const { recorder } = setup(t);
  const pending = gate.guard(
    { task: "chat", target: "https://api.groq.com" },
    () => new Promise(() => {})
  );
  gate.abortAllRemote();
  await assert.rejects(pending, interrupted);
  assert.deepEqual(
    [recorder.list()[0]?.outcome, recorder.list()[0]?.errorClass],
    ["cancelled", "SEALED_MODE"]
  );
});

test("an HTTP attempt executes inside its own ticket context", async (t) => {
  setup(t);
  const a = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  const b = gate.authorize({ task: "calendar", target: "https://api.groq.com" });
  await gate.runWithTicket(b, () =>
    gate.meteredFetch(a, async () => {
      assert.equal(gate.currentTicket(), a);
      return new Response(null, { status: 204 });
    })("https://api.groq.com")
  );
  assert.equal(gate.currentTicket(), null);
});

test("concurrent sessions keep task, target and correlation identity", async (t) => {
  setup(t);
  const seen = notices();
  const wait = deferred();
  const first = gate.withTask("dictationStt", () =>
    gate.withContext({ provider: "tinfoil", correlationId: "s-one" }, async () => {
      await wait.promise;
      await gate.guard({ target: "https://same.invalid", payload: "audio" }, async (ticket) =>
        ticket.markDelivered()
      );
    })
  );
  await gate.withTask("calendar", () =>
    gate.withContext({ provider: "openai", correlationId: "s-two" }, () =>
      gate.guard({ target: "https://same.invalid" }, async (ticket) => ticket.markDelivered())
    )
  );
  wait.resolve();
  await first;
  assert.deepEqual(
    seen.filter((n) => n.phase === "delivered").map((n) => [n.task, n.targetId, n.correlationId]),
    [
      ["calendar", "openai", "s-two"],
      ["dictationStt", "tinfoil", "s-one"],
    ]
  );
});

test("loopback tickets cannot hide remote attempts or reuse permission after sealing", async (t) => {
  const { flags, recorder } = setup(t, { sealed: true });
  const local = gate.authorize({ task: "chat", target: "http://127.0.0.1" });
  let calls = 0;
  await assert.rejects(
    gate.meteredFetch(local, async () => {
      calls++;
      return new Response("secret");
    })("https://remote.invalid/path?key=private"),
    (error) => sealedPhaseOf(error) === "refused"
  );
  assert.equal(calls, 0);
  assert.equal(recorder.list()[0]?.host, "remote.invalid");
  flags.sealed = false;
  const remote = gate.authorize({ task: "chat", target: "https://remote.invalid" });
  flags.sealed = true;
  await assert.rejects(
    gate.meteredFetch(remote, async () => {
      calls++;
    })("https://remote.invalid"),
    isSealedModeError
  );
  assert.equal(calls, 0);
});

test("redirect refusal preserves previously dispatched delivery and unknown bytes", async (t) => {
  const { recorder } = setup(t);
  const seen = notices();
  const ticket = gate.authorize({ task: "chat", target: "https://first.invalid" });
  const attempt = ticket.beginAttempt("first.invalid");
  attempt.markDispatched();
  attempt.markDelivered();
  attempt.noteStatus(302);
  const error = gate.recordBackstopBlock({
    host: "final.invalid",
    hosts: ["first.invalid", "final.invalid"],
    ticket: attempt,
  });
  assert.equal(sealedPhaseOf(error), "interrupted");
  attempt.settle({ outcome: "error" });
  ticket.settle({ outcome: "error" });
  const [row] = recorder.list();
  assert.deepEqual(
    [row.outcome, row.bytesOut, row.bytesIn, row.status, row.hosts],
    ["cancelled", null, null, 302, ["first.invalid", "final.invalid"]]
  );
  assert.equal(recorder.list().length, 1);
  assert.deepEqual(
    seen.map((n) => n.phase),
    ["dispatched", "delivered"]
  );
});

test("unattributed redirect refusal records interruption rather than wholly unsent", (t) => {
  const { recorder } = setup(t);
  const error = gate.recordBackstopBlock({
    host: "final.invalid",
    hosts: ["first.invalid", "final.invalid"],
  });
  assert.equal(sealedPhaseOf(error), "interrupted");
  assert.deepEqual(
    [recorder.list()[0]?.outcome, recorder.list()[0]?.bytesOut],
    ["cancelled", null]
  );
});

test("socket lifetime survives ticket settlement until observed close", (t) => {
  const { recorder } = setup(t);
  const { EventEmitter } = require("node:events");
  const socket = new EventEmitter();
  let destroys = 0;
  socket.destroy = () => {
    destroys++;
  };
  socket.bytesWritten = 17;
  socket.bytesRead = 19;
  const ticket = gate.authorize({
    task: "dictationStt",
    target: "wss://api.openai.com",
    meter: "socket",
  });
  ticket.attachSocket(socket);
  ticket.markDelivered();
  ticket.settle({ outcome: "ok" });
  assert.equal(gate.activeRemoteCount(), 1);
  assert.equal(recorder.list().length, 0, "wire meter finishes at actual close");
  gate.abortAllRemote();
  assert.equal(destroys, 1);
  assert.equal(gate.activeRemoteCount(), 1);
  socket.emit("close", false);
  assert.equal(gate.activeRemoteCount(), 0);
  assert.deepEqual(
    [recorder.list()[0]?.bytesOut, recorder.list()[0]?.bytesIn, recorder.list()[0]?.outcome],
    [17, 19, "cancelled"]
  );
});

test("Chromium transport holds preserve tags and liveness beyond ticket settlement", (t) => {
  setup(t);
  const ticket = gate.authorize({ task: "appUpdate", target: "https://updates.invalid" });
  const attempt = ticket.beginAttempt("updates.invalid");
  const close = attempt.retainTransport(); // Task 6 releases only at onCompleted/onErrorOccurred.
  attempt.markDispatched();
  ticket.settle({ outcome: "ok" });
  assert.equal(gate.ticketByTag(attempt.tag), attempt);
  assert.equal(gate.activeRemoteCount(), 1);
  gate.abortAllRemote();
  assert.equal(gate.activeRemoteCount(), 1);
  attempt.settle({ outcome: "cancelled" });
  close();
  close();
  assert.equal(gate.ticketByTag(attempt.tag), null);
  assert.equal(gate.activeRemoteCount(), 0);
});

test("opaque byte overrides stay unknown and only explicit child end settles after abort", (t) => {
  const { recorder } = setup(t);
  const ticket = gate.authorize({ task: "codex", target: "https://chatgpt.com", meter: "opaque" });
  gate.abortAllRemote();
  assert.equal(recorder.list().length, 0);
  ticket.settle({ outcome: "ok", bytesOut: 99, bytesIn: 99 });
  assert.deepEqual(
    [
      recorder.list()[0]?.kind,
      recorder.list()[0]?.bytesOut,
      recorder.list()[0]?.bytesIn,
      recorder.list()[0]?.outcome,
    ],
    ["session", null, null, "cancelled"]
  );
});

test("diagnostic rows never disclose loopback work or unbounded error metadata", (t) => {
  const { recorder } = setup(t);
  gate.recordUnattributed({ host: "127.0.0.1", outcome: "ok" });
  assert.equal(recorder.list().length, 0);
  const ticket = gate.authorize({
    task: "chat",
    target: "https://api.groq.com/private?key=secret",
  });
  ticket.addHost("https://secret.invalid/private");
  ticket.settle({ outcome: "error", errorClass: "SECRET_PROVIDER_ERROR" });
  assert.deepEqual(
    [recorder.list()[0]?.hosts, recorder.list()[0]?.errorClass],
    [["api.groq.com"], "OTHER"]
  );
});

test("reset aborts stale work, removes contexts/tags/listeners and restores fail closed", async (t) => {
  setup(t);
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  gate.withTask("chat", () =>
    gate.runWithTicket(ticket, () => {
      gate._resetForTests();
      assert.equal(gate.currentTask(), null);
      assert.equal(gate.currentTicket(), null);
    })
  );
  assert.equal(ticket.signal.aborted, true);
  assert.equal(gate.ticketByTag(ticket.tag), null);
  assert.equal(gate.activeRemoteCount(), 0);
  assert.equal(gate.isSealed(), true);
  assert.throws(() => gate.authorize({ target: "https://api.groq.com" }), isSealedModeError);
});

for (const reason of ["private cancellation", new Error("private cancellation")]) {
  test("caller abort stays cancelled even without an AbortError reason", async (t) => {
    const { recorder } = setup(t);
    const caller = new AbortController();
    const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
    const pending = gate.meteredFetch(ticket, () => new Promise(() => {}))("https://api.groq.com", {
      signal: caller.signal,
    });
    caller.abort(reason);
    await assert.rejects(pending);
    assert.deepEqual(
      [recorder.list()[0]?.outcome, recorder.list()[0]?.errorClass],
      ["cancelled", "ABORTED"]
    );
  });
}

test("a failed retry cannot retract an earlier uncertain dispatch", async (t) => {
  setup(t);
  const seen = notices();
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  await assert.rejects(
    gate.meteredFetch(ticket, async () => {
      throw Object.assign(new Error("private"), { code: "ECONNRESET" });
    })("https://api.groq.com")
  );
  await assert.rejects(
    gate.meteredFetch(ticket, async () => {
      throw Object.assign(new Error("private"), { code: "ECONNREFUSED" });
    })("https://api.groq.com")
  );
  assert.deepEqual(
    seen.map((n) => n.phase),
    ["dispatched", "dispatched", "undelivered"]
  );
  assert.notEqual(seen[0].ticketId, seen[2].ticketId);
});

test("concurrent attempts attribute socket host trails only to their own context", async (t) => {
  const { recorder } = setup(t);
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  const wait = deferred();
  const first = gate.meteredFetch(ticket, async () => {
    await wait.promise;
    ticket.addHost("first-edge.invalid");
    return new Response(null, { status: 204 });
  })("https://first.invalid");
  await gate.meteredFetch(ticket, async () => {
    ticket.addHost("second-edge.invalid");
    return new Response(null, { status: 204 });
  })("https://second.invalid");
  wait.resolve();
  await first;
  assert.deepEqual(
    recorder
      .list()
      .reverse()
      .map((r) => r.hosts),
    [
      ["second.invalid", "second-edge.invalid"],
      ["first.invalid", "first-edge.invalid"],
    ]
  );
});

test("a late transport result after reset cannot announce into the next session", async (t) => {
  setup(t);
  const transport = deferred();
  const oldNotices = [];
  gate.events.on("dispatched", (notice) => oldNotices.push(notice));
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  const pending = gate.meteredFetch(ticket, () => transport.promise)("https://api.groq.com");
  const caught = assert.rejects(pending);
  assert.equal(oldNotices.length, 1);
  const oldReceiptId = oldNotices[0].ticketId;
  gate._resetForTests();
  const { recorder } = setup(t);
  const seen = notices();
  const nextTicket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  await gate.meteredFetch(
    nextTicket,
    async () => new Response(null, { status: 204 })
  )("https://api.groq.com");
  assert.equal(Number.isSafeInteger(seen[0].ticketId), true);
  assert.notEqual(seen[0].ticketId, oldReceiptId);
  const currentRows = recorder.list();
  transport.resolve(new Response("private"));
  await caught;
  await nextTurn();
  assert.deepEqual(
    seen.map((notice) => notice.phase),
    ["dispatched", "delivered"]
  );
  assert.equal(
    seen.every((notice) => notice.ticketId === seen[0].ticketId),
    true
  );
  assert.deepEqual(
    recorder.list(),
    currentRows,
    "the stale result cannot write into the new recorder"
  );
});

test("a final refused redirect error cannot claim the dispatched first hop was unsent", async (t) => {
  const { recorder } = setup(t);
  const { SealedModeError } = require("../../src/helpers/privacy/egressPolicy");
  await assert.rejects(
    gate.guard({ task: "chat", target: "https://first.invalid" }, (ticket) =>
      gate.meteredFetch(ticket, async () => {
        ticket.addHost("final.invalid");
        throw new SealedModeError({ task: "chat", host: "final.invalid" });
      })("https://first.invalid")
    ),
    interrupted
  );
  assert.deepEqual(
    [recorder.list()[0]?.outcome, recorder.list()[0]?.bytesOut, recorder.list()[0]?.hosts],
    ["cancelled", null, ["first.invalid", "final.invalid"]]
  );
});

test("the gate drops key-shaped model ids before any recorder sees them (T18-07)", (t) => {
  setup(t);
  const rows = [];
  gate.attachRecorder({ record: (row) => rows.push(row) });
  const models = [
    ["AIzaSyD-ABCdefGHIjklMNOpqrSTUvwxYZ01234", null],
    ["sk-ant-api03-AbCdEfGhIjKl-MnOp", null],
    ["AKIAIOSFODNN7EXAMPLE", null],
    ["ghp_16C7e42F292c6912E7710c838347Ae178B4a", null],
    ["xoxb-123456789012-1234567890123-AbCdEf", null],
    ["Zx8-Qp_3LmN7vR2tY9wK4bH6jF1dS5aE0cU", null],
    ["gpt-4o-mini-realtime-preview-2024-12-17", "gpt-4o-mini-realtime-preview-2024-12-17"],
    ["nvidia/Llama-3_1-Nemotron-Ultra-253B-v1", "nvidia/Llama-3_1-Nemotron-Ultra-253B-v1"],
  ];
  for (const [model] of models) {
    const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com/x", model });
    ticket.settle({ outcome: "ok" });
  }
  assert.deepEqual(
    rows.map((row) => row.model),
    models.map(([, expected]) => expected)
  );
});

test("metadata handed to recorder-shaped adapters is already bounded", (t) => {
  setup(t);
  const rows = [];
  gate.attachRecorder({ record: (row) => rows.push(row) });
  const ticket = gate.authorize({
    task: "chat",
    target: "https://api.groq.com/private",
    model: "https://key:secret@private.invalid/path",
  });
  ticket.settle({
    outcome: "error",
    bytesOut: "secret",
    bytesIn: "secret",
    errorClass: "secret",
    status: "secret",
  });
  assert.equal(JSON.stringify(rows).includes("secret"), false);
  assert.deepEqual(
    [rows[0].bytesOut, rows[0].bytesIn, rows[0].status, rows[0].model, rows[0].errorClass],
    [null, null, null, null, "OTHER"]
  );
});

test("already aborted input and invalid headers do not invent an HTTP attempt", async (t) => {
  const { recorder } = setup(t);
  let calls = 0;
  await assert.rejects(
    gate.guard({ task: "chat", target: "https://api.groq.com" }, (ticket) =>
      gate.meteredFetch(ticket, async () => {
        calls++;
      })("https://api.groq.com", { signal: AbortSignal.abort() })
    )
  );
  await assert.rejects(
    gate.guard({ task: "chat", target: "https://api.groq.com" }, (ticket) =>
      gate.meteredFetch(ticket, async () => {
        calls++;
      })("https://api.groq.com", { headers: { "invalid header": "x" } })
    )
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    recorder.list().map((r) => r.kind),
    ["operation", "operation"]
  );
  assert.equal(recorder.summary().left, 0);
});

test("manual body transports retain HTTP failure status and unknown unfinished bytes", (t) => {
  const { recorder } = setup(t);
  const ticket = gate.authorize({ task: "chat", target: "https://api.groq.com" });
  ticket.markDelivered();
  ticket.noteStatus(503);
  ticket.bodyOpened();
  ticket.addBytes({ in: 3 });
  ticket.settle({ outcome: "ok" });
  assert.deepEqual(
    [
      recorder.list()[0]?.outcome,
      recorder.list()[0]?.status,
      recorder.list()[0]?.errorClass,
      recorder.list()[0]?.bytesIn,
    ],
    ["error", 503, "HTTP_5XX", null]
  );
});

test("recorder failure counters survive seal transitions and contain no failure messages", async (t) => {
  setup(t);
  const recorder = {
    record() {
      throw Object.assign(new Error("private disk detail"), { code: "PRIVATE_KEY" });
    },
  };
  gate.attachRecorder(recorder);
  assert.equal(gate.getRecorder(), recorder);
  await gate.guard({ task: "chat", target: "https://api.groq.com" }, async () => {});
  gate.onSealChanged(true);
  assert.deepEqual(gate.counters(), { blockedSinceSealed: 0, recordFailures: 1 });
});

test("test bypass controls refuse to run outside node:test", (t) => {
  setup(t);
  const context = process.env.NODE_TEST_CONTEXT;
  try {
    delete process.env.NODE_TEST_CONTEXT;
    assert.throws(() => gate._setBypassForTests(true), /require node:test/);
    assert.throws(() => gate._resetForTests(), /require node:test/);
  } finally {
    process.env.NODE_TEST_CONTEXT = context;
  }
});

test("guardResponse can abort a stalled clone cancellation", async (t) => {
  setup(t);
  const res = await gate.guardResponse(
    { task: "calendar", target: "https://graph.microsoft.com" },
    async () =>
      new Response(
        new ReadableStream({
          pull: () => new Promise(() => {}),
          cancel: () => new Promise(() => {}),
        })
      )
  );
  const cancelling = res.clone().body.cancel();
  gate.abortAllRemote();
  await assert.rejects(cancelling, interrupted);
  assert.equal(gate.activeRemoteCount(), 0);
});

test("a refused loopback-to-remote redirect records only the remote refusal", async (t) => {
  const { recorder } = setup(t, { sealed: true });
  const seen = notices();
  await assert.rejects(
    gate.guard({ task: "chat", target: "http://127.0.0.1" }, (ticket) =>
      gate.meteredFetch(
        ticket,
        async (_input, init) => {
          const owner = gate.ticketByTag(init.headers.get(gate.EGRESS_TAG_HEADER));
          throw gate.recordBackstopBlock({
            host: "remote.invalid",
            hosts: ["127.0.0.1", "remote.invalid"],
            ticket: owner,
          });
        },
        { tag: true }
      )("http://127.0.0.1")
    ),
    (error) => sealedPhaseOf(error) === "refused"
  );
  assert.deepEqual(
    recorder.list().map((r) => [r.host, r.outcome, r.bytesOut, r.bytesIn]),
    [["remote.invalid", "blocked", 0, 0]]
  );
  assert.deepEqual(seen, []);
});

test("a one-host remote redirect trail still proves an earlier dispatched hop", (t) => {
  const { recorder } = setup(t);
  const error = gate.recordBackstopBlock({ host: "remote.invalid", hosts: ["remote.invalid"] });
  assert.equal(sealedPhaseOf(error), "interrupted");
  assert.deepEqual(
    [recorder.list()[0]?.outcome, recorder.list()[0]?.bytesOut],
    ["cancelled", null]
  );
});

for (const uncertainFirst of [false, true]) {
  test(`real Plan 04 tracker keeps both recipients and withdraws only failed retries (uncertain=${uncertainFirst})`, async (t) => {
    const { recorder } = setup(t);
    const seen = notices();
    const tracker = createDisclosureTracker({
      session: { id: "review-session" },
      privacyApi: {
        onEgress(listener) {
          const listeners = ["dispatched", "delivered", "undelivered"].map((phase) => {
            const forward = (notice) => listener({ phase, ...notice });
            gate.events.on(phase, forward);
            return [phase, forward];
          });
          return () => listeners.forEach(([phase, listener]) => gate.events.off(phase, listener));
        },
      },
      dispatchApi: {},
    });
    t.after(() => tracker.dispose());
    const ticket = gate.withContext({ correlationId: "review-session" }, () =>
      gate.authorize({
        task: "dictationStt",
        target: "https://first.invalid",
        payload: "audio",
      })
    );
    const success = gate.meteredFetch(ticket, async () => new Response(null, { status: 204 }));
    const fail = (code) =>
      gate.meteredFetch(ticket, async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code } });
      });
    if (uncertainFirst) await assert.rejects(fail("ECONNRESET")("https://first.invalid"));
    else await success("https://first.invalid");
    await success("https://second.invalid");
    const expected = {
      target: uncertainFirst ? "host:second.invalid" : "host:first.invalid",
      payload: "audio",
      evidence: uncertainFirst ? "dispatched" : "attested",
      alsoSentTo: [uncertainFirst ? "host:first.invalid" : "host:second.invalid"],
    };
    assert.deepEqual(tracker.get(), expected);
    const dispatched = seen.filter((n) => n.phase === "dispatched");
    assert.equal(new Set(dispatched.map((n) => n.ticketId)).size, 2);
    for (const [index, notice] of dispatched.entries()) {
      assert.equal(Number.isSafeInteger(notice.ticketId), true);
      assert.deepEqual(
        [
          notice.attemptId,
          notice.operationId,
          notice.correlationId,
          notice.task,
          notice.targetId,
          notice.payload,
        ],
        [
          `${ticket.id}.${index + 1}`,
          ticket.id,
          "review-session",
          "dictationStt",
          `host:${index ? "second" : "first"}.invalid`,
          "audio",
        ]
      );
    }
    for (const host of ["first", "second", "third"]) {
      await assert.rejects(fail("ECONNREFUSED")(`https://${host}.invalid`));
      assert.deepEqual(tracker.get(), expected, "a failed retry removes only its own receipt");
      const last = seen.at(-1);
      assert.equal(last.phase, "undelivered");
      assert.equal(last.ticketId, seen.at(-2).ticketId);
      assert.equal(
        dispatched.some((n) => n.ticketId === last.ticketId),
        false
      );
    }
    // A subsequent delivery strengthens the first recipient without hiding either target.
    await success("https://first.invalid");
    assert.deepEqual(tracker.get(), {
      target: "host:first.invalid",
      payload: "audio",
      evidence: "attested",
      alsoSentTo: ["host:second.invalid"],
    });
    ticket.settle({ outcome: "ok" });
    assert.equal(recorder.list().length, 6);
    assert.equal(
      recorder.list().every((r) => r.kind === "request" && r.operationId === ticket.id),
      true
    );
  });
}

test("delivered receipt cannot be downgraded by its own later undelivered notice", (t) => {
  setup(t);
  const seen = notices();
  const ticket = gate.authorize({
    task: "dictationStt",
    target: "https://first.invalid",
    payload: "audio",
  });
  const attempt = ticket.beginAttempt("first.invalid");
  attempt.markDelivered();
  attempt.markUndelivered();
  ticket.markDelivered();
  ticket.markUndelivered();
  assert.deepEqual(
    seen.map((n) => n.phase),
    ["dispatched", "delivered", "dispatched", "delivered"]
  );
  assert.notEqual(seen[0].ticketId, seen[2].ticketId);
  ticket.discard();
});

for (const init of [undefined, { signal: undefined }]) {
  test("review reproduction: an already-aborted Request rejects before transport without a phantom row", async (t) => {
    const { recorder } = setup(t);
    const seen = notices();
    const ticket = gate.authorize({ task: "chat", target: "https://cancelled.invalid" });
    const caller = new AbortController();
    caller.abort(new DOMException("fixture cancellation", "AbortError"));
    const input = new Request("https://cancelled.invalid", { signal: caller.signal });
    let calls = 0;
    await assert.rejects(
      gate.meteredFetch(ticket, async (_input, options) => {
        calls++;
        options.signal.throwIfAborted();
        return new Response(null, { status: 204 });
      })(input, init),
      (error) => error === caller.signal.reason
    );
    assert.equal(calls, 0);
    assert.equal(ticket.attemptCount(), 0);
    assert.deepEqual(recorder.list(), []);
    assert.deepEqual(seen, []);
    ticket.discard();
  });
}

for (const duringBody of [false, true]) {
  test(`inherited Request signal cancels once during ${duringBody ? "stalled body" : "transport"}`, async (t) => {
    const { recorder } = setup(t);
    const ticket = gate.authorize({ task: "chat", target: "https://cancelled.invalid" });
    const caller = new AbortController();
    const input = new Request("https://cancelled.invalid", { signal: caller.signal });
    let aborts = 0;
    let cancels = 0;
    const pending = gate.meteredFetch(ticket, async (_input, options) => {
      options.signal.addEventListener("abort", () => aborts++, { once: true });
      if (!duringBody) return new Promise(() => {});
      return new Response(
        new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
          cancel() {
            cancels++;
          },
        })
      );
    })(input);
    const reading = duringBody ? (await pending).text() : pending;
    const outcome = reading.then(
      () => "resolved",
      (error) => error
    );
    caller.abort(new DOMException("fixture cancellation", "AbortError"));
    assert.equal(
      await Promise.race([outcome, nextTurn().then(() => "still pending")]),
      caller.signal.reason
    );
    ticket.abort();
    ticket.settle({ outcome: "cancelled" });
    await nextTurn();
    assert.equal(aborts, 1);
    assert.equal(cancels, duringBody ? 1 : 0);
    assert.equal(recorder.list().length, 1);
    assert.deepEqual(
      [recorder.list()[0].outcome, recorder.list()[0].errorClass],
      ["cancelled", "ABORTED"]
    );
  });
}

for (const override of ["signal", "null"]) {
  test(`explicit init ${override} overrides an aborted Request signal and still composes ticket cancellation`, async (t) => {
    const { recorder } = setup(t);
    const ticket = gate.authorize({ task: "chat", target: "https://cancelled.invalid" });
    const explicit = new AbortController();
    const input = new Request("https://cancelled.invalid", { signal: AbortSignal.abort() });
    let calls = 0;
    let signal;
    const response = await gate.meteredFetch(ticket, async (_input, options) => {
      calls++;
      signal = options.signal;
      signal.throwIfAborted();
      return new Response(
        new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
        })
      );
    })(input, { signal: override === "null" ? null : explicit.signal });
    const reading = response.text();
    const rejected = assert.rejects(reading);
    if (override === "signal") explicit.abort();
    else ticket.abort();
    await rejected;
    assert.equal(calls, 1);
    assert.equal(signal.aborted, true);
    assert.equal(recorder.list().length, 1);
  });
}

test("an already-aborted explicit init signal overrides a live Request before transport", async (t) => {
  const { recorder } = setup(t);
  const ticket = gate.authorize({ task: "chat", target: "https://cancelled.invalid" });
  let calls = 0;
  await assert.rejects(
    gate.meteredFetch(ticket, async () => {
      calls++;
    })(new Request("https://cancelled.invalid"), { signal: AbortSignal.abort() }),
    { name: "AbortError" }
  );
  assert.equal(calls, 0);
  assert.equal(ticket.attemptCount(), 0);
  assert.deepEqual(recorder.list(), []);
});

for (const tag of [false, true]) {
  test(`Request method, body and headers survive signal composition and init overrides (tag=${tag})`, async (t) => {
    const { recorder } = setup(t);
    const ticket = gate.authorize({ task: "chat", target: "https://request.invalid" });
    const fetch = gate.meteredFetch(
      ticket,
      async (input, init) => {
        const effective = new Request(input, init);
        assert.equal(effective.method, init.method ?? "POST");
        assert.equal(effective.headers.get("x-fixture"), init.method ? "override" : "original");
        assert.equal(effective.headers.has(gate.EGRESS_TAG_HEADER), tag);
        if (tag)
          assert.equal(
            gate.ticketByTag(effective.headers.get(gate.EGRESS_TAG_HEADER)).ticket,
            ticket
          );
        assert.equal(await effective.text(), init.body ?? "original body");
        return new Response(null, { status: 204 });
      },
      { tag }
    );
    const request = () =>
      new Request("https://request.invalid", {
        method: "POST",
        body: "original body",
        headers: { "x-fixture": "original", [gate.EGRESS_TAG_HEADER]: "stale" },
      });
    await fetch(request());
    await fetch(request(), {
      method: "PUT",
      body: "override body",
      headers: { "x-fixture": "override" },
    });
    ticket.settle({ outcome: "ok" });
    assert.deepEqual(
      recorder
        .list()
        .reverse()
        .map((r) => r.bytesOut),
      [null, 13]
    );
  });
}

test("cancellation at the dispatch notice prevents transport invocation", async (t) => {
  const { recorder } = setup(t);
  const caller = new AbortController();
  const ticket = gate.authorize({ task: "chat", target: "https://cancelled.invalid" });
  gate.events.once("dispatched", () => caller.abort());
  let calls = 0;
  await assert.rejects(
    gate.meteredFetch(ticket, async () => {
      calls++;
      return new Response(null, { status: 204 });
    })(new Request("https://cancelled.invalid", { signal: caller.signal })),
    { name: "AbortError" }
  );
  assert.equal(calls, 0);
  assert.equal(recorder.list().length, 1);
  assert.deepEqual(
    [recorder.list()[0].outcome, recorder.list()[0].errorClass],
    ["cancelled", "ABORTED"]
  );
});
