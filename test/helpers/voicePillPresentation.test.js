const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/voicePillPresentation.js");

test("Live Transcript stages footer growth, controls, then content", async () => {
  const { resolveLiveTranscriptEntrancePresentation } = await load();

  assert.deepEqual(resolveLiveTranscriptEntrancePresentation("encapsulate"), {
    coreStage: "encapsulated",
    controlsVisible: false,
    contentVisible: false,
  });
  assert.deepEqual(resolveLiveTranscriptEntrancePresentation("horizontal"), {
    coreStage: "footer",
    controlsVisible: false,
    contentVisible: false,
  });
  assert.deepEqual(resolveLiveTranscriptEntrancePresentation("controls"), {
    coreStage: "footer",
    controlsVisible: true,
    contentVisible: false,
  });
  assert.deepEqual(resolveLiveTranscriptEntrancePresentation("prepare"), {
    coreStage: "footer",
    controlsVisible: true,
    contentVisible: false,
  });
  assert.deepEqual(resolveLiveTranscriptEntrancePresentation("panel"), {
    coreStage: "content",
    controlsVisible: true,
    contentVisible: false,
  });
  assert.deepEqual(resolveLiveTranscriptEntrancePresentation("content"), {
    coreStage: "content",
    controlsVisible: true,
    contentVisible: true,
  });
});

test("Live Transcript entrance beats land strictly after one another", async () => {
  const { getLiveTranscriptEntranceTimeline } = await load();
  const timeline = getLiveTranscriptEntranceTimeline();

  // The invariant is the visual order, not the exact sums: the encapsulated
  // hold ends before the footer grows, controls appear before content is
  // prepared, and streaming starts only after the content settles.
  assert.ok(timeline.horizontalAtMs > 0);
  assert.ok(timeline.controlsAtMs > timeline.horizontalAtMs);
  assert.ok(timeline.prepareAtMs > timeline.controlsAtMs);
  assert.ok(timeline.panelAtMs > timeline.prepareAtMs);
  assert.ok(timeline.contentAtMs > timeline.panelAtMs);
  assert.ok(timeline.streamAtMs > timeline.contentAtMs);
});

test("press to first bar is one expansion, with no hold (VO-Q5)", async () => {
  const { getListeningEntranceTimeline, LISTENING_ENTRANCE_TIMING } = await load();
  const timeline = getListeningEntranceTimeline();
  assert.equal(timeline.expandAtMs, 0);
  assert.equal(timeline.waveformAtMs, LISTENING_ENTRANCE_TIMING.expansionMs);
  assert.ok(timeline.waveformAtMs <= 300);
  // The Agent footer handoff still needs its hold.
  assert.ok(getListeningEntranceTimeline({ afterAssistantFooterHandoff: true }).expandAtMs >= 400);
});

test("Live Transcript shows first words by 700ms (VO-Q18)", async () => {
  const { getLiveTranscriptEntranceTimeline } = await load();
  assert.ok(getLiveTranscriptEntranceTimeline().streamAtMs <= 700);
});

test("every pill footprint fits the 184px dock budget", async () => {
  const { VOICE_PILL_FOOTPRINT, VOICE_PILL_MAX_WIDTH } = await load();
  assert.deepEqual(VOICE_PILL_FOOTPRINT, {
    idle: { width: 40, height: 40 },
    recording: { width: 98, height: 36 },
    transcribing: { width: 144, height: 36 },
    cleaning: { width: 144, height: 36 },
    pasted: { width: 164, height: 36 },
    cancelled: { width: 160, height: 36 },
    meeting: { width: 124, height: 36 },
    meetingInterrupted: { width: 184, height: 36 },
    sealedPaused: { width: 124, height: 36 },
  });
  assert.equal(VOICE_PILL_MAX_WIDTH, 184);
  for (const [name, size] of Object.entries(VOICE_PILL_FOOTPRINT)) {
    assert.ok(size.width <= VOICE_PILL_MAX_WIDTH, name);
    assert.ok(size.height <= 40, name);
  }
});

test("pill stage priority: live work, then cancel, then outcome, then meeting", async () => {
  const { resolvePillStage } = await load();
  const base = {
    isRecording: false,
    micUnavailable: false,
    isProcessing: false,
    processingStage: null,
    agentMode: false,
    cancelled: null,
    recentOutcome: null,
    meetingRecording: null,
    showMeetingRecorder: true,
  };
  const meeting = { startedAt: 1, interruption: null, quiet: false };
  assert.equal(resolvePillStage(base), null);
  assert.equal(resolvePillStage({ ...base, meetingRecording: meeting }), "meeting");
  assert.equal(
    resolvePillStage({ ...base, meetingRecording: meeting, showMeetingRecorder: false }),
    null
  );
  assert.equal(
    resolvePillStage({ ...base, isRecording: true, meetingRecording: meeting }),
    "recording"
  );
  assert.equal(
    resolvePillStage({ ...base, isRecording: true, micUnavailable: true }),
    "unavailable"
  );
  assert.equal(resolvePillStage({ ...base, isProcessing: true }), "transcribing");
  assert.equal(
    resolvePillStage({ ...base, isProcessing: true, processingStage: "cleaning" }),
    "cleaning"
  );
  assert.equal(resolvePillStage({ ...base, isProcessing: true, agentMode: true }), "thinking");
  assert.equal(
    resolvePillStage({ ...base, cancelled: { undoUntil: 5 }, recentOutcome: { kind: "pasted" } }),
    "cancelled"
  );
  assert.equal(
    resolvePillStage({ ...base, recentOutcome: { kind: "pasted" }, meetingRecording: meeting }),
    "pasted"
  );
  assert.equal(resolvePillStage({ ...base, recentOutcome: { kind: "failed" } }), "failed");
  // §5.4: a failure while Sealed mode blocks the dictation route is the pre-flight refusal.
  assert.equal(
    resolvePillStage({ ...base, recentOutcome: { kind: "failed" }, dictationSealed: true }),
    "sealedPaused"
  );
  assert.equal(
    resolvePillStage({ ...base, recentOutcome: { kind: "pasted" }, dictationSealed: true }),
    "pasted"
  );
});

test("regular dictation processing is a transcribing capsule, Agent keeps thinking", async () => {
  const { resolveVoiceActivityPresentation } = await load();
  assert.deepEqual(
    resolveVoiceActivityPresentation({
      isRecording: false,
      isProcessing: true,
      isAssistantVoice: false,
      assistantThinking: false,
    }),
    { activeState: "transcribing", compactPill: true, isAgentThinking: false }
  );
  assert.equal(
    resolveVoiceActivityPresentation({
      isRecording: false,
      isProcessing: true,
      isAssistantVoice: true,
      assistantThinking: false,
    }).activeState,
    "thinking"
  );
});

test("one ownership policy for the long-lived stages (I4)", async () => {
  const { resolvePillOwnership } = await load();
  assert.deepEqual(resolvePillOwnership("cancelled"), {
    holdsWindow: true,
    interactive: true,
    outranksFooter: true,
  });
  assert.deepEqual(resolvePillOwnership("meeting"), {
    holdsWindow: true,
    interactive: true,
    outranksFooter: true,
  });
  assert.deepEqual(resolvePillOwnership("pasted"), {
    holdsWindow: true,
    interactive: false,
    outranksFooter: false,
  });
  for (const stage of ["failed", "sealedPaused"]) {
    assert.deepEqual(
      resolvePillOwnership(stage),
      {
        holdsWindow: true,
        interactive: false,
        outranksFooter: false,
      },
      stage
    );
  }
  assert.deepEqual(resolvePillOwnership(null), {
    holdsWindow: false,
    interactive: false,
    outranksFooter: false,
  });
});

test("auto-hide never hides an undo window, a success beat or the meeting recorder", async () => {
  const { shouldAutoHidePill, resolvePillOwnership } = await load();
  const idle = {
    floatingIconAutoHide: true,
    isRecording: false,
    isVisuallyProcessing: false,
    noticesOnScreen: false,
    wordsCardHandoffActive: false,
    assistantMounted: false,
    liveTranscriptMounted: false,
  };
  assert.equal(shouldAutoHidePill({ ...idle, ownership: resolvePillOwnership(null) }), true);
  for (const stage of ["cancelled", "pasted", "failed", "meeting", "sealedPaused"]) {
    assert.equal(
      shouldAutoHidePill({ ...idle, ownership: resolvePillOwnership(stage) }),
      false,
      stage
    );
  }
  assert.equal(
    shouldAutoHidePill({
      ...idle,
      floatingIconAutoHide: false,
      ownership: resolvePillOwnership(null),
    }),
    false
  );
});

test("Assistant final actions cannot suppress Undo or the meeting recorder", async () => {
  const { shouldSuppressPillForAssistantActions, resolvePillOwnership } = await load();
  const actions = {
    assistantOpen: true,
    footerPillVisible: false,
    assistantClosing: false,
    hasLiveActivity: false,
  };
  assert.equal(
    shouldSuppressPillForAssistantActions({ ...actions, ownership: resolvePillOwnership(null) }),
    true
  );
  assert.equal(
    shouldSuppressPillForAssistantActions({
      ...actions,
      ownership: resolvePillOwnership("meeting"),
    }),
    false
  );
  assert.equal(
    shouldSuppressPillForAssistantActions({
      ...actions,
      ownership: resolvePillOwnership("cancelled"),
    }),
    false
  );
});

test("Undo and Stop stay interactive with a panel mounted (Linux input region follows this flag)", async () => {
  const { resolveVoicePillInteraction, resolvePillOwnership } = await load();
  const base = { isRecording: false, isProcessing: false, isHovered: false };
  for (const panel of [
    { assistantMounted: true, liveTranscriptMounted: false },
    { assistantMounted: false, liveTranscriptMounted: true },
  ]) {
    assert.equal(
      resolveVoicePillInteraction({ ...base, ...panel, ownership: resolvePillOwnership(null) })
        .pillInteractive,
      false
    );
    assert.equal(
      resolveVoicePillInteraction({ ...base, ...panel, ownership: resolvePillOwnership("meeting") })
        .pillInteractive,
      true
    );
    assert.equal(
      resolveVoicePillInteraction({
        ...base,
        ...panel,
        ownership: resolvePillOwnership("cancelled"),
      }).pillInteractive,
      true
    );
  }
});

test("Live Transcript keeps an adaptive surface instead of entering at Agent height", async () => {
  const { LIVE_TRANSCRIPT_SURFACE_LIMITS } = await load();

  assert.deepEqual(LIVE_TRANSCRIPT_SURFACE_LIMITS, {
    minHeight: 152,
    maxHeight: 538,
  });
  assert.ok(LIVE_TRANSCRIPT_SURFACE_LIMITS.minHeight < LIVE_TRANSCRIPT_SURFACE_LIMITS.maxHeight);
});

test("voice mode direction mirrors the right baseline only for bottom-left", async () => {
  const { resolveVoiceHorizontalDirection } = await load();

  assert.equal(resolveVoiceHorizontalDirection("bottom-right"), "right");
  assert.equal(resolveVoiceHorizontalDirection("bottom-left"), "left");
  assert.equal(resolveVoiceHorizontalDirection("center"), "right");
});

test("the speaking pill resolves right-origin modes onto one interpolable dock system", async () => {
  const { resolveVoicePillDock } = await load();

  assert.equal(
    resolveVoicePillDock({
      liveTranscriptOpen: true,
      liveTranscriptEntrancePhase: "horizontal",
      assistantOpen: false,
      panelStartPosition: "bottom-right",
    }),
    "live-transcript-bottom-left"
  );
  assert.equal(
    resolveVoicePillDock({
      liveTranscriptOpen: true,
      liveTranscriptEntrancePhase: "encapsulate",
      assistantOpen: false,
      panelStartPosition: "bottom-right",
    }),
    "live-transcript-encapsulated-bottom-right"
  );
  assert.equal(
    resolveVoicePillDock({
      liveTranscriptOpen: false,
      liveTranscriptEntrancePhase: "idle",
      assistantOpen: true,
      panelStartPosition: "bottom-right",
    }),
    "assistant-bottom-right"
  );
});

test("a left-origin session keeps the speaking pill left while surfaces grow right", async () => {
  const { resolveVoicePillDock } = await load();

  assert.equal(
    resolveVoicePillDock({
      liveTranscriptOpen: true,
      liveTranscriptEntrancePhase: "encapsulate",
      assistantOpen: false,
      panelStartPosition: "bottom-left",
    }),
    "live-transcript-encapsulated-bottom-left"
  );
  for (const liveTranscriptEntrancePhase of ["horizontal", "controls", "content"]) {
    assert.equal(
      resolveVoicePillDock({
        liveTranscriptOpen: true,
        liveTranscriptEntrancePhase,
        assistantOpen: false,
        panelStartPosition: "bottom-left",
      }),
      "live-transcript-bottom-left"
    );
  }
  assert.equal(
    resolveVoicePillDock({
      liveTranscriptOpen: false,
      liveTranscriptEntrancePhase: "idle",
      assistantOpen: true,
      panelStartPosition: "bottom-left",
    }),
    "assistant-bottom-left"
  );
});

test("the idle pill keeps its configured resting dock", async () => {
  const { resolveVoicePillDock } = await load();

  assert.equal(
    resolveVoicePillDock({
      liveTranscriptOpen: false,
      liveTranscriptEntrancePhase: "idle",
      assistantOpen: false,
      panelStartPosition: "center",
    }),
    "center"
  );
});

test("Live Transcript restores stop and cancel interactions without unlocking Assistant", async () => {
  const { resolveVoicePillInteraction } = await load();

  assert.deepEqual(
    resolveVoicePillInteraction({
      assistantMounted: false,
      liveTranscriptMounted: true,
      isRecording: true,
      isProcessing: false,
    }),
    { pillInteractive: true, cancelVisible: true }
  );
  assert.deepEqual(
    resolveVoicePillInteraction({
      assistantMounted: false,
      liveTranscriptMounted: true,
      isRecording: false,
      isProcessing: true,
    }),
    { pillInteractive: false, cancelVisible: true }
  );
  assert.deepEqual(
    resolveVoicePillInteraction({
      assistantMounted: true,
      liveTranscriptMounted: false,
      isRecording: false,
      isProcessing: true,
    }),
    { pillInteractive: false, cancelVisible: false }
  );
  // The bare pill (no Live Transcript) exposes discard on hover, as before the panel.
  assert.deepEqual(
    resolveVoicePillInteraction({
      assistantMounted: false,
      liveTranscriptMounted: false,
      isRecording: false,
      isProcessing: true,
      isHovered: true,
    }),
    { pillInteractive: true, cancelVisible: true }
  );
  assert.deepEqual(
    resolveVoicePillInteraction({
      assistantMounted: false,
      liveTranscriptMounted: false,
      isRecording: false,
      isProcessing: true,
      isHovered: false,
    }),
    { pillInteractive: true, cancelVisible: false }
  );
});

test("a mounted Live Transcript can stop after the floating pill was previously dragged", async () => {
  const { shouldActivateVoicePill } = await load();

  assert.equal(
    shouldActivateVoicePill({
      hasDragged: true,
      liveTranscriptMounted: true,
      isProcessing: false,
      isAgentThinking: false,
    }),
    true
  );
  assert.equal(
    shouldActivateVoicePill({
      hasDragged: true,
      liveTranscriptMounted: false,
      isProcessing: false,
      isAgentThinking: false,
    }),
    false
  );
});

test("the interactive pill recognizes standard keyboard activation keys", async () => {
  const { isVoicePillActivationKey } = await load();

  assert.equal(isVoicePillActivationKey("Enter"), true);
  assert.equal(isVoicePillActivationKey(" "), true);
  assert.equal(isVoicePillActivationKey("Escape"), false);
});

test("a collapsed completed transcript leaves the normal pill interaction available", async () => {
  const { resolveVoicePillInteraction } = await load();

  assert.deepEqual(
    resolveVoicePillInteraction({
      assistantMounted: false,
      liveTranscriptMounted: false,
      isRecording: false,
      isProcessing: false,
    }),
    { pillInteractive: true, cancelVisible: false }
  );
});

test("the actual window side overrides a stale edge preference", async () => {
  const { resolveVoicePillDock } = await load();

  assert.equal(
    resolveVoicePillDock({
      liveTranscriptOpen: false,
      liveTranscriptEntrancePhase: "idle",
      assistantOpen: false,
      panelStartPosition: "bottom-right",
      horizontalDirection: "left",
    }),
    "bottom-left"
  );
  assert.equal(
    resolveVoicePillDock({
      liveTranscriptOpen: false,
      liveTranscriptEntrancePhase: "idle",
      assistantOpen: false,
      panelStartPosition: "bottom-left",
      horizontalDirection: "right",
    }),
    "bottom-right"
  );
});

test("listening entrance starts in the thinking circle before expanding", async () => {
  const { resolveListeningEntrancePresentation } = await load();
  assert.deepEqual(resolveListeningEntrancePresentation({ isRecording: true, phase: "idle" }), {
    activeState: "recording",
    collapseToLogo: true,
    compactPill: false,
    waveformVisible: false,
  });
});

test("listening entrance expands before revealing the waveform", async () => {
  const { resolveListeningEntrancePresentation } = await load();
  assert.deepEqual(
    resolveListeningEntrancePresentation({ isRecording: true, phase: "expanding" }),
    {
      activeState: "recording",
      collapseToLogo: false,
      compactPill: true,
      waveformVisible: false,
    }
  );
});

test("listening entrance settles at full width before revealing the waveform", async () => {
  const { resolveListeningEntrancePresentation } = await load();
  const settled = resolveListeningEntrancePresentation({
    isRecording: true,
    phase: "settled",
  });
  const waveform = resolveListeningEntrancePresentation({
    isRecording: true,
    phase: "waveform",
  });

  assert.deepEqual(settled, {
    activeState: "recording",
    collapseToLogo: false,
    compactPill: true,
    waveformVisible: false,
  });
  assert.deepEqual(waveform, { ...settled, waveformVisible: true });
});

test("listening entrance timers preserve the visual order", async () => {
  const { getListeningEntranceTimeline } = await load();

  for (const afterAssistantFooterHandoff of [false, true]) {
    const timeline = getListeningEntranceTimeline({ afterAssistantFooterHandoff });
    assert.ok(timeline.expandAtMs >= 0);
    assert.ok(timeline.settleAtMs > timeline.expandAtMs);
    assert.ok(timeline.waveformAtMs >= timeline.settleAtMs);
  }

  // The floating pill has no footer handoff to wait out, so its hold is the
  // shorter of the two speeds.
  assert.ok(
    getListeningEntranceTimeline().expandAtMs <
      getListeningEntranceTimeline({ afterAssistantFooterHandoff: true }).expandAtMs
  );
});

test("Agent footer retreats actions before the compact pill enters", async () => {
  const { getAssistantFooterTransitionTimeline, getListeningEntranceTimeline } = await load();
  const timeline = getAssistantFooterTransitionTimeline(false);

  assert.equal(timeline.initialPhase, "actions-exiting");
  assert.equal(timeline.handoffPhase, "pill-entering");
  assert.equal(timeline.settledPhase, "pill");
  assert.ok(timeline.handoffAtMs > 0);
  assert.ok(timeline.settledAtMs > timeline.handoffAtMs);
  // Cross-policy contract: the footer handoff must fully settle before the
  // listening entrance starts expanding the pill, or the two animations fight
  // over the same control. Only the footer-handoff hold carries this bound;
  // the floating pill never runs the two together.
  assert.ok(
    timeline.settledAtMs <
      getListeningEntranceTimeline({ afterAssistantFooterHandoff: true }).expandAtMs
  );
});

test("Agent footer retreats the pill before final actions grow from its anchor", async () => {
  const { getAssistantFooterTransitionTimeline } = await load();
  const timeline = getAssistantFooterTransitionTimeline(true);

  assert.equal(timeline.initialPhase, "pill-exiting");
  assert.equal(timeline.handoffPhase, "actions-entering");
  assert.equal(timeline.settledPhase, "actions");
  assert.ok(timeline.handoffAtMs > 0);
  assert.ok(timeline.settledAtMs > timeline.handoffAtMs);
});

test("Agent footer phases never mount actions and the pill together", async () => {
  const { resolveAssistantFooterPresentation } = await load();

  assert.deepEqual(resolveAssistantFooterPresentation("actions-exiting"), {
    pillVisible: false,
    actionsMounted: true,
    collapsePillToLogo: false,
  });
  assert.deepEqual(resolveAssistantFooterPresentation("pill-entering"), {
    pillVisible: true,
    actionsMounted: false,
    collapsePillToLogo: false,
  });
  assert.deepEqual(resolveAssistantFooterPresentation("pill-exiting"), {
    pillVisible: true,
    actionsMounted: false,
    collapsePillToLogo: true,
  });
});

test("an old Agent response stays ineligible during the follow-up handoff gap", async () => {
  const { resolveAssistantResponseReady } = await load();

  assert.equal(
    resolveAssistantResponseReady({
      responseContent: "The previous completed response",
      isBusy: false,
      isStreaming: false,
      voiceState: "idle",
      requestPending: true,
    }),
    false
  );
});

test("Agent response actions return only after the follow-up request settles", async () => {
  const { resolveAssistantResponseReady } = await load();
  const presentation = {
    responseContent: "The new completed response",
    isBusy: false,
    isStreaming: false,
    voiceState: "idle",
    requestPending: false,
  };

  assert.equal(resolveAssistantResponseReady(presentation), true);
  assert.equal(resolveAssistantResponseReady({ ...presentation, isBusy: true }), false);
  assert.equal(resolveAssistantResponseReady({ ...presentation, isStreaming: true }), false);
  assert.equal(resolveAssistantResponseReady({ ...presentation, voiceState: "listening" }), false);
});

test("stopping during the entrance cancels the staged recording presentation", async () => {
  const { resolveListeningEntrancePresentation } = await load();
  assert.deepEqual(
    resolveListeningEntrancePresentation({ isRecording: false, phase: "expanding" }),
    {
      activeState: null,
      collapseToLogo: false,
      compactPill: false,
      waveformVisible: true,
    }
  );
});

test("Agent listening keeps the existing expanded recording pill", async () => {
  const { resolveVoiceActivityPresentation } = await load();
  assert.deepEqual(
    resolveVoiceActivityPresentation({
      isRecording: true,
      isProcessing: false,
      isAssistantVoice: true,
      assistantThinking: false,
    }),
    { activeState: "recording", compactPill: true, isAgentThinking: false }
  );
});

test("Agent identity follows active requests and the complete panel lifecycle", async () => {
  const { resolveAgentModeActive } = await load();

  assert.equal(
    resolveAgentModeActive({
      isAssistantVoice: true,
      isRecording: true,
      isProcessing: false,
      assistantPanelMounted: false,
    }),
    true
  );
  assert.equal(
    resolveAgentModeActive({
      isAssistantVoice: true,
      isRecording: false,
      isProcessing: true,
      assistantPanelMounted: false,
    }),
    true
  );
  assert.equal(
    resolveAgentModeActive({
      isAssistantVoice: false,
      isRecording: false,
      isProcessing: false,
      assistantPanelMounted: true,
    }),
    true
  );
  assert.equal(
    resolveAgentModeActive({
      isAssistantVoice: true,
      isRecording: false,
      isProcessing: false,
      assistantPanelMounted: false,
    }),
    false
  );
});

test("Agent transcription contracts to the rotating thinking circle", async () => {
  const { resolveVoiceActivityPresentation } = await load();
  assert.deepEqual(
    resolveVoiceActivityPresentation({
      isRecording: false,
      isProcessing: true,
      isAssistantVoice: true,
      assistantThinking: false,
    }),
    { activeState: "thinking", compactPill: false, isAgentThinking: true }
  );
});

test("model thinking stays in the rotating circle after transcription ends", async () => {
  const { resolveVoiceActivityPresentation } = await load();
  assert.deepEqual(
    resolveVoiceActivityPresentation({
      isRecording: false,
      isProcessing: false,
      isAssistantVoice: false,
      assistantThinking: true,
    }),
    { activeState: "thinking", compactPill: false, isAgentThinking: true }
  );
});

test("regular dictation transcription is a labelled capsule", async () => {
  const { resolveVoiceActivityPresentation } = await load();
  assert.deepEqual(
    resolveVoiceActivityPresentation({
      isRecording: false,
      isProcessing: true,
      isAssistantVoice: false,
      assistantThinking: false,
    }),
    { activeState: "transcribing", compactPill: true, isAgentThinking: false }
  );
});

test("one voice panel core hosts each expanded mode", async () => {
  const { resolveVoicePanelCorePresentation } = await load();

  assert.deepEqual(
    resolveVoicePanelCorePresentation({
      assistantOpen: true,
      assistantMounted: true,
      liveTranscriptOpen: false,
      liveTranscriptMounted: false,
    }),
    { mode: "assistant", open: true }
  );
  assert.deepEqual(
    resolveVoicePanelCorePresentation({
      assistantOpen: false,
      assistantMounted: false,
      liveTranscriptOpen: true,
      liveTranscriptMounted: true,
    }),
    { mode: "live-transcript", open: true }
  );
});

test("an opening mode outranks a sibling that is only finishing its exit", async () => {
  const { resolveVoicePanelCorePresentation } = await load();

  assert.deepEqual(
    resolveVoicePanelCorePresentation({
      assistantOpen: false,
      assistantMounted: true,
      liveTranscriptOpen: true,
      liveTranscriptMounted: true,
    }),
    { mode: "live-transcript", open: true }
  );
});

test("the voice panel core stays mounted but contentless while idle", async () => {
  const { resolveVoicePanelCorePresentation } = await load();

  assert.deepEqual(
    resolveVoicePanelCorePresentation({
      assistantOpen: false,
      assistantMounted: false,
      liveTranscriptOpen: false,
      liveTranscriptMounted: false,
    }),
    { mode: null, open: false }
  );
});

test("Live Transcript reopen belongs only to an active normal dictation", async () => {
  const { shouldOfferLiveTranscriptReopen } = await load();

  assert.equal(
    shouldOfferLiveTranscriptReopen({
      manuallyCollapsed: true,
      isRecording: true,
      isProcessing: false,
      isAssistantVoice: false,
    }),
    true
  );
  assert.equal(
    shouldOfferLiveTranscriptReopen({
      manuallyCollapsed: true,
      isRecording: false,
      isProcessing: true,
      isAssistantVoice: false,
    }),
    true
  );
  assert.equal(
    shouldOfferLiveTranscriptReopen({
      manuallyCollapsed: true,
      isRecording: false,
      isProcessing: false,
      isAssistantVoice: false,
    }),
    false
  );
  assert.equal(
    shouldOfferLiveTranscriptReopen({
      manuallyCollapsed: true,
      isRecording: true,
      isProcessing: false,
      isAssistantVoice: true,
    }),
    false
  );
});

test("a fresh Agent request thinks in the floating logo circle", async () => {
  const { resolveAssistantThinkingTransition } = await load();
  assert.deepEqual(resolveAssistantThinkingTransition(false), {
    panelOpen: false,
    panelMounted: true,
    responseReady: false,
    thinking: true,
  });
});

test("an Agent follow-up keeps the existing response modal open while thinking", async () => {
  const { resolveAssistantThinkingTransition } = await load();
  assert.deepEqual(resolveAssistantThinkingTransition(true), {
    panelOpen: true,
    panelMounted: true,
    responseReady: false,
    thinking: true,
  });
});

test("a collapsed transcript stays reopenable while its result is processing", async () => {
  const { resolveCompanionPillInteractive } = await load();

  assert.equal(
    resolveCompanionPillInteractive({
      mainProcessInteractive: true,
      surfaceInteractive: true,
      isProcessing: true,
      canReopenLiveTranscript: true,
    }),
    true
  );
  assert.equal(
    resolveCompanionPillInteractive({
      mainProcessInteractive: true,
      surfaceInteractive: true,
      isProcessing: true,
      canReopenLiveTranscript: false,
    }),
    false
  );
  assert.equal(
    resolveCompanionPillInteractive({
      mainProcessInteractive: false,
      surfaceInteractive: true,
      isProcessing: false,
      canReopenLiveTranscript: true,
    }),
    false
  );
  assert.equal(
    resolveCompanionPillInteractive({
      mainProcessInteractive: true,
      surfaceInteractive: false,
      isProcessing: false,
      canReopenLiveTranscript: false,
    }),
    false
  );
});

test("final Agent actions keep the idle pill hidden until the panel finishes closing", async () => {
  const { shouldSuppressPillForAssistantActions } = await load();

  assert.equal(
    shouldSuppressPillForAssistantActions({
      assistantOpen: true,
      footerPillVisible: false,
      assistantClosing: false,
      hasLiveActivity: false,
    }),
    true
  );
  assert.equal(
    shouldSuppressPillForAssistantActions({
      assistantOpen: true,
      footerPillVisible: false,
      assistantClosing: true,
      hasLiveActivity: false,
    }),
    true
  );
  assert.equal(
    shouldSuppressPillForAssistantActions({
      assistantOpen: true,
      footerPillVisible: true,
      assistantClosing: false,
      hasLiveActivity: false,
    }),
    false
  );
  assert.equal(
    shouldSuppressPillForAssistantActions({
      assistantOpen: false,
      footerPillVisible: false,
      assistantClosing: false,
      hasLiveActivity: true,
    }),
    false
  );
});

test("the composed pill suppression keeps a live recording visible through the close", async () => {
  const { resolvePillVisualSuppression } = await load();

  const base = {
    dictationErrorSuppressed: false,
    assistantActionsSuppressed: false,
    assistantClosing: false,
    panelReturnResizeActive: false,
    hasLiveActivity: false,
  };

  // The regression this pins: folding the pill into the panel exit must not
  // override the close-intent ownership handoff. beginClose hides the companion
  // on the same tick, so a suppressed pill here leaves a running recording with
  // no visible owner for the whole ~580ms close.
  assert.equal(
    resolvePillVisualSuppression({ ...base, assistantClosing: true, hasLiveActivity: true }),
    false
  );
  // An idle close still folds into one beat.
  assert.equal(resolvePillVisualSuppression({ ...base, assistantClosing: true }), true);

  // The panel-return mask covers a real native shrink and is bounded by it, so
  // it stays unconditional — same contract as the dictation-error handoff.
  assert.equal(
    resolvePillVisualSuppression({ ...base, panelReturnResizeActive: true, hasLiveActivity: true }),
    true
  );

  // Error and footer owners are absolute regardless of activity.
  assert.equal(
    resolvePillVisualSuppression({
      ...base,
      dictationErrorSuppressed: true,
      hasLiveActivity: true,
    }),
    true
  );
  assert.equal(
    resolvePillVisualSuppression({
      ...base,
      assistantActionsSuppressed: true,
      hasLiveActivity: true,
    }),
    true
  );

  // Nothing claiming the pill leaves it visible.
  assert.equal(resolvePillVisualSuppression(base), false);
});

test("the composed suppression honours the assistant-actions carve-out end to end", async () => {
  const { resolvePillVisualSuppression, shouldSuppressPillForAssistantActions } = await load();

  // Both halves of the close: `assistantOpen` is still true through the content
  // fade, then flips false while `closing` runs out the contraction. A live
  // recording has to survive both, which is exactly what regressed when the
  // composition ORed `closing` in unconditionally.
  for (const assistantOpen of [true, false]) {
    const assistantActionsSuppressed = shouldSuppressPillForAssistantActions({
      assistantOpen,
      footerPillVisible: false,
      assistantClosing: true,
      hasLiveActivity: true,
    });
    assert.equal(
      resolvePillVisualSuppression({
        dictationErrorSuppressed: false,
        assistantActionsSuppressed,
        assistantClosing: true,
        panelReturnResizeActive: false,
        hasLiveActivity: true,
      }),
      false,
      `a live recording must stay visible with assistantOpen=${assistantOpen}`
    );
  }
});

test("activity handed back at close intent stays visible through the content fade", async () => {
  const { shouldSuppressPillForAssistantActions } = await load();

  // The companion hides at close INTENT while `assistantOpen` stays true until
  // the fade completes: suppressing here is the both-hidden gap.
  assert.equal(
    shouldSuppressPillForAssistantActions({
      assistantOpen: true,
      footerPillVisible: false,
      assistantClosing: true,
      hasLiveActivity: true,
    }),
    false
  );
  // Before close intent the footer still owns the visuals, so a companion
  // recording must not surface a second pill here.
  assert.equal(
    shouldSuppressPillForAssistantActions({
      assistantOpen: true,
      footerPillVisible: false,
      assistantClosing: false,
      hasLiveActivity: true,
    }),
    true
  );
});

test("owned capsules bypass close and return masks while explicit hard gates remain", async () => {
  const { resolvePillVisualSuppression, resolvePillOwnership } = await load();
  const base = {
    dictationErrorSuppressed: false,
    assistantActionsSuppressed: false,
    assistantClosing: false,
    panelReturnResizeActive: false,
    hasLiveActivity: false,
  };
  for (const stage of ["cancelled", "meeting"]) {
    const ownership = resolvePillOwnership(stage);
    assert.equal(ownership.outranksFooter, true);
    for (const gate of ["assistantClosing", "panelReturnResizeActive"]) {
      assert.equal(
        resolvePillVisualSuppression({ ...base, [gate]: true, ownership }),
        false,
        `${stage}: ${gate}`
      );
      assert.equal(resolvePillVisualSuppression({ ...base, [gate]: true }), true, `legacy ${gate}`);
    }
    for (const hardGate of ["dictationErrorSuppressed", "assistantActionsSuppressed"]) {
      assert.equal(resolvePillVisualSuppression({ ...base, [hardGate]: true, ownership }), true);
    }
  }
});

test("owned Agent response presentation preempts only the meeting resting stage", async () => {
  const { resolvePillStage } = await load();
  const base = {
    meetingRecording: { sessionId: "m1", startedAt: 1, quiet: false, interruption: null },
    showMeetingRecorder: true,
    agentResponseActive: true,
  };
  assert.equal(resolvePillStage(base), "thinking");
  assert.equal(resolvePillStage({ ...base, agentResponseActive: false }), "meeting");
  assert.equal(resolvePillStage({ ...base, isRecording: true }), "recording");
  assert.equal(
    resolvePillStage({ ...base, isProcessing: true, processingStage: "cleaning" }),
    "cleaning"
  );
  assert.equal(resolvePillStage({ ...base, cancelled: { sessionId: "d1" } }), "cancelled");
  assert.equal(resolvePillStage({ ...base, recentOutcome: { kind: "pasted" } }), "pasted");
  assert.equal(resolvePillStage({ ...base, recentOutcome: { kind: "failed" } }), "failed");
  assert.equal(
    resolvePillStage({ ...base, recentOutcome: { kind: "failed" }, dictationSealed: true }),
    "sealedPaused"
  );
  assert.equal(
    resolvePillStage({ ...base, meetingRecording: null }),
    null,
    "default Agent callers retain their existing presentation path"
  );
});

test("owned preparation keeps its existing processing acknowledgement ahead of resting meeting", async () => {
  const { resolvePillStage, resolvePillOwnership } = await load();
  const base = {
    meetingRecording: { sessionId: "m1", startedAt: 1, quiet: false, interruption: null },
    showMeetingRecorder: true,
    isPreparing: true,
  };
  assert.equal(resolvePillStage(base), "processing");
  assert.equal(
    resolvePillStage({ ...base, agentMode: true }),
    "processing",
    "mic warmup is not Agent thinking"
  );
  assert.equal(resolvePillStage({ ...base, isPreparing: false }), "meeting");
  assert.equal(resolvePillStage({ ...base, agentResponseActive: true }), "thinking");
  assert.equal(resolvePillStage({ ...base, isRecording: true }), "recording");
  assert.equal(
    resolvePillStage({ ...base, isRecording: true, micUnavailable: true }),
    "unavailable"
  );
  assert.equal(
    resolvePillStage({ ...base, isProcessing: true, processingStage: "cleaning" }),
    "cleaning"
  );
  assert.equal(resolvePillStage({ ...base, cancelled: { sessionId: "d1" } }), "cancelled");
  assert.equal(resolvePillStage({ ...base, recentOutcome: { kind: "pasted" } }), "pasted");
  assert.equal(resolvePillStage({ ...base, recentOutcome: { kind: "failed" } }), "failed");
  assert.equal(
    resolvePillStage({ ...base, recentOutcome: { kind: "failed" }, dictationSealed: true }),
    "sealedPaused"
  );
  assert.equal(
    resolvePillStage({ ...base, meetingRecording: null }),
    null,
    "legacy fallback is unchanged without a visible meeting"
  );
  assert.equal(resolvePillStage({ ...base, showMeetingRecorder: false }), null);
  assert.equal(
    resolvePillStage({ meetingRecording: base.meetingRecording, showMeetingRecorder: true }),
    "meeting",
    "omitted preparation defaults to the original policy"
  );
  assert.deepEqual(
    resolvePillOwnership("processing"),
    { holdsWindow: false, interactive: false, outranksFooter: false },
    "no new resting ownership is forged"
  );
});

test("sealedPaused holds auto-hide but yields the footer and panel input", async () => {
  const {
    resolvePillOwnership,
    shouldSuppressPillForAssistantActions,
    resolveVoicePillInteraction,
  } = await load();
  const ownership = resolvePillOwnership("sealedPaused");
  assert.equal(
    shouldSuppressPillForAssistantActions({
      assistantOpen: true,
      footerPillVisible: false,
      assistantClosing: false,
      hasLiveActivity: false,
      ownership,
    }),
    true
  );
  for (const panel of [
    { assistantMounted: true, liveTranscriptMounted: false },
    { assistantMounted: false, liveTranscriptMounted: true },
  ]) {
    assert.equal(
      resolveVoicePillInteraction({
        isRecording: false,
        isProcessing: false,
        isHovered: false,
        ...panel,
        ownership,
      }).pillInteractive,
      false
    );
  }
});
