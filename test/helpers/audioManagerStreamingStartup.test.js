const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const {
  mountTrial,
  deferred,
  flush,
  configureStreamingStartup,
} = require("./harness/audioRecordingTrial");

for (const route of [
  {
    cloudTranscriptionProvider: "openai",
    cloudTranscriptionModel: "gpt-4o-mini-transcribe",
    provider: "openai-realtime",
  },
  {
    cloudTranscriptionProvider: "deepgram",
    cloudTranscriptionModel: "nova-3",
    deepgramApiKey: "fixture-only",
    provider: "deepgram",
  },
]) {
  test(`real ${route.provider} warmup and start preserve selected session options and dictionary`, async (t) => {
    const h = await mountTrial(t);
    const stream = configureStreamingStartup(t, h, route);
    assert.equal(await stream.manager.warmupStreamingConnection(), true);
    const start = await h.start();
    await h.render(false);
    stream.connect.resolve({ success: true });
    await start.finish();
    await stream.waitConnect();
    const expected = {
      provider: route.provider,
      sampleRate: 16000,
      language: "en",
      keyterms: ["Loqui", "Gizmo Labs"],
      model: route.cloudTranscriptionModel,
      mode: "byok",
      environment: undefined,
      tenant: undefined,
    };
    assert.deepEqual(stream.calls, [
      ["warmup", expected],
      ["start", expected],
    ]);
    await React.act(async () => {
      stream.connect.resolve({ success: true });
      await flush();
      await h.api().cancelRecording();
    });
    assert.deepEqual(h.writes, []);
  });
}

for (const text of ["private streamed words", ""]) {
  test(`genuine streaming startup and ${text ? "success" : "no-audio"} stay private through deferred connection, completion/restart and merge`, async (t) => {
    const h = await mountTrial(t);
    const stream = configureStreamingStartup(t, h);
    const take = await h.reserve({ demoId: "original-stream", takeId: "11" });
    let start;
    await React.act(async () => {
      start = h.api().startRecording({ onboardingTake: take });
      await h.waitAcquisition();
    });
    await h.render(false);
    await React.act(async () => {
      h.mic().resolve({ getAudioTracks: () => [], getTracks: () => [] });
      await stream.waitConnect();
    });
    await h.render(true);
    await h.render(false);
    await React.act(async () => {
      stream.connect.resolve({ success: true });
      await start;
    });
    assert.equal(h.manager(), stream.manager);
    assert.equal(stream.manager.isRecording, true);
    assert.equal(stream.manager._recordingPrivate, true);
    stream.listeners.final(text);
    const merge = deferred();
    stream.manager.mergeRecordedSegments = () => merge.promise;
    let stop;
    await React.act(async () => {
      stop = stream.manager.stopStreamingRecording();
      await flush();
    });
    await h.render(true);
    await h.render(false);
    await React.act(async () => {
      merge.resolve(new Blob(["private captured fallback"]));
      await stop;
      await flush();
    });
    assert.deepEqual(h.writes, []);
    assert.equal(stream.manager.lastAudioBlob, null);
    const event = h.events.at(-1);
    assert.equal(event.demoId, "original-stream");
    assert.equal(event.takeId, "11");
    assert.equal(event.status, text ? "success" : "error");
    if (text) assert.equal(event.rawText, text);
    else assert.equal(event.code, "NO_AUDIO");
  });
}

test("actual streaming start uses sanitized dictionary keywords only for the selected OpenAI keyword model", async (t) => {
  const h = await mountTrial(t);
  const stream = configureStreamingStartup(t, h, {
    cloudTranscriptionModel: "gpt-transcribe",
    customDictionary: ["<Loqui>", "Gizmo\nLabs"],
  });
  // The normal streaming gate still excludes this batch model. Direct start
  // exercises its existing option-assembly branch without changing that gate.
  assert.equal(stream.manager.shouldUseStreaming(), false);
  assert.equal(await stream.manager.warmupStreamingConnection(), false);
  stream.connect.resolve({ success: true });
  await React.act(async () => {
    h.mic().resolve({ getAudioTracks: () => [], getTracks: () => [] });
    assert.equal(await stream.manager.startStreamingRecording(), true);
  });
  assert.deepEqual(stream.calls[0][1].keyterms, ["Loqui", "Gizmo", "Labs"]);
  assert.equal(stream.calls[0][1].model, "gpt-transcribe");
  await React.act(async () => {
    await stream.manager.cancelStreamingRecording();
  });
});

for (const boundary of ["microphone", "connection"]) {
  test(`cancel during genuine deferred streaming ${boundary} preserves original take and leaves no audio`, async (t) => {
    const h = await mountTrial(t);
    const stream = configureStreamingStartup(t, h);
    const take = await h.reserve({ demoId: "cancel-stream", takeId: "12" });
    let start, cancel;
    await React.act(async () => {
      start = h.api().startRecording({ onboardingTake: take });
      await h.waitAcquisition();
      if (boundary === "connection") {
        h.mic().resolve({ getAudioTracks: () => [], getTracks: () => [] });
        await stream.waitConnect();
      }
    });
    await h.render(false);
    await React.act(async () => {
      cancel = h.api().cancelRecording();
      await flush();
    });
    await h.render(true);
    await React.act(async () => {
      h.mic().resolve({ getAudioTracks: () => [], getTracks: () => [] });
      stream.connect.resolve({ success: true });
      await Promise.all([start, cancel]);
      await flush();
    });
    assert.equal(stream.manager.isRecording, false);
    assert.equal(stream.manager.isStreaming, false);
    assert.ok(!stream.manager.lastAudioBlob);
    assert.deepEqual(h.writes, []);
    const event = h.events.find((event) => event.status === "cancelled");
    assert.equal(event.demoId, "cancel-stream");
    assert.equal(event.takeId, "12");
    assert.equal("sessionId" in event, false);
    assert.equal(
      stream.calls.filter(([kind]) => kind === "start").length,
      boundary === "connection" ? 1 : 0
    );
  });
}

test("genuine streaming default-device retry keeps admission privacy and take through completion/restart", async (t) => {
  const h = await mountTrial(t);
  const stream = configureStreamingStartup(t, h);
  const retry = deferred();
  let attempts = 0;
  stream.manager._acquireCaptureStream = () => (++attempts === 1 ? h.mic().promise : retry.promise);
  const take = await h.reserve({ demoId: "stream-retry", takeId: "13" });
  let start;
  await React.act(async () => {
    start = h.api().startRecording({ onboardingTake: take });
    await flush();
  });
  await h.render(false);
  await React.act(async () => {
    h.mic().reject(new DOMException("stale device", "OverconstrainedError"));
    await flush();
    retry.resolve({ getAudioTracks: () => [], getTracks: () => [] });
    await stream.waitConnect();
  });
  await h.render(true);
  await React.act(async () => {
    stream.connect.resolve({ success: true });
    await start;
    stream.listeners.final("private retry result");
    await stream.manager.stopStreamingRecording();
    await flush();
  });
  assert.equal(attempts, 2);
  assert.equal(stream.manager._recordingPrivate, true);
  assert.deepEqual(h.writes, []);
  assert.equal(stream.manager.lastAudioBlob, null);
  assert.equal(h.events.at(-1).demoId, "stream-retry");
  assert.equal(h.events.at(-1).takeId, "13");
  assert.equal(h.events.at(-1).status, "success");
});

test("completion/restart during genuine streaming recovery await keeps original manager, take and privacy", async (t) => {
  const h = await mountTrial(t);
  const stream = configureStreamingStartup(t, h);
  const recovery = deferred();
  const entered = deferred();
  stream.manager.beginMicRecovery = () => {
    entered.resolve();
    return recovery.promise;
  };
  const take = await h.reserve({ demoId: "stream-recovery", takeId: "14" });
  let start;
  await React.act(async () => {
    start = h.api().startRecording({ onboardingTake: take });
    await h.waitAcquisition();
    h.mic().resolve({ getAudioTracks: () => [], getTracks: () => [] });
    await entered.promise;
  });
  await h.render(false);
  await h.render(true);
  await h.render(false);
  await React.act(async () => {
    recovery.resolve();
    await stream.waitConnect();
    stream.connect.resolve({ success: true });
    await start;
    stream.listeners.final("original recovery words");
    await stream.manager.stopStreamingRecording();
    await flush();
  });
  assert.equal(h.manager(), stream.manager);
  assert.equal(stream.manager._recordingPrivate, true);
  assert.deepEqual(h.writes, []);
  assert.equal(h.events.at(-1).demoId, "stream-recovery");
  assert.equal(h.events.at(-1).takeId, "14");
  assert.equal(h.events.at(-1).status, "success");
});

test("disposing the real streaming owner during connection cancels it and cannot release newer manager audio", async (t) => {
  const h = await mountTrial(t);
  const stream = configureStreamingStartup(t, h);
  const take = await h.reserve({ demoId: "disposed-stream", takeId: "15" });
  let start;
  await React.act(async () => {
    start = h.api().startRecording({ onboardingTake: take });
    await h.waitAcquisition();
    h.mic().resolve({ getAudioTracks: () => [], getTracks: () => [] });
    await stream.waitConnect();
  });
  await h.render(false, () => {});
  const newer = h.manager();
  assert.notEqual(newer, stream.manager);
  const audio = new Blob(["newer manager audio"]);
  newer.lastAudioBlob = audio;
  newer.lastAudioBlobPrivate = false;
  await React.act(async () => {
    stream.connect.resolve({ success: true });
    await start;
    await flush();
  });
  assert.equal(stream.manager.isRecording, false);
  assert.equal(stream.manager.isStreaming, false);
  assert.equal(newer.lastAudioBlob, audio);
  assert.deepEqual(h.writes, []);
  assert.equal(
    h.events.some((event) => event.status === "success"),
    false
  );
});

for (const boundary of ["microphone", "connection", "finalization"]) {
  test(`stream admission binds adapter A/options across B replacement during ${boundary}`, async (t) => {
    const h = await mountTrial(t);
    const stream = configureStreamingStartup(t, h);
    const calls = [];
    let releaseStop;
    const stopWait = new Promise((resolve) => {
      releaseStop = resolve;
    });
    const api = h.window.electronAPI;
    api.dictationRealtimeStop = async () => {
      calls.push("A.stop");
      if (boundary === "finalization") await stopWait;
      return { success: true };
    };
    api.deepgramStreamingStop = async () => {
      calls.push("B.stop");
      return { success: true };
    };
    api.dictationRealtimeSend = () => calls.push("A.send");
    api.deepgramStreamingSend = () => calls.push("B.send");
    let start;
    await React.act(async () => {
      start = stream.manager.startStreamingRecording();
      await h.waitAcquisition();
    });
    const switchB = () =>
      Object.assign(globalThis.__trialBoundarySettings, {
        cloudTranscriptionProvider: "deepgram",
        cloudTranscriptionModel: "nova-3",
        preferredLanguage: "fr",
      });
    if (boundary === "microphone") switchB();
    await React.act(async () => {
      h.mic().resolve({ getAudioTracks: () => [], getTracks: () => [] });
      await stream.waitConnect();
    });
    const port = stream.manager.streamingProcessor.port;
    if (boundary === "connection") switchB();
    await React.act(async () => {
      stream.connect.resolve({ success: true });
      await start;
    });
    assert.equal(stream.calls.find(([kind]) => kind === "start")[1].provider, "openai-realtime");
    assert.equal(stream.calls.find(([kind]) => kind === "start")[1].language, "en");
    if (boundary === "finalization") {
      stream.listeners.final("Owned A words.");
      let stop;
      await React.act(async () => {
        stop = stream.manager.stopStreamingRecording();
        await flush();
      });
      switchB();
      releaseStop();
      await React.act(async () => {
        await stop;
      });
    } else {
      await React.act(async () => {
        await stream.manager.cancelStreamingRecording();
      });
    }
    port.onmessage({ data: new ArrayBuffer(2) });
    assert.deepEqual(calls, ["A.stop"], "A stops once; B and late buffered sends stay untouched");
  });
}

for (const failure of ["getter", "start", "stop"]) {
  test(`stream owner safely settles a thrown ${failure} without touching B`, async (t) => {
    const h = await mountTrial(t);
    const stream = configureStreamingStartup(t, h);
    let stops = 0,
      bStops = 0;
    h.window.electronAPI.dictationRealtimeStop = () => {
      stops++;
      if (failure === "stop") throw new Error("A stop fixture");
      return { success: true };
    };
    h.window.electronAPI.deepgramStreamingStop = () => {
      bStops++;
      return { success: true };
    };
    if (failure === "getter")
      stream.manager.getStreamingProvider = () => {
        throw new Error("getter fixture");
      };
    if (failure === "start")
      h.window.electronAPI.dictationRealtimeStart = async () => {
        throw new Error("A start fixture");
      };
    let start;
    await React.act(async () => {
      start = stream.manager.startStreamingRecording();
      if (failure !== "getter") h.mic().resolve({ getAudioTracks: () => [], getTracks: () => [] });
      if (failure === "stop") stream.connect.resolve({ success: true });
      await start;
    });
    if (failure === "stop") {
      Object.assign(globalThis.__trialBoundarySettings, { cloudTranscriptionProvider: "deepgram" });
      await React.act(async () => {
        await stream.manager.cancelStreamingRecording();
        await stream.manager.cancelStreamingRecording();
      });
    }
    assert.equal(stops, failure === "getter" ? 0 : 1);
    assert.equal(bStops, 0);
    assert.equal(stream.manager.isStreaming, false);
    assert.equal(stream.manager.streamingStartInProgress, false);
  });
}
