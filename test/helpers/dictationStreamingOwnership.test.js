const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const {
  mountTrial,
  deferred,
  flush,
  configureStreamingStartup,
} = require("./harness/audioRecordingTrial");
const { families, operation, sender, mainFixture } = require("./harness/dictationStreamingIpc");
for (const [provider, , apiName, slot] of families)
  for (const replacement of ["same-sender", "different-sender"]) {
    test(`${provider}: disposed actual hook A's delayed IPC response cannot stop ${replacement} B`, async (t) => {
      const h = await mountTrial(t);
      const stream = configureStreamingStartup(t, h, {
        cloudTranscriptionProvider:
          provider === "openai-realtime"
            ? "openai"
            : provider === "tinfoil-realtime"
              ? "tinfoil"
              : provider,
        cloudTranscriptionModel:
          provider === "gemini"
            ? "gemini-3.5-transcribe-live"
            : provider === "deepgram"
              ? "nova-3"
              : provider === "assemblyai"
                ? "universal-streaming-multilingual"
                : "gpt-4o-mini-transcribe",
        deepgramApiKey: "fixture",
        assemblyaiApiKey: "fixture",
        geminiApiKey: "fixture",
        cortiClientId: "fixture",
        cortiClientSecret: "fixture",
        tinfoilApiKey: "fixture",
      });
      const main = mainFixture(t),
        a = sender("A"),
        b = replacement === "same-sender" ? a : sender("B");
      const delivery = deferred(),
        aApi = main.bridge(a, delivery),
        bApi = main.bridge(b);
      for (const suffix of ["Start", "Stop", "Send", "Finalize", "ForceEndpoint"])
        if (aApi[apiName + suffix]) h.window.electronAPI[apiName + suffix] = aApi[apiName + suffix];
      for (const key of Object.keys(aApi))
        if (/^on(?:AssemblyAi|Gemini|Corti)/.test(key)) h.window.electronAPI[key] = aApi[key];
      let start;
      await React.act(async () => {
        start = stream.manager.startStreamingRecording();
        await h.waitAcquisition();
        h.mic().resolve({ getAudioTracks: () => [], getTracks: () => [] });
        await main.waitOpen(1);
      });
      // Main A has completed and released its guard, but the real preload promise
      // is still pending in the actual renderer adapter/hook being disposed.
      const clientA = main.host[slot];
      const identityA = stream.manager._streamingTransport.operation;
      await h.render(false, () => {});
      const resultB = await bApi[apiName + "Start"]({ provider, mode: "byok", ...operation("B") });
      assert.equal(resultB.success, true);
      const clientB = main.host[slot];
      assert.equal(clientB.live, true);
      assert.notEqual(clientA, clientB, "replacement owns a fresh main adapter");
      assert.equal(clientA.live, false, "B replacement has already reclaimed A");
      aApi[apiName + "Send"](new ArrayBuffer(2), identityA);
      (aApi[apiName + "Finalize"] ?? aApi[apiName + "ForceEndpoint"])?.(identityA);
      assert.equal(clientB.sends || 0, 0);
      assert.equal(clientB.finals || 0, 0);
      const delivered = a.messages.length;
      clientA.onFinalTranscript?.("retired A final");
      assert.equal(a.messages.length, delivered);
      if (replacement === "different-sender") a.emit("did-start-navigation");
      else
        assert.equal(
          a.listenerCount("did-start-navigation"),
          1,
          "only B lifetime listener remains"
        );
      assert.equal(clientB.live, true);
      await React.act(async () => {
        delivery.resolve();
        await start;
        await flush();
      });
      assert.equal(clientB.live, true, "late A teardown must leave actual main B connection live");
      assert.equal((await bApi[apiName + "Stop"](operation("B"))).success, true);
      assert.equal(clientB.live, false, "explicit owned B stop must close B");
      assert.deepEqual(h.writes, []);
    });
  }

for (const [provider, , apiName, slot] of families) {
  test(`${provider}: pending token stop closes late A, rejects other senders/replay and permits fresh B`, async (t) => {
    const main = mainFixture(t),
      a = sender("owner"),
      other = sender("other"),
      api = main.bridge(a),
      foreign = main.bridge(other);
    const token = main.holdToken(),
      identity = operation("pending");
    const starting = api[apiName + "Start"]({ provider, mode: "byok", ...identity });
    await flush();
    assert.equal((await foreign[apiName + "Stop"](identity)).success, false);
    const stop = api[apiName + "Stop"](identity),
      duplicate = api[apiName + "Stop"](identity);
    token.resolve("fixture");
    await Promise.all([starting, stop, duplicate]);
    assert.ok(
      main.clients.every((c) => !c.live),
      "late A is actually disconnected"
    );
    assert.equal(
      (await api[apiName + "Start"]({ provider, ...identity })).success,
      false,
      "retired attempt replay refuses"
    );
    assert.equal((await api[apiName + "Start"]({ provider, ...operation("fresh") })).success, true);
    const b = main.host[slot];
    const frame = new ArrayBuffer(2);
    api[apiName + "Send"](frame, identity);
    foreign[apiName + "Send"](frame, operation("fresh"));
    api[apiName + "Send"](frame); // no unscoped fallback against known labeled B
    assert.equal(b.sends || 0, 0);
    assert.equal((await api[apiName + "Stop"]()).success, false);
    const finalize = api[apiName + "Finalize"] ?? api[apiName + "ForceEndpoint"];
    finalize?.(identity);
    assert.equal(b.finals || 0, 0);
    api[apiName + "Send"](frame, operation("fresh"));
    assert.equal(b.sends, 1);
    finalize?.(operation("fresh"));
    if (finalize) assert.equal(b.finals, 1);
    await api[apiName + "Stop"](operation("fresh"));
    assert.equal(b.live, false);
  });
  for (const loss of ["destroyed", "did-start-navigation", "dispose"]) {
    test(`${provider}: ${loss} while credentials pending reclaims only its captured connection/listeners`, async (t) => {
      const main = mainFixture(t),
        a = sender("A"),
        api = main.bridge(a),
        token = main.holdToken();
      const start = api[apiName + "Start"]({ provider, ...operation("lost") });
      await flush();
      if (loss === "dispose") void main.host.dictationStreamingOperations.dispose();
      else {
        if (loss === "destroyed") a.dead = true;
        a.emit(loss);
      }
      token.resolve("fixture");
      await start;
      await flush();
      assert.ok(main.clients.every((c) => !c.live));
      assert.equal(a.listenerCount("destroyed"), 0);
      assert.equal(a.listenerCount("did-start-navigation"), 0);
      const messages = a.messages.length;
      for (const c of main.clients) c.onFinalTranscript?.("late");
      assert.equal(a.messages.length, messages);
    });
  }
  test(`${provider}: normal disconnect tail still publishes to its owner and duplicate/reentrant stop is idempotent`, async (t) => {
    const main = mainFixture(t),
      a = sender("A"),
      api = main.bridge(a),
      identity = operation("normal");
    assert.equal((await api[apiName + "Start"]({ provider, ...identity })).success, true);
    const client = main.host[slot];
    let stops = 0;
    client.disconnect = async () => {
      stops++;
      client.onFinalTranscript?.("tail words");
      void api[apiName + "Stop"](identity);
      client.live = false;
      return { text: "tail words" };
    };
    const result = await api[apiName + "Stop"](identity);
    assert.equal(result.text, "tail words");
    assert.equal(stops, 1);
    assert.equal(client.live, false);
    assert.ok(a.messages.some(([, text]) => text === "tail words"));
  });
}

for (const [provider, , apiName, slot] of families)
  for (const error of ["sync-start", "reject-start", "sync-stop", "reject-stop"]) {
    test(`${provider}: ${error} settles captured main owner without reclaiming a fresh connection`, async (t) => {
      const main = mainFixture(t),
        a = sender("A"),
        api = main.bridge(a);
      // Fake transport leaves only: real main registration and operation wrapper.
      const first = api[apiName + "Start"]({ provider, ...operation("error") });
      await first;
      const client = main.host[slot];
      if (error.endsWith("stop")) {
        client.disconnect =
          error === "sync-stop"
            ? () => {
                throw Error("stop fixture");
              }
            : async () => {
                throw Error("stop fixture");
              };
        await api[apiName + "Stop"](operation("error"));
        assert.equal(
          client.live,
          false,
          "captured cleanup leaves release even when disconnect fails"
        );
      } else {
        await api[apiName + "Stop"](operation("error"));
        const original = client.constructor.prototype.connect;
        client.constructor.prototype.connect =
          error === "sync-start"
            ? () => {
                throw Error("start fixture");
              }
            : async () => {
                throw Error("start fixture");
              };
        assert.equal(
          (await api[apiName + "Start"]({ provider, ...operation("start-error") })).success,
          false
        );
        client.constructor.prototype.connect = original;
      }
      assert.equal((await api[apiName + "Start"]({ provider, ...operation("new") })).success, true);
      const fresh = main.host[slot];
      await api[apiName + "Stop"](operation("error"));
      assert.equal(fresh.live, true);
      await api[apiName + "Stop"](operation("new"));
      assert.equal(fresh.live, false);
    });
  }

for (const [provider, , apiName, slot] of families) {
  test(`${provider}: same-owner warm adoption and foreign replacement retain exact ownership`, async (t) => {
    const main = mainFixture(t),
      a = sender("A"),
      b = sender("B"),
      api = main.bridge(a),
      other = main.bridge(b);
    assert.equal((await api[apiName + "Warmup"]({ provider, mode: "byok" })).success, true);
    const warm = main.host[slot];
    assert.equal(
      (await api[apiName + "Start"]({ provider, mode: "byok", ...operation("warm") })).success,
      true
    );
    assert.equal(main.host[slot], warm, "same sender may adopt its own warm adapter");
    assert.equal(
      (await api[apiName + "Warmup"]({ provider })).success,
      false,
      "warmup cannot replace recording"
    );
    assert.equal(
      (await other[apiName + "Start"]({ provider, ...operation("foreign") })).success,
      true
    );
    const replacement = main.host[slot];
    assert.notEqual(replacement, warm);
    assert.equal(warm.live, false);
    await api[apiName + "Stop"](operation("warm"));
    a.emit("destroyed");
    assert.equal(replacement.live, true);
    await other[apiName + "Stop"](operation("foreign"));
    assert.equal(replacement.live, false);
    assert.equal(a.listenerCount("destroyed"), 0);
    assert.equal(b.listenerCount("destroyed"), 0);
  });
  test(`${provider}: malformed canonical identities fail before token/client admission; legacy stays sender bound`, async (t) => {
    const main = mainFixture(t),
      a = sender("A"),
      b = sender("B"),
      api = main.bridge(a),
      other = main.bridge(b);
    for (const identity of [
      { operationId: "only" },
      { ...operation("mismatch"), dictationSessionId: "other" },
      { ...operation("invalid"), operationId: 1 },
    ])
      assert.equal((await api[apiName + "Start"]({ provider, ...identity })).success, false);
    assert.equal(main.tokens.length, 0);
    assert.equal(main.clients.length, 0);
    assert.equal(
      (await api[apiName + "Start"]({ provider })).success,
      true,
      "legacy start is still usable"
    );
    const client = main.host[slot];
    assert.equal((await other[apiName + "Stop"]()).success, false);
    assert.equal(client.live, true);
    assert.equal((await api[apiName + "Stop"]()).success, true);
    assert.equal(client.live, false);
  });
}

for (const [provider, , apiName, slot] of families) {
  test(`${provider}: record during its own pending warmup waits and adopts; duplicate/foreign start refuses`, async (t) => {
    const main = mainFixture(t),
      a = sender("A"),
      api = main.bridge(a),
      other = main.bridge(sender("B")),
      token = main.holdToken();
    const warm = api[apiName + "Warmup"]({ provider, mode: "byok" });
    await flush();
    const start = api[apiName + "Start"]({ provider, mode: "byok", ...operation("warm-pending") });
    assert.equal(
      (await api[apiName + "Start"]({ provider, ...operation("duplicate") })).success,
      false
    );
    assert.equal(
      (await other[apiName + "Start"]({ provider, ...operation("foreign") })).success,
      false
    );
    token.resolve("fixture");
    assert.equal((await warm).success, true);
    assert.equal((await start).success, true);
    const client = main.host[slot];
    assert.equal(main.clients.length, 1);
    assert.equal(client.live, true);
    await api[apiName + "Stop"](operation("warm-pending"));
    assert.equal(client.live, false);
  });
}

for (const [provider, , apiName, slot] of families) {
  test(`${provider}: changed warm recipient options require a fresh adapter`, async (t) => {
    const main = mainFixture(t),
      api = main.bridge(sender("A"));
    assert.equal(
      (await api[apiName + "Warmup"]({ provider, model: "warm-model", mode: "byok" })).success,
      true
    );
    const warm = main.host[slot];
    const selected = provider === "openai-realtime" ? "tinfoil-realtime" : provider;
    assert.equal(
      (
        await api[apiName + "Start"]({
          provider: selected,
          model: "new-model",
          mode: "byok",
          ...operation("changed"),
        })
      ).success,
      true
    );
    assert.notEqual(main.host[slot], warm);
    assert.equal(warm.live, false);
    await api[apiName + "Stop"](operation("changed"));
  });
}
