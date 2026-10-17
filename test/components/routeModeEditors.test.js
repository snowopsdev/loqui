const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");
const { createProbeRoot, findElement } = require("../lib/probeRoot");
const {
  SRC,
  primeRouteFacts,
  rendererServer,
  routeTestApi,
  noticeCapture,
} = require("../lib/routeTestApi");

test("change-driving: mode selectors go through the route planner (I1)", async (t) => {
  installBrowserGlobals(t, {
    window: {
      dispatchEvent: () => true,
      electronAPI: routeTestApi({ present: ["openai", "groq"] }),
      location: { search: "" },
    },
  });
  const vite = await rendererServer(t, "loqui-route-mode-editors-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteDraftStore } = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { MeetingTranscriptionPanel } = await vite.ssrLoadModule(
    "/components/settings/MeetingSettings.tsx"
  );
  const { UploadTranscriptionPanel } = await vite.ssrLoadModule(
    "/components/settings/UploadSettings.tsx"
  );
  const InferenceConfigEditor = (
    await vite.ssrLoadModule("/components/settings/InferenceConfigEditor.tsx")
  ).default;
  await primeRouteFacts(vite);
  const { notices, wrap, clearNotices } = await noticeCapture(vite, t);
  const probes = createProbeRoot(t, { wrap });
  const selector = (tree) =>
    findElement(
      tree,
      (node) => typeof node.props?.onSelect === "function" && Array.isArray(node.props?.modes)
    );

  // Change-driving: the handler wrote meetingTranscriptionMode directly.
  await t.test(
    "change-driving: note recording: Cloud is staged with no provider; re-picking the active mode discards it",
    async () => {
      await probes.act(() => useRouteDraftStore.getState().discard());
      await probes.act(() =>
        useSettingsStore.setState({
          meetingTranscriptionMode: "local",
          meetingUseLocalWhisper: true,
        })
      );
      const tree = await probes.mount("meeting", () => MeetingTranscriptionPanel());
      await probes.act(() => selector(tree()).props.onSelect("providers"));
      await probes.settle();
      assert.deepEqual(useRouteDraftStore.getState().draft, {
        routeId: "noteRecordingStt",
        kind: "target",
        target: { mode: "providers", provider: "" },
      });
      assert.equal(useSettingsStore.getState().meetingTranscriptionMode, "local");
      assert.equal(selector(tree()).props.stagedMode, "providers");
      await probes.act(() => selector(tree()).props.onSelect("local"));
      await probes.settle();
      assert.equal(useRouteDraftStore.getState().draft, null);
    }
  );

  // Change-driving: the handler wrote uploadTranscriptionMode directly.
  await t.test(
    "change-driving: upload: Self-hosted is staged against dictation's shared server",
    async () => {
      await probes.act(() => useRouteDraftStore.getState().discard());
      await probes.act(() =>
        useSettingsStore.setState({
          uploadTranscriptionMode: "local",
          remoteTranscriptionUrl: "http://192.168.1.20:8178",
        })
      );
      const tree = await probes.mount("upload", () => UploadTranscriptionPanel());
      await probes.act(() => selector(tree()).props.onSelect("self-hosted"));
      await probes.settle();
      assert.deepEqual(useRouteDraftStore.getState().draft?.target, {
        mode: "self-hosted",
        remoteUrl: "http://192.168.1.20:8178",
      });
      assert.equal(useSettingsStore.getState().uploadTranscriptionMode, "local");
    }
  );

  // Change-driving (SET-Q10): the old toast said "On Device" with no Undo.
  await t.test(
    "change-driving: chat: Local applies at once and notices the destination with Undo",
    async () => {
      await probes.act(() => useRouteDraftStore.getState().discard());
      await probes.act(() =>
        useSettingsStore.setState({
          chatAgentMode: "providers",
          chatAgentProvider: "groq",
          chatAgentModel: "openai/gpt-oss-120b",
        })
      );
      clearNotices();
      const tree = await probes.mount("chat", () =>
        InferenceConfigEditor({ scope: "chatIntelligence" })
      );
      await probes.act(() => selector(tree()).props.onSelect("local"));
      await probes.settle();
      assert.equal(useSettingsStore.getState().chatAgentMode, "local");
      assert.equal(useRouteDraftStore.getState().draft, null);
      assert.equal(notices.length, 1);
      assert.match(notices[0].title, /routes\.toast\.local/);
      assert.equal(notices[0].actions?.[0]?.label, "routes.toast.undo");
    }
  );

  // Source guard (TranscriptionSection is not exported): change-driving today.
  await t.test(
    "change-driving: dictation's mode handler requests a route change instead of writing the store",
    () => {
      const source = fs.readFileSync(path.join(SRC, "components/SettingsPage.tsx"), "utf8");
      const section = source.slice(
        source.indexOf("function TranscriptionSection"),
        source.indexOf("interface AiModelsSectionProps")
      );
      const handler = section.slice(
        section.indexOf("const handleTranscriptionModeSelect"),
        section.indexOf("const selectedCloudModelStreams")
      );
      assert.match(handler, /request\(\s*"dictationStt",\s*stagedTargetForMode\(/);
      assert.doesNotMatch(handler, /setTranscriptionMode\(|setUseLocalWhisper\(|toast\(/);
      assert.doesNotMatch(source, /CLEANUP_MODE_TOAST_KEY|handleCleanupModeChange/);
    }
  );
});

// Change-driving: the old active-mode early return did not cancel an older
// Cloud pick still waiting for local metadata.
test(
  "change-driving: active-mode re-picks supersede pending Cloud picks in each mounted editor",
  { timeout: 15000 },
  async (t) => {
    const api = routeTestApi({ present: ["openai"] });
    installBrowserGlobals(t, { window: { dispatchEvent: () => true, electronAPI: api } });
    const vite = await rendererServer(t, "loqui-mode-repick-pending-");
    const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
    const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
    const { MeetingTranscriptionPanel } = await vite.ssrLoadModule(
      "/components/settings/MeetingSettings.tsx"
    );
    const { UploadTranscriptionPanel } = await vite.ssrLoadModule(
      "/components/settings/UploadSettings.tsx"
    );
    const InferenceConfigEditor = (
      await vite.ssrLoadModule("/components/settings/InferenceConfigEditor.tsx")
    ).default;
    await primeRouteFacts(vite);
    const { notices, wrap } = await noticeCapture(vite, t);
    const probes = createProbeRoot(t, { wrap });
    const list = api.credentials.list;
    const held = [];
    api.credentials.list = () => new Promise((resolve) => held.push(() => resolve(list())));
    const choices = [
      ["meeting", () => MeetingTranscriptionPanel(), "meetingTranscriptionMode"],
      ["upload", () => UploadTranscriptionPanel(), "uploadTranscriptionMode"],
      ["chat", () => InferenceConfigEditor({ scope: "chatIntelligence" }), "chatAgentMode"],
    ];
    for (const [name, component, key] of choices) {
      await t.test(`change-driving: ${name}`, async () => {
        await probes.act(() => {
          drafts.endSettingsSession();
          useSettingsStore.setState({
            [key]: "local",
            meetingUseLocalWhisper: true,
            uploadUseLocalWhisper: true,
            chatAgentProvider: "qwen",
            chatAgentModel: "qwen3-4b",
          });
        });
        const tree = await probes.mount(name, component);
        const selector = () =>
          findElement(
            tree(),
            (node) => typeof node.props?.onSelect === "function" && Array.isArray(node.props?.modes)
          );
        await probes.act(() => {
          void selector().props.onSelect("providers");
        });
        await probes.settle();
        assert.ok(held.length >= 1, "the pick is waiting for local credential metadata");
        await probes.act(() => {
          void selector().props.onSelect("local");
        });
        await probes.settle();
        await probes.act(() => {
          for (const release of held.splice(0)) release();
        });
        await probes.settle();
        assert.equal(drafts.useRouteDraftStore.getState().draft, null);
        assert.equal(useSettingsStore.getState()[key], "local");
        assert.equal(notices.length, 0);
      });
    }
  }
);

// Change-driving: cancelling a visible draft used global discard, which ended
// the session and silently superseded another route's pending request.
test(
  "change-driving: active-mode re-pick preserves unrelated drafts and pending route intent",
  { timeout: 15000 },
  async (t) => {
    const api = routeTestApi({ present: ["openai"] });
    installBrowserGlobals(t, { window: { dispatchEvent: () => true, electronAPI: api } });
    const vite = await rendererServer(t, "loqui-mode-repick-other-route-");
    const { TEST_COPY } = require("../lib/routeStateFixture");
    const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
    const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
    const { MeetingTranscriptionPanel } = await vite.ssrLoadModule(
      "/components/settings/MeetingSettings.tsx"
    );
    await primeRouteFacts(vite);
    const { wrap } = await noticeCapture(vite, t);
    const probes = createProbeRoot(t, { wrap });
    useSettingsStore.setState({
      meetingTranscriptionMode: "local",
      meetingUseLocalWhisper: true,
      chatAgentMode: "local",
      chatAgentProvider: "qwen",
      chatAgentModel: "qwen3-4b",
    });
    const unrelated = {
      routeId: "translation",
      kind: "target",
      target: { mode: "providers", provider: "openai", model: "gpt-6-astra" },
    };
    drafts.useRouteDraftStore.getState().stage(unrelated);
    const tree = await probes.mount("meeting", () => MeetingTranscriptionPanel());
    const select = () =>
      findElement(
        tree(),
        (node) => typeof node.props?.onSelect === "function" && Array.isArray(node.props?.modes)
      );
    await probes.act(() => select().props.onSelect("local"));
    await probes.settle();
    assert.equal(drafts.useRouteDraftStore.getState().draft, unrelated);
    const session = drafts.useRouteDraftStore.getState().requestEpoch;
    await probes.act(() =>
      drafts.useRouteDraftStore.getState().stage({
        routeId: "noteRecordingStt",
        kind: "target",
        target: { mode: "providers", provider: "openai" },
      })
    );
    const list = api.credentials.list;
    const held = [];
    api.credentials.list = () => new Promise((resolve) => held.push(() => resolve(list())));
    let pending;
    await probes.act(() => {
      pending = drafts.requestRouteChange(
        "chat",
        { mode: "providers", provider: "openai", model: "gpt-6-astra" },
        TEST_COPY
      );
    });
    await probes.settle();
    await probes.act(() => select().props.onSelect("local"));
    await probes.settle();
    await probes.act(() => {
      for (const release of held.splice(0)) release();
    });
    await probes.settle();
    assert.equal(await pending, "staged");
    assert.equal(
      drafts.useRouteDraftStore.getState().requestEpoch,
      session,
      "route cancellation does not end the session"
    );
    assert.equal(drafts.useRouteDraftStore.getState().draft.routeId, "chat");
  }
);

// Change-driving source guard: dictation is a private page section; all four
// handlers must use the same route-only cancellation API after active re-pick.
test("change-driving: all four active-mode handlers request an empty route patch", () => {
  for (const [file, route] of [
    ["components/SettingsPage.tsx", '"dictationStt"'],
    ["components/settings/MeetingSettings.tsx", '"noteRecordingStt"'],
    ["components/settings/UploadSettings.tsx", '"uploadStt"'],
    ["components/settings/InferenceConfigEditor.tsx", "routeId"],
  ]) {
    const source = fs.readFileSync(path.join(SRC, file), "utf8");
    const handlerStart = source.indexOf(
      file.endsWith("InferenceConfigEditor.tsx")
        ? "const handleModeSelect"
        : "const handleTranscriptionModeSelect"
    );
    const handler = source.slice(handlerStart, source.indexOf("\n  const ", handlerStart + 1));
    assert.ok(handler.includes(`requestPatch(${route}, {})`), file);
    assert.doesNotMatch(handler, /getState\(\)\.discard\(/, file);
  }
});
