const test = require("node:test");
const assert = require("node:assert/strict");
const { workspace, deferred } = require("../helpers/harness/onboardingWorkspace");

test("actual Router retains ChatView composer and current conversation across restart/return", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("chat"));
  await ui.wait(() => ui.findAll((n) => n.tagName === "TEXTAREA").length);
  await ui.act(() => ui.state.conversations.onSelectConversation(8));
  const textarea = () => ui.findAll((n) => n.tagName === "TEXTAREA")[0];
  await ui.act(() => ui.props(textarea()).onChange({ target: { value: "Unsaved newer draft" } }));
  const node = textarea();
  await ui.start("cleanup");
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  assert.equal(textarea() === node, true, "original composer remains mounted during setup");
  await ui.return();
  await ui.wait(() => textarea());
  assert.equal(textarea() === node, true, "original composer node must survive setup");
  assert.equal(ui.props(textarea()).value, "Unsaved newer draft");
  assert.equal(ui.state.conversations.activeConversationId, 8);
  assert.match(ui.text(), /Original history/);
});

test("actual Router preserves admitted provider callback and assistant persistence while setup is shown", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("chat"));
  await ui.wait(() => ui.findAll((n) => n.tagName === "TEXTAREA").length);
  const textarea = () => ui.findAll((n) => n.tagName === "TEXTAREA")[0];
  await ui.act(() => ui.props(textarea()).onChange({ target: { value: "Question A" } }));
  await ui.act(() =>
    ui.props(textarea()).onKeyDown({
      key: "Enter",
      shiftKey: false,
      nativeEvent: { isComposing: false, keyCode: 13 },
      preventDefault() {},
    })
  );
  await ui.wait(() => ui.state.requests.length === 1);
  const cancels = ui.state.cancels;
  await ui.start("cleanup");
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  assert.equal(ui.state.cancels, cancels, "setup must not unmount/cancel the admitted stream");
  await ui.act(() => ui.state.reply.resolve());
  await ui.wait(() => ui.state.writes.some((w) => w.role === "assistant"));
  assert.deepEqual(ui.state.writes, [
    { id: 7, role: "user", content: "Question A" },
    { id: 7, role: "assistant", content: "first answer" },
  ]);
  await ui.return();
  await ui.wait(() => textarea());
  assert.match(ui.text(), /first answer/);
});

test("actual note draft/editor and original live recording/save owners survive setup and deferred completion", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("personal-notes"));
  await ui.wait(() => ui.byAttr("data-document-editor").length);
  const editor = () => ui.byAttr("data-document-editor")[0];
  const node = editor();
  await ui.act(() => ui.props(editor()).onChange({ target: { value: "New document draft" } }));
  assert.equal(ui.props(editor()).value, "New document draft");
  await ui.act(() =>
    ui.meeting.startRecording({
      noteId: 42,
      noteTitle: "Original",
      folderId: 2,
      seedSegments: [],
      autoEndEligible: true,
    })
  );
  assert.equal(ui.meeting.useMeetingRecordingStore.getState().isRecording, true);
  const session = ui.meeting.getActiveRecordingSessionId();
  const segment = ui.state.segment;
  const autoEnd = ui.state.autoEnd;
  await ui.start("cleanup");
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  assert.equal(editor() === node, true, "actual NoteEditor and draft owner remain mounted");
  assert.equal(ui.state.segment === segment, true, "original recorder subscription remains owned");
  assert.equal(
    ui.state.autoEnd === autoEnd,
    true,
    "original MeetingRecordingMount auto-end consumer remains installed"
  );
  assert.equal(ui.meeting.getActiveRecordingSessionId(), session);
  assert.equal(ui.props(editor()).value, "New document draft");
  await ui.act(() =>
    segment({
      sessionId: session,
      text: "Captured live words",
      speaker: "speaker_0",
      isFinal: true,
      source: "mic",
    })
  );
  const portalButtons = [];
  const visit = (node) => {
    if (node.tagName === "BUTTON") portalButtons.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(globalThis.document.body);
  const stop = portalButtons.find((n) => n.attributes?.["aria-label"] === "notes.editor.stop");
  assert.ok(stop, "actual portalled live Stop remains available during setup");
  await ui.click(stop);
  assert.equal(ui.meeting.useMeetingRecordingStore.getState().isRecording, false);
  assert.ok(
    ui.state.updates.some((w) => w.id === 42 && w.updates.transcript),
    "original stop persists the transcript while setup is shown"
  );
  await ui.return();
  assert.equal(editor() === node, true);
  assert.equal(ui.props(editor()).value, "New document draft");
  await ui.wait(() => ui.state.updates.some((w) => w.updates.content === "New document draft"));
  assert.equal(ui.state.recordingStarts, 1);
});

test("same-step requests have fresh setup lifetimes; hidden keyboard cannot replace current chat or open workspace search", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("chat"));
  await ui.wait(() => ui.findAll((n) => n.tagName === "TEXTAREA").length);
  await ui.act(() => ui.state.conversations.onSelectConversation(8));
  await ui.start("cleanup");
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  const first = ui.byAttr("data-setup-instance")[0].attributes["data-setup-instance"];
  const oldComplete = ui.state.flow.onComplete;
  await ui.start("cleanup");
  assert.notEqual(ui.byAttr("data-setup-instance")[0].attributes["data-setup-instance"], first);
  await ui.act(() => oldComplete({ next: { kind: "dictate-note" } }));
  assert.equal(
    ui.byAttr("data-setup-instance").length,
    1,
    "superseded callback cannot return or hand off"
  );
  for (const key of ["n", "k", ","])
    await ui.act(() =>
      globalThis.window.dispatchEvent({ type: "keydown", key, ctrlKey: true, preventDefault() {} })
    );
  assert.equal(ui.state.conversations.activeConversationId, 8);
  assert.equal(ui.state.saves.length, 0);
  await ui.return();
  assert.equal(ui.state.conversations.activeConversationId, 8);
  const intents = await ui.vite.ssrLoadModule("/utils/afterSetupIntent.ts");
  assert.equal(intents.takeAfterSetupIntent(), null);
});

for (const kind of ["dictate-note", "open-settings"])
  test(`retained Panel consumes each ${kind} completion only on return, once per new intent`, async (t) => {
    const ui = await workspace(t);
    const intents = await ui.vite.ssrLoadModule("/utils/afterSetupIntent.ts");
    for (let round = 0; round < 2; round++) {
      await ui.start("finish");
      await ui.wait(() => ui.byAttr("data-setup-instance").length);
      assert.equal(ui.state.saves.length, kind === "dictate-note" ? round : 0);
      await ui.act(() =>
        ui.state.flow.onComplete({
          next: kind === "dictate-note" ? { kind } : { kind, path: "stt/noteRecording" },
        })
      );
      if (kind === "dictate-note") await ui.wait(() => ui.state.saves.length === round + 1);
      else await ui.wait(() => ui.byAttr("data-settings-path", "stt/noteRecording").length);
      assert.equal(intents.takeAfterSetupIntent(), null, "consumed in RAM exactly once");
      await ui.start("cleanup");
      await ui.return();
      assert.equal(
        ui.state.saves.length,
        kind === "dictate-note" ? round + 1 : 0,
        "ordinary return cannot replay"
      );
    }
    if (kind === "dictate-note")
      assert.equal(
        ui.state.recordingStarts,
        1,
        "actual useCreateNote retains the original live recorder on the second intent"
      );
    else assert.equal(ui.state.recordingStarts ?? 0, 0);
  });

test("first launch does not mount workspace, DB/editor or recording consumers before setup completes", async (t) => {
  const ui = await workspace(t, { firstLaunch: true });
  assert.equal(ui.state.nav, undefined);
  assert.equal(ui.state.autoEnd, undefined);
  assert.equal(
    ui.calls.some(([name]) => name === "getSpaces" || name === "getTranscriptions"),
    false
  );
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  await ui.return();
  await ui.wait(() => ui.state.nav);
  assert.equal(typeof ui.state.autoEnd, "function");
});

test("restart supersedes a completion queued before workspace return without replay", async (t) => {
  const ui = await workspace(t);
  await ui.start("finish");
  await ui.wait(() => ui.state.flow);
  await ui.act(() => {
    ui.state.flow.onComplete({ next: { kind: "dictate-note" } });
    globalThis.window.dispatchEvent(
      new CustomEvent("loqui:start-onboarding", { detail: { step: "cleanup" } })
    );
  });
  assert.equal(ui.state.saves.length, 0);
  await ui.return();
  assert.equal(ui.state.saves.length, 0);
});

test("duplicate completion callbacks cannot leave a second intent in the RAM slot", async (t) => {
  const ui = await workspace(t);
  await ui.start("finish");
  await ui.wait(() => ui.state.flow);
  const complete = ui.state.flow.onComplete;
  await ui.act(() => {
    complete({ next: { kind: "open-settings", path: "stt/noteRecording" } });
    complete({ next: { kind: "dictate-note" } });
  });
  await ui.wait(() => ui.byAttr("data-settings-path", "stt/noteRecording").length);
  assert.equal(ui.state.saves.length, 0);
  assert.equal(ui.byAttr("data-settings-path", "stt/noteRecording").length, 1);
  const intents = await ui.vite.ssrLoadModule("/utils/afterSetupIntent.ts");
  assert.equal(intents.takeAfterSetupIntent(), null);
});

test("hidden ChatInput pauses a queued new send while the admitted answer still persists", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("chat"));
  await ui.wait(() => ui.findAll((n) => n.tagName === "TEXTAREA").length);
  const textarea = () => ui.findAll((n) => n.tagName === "TEXTAREA")[0];
  const type = (value) => ui.act(() => ui.props(textarea()).onChange({ target: { value } }));
  const enter = () =>
    ui.act(() =>
      ui.props(textarea()).onKeyDown({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: false, keyCode: 13 },
        preventDefault() {},
      })
    );
  await type("First question");
  await enter();
  await ui.wait(() => ui.state.requests.length === 1);
  await type("Queued question");
  await enter();
  assert.match(ui.text(), /agentMode.input.queued/);
  await ui.start("cleanup");
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  await ui.act(() => ui.state.reply.resolve());
  await ui.wait(() => ui.state.writes.some((w) => w.role === "assistant"));
  assert.equal(ui.state.requests.length, 1, "hidden composer cannot admit the queued next request");
  assert.equal(ui.props(textarea()).value, "Queued question");
  await ui.return();
  await ui.wait(() => ui.state.requests.length === 2);
  assert.equal(
    ui.state.writes.filter((w) => w.role === "user" && w.content === "Queued question").length,
    1
  );
});

test("restart preserves a pending first creation, newer draft and original captured inference", async (t) => {
  const ui = await workspace(t);
  await ui.act(() => ui.state.nav.onViewChange("chat"));
  await ui.wait(() => ui.findAll((n) => n.tagName === "TEXTAREA").length);
  const textarea = () => ui.findAll((n) => n.tagName === "TEXTAREA")[0];
  ui.state.creation = deferred();
  await ui.act(() => ui.props(textarea()).onChange({ target: { value: "Admitted A" } }));
  await ui.act(() =>
    ui.props(textarea()).onKeyDown({
      key: "Enter",
      shiftKey: false,
      nativeEvent: { isComposing: false, keyCode: 13 },
      preventDefault() {},
    })
  );
  await ui.act(() => ui.props(textarea()).onChange({ target: { value: "Newer unsent draft" } }));
  const node = textarea();
  await ui.start("cleanup");
  await ui.wait(() => ui.byAttr("data-setup-instance").length);
  const { useSettingsStore } = await ui.vite.ssrLoadModule("/stores/settingsStore.ts");
  await ui.act(() =>
    useSettingsStore.setState({
      chatAgentMode: "local",
      chatAgentProvider: "ollama",
      chatAgentModel: "different-model",
    })
  );
  await ui.act(() => ui.state.creation.resolve({ id: 7 }));
  await ui.wait(() => ui.state.requests.length === 1);
  assert.equal(ui.state.requests[0][1], "tiny-1b");
  assert.equal(
    ui.state.requests[0][2],
    "lan",
    "admitted inference never retargets across persistence/setup"
  );
  await ui.act(() => ui.state.reply.resolve());
  await ui.wait(() => ui.state.writes.some((w) => w.role === "assistant"));
  await ui.return();
  assert.equal(textarea() === node, true);
  assert.equal(ui.props(textarea()).value, "Newer unsent draft");
  assert.equal(ui.state.conversations.activeConversationId, 7);
  assert.deepEqual(ui.state.writes, [
    { id: 7, role: "user", content: "Admitted A" },
    { id: 7, role: "assistant", content: "first answer" },
  ]);
});
