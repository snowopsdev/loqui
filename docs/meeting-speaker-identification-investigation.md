# Meeting Speaker Identification — Root Cause Investigation

**Bug report:** During a meeting recording (local models: Parakeet / Nemotron / OpenWhispr),
two different voices are treated as the same speaker, sometimes attributed to the
recorder. Manually identifying a participant in the transcript does not stick for
subsequent conversation. Participants' emails are added *during* the meeting.

**Branch:** `worktree-investigate-speaker-identification` (off `main` @ `b656fa69`)
**Status:** Root causes identified and reproduced; RC1–RC3, RC6, RC7 fixed on this
branch (see "Fix implemented" at the end). RC4/RC5 remain follow-ups.

---

## Architecture recap (as-built)

- Only **system audio** feeds the live identifier (`ipcHandlers.js` `sendMeetingAudio`,
  ~line 6767). The **mic channel is definitionally the recorder** — labeled `you`
  in `diarization.js mergeWithTranscript()` (~line 462) and rendered as
  `notes.speaker.you` in `PersonalNotesView.tsx` (~line 802).
- There are **four independent speaker-ID namespaces, all using the same
  `speaker_N` string format**:
  1. Internal live cluster ids (`liveSpeakerIdentifier.js`, `_assignSpeakerId`)
  2. Public remapped ids (`createSpeakerRemapper`, `ipcHandlers.js` ~5722)
  3. Renderer-minted placeholder ids (`mintPlaceholderSpeakerId`,
     `meetingRecordingStore.ts` ~567)
  4. Offline diarization renumbered ids (`_startOrSkipDiarization` ~9793 and
     `diarization.js mergeWithTranscript` ~440)

  They collide textually but denote different clusters. Several code paths pass an
  id from one namespace into a map keyed by another.

---

## Symptom 1 — Two different voices treated as the same speaker

### RC1 (primary): session speaker cap defaults to 1 when participants are added mid-meeting

- `resolveSessionMaxSpeakers()` (`ipcHandlers.js` ~5781) = `expectedCount − 1`
  (mic is "you"), and `expectedCount` falls back to
  `DEFAULT_EXPECTED_SPEAKER_COUNT = 2` (`src/constants/speakerDetection.json`).
- The renderer **never pushes the speaker config at recording start** —
  `startRecording()` only sets store state; `pushConfig` fires solely from the
  stepper/toggle UI. Main falls back to note participants **at start time only**
  (`_resolveInitialMeetingSpeakerConfig`, called at ~6655).
- The reported repro adds participant emails **during** the meeting → at start the
  note has no participants → cap = 1 → the live identifier force-merges every
  remote voice into one cluster (`_assignOrForceCluster`), and the renderer's own
  placeholder minting also caps at `speaker_0`.

**Demonstrated:** two orthogonal (cosine 0) embeddings both resolve to `speaker_0`
at cap 1 (Demo 1).

### RC2: the public-label remapper is frozen at recording start and collapses new voices

- `meetingSpeakerRemapper = createSpeakerRemapper(resolveSessionMaxSpeakers())` is
  created **once** in `startLiveSpeakerIdentification` (~5997). The
  `meeting-set-session-speaker-config` handler (~9189) updates the identifier's
  cap but **never rebuilds the remapper** — fixing the stepper mid-meeting does not
  help the UI labels.
- Remapper logic: once `map.size >= cap`, **every new internal id maps to
  `speaker_{cap-1}` permanently** — distinct voices folded into the last slot
  (Demo 3).

### RC3: the offline (post-meeting) pass re-clusters with the stale start-time count

- At stop, `sessionSpeakerConfigSnapshot = this.activeMeetingSpeakerConfig`
  (~6950/6977) is passed to `_startOrSkipDiarization`.
  `_resolveSpeakerExpectation` (~9678) short-circuits on
  `sessionConfig.expectedCount` and **never consults the note's (now-updated)
  attendees**. Default case → `sherpa-onnx-diarize --clustering.num-clusters=1` →
  the entire system track is literally one cluster in the final transcript.
  `capSpeakerClusters` additionally folds excess clusters into the most-talkative
  one.

### RC4 (contributing): single-VAD-segment short circuit

- A "speech segment" ends only after 24 consecutive silent 32 ms windows
  (~0.77 s). Back-and-forth exchanges with shorter gaps stay one segment;
  `_resolveSpeakerForEmbedding` short-circuits on `currentSegmentSpeakerId`
  (`liveSpeakerIdentifier.js` ~682) so the whole exchange keeps the first
  speaker, and the final mixed-voice embedding is averaged into that speaker's
  centroid (`updateCentroid: true`) — centroid pollution drives later
  `recluster()` merges (threshold 0.65) between genuinely different people.

### RC5 (contributing, local models — the reporter's setup): timestamp skew defeats window matching

- Local mode transcribes 5 s chunks (`LOCAL_MEETING_CHUNK_INTERVAL_MS = 5000`)
  and stamps segments with `Date.now()` **after decoding** (~6146), i.e. the
  utterance midpoint lags by ~2.5–7+ s. Live identifications carry
  sample-clock-derived windows padded only ±0.75 s
  (`LIVE_WINDOW_PADDING_SECONDS`). The window matching in main (~6029) and in the
  renderer (`isSegmentWithinIdentificationWindow`) systematically misses →
  segments fall back to the 8 s carry-forward
  (`SYSTEM_SPEAKER_CARRY_FORWARD_MS`) which chains consecutive *different* voices
  onto the previous speaker's id.

## Symptom 2 — Remote speech attributed to the recorder

- Anything on the mic channel is "you". Remote voices played over loudspeakers
  re-enter the mic; suppression is heuristic (echo-leak correlation/RMS ceilings,
  holdbacks, text-overlap dedupe in `transcribeLocalMeetingChunk` ~6148 and
  `dedupeMicAgainstSystem`). Local models transcribe the bleed slightly
  differently on each channel, so text-overlap dedupe misses → the bleed survives
  as a mic segment → rendered as the recorder. AEC helper absence/failure widens
  this hole.
- **Amplifier:** `bindOneOnOneAttendeeToSpeaker(publicSpeakerId)` (~5787, invoked
  at ~6005 with the *public* id) reads `getSpeakerEmbedding()` from the
  *internal*-keyed map — it can persist the 1:1 attendee's profile with the
  wrong cluster's embedding (including a bleed cluster). Poisoned profiles then
  mislabel future meetings via `getLiveSpeakerProfiles` matching (threshold 0.65,
  margin 0.03) and `_retroactiveMapping` (>0.6).

## Symptom 3 — Manual identification doesn't persist

### RC6: `set-speaker-mapping` crosses ID namespaces and fails silently

- The renderer only ever sees public/minted ids, but the handler (~9364) passes
  that id straight into `liveSpeakerIdentifier.getSpeakerEmbedding()` and
  `.mapSpeaker()`, which are keyed by internal ids. After any recluster merge or
  cap fold, the id doesn't exist internally → `mapSpeaker` returns `false`
  **silently** (return value ignored) → no display name attached → every
  subsequent identification of that voice arrives unnamed.

**Demonstrated end-to-end (Demo 2):** with cap 3, an ambiguous utterance mints a
third cluster, the 30 s recluster merges it away, the next new participant gets
internal `speaker_3` → public `speaker_2`; `mapSpeaker("speaker_2", …, "Carol")`
returns `false`; the next identification of Carol's voice carries no name.

### RC7: the post-meeting reconcile looks up manual mappings under the wrong key

- `_reconcileLiveSpeakerState` (~9592) matches offline clusters to live clusters
  by embedding, then fetches the user's mapping with
  `mapping.speaker_id === bestEntry.speakerId` — `bestEntry.speakerId` is the
  live **internal** id, but rows were stored under the renderer's **public** id
  → the transfer silently finds nothing whenever the namespaces diverged
  (exactly the multi-speaker sessions where users bother to identify people).
- The offline pass renumbers clusters independently and
  `mergeTranscriptSegments` (renderer, `NoteEditor.tsx` ~546) lets diarization
  overwrite `speaker` on unlocked segments. `NoteEditor`'s `speakerMappings`
  (keyed by the old ids) then no longer match any final segment → the
  identification visibly disappears after "diarization complete".
- During the live session the renderer's `speakerLocks` *does* keep the name on
  segments carrying the same public id — which, under RC1/RC2, also mislabels
  other voices with that name. Both halves of "identification doesn't work" are
  the same ID-aliasing defect seen from two sides.

---

## Reproduction

`node <scratchpad>/speaker-id-repro.js` (drives the real `LiveSpeakerIdentifier`
with mocked `debugLogger`/`speakerEmbeddings`, plus a verbatim copy of
`createSpeakerRemapper`): all three demos assert and pass on `main`.

Suggested regression home: `test/helpers/liveSpeakerIdentifier.test.js` using the
repo's existing `Module._load` mocking pattern (see
`test/helpers/audioActivityDetector.test.js`).

## Fix implemented (this branch)

1. **ID namespaces collapsed** (RC6, RC7, and the RC2 folding): cluster ids in
   `liveSpeakerIdentifier.js` now double as the transcript labels —
   `_assignSpeakerId` allocates the lowest free `speaker_N` slot and a slot freed
   by a recluster merge is reused for the next new voice. The
   `createSpeakerRemapper` layer in `ipcHandlers.js` is deleted; identification
   events, merge events, `set-speaker-mapping`, `getSpeakerEmbedding`,
   `bindOneOnOneAttendeeToSpeaker`, and the post-meeting
   `_reconcileLiveSpeakerState` all now share one id space. `mapSpeaker` logs a
   warning when it drops an unknown id instead of failing silently.
2. **Caps unfrozen** (RC1, RC3): stepper-set configs are marked `explicit`;
   `db-update-note` calls `_refreshMeetingSpeakerConfigFromNote` when
   participants change during the active meeting note, which re-derives
   `expectedCount`, raises the live identifier's cap, and broadcasts
   `meeting-session-speaker-config-updated` (new preload/renderer listener keeps
   the stepper and renderer-side placeholder cap in sync). The offline pass's
   `_resolveSpeakerExpectation` now re-reads the note at stop time unless the
   count was explicit, and applies consistent `total − 1` semantics.
3. **Renderer merge handler** now moves *locked* segments to the kept cluster id
   (preserving the user-set name) so a reused slot can't inherit a stale lock.
4. **Merged from `fix/meeting-speaker-identification` (concurrent Codex branch):**
   `expectedCountIsExplicit` on `startRecording` so participant-derived counts no
   longer masquerade as a manual stepper choice (`userTouchedStepper`), the
   extracted `resolveParticipant*` helpers in `src/utils/participants.ts` with
   tests, and `syncSessionExpectedCountFromParticipants` for instant stepper
   feedback on roster edits (state-only — the authoritative cap update stays in
   main's `db-update-note` hook so the config isn't misflagged as explicit).
   Intentionally **not** taken: the mutable remapper (`meetingSpeakerIdentity.js`)
   — superseded by the slot-reuse design, which also fixes RC6/RC7 — and the
   `loopback` live-ID enablement, split out as a Windows-verified follow-up.

Regression tests: `test/helpers/liveSpeakerIdentifier.test.js` (5 tests, written
RED-first against the pre-fix behavior) and `test/helpers/participants.test.js`.

## Remaining follow-ups (not in this branch)

1. **Persist manual identity by embedding, not by volatile id** (hardens
   reconcile further; the profile embedding is already saved at mapping time).
2. **Local-mode timestamps** (RC5): stamp segments at chunk capture start
   (arrival − chunk duration), not decode completion, and/or widen the
   identification matching window for the chunked path.
3. **Segment turn-splitting** (RC4): re-check speaker identity on live
   re-identification instead of short-circuiting on `currentSegmentSpeakerId`,
   or skip centroid updates for segments whose live identity flipped mid-segment.
4. **Mic bleed → "You" attribution:** heuristic; AEC coverage and cross-channel
   dedupe for local models are the levers.
