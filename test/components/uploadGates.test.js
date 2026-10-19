const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

async function mount(t, routeOverride = null) {
  const diagnostics = [],
    originalWarn = console.warn,
    originalError = console.error;
  console.warn = (...args) => diagnostics.push(["warn", ...args]);
  console.error = (...args) => diagnostics.push(["error", ...args]);
  let root;
  t.after(async () => {
    try {
      if (root) await React.act(async () => root.unmount());
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
    assert.deepEqual(diagnostics, [], "unexpected diagnostics fail the fixture");
  });
  let chooser = deferred(),
    inventory = deferred();
  const calls = [],
    opened = [];
  installBrowserGlobals(t, {
    initialStorage: {
      transcriptionMode: "local",
      useLocalWhisper: "true",
      uploadTranscriptionMode: "local",
      uploadUseLocalWhisper: "true",
    },
    window: {
      electronAPI: {
        getDiarizationModelStatus: async () => ({ modelsDownloaded: true }),
        getSpaces: async () => [],
        getFolders: async () => [],
        listWhisperModels: () => inventory.promise,
        selectAudioFile: () => {
          calls.push("browse");
          return chooser.promise;
        },
        getFileSize: async () => 100,
        getPathForFile: (f) => {
          calls.push("path");
          return "/memory/" + f.name;
        },
        downloadUrlAudio: async () => {
          calls.push("download");
          return { success: false, error: "Memory failure" };
        },
        cancelUrlDownload: () => calls.push("cancel"),
        deleteTempFile: () => calls.push("delete"),
      },
    },
  });
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-upload-gates-", {
      ...(routeOverride
        ? {
            "/lib/routes": `
      const route = {state:${JSON.stringify(routeOverride)}};
      export const useResolvedRoute = () => route;
      export const routeSnapshotFromSettings = () => ({});
      export const resolveRoute = () => route;
    `,
          }
        : {}),
      "/services/fileTranscription": `export const transcribeFileWithSpeakers = async () => { globalThis.__uploadCalls.push("transcribe"); return globalThis.__uploadResult ? await globalThis.__uploadResult : { success:false, error:"Memory failure" }; }; export const resolveDiarizationSettings = async () => globalThis.__uploadDiarizationWait ? await globalThis.__uploadDiarizationWait : ({ enabled:false }); export const shouldUseByokDiarize = () => false; export const getTranscriptionApiKey = () => "";`,
    })
  );
  globalThis.__uploadCalls = calls;
  t.after(() => {
    delete globalThis.__uploadCalls;
    delete globalThis.__uploadResult;
    delete globalThis.__uploadDiarizationWait;
  });
  const { default: View } = await vite.ssrLoadModule("/components/notes/UploadAudioView.tsx");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteFactsStore, EMPTY_ROUTE_FACTS } = await vite.ssrLoadModule(
    "/stores/routeFactsStore.ts"
  );
  const { useSealedStore: sealedStore } = await vite.ssrLoadModule("/stores/sealedStore.ts");
  const batch = await vite.ssrLoadModule("/stores/batchQueueStore.ts");
  const { useSealedStore } = await vite.ssrLoadModule("/stores/sealedStore.ts");
  useSealedStore.setState({ sealed: false });
  useSettingsStore.setState({
    transcriptionMode: "local",
    useLocalWhisper: true,
    localTranscriptionProvider: "whisper",
    whisperModel: "base",
    uploadTranscriptionMode: "local",
    uploadLocalTranscriptionProvider: "whisper",
    uploadWhisperModel: "base",
    uploadUseLocalWhisper: true,
  });
  root = createRoot(tree.container);
  await React.act(async () =>
    root.render(React.createElement(View, { onOpenSettings: (s) => opened.push(s) }))
  );
  const facts = async (installed) =>
    React.act(async () =>
      useRouteFactsStore.setState({
        facts: {
          ...EMPTY_ROUTE_FACTS,
          installed: { ...EMPTY_ROUTE_FACTS.installed, whisper: installed },
        },
      })
    );
  await facts(null);
  const find = (predicate) => tree.find((n) => predicate(tree.props(n) ?? {}, n));
  const zone = () =>
    find((p) => p.role === "button" && p["aria-label"] === "notes.upload.dropOrBrowse");
  const url = () => find((p, n) => n.tagName === "INPUT" && p.type === "url");
  const button = (key) => find((p) => p.children === key);
  const act = (fn) =>
    React.act(async () => {
      await fn();
    });
  return {
    tree,
    find,
    zone,
    url,
    button,
    facts,
    act,
    calls,
    opened,
    chooser,
    inventory,
    batch,
    useSettingsStore,
    useRouteFactsStore,
    sealedStore,
    unmount: async () => {
      await React.act(async () => root.unmount());
      root = null;
    },
  };
}

async function startAdmittedFile(h) {
  await h.facts(new Set(["base"]));
  await h.act(() =>
    h.batch.addFiles([{ name: "admitted.wav", path: "/memory/admitted.wav", sizeBytes: 100 }])
  );
  const first = deferred();
  globalThis.__uploadResult = first.promise;
  await h.act(() => h.tree.props(h.button("notes.upload.transcribe")).onClick());
  assert.deepEqual(h.calls, ["transcribe"]);
  assert.equal(h.batch.useBatchQueueStore.getState().isProcessing, true);
  return first;
}

for (const boundary of ["chooser", "size"]) {
  for (const names of [["returned.wav"], ["returned.wav", "second.wav"]]) {
    test(`pending chooser active drain: readiness lost during ${boundary}, ${names.length} files retained until explicit admission`, async (t) => {
      const h = await mount(t),
        p = (n) => h.tree.props(n);
      const first = await startAdmittedFile(h);
      await h.act(() =>
        p(h.url()).onChange({ target: { value: "https://example.invalid/draft" } })
      );
      const sizes = names.map(() => deferred());
      let sizeCalls = 0;
      if (boundary === "size")
        globalThis.window.electronAPI.getFileSize = () => sizes[sizeCalls++].promise;
      const browsing = p(h.zone()).onClick();
      if (boundary === "chooser") await h.facts(null);
      await h.act(() =>
        h.chooser.resolve({ canceled: false, filePaths: names.map((n) => "/memory/" + n) })
      );
      if (boundary === "size") {
        assert.equal(sizeCalls, 1, "chooser returned and size read is actually pending");
        await h.facts(null);
        for (const size of sizes) await h.act(() => size.resolve(100));
      }
      await browsing;
      await h.act(() => first.resolve({ success: false, error: "Memory failure" }));
      assert.equal(h.calls.filter((c) => c === "transcribe").length, 1);
      assert.equal(p(h.url()).value, "https://example.invalid/draft");
      assert.equal(
        h.batch.useBatchQueueStore.getState().queue.length,
        1,
        "pending files never enter the active queue"
      );
      for (const name of names)
        assert.ok(
          h.find((p) => p.children === name),
          name
        );
      const add = h.button("notes.upload.addToQueue");
      assert.ok(add);
      assert.equal(p(add).disabled, true);
      const heldAdd = p(add).onClick;
      await h.act(heldAdd);
      assert.equal(h.batch.useBatchQueueStore.getState().queue.length, 1);
      await h.facts(new Set(["base"]));
      assert.equal(
        h.batch.useBatchQueueStore.getState().queue.length,
        1,
        "ready restoration alone is inert"
      );
      assert.equal(h.calls.filter((c) => c === "transcribe").length, 1);
      await h.act(() => {
        heldAdd();
        heldAdd();
      });
      assert.deepEqual(
        h.batch.useBatchQueueStore.getState().queue.map((i) => i.name),
        ["admitted.wav", ...names]
      );
      assert.equal(h.button("notes.upload.addToQueue"), null);
      await h.act(heldAdd);
      assert.equal(
        h.batch.useBatchQueueStore.getState().queue.length,
        1 + names.length,
        "old callback cannot duplicate admission"
      );
      await h.act(() => p(h.button("notes.upload.transcribe")).onClick());
      assert.equal(h.calls.filter((c) => c === "transcribe").length, 1 + names.length);
    });
  }
}

test("pending chooser concurrent completions accumulate and held add consumes only current pending files", async (t) => {
  const h = await mount(t),
    p = (n) => h.tree.props(n);
  const first = await startAdmittedFile(h);
  const choices = [deferred(), deferred(), deferred()];
  let next = 0;
  globalThis.window.electronAPI.selectAudioFile = () => choices[next++].promise;
  const browse = p(h.zone()).onClick;
  const completions = [browse(), browse()];
  await h.facts(null);
  await h.act(() =>
    choices[1].resolve({ canceled: false, filePaths: ["/memory/b.wav", "/memory/c.wav"] })
  );
  await completions[1];
  assert.ok(h.button("notes.upload.addToQueue"), "returned files need an inert pending action");
  const heldAdd = p(h.button("notes.upload.addToQueue")).onClick;
  await h.act(() => choices[0].resolve({ canceled: false, filePaths: ["/memory/a.wav"] }));
  await completions[0];
  for (const name of ["a.wav", "b.wav", "c.wav"]) assert.ok(h.find((p) => p.children === name));
  await h.facts(new Set(["base"]));
  await h.act(() => {
    heldAdd();
    heldAdd();
  });
  assert.deepEqual(
    h.batch.useBatchQueueStore.getState().queue.map((i) => i.name),
    ["admitted.wav", "b.wav", "c.wav", "a.wav"]
  );
  const third = browse();
  await h.facts(null);
  await h.act(() => choices[2].resolve({ canceled: false, filePaths: ["/memory/d.wav"] }));
  await third;
  await h.act(heldAdd);
  assert.equal(h.batch.useBatchQueueStore.getState().queue.length, 4);
  await h.facts(new Set(["base"]));
  await h.act(heldAdd);
  assert.deepEqual(
    h.batch.useBatchQueueStore.getState().queue.map((i) => i.name),
    ["admitted.wav", "b.wav", "c.wav", "a.wav", "d.wav"]
  );
  await h.act(() => first.resolve({ success: false, error: "Memory failure" }));
  assert.equal(h.calls.filter((c) => c === "transcribe").length, 5);
});

for (const boundary of ["chooser", "size"]) {
  test(`pending chooser unmount during ${boundary} cannot feed the admitted drain`, async (t) => {
    const h = await mount(t),
      p = (n) => h.tree.props(n);
    const first = await startAdmittedFile(h);
    const size = deferred();
    if (boundary === "size") globalThis.window.electronAPI.getFileSize = () => size.promise;
    const browsing = p(h.zone()).onClick();
    if (boundary === "chooser") await h.unmount();
    await h.act(() => h.chooser.resolve({ canceled: false, filePaths: ["/memory/late.wav"] }));
    if (boundary === "size") {
      await h.unmount();
      await h.act(() => size.resolve(100));
    }
    await browsing;
    await h.act(() => first.resolve({ success: false, error: "Memory failure" }));
    assert.equal(h.batch.useBatchQueueStore.getState().queue.length, 1);
    assert.equal(h.calls.filter((c) => c === "transcribe").length, 1);
  });
}

test("pending chooser selection survives original batch cancellation without admitting late files", async (t) => {
  const h = await mount(t),
    p = (n) => h.tree.props(n);
  globalThis.window.electronAPI.saveNote = async () => {
    h.calls.push("save");
    return { success: false, error: "Unexpected save" };
  };
  globalThis.window.electronAPI.cancelUploadTranscription = () => h.calls.push("cancelTranscribe");
  const first = await startAdmittedFile(h);
  const browsing = p(h.zone()).onClick();
  await h.facts(null);
  await h.act(() => h.chooser.resolve({ canceled: false, filePaths: ["/memory/retained.wav"] }));
  await browsing;
  await h.act(() => p(h.button("notes.upload.cancelAll")).onClick());
  await h.act(() => first.resolve({ success: true, text: "Late result must not save" }));
  assert.equal(h.batch.useBatchQueueStore.getState().isProcessing, false);
  assert.equal(h.calls.filter((c) => c === "transcribe").length, 1);
  assert.ok(h.calls.includes("cancelTranscribe"));
  assert.equal(h.calls.includes("save"), false, "canceled A cannot save its late success");
  assert.ok(h.find((p) => p.children === "retained.wav"));
  assert.ok(h.button("notes.upload.addToQueue"));
  assert.equal(p(h.button("notes.upload.addToQueue")).disabled, true);
});

test("pending chooser held add cannot admit a retained selection after unmount", async (t) => {
  const h = await mount(t),
    p = (n) => h.tree.props(n);
  const first = await startAdmittedFile(h);
  const browsing = p(h.zone()).onClick();
  await h.facts(null);
  await h.act(() => h.chooser.resolve({ canceled: false, filePaths: ["/memory/retained.wav"] }));
  await browsing;
  const heldAdd = p(h.button("notes.upload.addToQueue")).onClick;
  await h.facts(new Set(["base"]));
  await h.unmount();
  await h.act(heldAdd);
  await h.act(() => first.resolve({ success: false, error: "Memory failure" }));
  assert.equal(h.batch.useBatchQueueStore.getState().queue.length, 1);
  assert.equal(h.calls.filter((c) => c === "transcribe").length, 1);
});

test("real view keeps unknown visible/inert, actual facts alone enable it, stale handlers fail closed", async (t) => {
  const h = await mount(t),
    p = (n) => h.tree.props(n);
  assert.ok(h.zone(), "unknown still explains upload");
  assert.equal(p(h.zone())["aria-disabled"], true);
  assert.equal(p(h.url()).disabled, true);
  assert.ok(h.find((p) => p["data-state"] === "unknown"));
  assert.equal(h.button("notes.upload.chooseModel"), null);
  assert.equal(
    h.find((p) => p.role === "switch"),
    null
  );
  await h.act(() =>
    h.inventory.resolve({ success: true, models: [{ model: "other", downloaded: true }] })
  );
  assert.equal(
    p(h.zone())["aria-disabled"],
    true,
    "unselected inventory cannot enable selected model"
  );
  await h.facts(new Set(["base"]));
  assert.equal(p(h.zone())["aria-disabled"], undefined);
  assert.ok(h.find((p) => p.role === "switch"));
  const held = p(h.zone()).onClick,
    drop = p(h.zone()).onDrop;
  await h.act(() =>
    p(h.url()).onChange({ target: { value: "https://example.invalid/audio.mp3" } })
  );
  const submit = p(h.find((p) => p["aria-label"] === "notes.upload.urlSubmit")).onClick;
  const enter = p(h.url()).onKeyDown;
  await h.facts(null);
  let prevented = false;
  await h.act(() => {
    held();
    submit();
    enter({ key: "Enter", preventDefault() {} });
    drop({
      preventDefault() {
        prevented = true;
      },
      dataTransfer: { files: [{ name: "audio.mp3", size: 100 }] },
    });
  });
  assert.equal(prevented, true);
  assert.deepEqual(h.calls, []);
  assert.equal(p(h.url()).value, "https://example.invalid/audio.mp3");
});

test("needsModel supplies exact fix and upload Settings alias; other states stay truthful", async (t) => {
  const h = await mount(t),
    p = (n) => h.tree.props(n);
  await h.facts(new Set());
  assert.ok(h.button("notes.upload.chooseModel"));
  await h.act(() => p(h.button("notes.upload.chooseModel")).onClick());
  assert.deepEqual(h.opened, ["uploadTranscription"]);
  await h.act(() =>
    h.useRouteFactsStore.setState({
      facts: {
        ...h.useRouteFactsStore.getState().facts,
        credentials: new Map([["openai", false]]),
      },
    })
  );
  for (const [settings, expected, detail] of [
    [
      {
        uploadUseLocalWhisper: false,
        uploadTranscriptionMode: "providers",
        uploadCloudTranscriptionProvider: "openai",
        uploadCloudTranscriptionModel: "whisper-1",
      },
      "needsKey",
    ],
    [{ uploadTranscriptionMode: "self-hosted", remoteTranscriptionUrl: "" }, "needsUrl"],
    [{ uploadTranscriptionMode: "openwhispr" }, "unreachable", "routes.state.retired"],
    [
      { uploadTranscriptionMode: "providers", uploadCloudTranscriptionProvider: "deepgram" },
      "unreachable",
      "routes.state.unsupported",
    ],
  ]) {
    await h.act(() => h.useSettingsStore.setState(settings));
    assert.equal(p(h.zone())["aria-disabled"], true);
    assert.equal(h.button("notes.upload.chooseModel"), null);
    const chip = h.find((p) => p["data-state"] === expected);
    assert.ok(chip, expected);
    if (detail) assert.equal(p(chip).children[1], detail);
  }
  await h.act(() => h.sealedStore.setState({ sealed: true }));
  const chip = h.find((p) => p["data-state"] === "unreachable");
  assert.equal(p(chip).children[1], "routes.state.sealed");
  assert.deepEqual(h.calls, []);
});

test("pending chooser retains selection after readiness loss but cannot transcribe", async (t) => {
  const h = await mount(t),
    p = (n) => h.tree.props(n);
  await h.facts(new Set(["base"]));
  const pending = p(h.zone()).onClick();
  await h.facts(null);
  await h.act(() => h.chooser.resolve({ canceled: false, filePaths: ["/memory/audio.mp3"] }));
  await pending;
  const transcribe = h.button("notes.upload.transcribe");
  assert.ok(transcribe);
  assert.equal(p(transcribe).disabled, true);
  await h.act(() => p(transcribe).onClick());
  assert.deepEqual(h.calls, ["browse"]);
  assert.ok(h.find((p) => p.children === "audio.mp3"));
});

test("expanded URL and existing queue survive readiness loss without admitting or starting work", async (t) => {
  const h = await mount(t),
    p = (n) => h.tree.props(n);
  await h.facts(new Set(["base"]));
  await h.act(() =>
    p(h.url()).onPaste({
      clipboardData: { getData: () => "https://example.invalid/a\nhttps://example.invalid/b" },
      preventDefault() {},
    })
  );
  const textarea = h.find((p, n) => n.tagName === "TEXTAREA");
  const heldAdd = p(h.button("notes.upload.addToQueue")).onClick;
  await h.facts(null);
  assert.equal(p(textarea).disabled, true);
  await h.act(heldAdd);
  assert.equal(h.batch.useBatchQueueStore.getState().queue.length, 0);
  assert.match(p(textarea).value, /example.invalid/);
  await h.facts(new Set(["base"]));
  await h.act(() => p(h.button("notes.upload.addToQueue")).onClick());
  assert.equal(h.batch.useBatchQueueStore.getState().queue.length, 2);
  const heldStart = p(h.button("notes.upload.transcribe")).onClick;
  await h.facts(null);
  assert.equal(p(h.button("notes.upload.transcribe")).disabled, true);
  await h.act(heldStart);
  assert.equal(h.batch.useBatchQueueStore.getState().isProcessing, false);
  assert.equal(h.batch.useBatchQueueStore.getState().queue.length, 2);
  assert.deepEqual(h.calls, []);
});

test("readiness comes from shared routes, never the removed renderer credential heuristic", () => {
  const src = fs.readFileSync("src/components/notes/UploadAudioView.tsx", "utf8");
  assert.ok(src.includes('useResolvedRoute("uploadStt")'));
  assert.equal(
    /NoProviderView|checkProviderReady|getTranscriptionApiKey|useSettings\(/.test(src),
    false
  );
});

test("ready drop selects, stale selected and retry handlers cannot launch; an admitted operation is preserved", async (t) => {
  const h = await mount(t),
    p = (n) => h.tree.props(n);
  await h.facts(new Set(["base"]));
  await h.act(() =>
    p(h.zone()).onDrop({
      preventDefault() {},
      dataTransfer: { files: [{ name: "memory.wav", size: 100 }] },
    })
  );
  const held = p(h.button("notes.upload.transcribe")).onClick;
  await h.facts(null);
  await h.act(held);
  assert.deepEqual(h.calls, ["path"]);
  await h.facts(new Set(["base"]));
  const pending = deferred();
  globalThis.__uploadResult = pending.promise;
  let admitted;
  await h.act(() => {
    admitted = p(h.button("notes.upload.transcribe")).onClick();
  });
  assert.deepEqual(h.calls, ["path", "transcribe"]);
  await h.facts(null);
  await h.act(() => pending.resolve({ success: false, error: "Memory failure" }));
  await admitted;
  assert.ok(h.find((p) => p.children === "Memory failure"));
  const retry = p(h.button("notes.upload.retry"));
  assert.equal(retry.disabled, true);
  await h.act(retry.onClick);
  assert.deepEqual(
    h.calls,
    ["path", "transcribe"],
    "readiness loss neither cancels admitted work nor admits retry"
  );
});

test("drag feedback ends when route readiness is lost and does not resume without a new drag", async (t) => {
  const h = await mount(t),
    p = (n) => h.tree.props(n);
  await h.facts(new Set(["base"]));
  await h.act(() => p(h.zone()).onDragOver({ preventDefault() {} }));
  assert.ok(p(h.zone()).className.includes("upload-drop-zone-active"));
  await h.facts(null);
  await h.facts(new Set(["base"]));
  assert.equal(p(h.zone()).className.includes("upload-drop-zone-active"), false);
});

test("the published off-state contract stays inert (the current upload graph has no off setting)", async (t) => {
  const h = await mount(t, { status: "off" }),
    p = (n) => h.tree.props(n);
  assert.equal(p(h.zone())["aria-disabled"], true);
  assert.equal(p(h.url()).disabled, true);
  assert.ok(h.find((p) => p["data-state"] === "off"));
  assert.equal(h.button("notes.upload.chooseModel"), null);
  assert.equal(
    h.find((p) => p.role === "switch"),
    null
  );
  await h.act(() => p(h.find((p) => p["aria-label"] === "notes.upload.urlSubmit")).onClick());
  assert.deepEqual(h.calls, []);
});

test("queue start rechecks readiness after its pending speaker settings resolve", async (t) => {
  const h = await mount(t),
    p = (n) => h.tree.props(n);
  await h.facts(new Set(["base"]));
  await h.act(() => h.batch.addUrls(["https://example.invalid/pending.wav"]));
  const wait = deferred();
  globalThis.__uploadDiarizationWait = wait.promise;
  let start;
  await h.act(() => {
    start = p(h.button("notes.upload.transcribe")).onClick();
  });
  assert.equal(h.batch.useBatchQueueStore.getState().isProcessing, false);
  await h.facts(null);
  await h.act(() => wait.resolve({ enabled: false }));
  await start;
  assert.equal(h.batch.useBatchQueueStore.getState().isProcessing, false);
  assert.equal(h.batch.useBatchQueueStore.getState().queue[0].status, "queued");
  assert.deepEqual(h.calls, []);
});
