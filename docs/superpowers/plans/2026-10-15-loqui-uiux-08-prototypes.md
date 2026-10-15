# Loqui UI/UX Plan 08 — Prototypes (WS-M4 confidence typography, WS-M5 The Table) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two Labs prototypes behind off-by-default flags:
- **WS-M4, confidence as typography.** Transcript words get variable font weight plus a dotted underline from the speech engine's word probabilities. It is gated to engines that pass a go/no-go spike, and hidden everywhere else.
- **WS-M5, The Table.** A per-Space spatial canvas with draggable note, meeting, dictation and chat-answer cards. It has connectors, lasso, pan and zoom, an inbox tray, and positions persisted in local SQLite.

**Architecture:**
- **WS-M4.** It is a vertical slice from engine to pixels:
  - Main asks whisper.cpp for `verbose_json` and reads the per-token log-probs sherpa-onnx already sends.
  - `src/helpers/wordConfidence.js` merges tokens into words.
  - The renderer carries the words through the existing dictation result to `db-save-transcription`.
  - Main aligns the words to the saved `raw_text` by character offset and stores them in a new side table, `transcription_confidence`.
  - History rows fetch the words lazily and render them with `ConfidenceText`.
- **WS-M5.** A Space's root overview gains a `List | Table` switch.
  - Main owns three new tables (`note_layout`, `note_layout_links`, `note_layout_viewport`) and returns a ready-to-draw board.
  - The renderer keeps geometry, model and gesture logic in pure, tested modules (`src/components/table/*.ts`).
  - Thin React components draw DOM cards over a transformed world.

**Tech Stack:**
- Electron 44 main process (CommonJS), with better-sqlite3 13.0.3.
- whisper.cpp server (OpenWhispr fork, tag `0.0.10`) and sherpa-onnx 1.13.8 offline WebSocket server.
- React 19, TypeScript, Tailwind CSS 4, zustand 5 and Radix Popover.
- Node `node:test`, using the tsx loader, `react-dom/server`, and the Vite SSR harness (`test/lib/rendererTestHarness.js`).

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md`: the Plan 08 row in §3, decision D7, constraints §4 and contracts §5. Acceptance reference: `design-explorations/loqui-uiux-review.html#ws-m4` and `#ws-m5` (source `design-explorations/loqui-uiux-review/parts/04-workspace.html:1552-1633` for markup, `:2617-2810` for the interactive mocks). Research: `.omc/research/ui-review/audit-workspace.md` §4 M4, M5 and §3 R4.

---

## Contract change requests

Spec §5 says only the owning plan may change a contract. These requests go to the owner and the owning plans. Plan 08 codes against the assumption stated in each one, so execution can proceed if the request is accepted as written.

1. **CCR-1, new §5.5 "Space surface" (owner: Plan 06; consumer: Plan 08).** Plan 06 reshapes the sidebar and Spaces (WS-R1 B). Plan 08 needs a stable place to mount a per-Space view switch.
   - **Request:** Plan 06 publishes, as a contract, the component that renders a Space's root content and a `viewSwitch` slot in its header. Alternatively, it keeps `ContainerOverview` (`src/components/notes/overview/ContainerOverview.tsx`) with its current props `{ space, folder, onOpenNote, onNewNote, onAddExisting }`, rendered by `PersonalNotesView` when no note is open.
   - **Assumption used in Task 17:** the latter.
2. **CCR-2, new §5.6 "Entity mention links" (owner: Plan 06; consumer: Plan 08).** WS-R7 B (universal mentions) lets notes mention notes, meetings and dictations. The Table draws connectors from these links.
   - The draft Plan 06 (Task 17, uncommitted on its branch as of 2026-10-14) already defines the pieces in `src/utils/mentionMarkdown.ts`:
     - the scheme `<kind>:<positiveInt>`, stored as `[@Label](note:17)`, with kinds `note | meeting | dictation | folder`;
     - `parseMentionHref(href): { kind; entityId: string | null; email: string | null } | null`.
   - **Request:** Plan 06 publishes the scheme and `parseMentionHref` in spec §5, so Plan 08 can depend on them.
   - **Plan 08's use:** Task 13 wraps it as `parseEntityHref` in `src/components/table/tableEdges.ts`:
     - `note` and `meeting` map to a note card;
     - `dictation` maps to a dictation card;
     - `folder` and `person` map to nothing.
   - If Plan 06 renames the function, only that adapter changes.
3. **CCR-3, new §5.7 "Labs flags" (owner: Plan 08; consumers: any later prototype).**
   - **Plan 08 produces:**
     - the boolean settings `labsConfidenceTypography` and `labsTable` in `src/stores/settingsStore.ts` (`BOOLEAN_SETTINGS`, `readBoolean`, `createBooleanSetter`);
     - a `LabsSettings` panel (`src/components/settings/LabsSettings.tsx`) rendered in Settings → System.
   - **Rule:** a Labs flag defaults to `false`, gates both UI and any engine or request change, and turning it off restores today's behaviour exactly.
   - Plan 03 restructures Settings and merges before Plan 08. Task 2 mounts the panel in whatever section replaced `case "system"` (`SettingsPage.tsx:2963`) and says how to find it.
4. **CCR-4, a scope deviation from WS-M4's acceptance mock (owner decision, an addendum to D7).** The mock's popover lists the top three alternatives for a word (n-best), with `Enter` to replace.
   - No engine Loqui runs exposes per-word alternatives. This was confirmed from the pinned whisper.cpp fork and sherpa-onnx 1.13.8 source; Deepgram's whole-transcript `alternatives[]` is unconfirmed for streaming.
   - **Plan 08 ships:** a popover with the word's confidence, `A` Add to Words and `P` Play 2 s. It has no alternatives and no `Enter` replace.
   - **Restoring alternatives** needs decoder top-k changes in the whisper.cpp fork. That is a separate engine project.
5. **CCR-5, a scope deviation from WS-M5's selection bar (owner decision).** The mock's `Delete` would delete user content from a prototype surface. Spec §4 says content is preserved.
   - **Plan 08 ships:** `Remove from table`. The card goes back to the Inbox tray and nothing is deleted, so no undo is needed.
   - **Summarise** and **Ask about these** reuse the Space's existing chat (`useContainerChat`), with the selection as context. The answer becomes a chat-answer card linked to its sources.
   - There is no new AI request path, so Sealed mode (Plan 07, D6) covers these actions without changes.

## Assumptions about Plan 06 (Workspace)

Plan 06's plan existed only as an uncommitted draft when this plan was written (`snowopsdev/plan/uiux-06-workspace`, 2026-10-14). The assumptions below were checked against that draft. Plan 08 executes after Plan 06 merges. Before Task 1, the executor runs `git log --oneline main -- src/components/notes src/components/ui/TranscriptionItem.tsx src/components/HistoryView.tsx` and reads Plan 06's plan. Where an assumption below is false, the affected task says what to do.

- **A1.** The Space root overview is still `ContainerOverview`, with the props above (CCR-1). There is still exactly one Space, "Personal" (`spaces.kind CHECK (kind = 'private')`, `src/helpers/localDatabaseSchema.js:276`), but all Plan 08 code is keyed by `space_id` and works unchanged with more Spaces.
- **A2.** The history row is still `src/components/ui/TranscriptionItem.tsx`. Draft Plan 06 Task 12 modifies it but keeps it.
  - The cleaned text renders in a single `<p>` (today `:279-285`). After Plan 06 that `<p>` carries `className="text-body line-clamp-4 …"` and `onClick={copyUnlessSelecting}`. Task 10 keeps both.
  - An expandable raw-transcript block exists (today `:289-324`).
  - The row kebab builds `candidateActions` (today `:115-146`).
  - If WS-R4 B moved them, apply Task 10's edits to the moved code.
- **A3.** Draft Plan 06 does not touch it. `useContainerChat` (`src/hooks/useContainerChat.ts`) still returns `{ messages, agentState, sendMessage, cancelStream, conversations, activeConversationId, switchConversation, startNewChat }`, and `OverviewAskSection` still takes the props passed at `ContainerOverview.tsx:129-139`.
- **A4.** Draft Plan 06 adds `--color-ai-text` (CR-06-4), which Task 16 uses for the machine-authored Summarise label. Tokens from Plan 01 exist: `--motion-*`, `--color-accent` (#d90078), and the hex dark tokens in `.dark`. Helpers exist: `src/utils/contrast.ts` (`contrastRatio`) and `test/helpers/harness/cssTokens.js` (`resolveTokens`).

## Data model and migration

Loqui has no migration system. `initDatabase` (`src/helpers/database.js:100-107`) runs the idempotent `CREATE … IF NOT EXISTS` script in `src/helpers/localDatabaseSchema.js` on every start. Adding a column to an existing table would not reach installed profiles. Plan 08 therefore adds **only new tables**:

| Table | Purpose | Lifecycle |
|---|---|---|
| `transcription_confidence(transcription_id PK → transcriptions(id) ON DELETE CASCADE, engine, words_json, created_at)` | One row per transcription that has word confidence. `words_json` holds `[{s, e, p, t?}]`, where `s`/`e` are UTF-16 offsets into `raw_text`, `p` is 0..1 and `t` is the start in seconds. | Hard deletes cascade (`deleteTranscription`, `clearTranscriptions`, retention all `DELETE`; `foreign_keys = ON` at `database.js:106`). `updateTranscriptionText` drops the row when `raw_text` changes (edit or retry). |
| `note_layout(space_id, entity_type ∈ note/dictation/chat, entity_id, x, y, w, h, z, hidden, updated_at; PK(space_id, entity_type, entity_id))` | Card positions. The name and columns follow the acceptance reference; `hidden` was added so that "Remove from table" works for notes, which otherwise auto-appear. | Polymorphic, so no FK. `getTableBoard` prunes rows whose entity is gone in the same transaction. |
| `note_layout_links(space_id, a_type, a_id, b_type, b_id, created_at; PK on all five)` | User-made connectors (Group into note, Summarise). | Filtered on read to links whose two ends are on the board or in the Inbox. |
| `note_layout_viewport(space_id PK, x, y, scale, updated_at)` | Last pan and zoom per Space. | Overwritten on change. |

Upgrade: an existing profile gains all four tables on next launch, and Task 6 and Task 11 test this by dropping the tables and reopening. Downgrade: older builds ignore unknown tables. History reads stay `SELECT *`-sized: rows gain only `has_confidence` (0/1, computed with `EXISTS`), and the words load lazily per row through `db-get-transcription-confidence`.

## Global Constraints

- Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md, spec §4).
- Local and remote choices stay explicit. Nothing silently switches provider or moves work from local to remote. Content is preserved on every failure. A confidence payload that fails validation is dropped, and the transcription still saves.
- Labs flags default to `false`. With both flags off, every request, IPC payload and render must be byte-for-byte what it is today. In particular, whisper.cpp still receives `response_format=json`.
- WS-M4 changes requests only for local engines: whisper.cpp server and sherpa-onnx offline. No cloud provider request changes in this plan.
- Text contrast is at least 4.5:1 and non-text UI (underlines, connectors, card borders) at least 3:1, in light theme and Plum Night.
- Motion uses the shared tokens only (`--motion-*`). Every loop is gated to its active state. Reduced motion keeps opacity and colour feedback and drops transforms (the existing policy in `src/index.css`). The Table's spring snap and the confidence weight transition are both off under reduced motion.
- Uncertainty is never signalled by weight alone: every uncertain word also has a dotted underline (audit M4).
- Every visible string goes through i18n in all 11 locales: `ar de en es fr it ja pt ru zh-CN zh-TW`. `npm run i18n:check` passes. Draft Plan 06 adds `scripts/merge-locale-keys.js`, an all-or-nothing merge that refuses conflicting values. If it is on `main`, feed it the same key and value tables as Tasks 2, 10 and 16 instead of their inline `node -e` writers.
- RTL: use logical properties (`ms-`, `me-`, `start-`, `end-`, `inset-inline-*`). Canvas world coordinates stay physical; only chrome (inbox tray, toolbar, selection bar) flips.
- Tests: run `npm run native:node` once, then `npm test -- <files>`. Run `npm run native:electron` before launching the desktop app. Never use personal profiles in tests or the spike. Never commit personal voice recordings.
- Before a PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run i18n:check`.
- Node: `~/.nvm/versions/node/v24.21.0/bin` (matches `.node-version` 24.21.0).
- `DESIGN.md` is the source of truth (D10). Tasks 10 and 17 update it in the same commits, and `docs/PRIVACY.md` gains the two new local stores.

## Go/no-go gate (D7)

Task 1 is a spike. Its report (`docs/superpowers/research/2026-10-ws-m4-confidence-spike.md`) decides, per engine, GO or NO-GO, against the criteria in Task 1 Step 5. Then:

| Outcome | Tasks to run |
|---|---|
| whisper.cpp GO, sherpa-onnx GO | 2–18 |
| whisper.cpp GO only | 2, 3, 4, 6–18. Skip 5, and remove `"sherpa-onnx"` from `ENGINES` in `src/helpers/wordConfidence.js` (Task 3). |
| sherpa-onnx GO only | 2, 3, 5–18. Skip 4, and remove `"whisper.cpp"` from `ENGINES` in `src/helpers/wordConfidence.js` (Task 3). |
| both NO-GO | 2, 11–18. WS-M4 stops after the spike report. Remove `labsConfidenceTypography` from Task 2 and the confidence rows from Tasks 17 and 18. |

WS-M5 (Tasks 11–17) does not depend on the gate.

## Review Focus

1. **Alignment drift.** The engine's token text differs from the saved `raw_text` (inverse text normalisation "twenty" → "20", dictionary-echo recovery swapping in a retry result, whitespace normalisation, CJK without spaces, leading punctuation).
   - A reasonable person expects a wrong underline to be impossible. A word with no exact, word-bounded match at or after the previous match is simply drawn plain.
   - Pinned in Task 3 (`wordConfidence.test.js`: "words align… skip what changed", "CJK tokens are words of their own", the boundary test) and Task 7 (the retry result carries the retry's own confidence).
2. **Stale confidence after an edit or retry.** Retry rewrites `raw_text` (the `retry-transcription` handler at `ipcHandlers.js:5083` calls `updateTranscriptionText(id, result.text, result.text)` at `:5290`), and so does a manual edit (`update-transcription-text`, `:7929`). A user expects the old underlines to vanish, not to sit on the new words.
   - Pinned in Task 6: "confidence follows the raw text".
3. **Hostile or garbage payloads over IPC.** The renderer sends the words to `db-save-transcription`. Non-arrays, `NaN` or out-of-range probabilities, 64+ character "words", an unknown engine, or 20 001 words must never fail the save or bloat the DB.
   - Pinned in Task 3 (`buildStoredConfidence` refusals) and Task 6 ("a malformed payload never blocks saving").
4. **Keyboard focus on a virtualised canvas.** Arrowing to a card that is outside the rendered 1.5× viewport must still move focus there and bring it into view. Selected and focused cards must never be culled.
   - Pinned in Task 12 (`visibleIds` always keeps `always`, and `ensureVisible` pans) and Task 15 (the component keeps the focused id in the render set).
5. **Notes removed or deleted while the board is open, or between sessions.** A note deleted in the editor, a dictation purged by retention, or a chat deleted must not leave a ghost card or a dangling connector. "Remove from table" on a note must not delete the note.
   - Pinned in Task 11 ("deleted entities are pruned", "removing a note hides it and keeps the note") and Task 13 (edges drop endpoints that are not on the board).

---

## Part A — WS-M4: confidence as typography

### Task 1: Spike — which engines expose word probabilities (go/no-go)

Covers WS-M4 and D7. This task writes no app code.

**Files:**
- Create: `scripts/spikes/word-confidence-spike.js`
- Create: `docs/superpowers/research/2026-10-ws-m4-confidence-spike.md`
- Create (GO engines only): `test/fixtures/confidence/whisper-verbose.json`, `test/fixtures/confidence/sherpa-offline-tdt.json`

**Interfaces:**
- Produces fixtures that Task 3's tests read. Each fixture is the engine's raw JSON response for the synthetic sample below, unedited except for being pretty-printed.
- Produces the gate decision table that every later Part A task obeys.

**Background (desk research, 2026-10-14, from primary sources; the spike confirms it at runtime):**

| Engine (as Loqui runs it) | Today's request and parse | Expected confidence data | Request change |
|---|---|---|---|
| whisper.cpp server, fork tag `0.0.10` (`src/helpers/whisperCppRelease.js:1`, `runtime-assets.json`) | `POST /inference`, `response_format=json` (`src/helpers/whisperServer.js:918-923`). Only `text` is read (`src/helpers/whisper.js:565-571`). | `segments[].words[] = {word, start, end, t_dtw, probability}`. These entries are **tokens**, not words; `probability` is 0..1. Present since upstream PR #1781. | `response_format=verbose_json` plus `no_language_probabilities=true` |
| sherpa-onnx 1.13.8 offline WS (`src/helpers/parakeetWsServer.js:137-160`), Parakeet TDT 0.6b v3 | JSON result; only `.text` is read (`src/helpers/parakeetWsResult.js:1-9`) | `tokens[]` (strings with `▁` word starts), `ys_log_probs[]` (natural log, ≤ 0), `timestamps[]` (s). Filled for greedy search, which is the default. | None |
| sherpa-onnx online (Nemotron streaming) | `createOnlineAccumulator` | `ys_probs[]` (log-probs) | Out of scope: the streaming path is not instrumented |
| OpenAI `gpt-4o(-mini)-transcribe` | `transcribe-audio-file-byok` (`ipcHandlers.js:7964`), `data.text` | `logprobs[]` per token with `include[]=logprobs`, `json` only | Out of scope (cloud) |
| Deepgram nova-3, AssemblyAI (streaming) | transcript text only | `words[].confidence` | Out of scope (cloud) |
| OpenAI `whisper-1`, Groq, xAI, Gemini, Mistral, Corti, Tinfoil | text | segment-level or none | NO-GO |

- [ ] **Step 1: Prepare a throwaway environment (never a personal profile)**

```bash
npm run download:whisper-cpp
npm run download:sherpa-onnx
ls resources/bin | grep -E "whisper-server|sherpa-onnx-ws"
node -e 'process.env.LOQUI_CACHE_ROOT||0; console.log(require("./src/helpers/modelDirUtils").getModelsDirForService("whisper"))'
```

If the `modelDirUtils` call throws because `electron` is unavailable, use the model directories from the installed app's cache instead (`~/.cache/<cacheName>/whisper-models` and `…/parakeet-models`). Copy one Whisper model (for example `ggml-base.bin`, or `ggml-large-v3-turbo.bin` if present) and the `parakeet-tdt-0.6b-v3` directory into `/tmp/loqui-spike/`. Never point the script at a live profile directory.

Create the synthetic sample. It contains names, numbers and homophones on purpose:

```bash
mkdir -p /tmp/loqui-spike
say -v Samantha -o /tmp/loqui-spike/sample.aiff "So the pricing change goes out on Thursday, not Monday, and Maria wants the new tier names in the FAQ before we send the announcement to the mailing list. Call Siobhan at four thirty about the Qdrant migration."
ffmpeg -y -i /tmp/loqui-spike/sample.aiff -ar 16000 -ac 1 -c:a pcm_s16le /tmp/loqui-spike/sample.wav
```

Record a real voice sample of 20–30 s. It is for calibration only and is never committed:

```bash
ffmpeg -y -f avfoundation -i ":0" -t 25 -ar 16000 -ac 1 -c:a pcm_s16le /tmp/loqui-spike/voice.wav
```

- [ ] **Step 2: Write the spike script**

Create `scripts/spikes/word-confidence-spike.js`:

```js
#!/usr/bin/env node
// WS-M4 spike (Plan 08 Task 1). Runs the pinned local engines against a 16 kHz
// mono PCM16 WAV and prints/stores their raw confidence-bearing responses.
// Dev tool only: it never reads a Loqui profile and makes no network calls
// beyond 127.0.0.1.
//
//   node scripts/spikes/word-confidence-spike.js --wav /tmp/loqui-spike/sample.wav \
//     --whisper-bin resources/bin/whisper-server-darwin-arm64 \
//     --whisper-model /tmp/loqui-spike/ggml-base.bin \
//     --sherpa-bin resources/bin/sherpa-onnx-ws-darwin-arm64 \
//     --parakeet-dir /tmp/loqui-spike/parakeet-tdt-0.6b-v3 \
//     [--save]   # write test/fixtures/confidence/*.json (synthetic sample only)
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const WebSocket = require("ws");

const OUT_DIR = path.join(__dirname, "../../test/fixtures/confidence");
const WHISPER_PORT = 8199;
const SHERPA_PORT = 6029;

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForPort(port, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const open = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => resolve(socket.end() || true));
      socket.once("error", () => resolve(false));
    });
    if (open) return;
    await sleep(250);
  }
  throw new Error(`port ${port} not ready after ${timeoutMs}ms`);
}

function postInference(wav, fields) {
  const boundary = `----Spike${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n`
    ),
    wav,
    Buffer.from("\r\n"),
    ...Object.entries(fields).map(([k, v]) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
    ),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: WHISPER_PORT,
        path: "/inference",
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ ms: Date.now() - started, json: JSON.parse(data) }));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

function wavToFloat32(wav) {
  const dataAt = wav.indexOf("data") + 8;
  const pcm = wav.subarray(dataAt);
  const out = Buffer.alloc((pcm.length / 2) * 4);
  for (let i = 0; i < pcm.length / 2; i++) out.writeFloatLE(pcm.readInt16LE(i * 2) / 32768, i * 4);
  return out;
}

function sherpaDecode(samples) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const ws = new WebSocket(`ws://127.0.0.1:${SHERPA_PORT}`);
    let result = "";
    ws.on("open", () => {
      const message = Buffer.alloc(8 + samples.length);
      message.writeInt32LE(16000, 0);
      message.writeInt32LE(samples.length, 4);
      samples.copy(message, 8);
      ws.send(message);
    });
    ws.on("message", (data) => {
      result += data.toString();
      ws.send("Done");
    });
    ws.on("close", () => resolve({ ms: Date.now() - started, json: JSON.parse(result) }));
    ws.on("error", reject);
  });
}

// Rough token→word check, independent of Task 3's module: the share of
// whitespace words in the joined token text found, in order, in `text`.
function orderedCoverage(tokenTexts, text) {
  const joined = tokenTexts.join("").replace(/▁/g, " ").replace(/\s+/g, " ").trim();
  const words = joined.split(" ").filter(Boolean);
  const hay = text.replace(/\s+/g, " ").toLowerCase();
  let cursor = 0;
  let hits = 0;
  for (const w of words) {
    const at = hay.indexOf(w.toLowerCase(), cursor);
    if (at !== -1) {
      hits += 1;
      cursor = at + w.length;
    }
  }
  return words.length ? hits / words.length : 0;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const deciles = (ps) => [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => [...ps].sort((a, b) => a - b)[Math.floor(q * (ps.length - 1))]);

async function runWhisper(wav, save) {
  const child = spawn(arg("whisper-bin"), [
    "-m", arg("whisper-model"), "--host", "127.0.0.1", "--port", String(WHISPER_PORT), "--max-len", "4096",
  ], { stdio: "ignore" });
  try {
    await waitForPort(WHISPER_PORT);
    const plain = [];
    const verbose = [];
    for (let i = 0; i < 3; i++) {
      plain.push((await postInference(wav, { response_format: "json", language: "en" })).ms);
      const v = await postInference(wav, { response_format: "verbose_json", no_language_probabilities: "true", language: "en" });
      verbose.push(v.ms);
      if (i === 2) {
        const tokens = (v.json.segments || []).flatMap((s) => s.words || []);
        const ps = tokens.map((t) => t.probability).filter((p) => Number.isFinite(p) && p >= 0 && p <= 1);
        console.log(JSON.stringify({
          engine: "whisper.cpp",
          topLevelKeys: Object.keys(v.json),
          segmentKeys: Object.keys(v.json.segments?.[0] || {}),
          tokenKeys: Object.keys(tokens[0] || {}),
          tokenCount: tokens.length,
          probabilityShare: tokens.length ? ps.length / tokens.length : 0,
          orderedCoverage: orderedCoverage(tokens.map((t) => t.word), String(v.json.text || "")),
          probabilityDeciles: deciles(ps),
          lowest: tokens.slice().sort((a, b) => a.probability - b.probability).slice(0, 8).map((t) => [t.word, t.probability]),
          medianMs: { json: median(plain), verbose_json: median(verbose) },
        }, null, 2));
        if (save) fs.writeFileSync(path.join(OUT_DIR, "whisper-verbose.json"), JSON.stringify(v.json, null, 2) + "\n");
      }
    }
  } finally {
    child.kill();
  }
}

async function runSherpa(wav, save) {
  const dir = arg("parakeet-dir");
  const child = spawn(arg("sherpa-bin"), [
    `--tokens=${path.join(dir, "tokens.txt")}`,
    `--encoder=${path.join(dir, "encoder.int8.onnx")}`,
    `--decoder=${path.join(dir, "decoder.int8.onnx")}`,
    `--joiner=${path.join(dir, "joiner.int8.onnx")}`,
    "--model-type=nemo_transducer",
    `--port=${SHERPA_PORT}`,
    "--num-threads=2",
    "--num-work-threads=1",
  ], { stdio: "ignore" });
  try {
    await waitForPort(SHERPA_PORT);
    const r = await sherpaDecode(wavToFloat32(wav));
    const tokens = r.json.tokens || [];
    const lps = r.json.ys_log_probs || [];
    const ps = lps.map((lp) => Math.exp(lp)).filter((p) => Number.isFinite(p) && p >= 0 && p <= 1);
    console.log(JSON.stringify({
      engine: "sherpa-onnx",
      keys: Object.keys(r.json),
      tokenCount: tokens.length,
      logProbCount: lps.length,
      timestampCount: (r.json.timestamps || []).length,
      probabilityShare: tokens.length ? ps.length / tokens.length : 0,
      orderedCoverage: orderedCoverage(tokens, String(r.json.text || "")),
      probabilityDeciles: deciles(ps),
      lowest: tokens.map((t, i) => [t, Math.exp(lps[i])]).sort((a, b) => a[1] - b[1]).slice(0, 8),
      ms: r.ms,
    }, null, 2));
    if (save) fs.writeFileSync(path.join(OUT_DIR, "sherpa-offline-tdt.json"), JSON.stringify(r.json, null, 2) + "\n");
  } finally {
    child.kill();
  }
}

(async () => {
  const wav = fs.readFileSync(arg("wav"));
  const save = process.argv.includes("--save");
  if (save) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (arg("whisper-bin")) await runWhisper(wav, save);
  if (arg("sherpa-bin")) await runSherpa(wav, save);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Run it on the synthetic sample and save fixtures**

Run (adjust the binary names to your platform):

```bash
node scripts/spikes/word-confidence-spike.js --wav /tmp/loqui-spike/sample.wav \
  --whisper-bin resources/bin/whisper-server-darwin-arm64 --whisper-model /tmp/loqui-spike/ggml-base.bin \
  --sherpa-bin resources/bin/sherpa-onnx-ws-darwin-arm64 --parakeet-dir /tmp/loqui-spike/parakeet-tdt-0.6b-v3 --save
```

Expected: two JSON summaries.
- whisper: `tokenKeys` includes `word` and `probability`.
- sherpa: `keys` includes `tokens` and `ys_log_probs`, with `tokenCount === logProbCount`.

If a key differs from the background table (for example sherpa names it `token_log_probs`), record the real name in the report; Task 3 and Task 5 use the names from the report.

- [ ] **Step 4: Run it on the real voice sample (no `--save`)**

```bash
node scripts/spikes/word-confidence-spike.js --wav /tmp/loqui-spike/voice.wav \
  --whisper-bin resources/bin/whisper-server-darwin-arm64 --whisper-model /tmp/loqui-spike/ggml-base.bin \
  --sherpa-bin resources/bin/sherpa-onnx-ws-darwin-arm64 --parakeet-dir /tmp/loqui-spike/parakeet-tdt-0.6b-v3
```

For each engine, listen to the recording and mark each of the 8 `lowest` words as *wrong*, *ambiguous* or *correct*. Then delete `/tmp/loqui-spike/voice.wav`.

- [ ] **Step 5: Decide and write the report**

An engine is **GO** only if all four hold on both samples:
- **G1 data:** `probabilityShare ≥ 0.95`.
- **G2 alignment:** `orderedCoverage ≥ 0.95`.
- **G3 cost:**
  - whisper: median `verbose_json` latency ≤ median `json` latency × 1.10 + 50 ms.
  - sherpa: no request change is needed, so G3 passes by definition.
- **G4 signal:** on the voice sample, at least 3 of the 8 lowest words are *wrong* or *ambiguous*, and on the synthetic sample at least 80 % of tokens have p ≥ 0.9.
  - If G4 holds only with different cut-offs, the report proposes new values for `CONFIDENCE_THRESHOLDS` (default `{ sure: 0.9, maybe: 0.7 }`), and Task 8 uses them.

Create `docs/superpowers/research/2026-10-ws-m4-confidence-spike.md` with these sections:
1. **Question:** quote D7.
2. **Method:** the samples, the binaries and model names, the commands from Steps 3–4.
3. **Results:** paste both JSON summaries per sample. Redact nothing; the voice transcript is not included, only the per-token words in `lowest`.
4. **Decision:** a table `engine | G1 | G2 | G3 | G4 | GO/NO-GO`, plus the threshold decision.
5. **Data flow:** copy the "Data model and migration" section of this plan, and note any field-name corrections from Step 3.
6. **Cloud engines:** copy the cloud rows of the background table, marked "not instrumented in Plan 08; follow-up candidates: gpt-4o(-mini)-transcribe logprobs, Deepgram and AssemblyAI streaming `words[].confidence`".

Delete the fixture of any NO-GO engine.

- [ ] **Step 6: Commit**

```bash
git add scripts/spikes/word-confidence-spike.js docs/superpowers/research/2026-10-ws-m4-confidence-spike.md test/fixtures/confidence
git commit -m "docs(spike): word confidence go/no-go for local speech engines (WS-M4)"
```

Stop here and show the owner the decision table before starting Task 3. A NO-GO on both engines ends Part A (see the gate table).

---

### Task 2: Labs flags and the Labs settings panel

Covers CCR-3. It is shared by Part A and Part B.

**Files:**
- Modify: `src/stores/settingsStore.ts`:
  - `BOOLEAN_SETTINGS` at `:195-~240` (add next to `"saveDiscardedTranscriptions"` at `:222`);
  - `SettingsState` body at `:786` (after `audioCuesEnabled: boolean;`);
  - the setter types next to `:1089`;
  - initial state next to `:1489`;
  - setters next to `:2201`.
- Create: `src/components/settings/LabsSettings.tsx`
- Modify: `src/components/SettingsPage.tsx`. Import the panel, and render it in `case "system":` (`:2963`) after `<UpdateSettings />`. Plan 03 may have restructured this. If so, run `grep -n "UpdateSettings" src/components/SettingsPage.tsx src/components/settings/*.tsx` and mount `<LabsSettings />` directly after `<UpdateSettings />`, wherever that now renders.
- Modify: `src/locales/{ar,de,en,es,fr,it,ja,pt,ru,zh-CN,zh-TW}/translation.json` (`settingsPage.labs.*`).
- Test: `test/components/labsSettings.test.js`

**Interfaces:**
- Produces these settings-store keys (boolean, persisted in `localStorage`, synced across windows through `BOOLEAN_SETTINGS`):
  - `labsConfidenceTypography` (default `false`), with `setLabsConfidenceTypography(value: boolean)`;
  - `labsTable` (default `false`), with `setLabsTable(value: boolean)`;
  - `historyShowConfidence` (default `false`; the list-row toggle, used in Task 10), with `setHistoryShowConfidence(value: boolean)`.
- Produces `export default function LabsSettings(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `test/components/labsSettings.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const repoRoot = path.join(__dirname, "../..");

async function renderLabs(t, state) {
  installBrowserGlobals(t);
  globalThis.__labsState = state;
  t.after(() => delete globalThis.__labsState);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-labs-settings-test-",
    mockModules: {
      "/stores/settingsStore": `
        export const useSettingsStore = (selector) => selector(globalThis.__labsState);
      `,
    },
  });
  const mod = await vite.ssrLoadModule("/components/settings/LabsSettings.tsx");
  return renderToStaticMarkup(createElement(mod.default));
}

test("Labs lists both prototypes as switches, off by default", async (t) => {
  const html = await renderLabs(t, {
    labsConfidenceTypography: false,
    labsTable: false,
    setLabsConfidenceTypography() {},
    setLabsTable() {},
  });
  assert.match(html, /settingsPage\.labs\.title/);
  assert.match(html, /settingsPage\.labs\.confidence\.label/);
  assert.match(html, /settingsPage\.labs\.table\.label/);
  assert.equal((html.match(/role="switch"/g) || []).length, 2);
  assert.equal((html.match(/aria-checked="false"/g) || []).length, 2);
});

test("the store declares the Labs flags as synced booleans that default to off", () => {
  const src = fs.readFileSync(path.join(repoRoot, "src/stores/settingsStore.ts"), "utf8");
  const set = src.slice(src.indexOf("const BOOLEAN_SETTINGS"), src.indexOf("]);", src.indexOf("const BOOLEAN_SETTINGS")));
  for (const key of ["labsConfidenceTypography", "labsTable", "historyShowConfidence"]) {
    assert.match(set, new RegExp(`"${key}"`), `${key} is in BOOLEAN_SETTINGS`);
    assert.match(src, new RegExp(`${key}: readBoolean\\("${key}", false\\)`), `${key} defaults to false`);
    const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;
    assert.match(src, new RegExp(`${setter}: createBooleanSetter\\("${key}"\\)`), `${setter} persists`);
  }
});

test("every locale names both Labs prototypes", () => {
  const dir = path.join(repoRoot, "src/locales");
  for (const lang of fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "translation.json")))) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, lang, "translation.json"), "utf8"));
    const labs = json.settingsPage?.labs;
    assert.ok(labs?.title && labs?.description, `${lang} labs title`);
    for (const k of ["confidence", "table"]) assert.ok(labs[k]?.label && labs[k]?.description, `${lang} labs.${k}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/labsSettings.test.js`
Expected: FAIL. Vite cannot resolve `/components/settings/LabsSettings.tsx`, `labsConfidenceTypography is in BOOLEAN_SETTINGS` fails, and `en labs title` fails.

- [ ] **Step 3: Implement**

1. In `src/stores/settingsStore.ts`:
   - Add three entries to `BOOLEAN_SETTINGS` directly after `"saveDiscardedTranscriptions",` (`:222`):

     ```ts
       "labsConfidenceTypography",
       "labsTable",
       "historyShowConfidence",
     ```

   - In `export interface SettingsState … {` add, after `audioCuesEnabled: boolean;` (`:786`):

     ```ts
       // Labs prototypes (Plan 08). Off by default; off means today's behaviour exactly.
       labsConfidenceTypography: boolean;
       labsTable: boolean;
       historyShowConfidence: boolean;
     ```

   - Next to `setSaveDiscardedTranscriptions: (value: boolean) => void;` (`:1089`):

     ```ts
       setLabsConfidenceTypography: (value: boolean) => void;
       setLabsTable: (value: boolean) => void;
       setHistoryShowConfidence: (value: boolean) => void;
     ```

   - Next to `saveDiscardedTranscriptions: readBoolean("saveDiscardedTranscriptions", false),` (`:1489`):

     ```ts
       labsConfidenceTypography: readBoolean("labsConfidenceTypography", false),
       labsTable: readBoolean("labsTable", false),
       historyShowConfidence: readBoolean("historyShowConfidence", false),
     ```

   - Next to `setSaveDiscardedTranscriptions: createBooleanSetter("saveDiscardedTranscriptions"),` (`:2201`):

     ```ts
       setLabsConfidenceTypography: createBooleanSetter("labsConfidenceTypography"),
       setLabsTable: createBooleanSetter("labsTable"),
       setHistoryShowConfidence: createBooleanSetter("historyShowConfidence"),
     ```

2. Create `src/components/settings/LabsSettings.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { useSettingsStore } from "../../stores/settingsStore";
   import { SectionHeader, SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";
   import { Toggle } from "../ui/toggle";

   // Labs: prototypes that ship off. Each switch gates both the UI and any
   // engine/request change behind it (CCR-3, Plan 08).
   export default function LabsSettings() {
     const { t } = useTranslation();
     const confidence = useSettingsStore((s) => s.labsConfidenceTypography);
     const setConfidence = useSettingsStore((s) => s.setLabsConfidenceTypography);
     const table = useSettingsStore((s) => s.labsTable);
     const setTable = useSettingsStore((s) => s.setLabsTable);

     return (
       <div>
         <SectionHeader
           title={t("settingsPage.labs.title")}
           description={t("settingsPage.labs.description")}
         />
         <SettingsPanel>
           <SettingsPanelRow>
             <SettingsRow
               label={t("settingsPage.labs.confidence.label")}
               description={t("settingsPage.labs.confidence.description")}
             >
               <Toggle checked={confidence} onChange={setConfidence} />
             </SettingsRow>
           </SettingsPanelRow>
           <SettingsPanelRow>
             <SettingsRow
               label={t("settingsPage.labs.table.label")}
               description={t("settingsPage.labs.table.description")}
             >
               <Toggle checked={table} onChange={setTable} />
             </SettingsRow>
           </SettingsPanelRow>
         </SettingsPanel>
       </div>
     );
   }
   ```

3. In `src/components/SettingsPage.tsx`, add `import LabsSettings from "./settings/LabsSettings";` after `import UpdateSettings from "./settings/UpdateSettings";` (`:1`). In `case "system":`, render `<LabsSettings />` on the line after `<UpdateSettings />`.

4. Add `settingsPage.labs` to every locale. Run from the repo root:

   ```bash
   node -e '
   const fs=require("fs"),p=require("path");
   const L={
    en:["Labs","Prototypes that are still being shaped. They stay on this device and can be turned off at any time.","Confidence in transcripts","Words the speech engine was unsure about are drawn lighter and underlined. Works with local Whisper and Parakeet.","The Table","A canvas view for a space: spread notes, dictations and answers out and link them."],
    de:["Labs","Prototypen in Arbeit. Sie bleiben auf diesem Gerät und lassen sich jederzeit ausschalten.","Sicherheit im Transkript","Wörter, bei denen die Spracherkennung unsicher war, erscheinen heller und unterstrichen. Funktioniert mit lokalem Whisper und Parakeet.","Der Tisch","Eine Leinwand für einen Bereich: Notizen, Diktate und Antworten auslegen und verbinden."],
    es:["Labs","Prototipos aún en desarrollo. Se quedan en este dispositivo y puedes desactivarlos cuando quieras.","Confianza en las transcripciones","Las palabras de las que el motor de voz no estaba seguro se muestran más claras y subrayadas. Funciona con Whisper y Parakeet locales.","La Mesa","Un lienzo para un espacio: extiende notas, dictados y respuestas y enlázalos."],
    fr:["Labs","Des prototypes encore en chantier. Ils restent sur cet appareil et se désactivent à tout moment.","Confiance dans les transcriptions","Les mots dont le moteur vocal doutait sont plus légers et soulignés. Fonctionne avec Whisper et Parakeet en local.","La Table","Un canevas pour un espace : étalez notes, dictées et réponses, puis reliez-les."],
    it:["Labs","Prototipi ancora in lavorazione. Restano su questo dispositivo e puoi disattivarli quando vuoi.","Affidabilità nelle trascrizioni","Le parole su cui il motore vocale era incerto appaiono più chiare e sottolineate. Funziona con Whisper e Parakeet locali.","Il Tavolo","Una tela per uno spazio: disponi note, dettature e risposte e collegale."],
    pt:["Labs","Protótipos ainda em evolução. Ficam neste dispositivo e podem ser desativados a qualquer momento.","Confiança nas transcrições","Palavras sobre as quais o mecanismo de voz tinha dúvidas aparecem mais leves e sublinhadas. Funciona com Whisper e Parakeet locais.","A Mesa","Uma tela para um espaço: espalhe notas, ditados e respostas e ligue-os."],
    ru:["Лаборатория","Прототипы в разработке. Они остаются на этом устройстве, их можно отключить в любой момент.","Уверенность в расшифровке","Слова, в которых распознавание не было уверено, показываются светлее и с подчёркиванием. Работает с локальными Whisper и Parakeet.","Стол","Холст для пространства: раскладывайте заметки, диктовки и ответы и связывайте их."],
    ja:["Labs","開発中のプロトタイプです。このデバイス上にとどまり、いつでもオフにできます。","文字起こしの確信度","音声エンジンが自信を持てなかった単語を細く、下線付きで表示します。ローカルの Whisper と Parakeet で動作します。","テーブル","スペース用のキャンバス。メモ、音声入力、回答を広げてつなげられます。"],
    "zh-CN":["实验室","仍在打磨的原型功能。它们只在此设备上运行，可随时关闭。","转写置信度","语音引擎不确定的词会以较细字重并加下划线显示。适用于本地 Whisper 和 Parakeet。","桌面","空间的画布视图：铺开笔记、听写和回答并把它们连起来。"],
    "zh-TW":["實驗室","仍在打磨的原型功能。它們只在此裝置上執行，可隨時關閉。","轉錄信心度","語音引擎不確定的字詞會以較細字重並加底線顯示。適用於本機 Whisper 與 Parakeet。","桌面","空間的畫布檢視：鋪開筆記、聽寫與回答並將它們連起來。"],
    ar:["المختبر","نماذج أولية ما زالت قيد التشكيل. تبقى على هذا الجهاز ويمكن إيقافها في أي وقت.","الثقة في النصوص المفرغة","تظهر الكلمات التي لم يكن محرك الكلام متأكدًا منها بخط أخف وتحتها خط. يعمل مع Whisper وParakeet المحليين.","الطاولة","لوحة لمساحة: افرد الملاحظات والإملاءات والإجابات واربط بينها."]};
   for(const [l,[title,desc,cl,cd,tl,td]] of Object.entries(L)){const f=p.join("src/locales",l,"translation.json");const j=JSON.parse(fs.readFileSync(f,"utf8"));j.settingsPage=j.settingsPage||{};j.settingsPage.labs={title,description:desc,confidence:{label:cl,description:cd},table:{label:tl,description:td}};fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");}'
   npx prettier --check "src/locales/**/translation.json" || npx prettier --write "src/locales/**/translation.json"
   ```

   If the gate disabled WS-M4, drop the `confidence` row from the component, the test and the locales.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/labsSettings.test.js test/locales/translationCoverage.test.js && npm run i18n:check && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/components/settings/LabsSettings.tsx src/components/SettingsPage.tsx src/locales test/components/labsSettings.test.js
git commit -m "feat(settings): Labs panel with off-by-default prototype flags"
```

---

### Task 3: Word confidence core (main process)

**Files:**
- Create: `src/helpers/wordConfidence.js` (CommonJS; required by main-process modules)
- Test: `test/helpers/wordConfidence.test.js`

**Interfaces:**
- Produces (CommonJS `module.exports`):
  - `ENGINES: Set<"whisper.cpp" | "sherpa-onnx">`, `MAX_WORDS = 20000`, `MAX_WORD_LENGTH = 64`
  - `tokensFromWhisperVerbose(json): Token[]`, where `Token = { text: string; p: number; t?: number }`
  - `tokensFromSherpaOffline(json, offsetSeconds = 0): Token[]`
  - `offsetTokens(tokens: Token[] | undefined, seconds: number): Token[]`. This shifts `t` and forces a word boundary at the first token.
  - `mergeTokensToWords(tokens: Token[]): Word[]`, where `Word = { w: string; p: number; t?: number }` and `p` is the geometric mean of the word's non-punctuation token probabilities, rounded to 3 decimals.
  - `alignWordsToText(words: Word[], text: string): Stored[]`, where `Stored = { s: number; e: number; p: number; t?: number }`.
  - `buildStoredConfidence(input: { engine, words: Word[] } | null, rawText: string): { v: 1; engine; words: Stored[] } | null`
- The **candidate** shape that crosses IPC (renderer → main) is `{ engine: "whisper.cpp" | "sherpa-onnx"; words: Word[] }`. Tasks 4–7 call it `confidence`.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/wordConfidence.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  MAX_WORDS,
  alignWordsToText,
  buildStoredConfidence,
  mergeTokensToWords,
  offsetTokens,
  tokensFromSherpaOffline,
  tokensFromWhisperVerbose,
} = require("../../src/helpers/wordConfidence");

test("whisper tokens merge into words at leading-space boundaries", () => {
  const words = mergeTokensToWords([
    { text: " Mar", p: 0.6, t: 1.2 },
    { text: "ia", p: 0.9, t: 1.3 },
    { text: " wants", p: 0.95, t: 1.5 },
    { text: ".", p: 0.2, t: 1.8 },
  ]);
  assert.deepEqual(words, [
    { w: "Maria", p: 0.735, t: 1.2 },
    { w: "wants.", p: 0.95, t: 1.5 },
  ]);
});

test("sherpa pieces use ▁ as the boundary and log-probs become probabilities", () => {
  const tokens = tokensFromSherpaOffline(
    { text: "the tier", tokens: ["▁the", "▁ti", "er"], ys_log_probs: [Math.log(0.99), Math.log(0.64), 0], timestamps: [0.1, 0.4, 0.5] },
    15
  );
  assert.deepEqual(tokens.map((t) => t.t), [15.1, 15.4, 15.5]);
  assert.deepEqual(mergeTokensToWords(tokens).map((w) => [w.w, w.p]), [["the", 0.99], ["tier", 0.8]]);
  assert.deepEqual(tokensFromSherpaOffline({ tokens: ["▁a"], ys_log_probs: [] }), [], "lengths must match");
  assert.deepEqual(tokensFromSherpaOffline(null), []);
});

test("whisper verbose_json words become tokens with start seconds", () => {
  const json = {
    text: " So the tier.",
    segments: [{ text: " So the tier.", words: [
      { word: " So", start: 0, end: 0.3, t_dtw: -1, probability: 0.97 },
      { word: " the", start: 0.3, end: 0.5, t_dtw: -1, probability: 0.99 },
      { word: " tier", start: 0.5, end: 0.9, t_dtw: -1, probability: 0.64 },
      { word: ".", start: 0.9, end: 1, t_dtw: -1, probability: 0.5 },
    ] }],
  };
  assert.deepEqual(mergeTokensToWords(tokensFromWhisperVerbose(json)), [
    { w: "So", p: 0.97, t: 0 },
    { w: "the", p: 0.99, t: 0.3 },
    { w: "tier.", p: 0.64, t: 0.5 },
  ]);
  assert.deepEqual(tokensFromWhisperVerbose({ text: "x" }), []);
});

test("special, byte-fallback and invalid tokens never become words", () => {
  const words = mergeTokensToWords([
    { text: "[_BEG_]", p: 1 },
    { text: " hello", p: 0.9 },
    { text: "<|endoftext|>", p: 1 },
    { text: "<0xE2>", p: 0.5 },
    { text: "[_TT_150]", p: 1 },
    { text: " a", p: Number.NaN },
    { text: " b", p: 1.4 },
    { text: " c", p: -0.1 },
  ]);
  assert.deepEqual(words.map((w) => w.w), ["hello"]);
});

test("CJK tokens are words of their own and keep trailing punctuation", () => {
  const words = mergeTokensToWords([{ text: "定价", p: 0.9 }, { text: "周四", p: 0.6 }, { text: "。", p: 0.3 }]);
  assert.deepEqual(words.map((w) => [w.w, w.p]), [["定价", 0.9], ["周四。", 0.6]]);
});

test("leading punctuation opens a word but does not score it", () => {
  const words = mergeTokensToWords([{ text: " (", p: 0.1 }, { text: "see", p: 0.8 }, { text: ")", p: 0.1 }]);
  assert.deepEqual(words, [{ w: "(see)", p: 0.8 }]);
});

test("segment offsets shift time and force a boundary at the seam", () => {
  const shifted = offsetTokens([{ text: "lo", p: 0.9, t: 0.2 }, { text: "▁there", p: 0.9, t: 0.4 }], 15);
  assert.deepEqual(shifted, [{ text: " lo", p: 0.9, t: 15.2 }, { text: "▁there", p: 0.9, t: 15.4 }]);
  assert.deepEqual(offsetTokens(undefined, 15), []);
});

test("words align to the saved raw text by offset and skip what changed", () => {
  const raw = "So the pricing change goes out on Thursday, not Monday. Call 20 people.";
  const aligned = alignWordsToText(
    ["So", "the", "pricing", "change", "goes", "out", "on", "thursday,", "not", "Monday.", "Call", "twenty", "people."].map(
      (w, i) => ({ w, p: i === 7 ? 0.84 : 0.9 })
    ),
    raw
  );
  assert.deepEqual(aligned.map((a) => raw.slice(a.s, a.e)), [
    "So", "the", "pricing", "change", "goes", "out", "on", "Thursday,", "not", "Monday.", "Call", "people.",
  ]);
  assert.equal(aligned[7].p, 0.84, "a case-insensitive match keeps the engine score");
});

test("alignment never matches inside another word or far ahead", () => {
  const raw = "Monday on the mountain";
  assert.deepEqual(alignWordsToText([{ w: "on", p: 0.5 }], raw).map((a) => raw.slice(a.s, a.e)), ["on"]);
  assert.equal(alignWordsToText([{ w: "on", p: 0.5 }], raw)[0].s, 7, "not the 'on' inside Monday");
  const far = `${"x ".repeat(40)}target`;
  assert.deepEqual(alignWordsToText([{ w: "target", p: 0.5 }], far), [], "beyond the 48-char lookahead");
});

test("stored payload is validated, aligned and versioned", () => {
  const raw = "Maria wants the tier names.";
  const stored = buildStoredConfidence(
    { engine: "whisper.cpp", words: [{ w: "Maria", p: 0.58, t: 1.2 }, { w: "wants", p: 0.91 }, { w: "", p: 0.5 }, { w: "tier", p: 2 }, { w: "names.", p: 0.88 }] },
    raw
  );
  assert.deepEqual(stored, {
    v: 1,
    engine: "whisper.cpp",
    words: [{ s: 0, e: 5, p: 0.58, t: 1.2 }, { s: 6, e: 11, p: 0.91 }, { s: 21, e: 27, p: 0.88 }],
  });
  assert.equal(buildStoredConfidence({ engine: "deepgram", words: [{ w: "Maria", p: 0.5 }] }, raw), null, "unknown engine");
  assert.equal(buildStoredConfidence({ engine: "whisper.cpp", words: [{ w: "zebra", p: 0.5 }] }, raw), null, "nothing aligned");
  assert.equal(buildStoredConfidence({ engine: "whisper.cpp", words: "nope" }, raw), null, "not an array");
  assert.equal(
    buildStoredConfidence({ engine: "whisper.cpp", words: new Array(MAX_WORDS + 1).fill({ w: "Maria", p: 1 }) }, raw),
    null,
    "oversized payloads are refused whole"
  );
  assert.equal(buildStoredConfidence({ engine: "whisper.cpp", words: [{ w: "M".repeat(65), p: 1 }] }, raw), null);
  assert.equal(buildStoredConfidence(null, raw), null);
  assert.equal(buildStoredConfidence({ engine: "whisper.cpp", words: [{ w: "Maria", p: 1 }] }, null), null);
});

for (const [file, toTokens] of [
  ["whisper-verbose.json", tokensFromWhisperVerbose],
  ["sherpa-offline-tdt.json", (json) => tokensFromSherpaOffline(json)],
]) {
  test(`spike fixture ${file}: at least 95% of words align to the engine's own text`, (t) => {
    const fixture = path.join(__dirname, "../fixtures/confidence", file);
    if (!fs.existsSync(fixture)) return t.skip("engine was NO-GO in the Task 1 spike");
    const json = JSON.parse(fs.readFileSync(fixture, "utf8"));
    const words = mergeTokensToWords(toTokens(json));
    const text = String(json.text).replace(/\s+/g, " ").trim();
    const aligned = alignWordsToText(words, text);
    assert.ok(words.length > 10, `${words.length} words`);
    assert.ok(aligned.length / words.length >= 0.95, `${aligned.length}/${words.length} aligned`);
    for (const a of aligned) assert.ok(a.p >= 0 && a.p <= 1 && a.e > a.s);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/helpers/wordConfidence.test.js`
Expected: FAIL with `Cannot find module '../../src/helpers/wordConfidence'`.

- [ ] **Step 3: Implement**

Create `src/helpers/wordConfidence.js`:

```js
// Word-level recognition confidence (Plan 08, WS-M4).
//
// Engines report per-token probabilities. This module turns tokens into words
// and, at save time, pins each word to character offsets in the raw transcript
// that was actually stored. Anything that does not line up exactly is dropped:
// a word without data renders at normal weight, which is the honest fallback;
// a word with the wrong data would be a lie.

const ENGINES = new Set(["whisper.cpp", "sherpa-onnx"]);
const MAX_WORDS = 20000;
const MAX_WORD_LENGTH = 64;
// How far past the previous match a word may be found. Covers a few words the
// engine text and the saved text disagree on (ITN, cleanup) without letting a
// common word ("the") jump to a far-away occurrence.
const ALIGN_LOOKAHEAD = 48;

const SPECIAL_TOKEN = /^\s*(\[_[A-Z]+_?\d*\]|<\|[^|]*\|>|<unk>|<blk>|<s>|<\/s>)\s*$/;
const BYTE_TOKEN = /^<0x[0-9A-Fa-f]{2}>$/;
const PUNCT_ONLY = /^[\p{P}\p{S}]+$/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

const round3 = (n) => Math.round(n * 1000) / 1000;
const isProbability = (p) => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1;

function tokensFromWhisperVerbose(json) {
  const segments = Array.isArray(json?.segments) ? json.segments : [];
  const tokens = [];
  for (const segment of segments) {
    for (const entry of Array.isArray(segment?.words) ? segment.words : []) {
      if (typeof entry?.word !== "string") continue;
      tokens.push({
        text: entry.word,
        p: Number(entry.probability),
        ...(Number.isFinite(entry.start) ? { t: round3(entry.start) } : {}),
      });
    }
  }
  return tokens;
}

function tokensFromSherpaOffline(json, offsetSeconds = 0) {
  const pieces = Array.isArray(json?.tokens) ? json.tokens : [];
  const logProbs = Array.isArray(json?.ys_log_probs) ? json.ys_log_probs : [];
  if (!pieces.length || pieces.length !== logProbs.length) return [];
  const times =
    Array.isArray(json?.timestamps) && json.timestamps.length === pieces.length ? json.timestamps : null;
  return pieces.map((piece, i) => ({
    text: String(piece),
    p: Math.exp(Number(logProbs[i])),
    ...(times && Number.isFinite(times[i]) ? { t: round3(times[i] + offsetSeconds) } : {}),
  }));
}

function offsetTokens(tokens, seconds) {
  if (!Array.isArray(tokens)) return [];
  return tokens.map((token, i) => ({
    ...token,
    text: i === 0 && !/^[\s▁]/.test(token.text) ? ` ${token.text}` : token.text,
    ...(Number.isFinite(token.t) ? { t: round3(token.t + seconds) } : {}),
  }));
}

function mergeTokensToWords(tokens) {
  const words = [];
  let current = null;
  const flush = () => {
    if (current && current.scores.length) {
      const meanLog =
        current.scores.reduce((sum, p) => sum + Math.log(Math.max(p, 1e-6)), 0) / current.scores.length;
      words.push({
        w: current.text,
        p: round3(Math.exp(meanLog)),
        ...(current.t !== undefined ? { t: current.t } : {}),
      });
    }
    current = null;
  };

  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (!token || typeof token.text !== "string" || !isProbability(token.p)) continue;
    const text = token.text.replace(/▁/g, " ");
    const bare = text.trim();
    if (!bare || SPECIAL_TOKEN.test(text) || BYTE_TOKEN.test(bare)) continue;
    const isPunct = PUNCT_ONLY.test(bare);
    const startsWord = /^\s/.test(text) || !current || (CJK.test(bare) && !isPunct);
    if (startsWord) {
      flush();
      current = { text: bare, scores: isPunct ? [] : [token.p], t: token.t };
    } else {
      current.text += bare;
      // Punctuation rides along with its word but never lowers its score.
      if (!isPunct) current.scores.push(token.p);
    }
  }
  flush();
  return words;
}

function findWord(text, lowerText, word, from) {
  const useLower = lowerText !== null && word.toLowerCase().length === word.length;
  const hay = useLower ? lowerText : text;
  const needle = useLower ? word.toLowerCase() : word;
  const checkBoundary = !CJK.test(word);
  let at = hay.indexOf(needle, from);
  while (at !== -1 && at - from <= ALIGN_LOOKAHEAD) {
    const end = at + needle.length;
    if (!checkBoundary || (!WORD_CHAR.test(text[at - 1] ?? "") && !WORD_CHAR.test(text[end] ?? ""))) {
      return at;
    }
    at = hay.indexOf(needle, at + 1);
  }
  return -1;
}

function alignWordsToText(words, text) {
  if (typeof text !== "string" || !text) return [];
  const lower = text.toLowerCase();
  const lowerText = lower.length === text.length ? lower : null;
  const out = [];
  let cursor = 0;
  for (const word of words) {
    const at = findWord(text, lowerText, word.w, cursor);
    if (at === -1) continue;
    out.push({ s: at, e: at + word.w.length, p: word.p, ...(word.t !== undefined ? { t: word.t } : {}) });
    cursor = at + word.w.length;
  }
  return out;
}

function sanitizeWords(words) {
  if (!Array.isArray(words) || words.length === 0 || words.length > MAX_WORDS) return null;
  const clean = [];
  for (const word of words) {
    if (!word || typeof word.w !== "string") continue;
    if (word.w.length > MAX_WORD_LENGTH) return null;
    if (!word.w.trim() || !isProbability(word.p)) continue;
    clean.push({
      w: word.w.trim(),
      p: round3(word.p),
      ...(Number.isFinite(word.t) && word.t >= 0 ? { t: round3(word.t) } : {}),
    });
  }
  return clean.length ? clean : null;
}

function buildStoredConfidence(input, rawText) {
  if (!input || !ENGINES.has(input.engine) || typeof rawText !== "string") return null;
  const words = sanitizeWords(input.words);
  if (!words) return null;
  const aligned = alignWordsToText(words, rawText);
  return aligned.length ? { v: 1, engine: input.engine, words: aligned } : null;
}

module.exports = {
  ENGINES,
  MAX_WORDS,
  MAX_WORD_LENGTH,
  alignWordsToText,
  buildStoredConfidence,
  mergeTokensToWords,
  offsetTokens,
  tokensFromSherpaOffline,
  tokensFromWhisperVerbose,
};
```

If the spike report recorded a different sherpa field name (for example `token_log_probs`), use that name in `tokensFromSherpaOffline` and in its test.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/helpers/wordConfidence.test.js`
Expected: PASS. The fixture tests pass for GO engines and skip for NO-GO engines.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/wordConfidence.js test/helpers/wordConfidence.test.js
git commit -m "feat(stt): merge engine tokens into aligned word confidence"
```

---

### Task 4: whisper.cpp — request `verbose_json` behind the option and parse words

Run this only if whisper.cpp is GO.

**Files:**
- Modify: `src/helpers/whisperServer.js:868` (destructure `wordConfidence`) and `:918-923` (`response_format`)
- Modify: `src/helpers/whisper.js`:
  - `:397-400` (`transcribeLocalWhisper` forwards the option);
  - `:466-471` and `:479` (`_runServerTranscription`);
  - `:533` and `:565-571` (`parseWhisperResult`).
- Test: `test/helpers/whisperServerInferenceFields.test.js` (append), `test/helpers/whisperWordConfidence.test.js` (new)

**Interfaces:**
- Consumes Task 3: `tokensFromWhisperVerbose`, `mergeTokensToWords`.
- Produces:
  - `WhisperServerManager#transcribe(buffer, { …, wordConfidence?: boolean })`;
  - `WhisperManager#transcribeLocalWhisper(blob, { …, wordConfidence?: boolean })`;
  - `parseWhisperResult(output, { wordConfidence?: boolean } = {})`, which returns `{ success: true, text, confidence?: { engine: "whisper.cpp", words } }`.
- The IPC handler `transcribe-local-whisper` (`ipcHandlers.js:2374-2390`) already spreads `requestOptions` through, so it needs no change.

- [ ] **Step 1: Write the failing tests**

Append to `test/helpers/whisperServerInferenceFields.test.js`:

```js
test("word confidence asks for verbose_json and skips the language-probability pass", async (t) => {
  const { server, port, getBody } = await startCapturingServer();
  t.after(() => server.close());

  const manager = createManager(port);
  await manager.transcribe(Buffer.from("audio"), { language: "en", wordConfidence: true });

  const body = getBody();
  assert.equal(fieldValue(body, "response_format"), "verbose_json");
  assert.equal(fieldValue(body, "no_language_probabilities"), "true");
});

test("without word confidence the request is unchanged", async (t) => {
  const { server, port, getBody } = await startCapturingServer();
  t.after(() => server.close());

  const manager = createManager(port);
  await manager.transcribe(Buffer.from("audio"), { language: "en" });

  const body = getBody();
  assert.equal(fieldValue(body, "response_format"), "json");
  assert.equal(fieldValue(body, "no_language_probabilities"), null);
});
```

Create `test/helpers/whisperWordConfidence.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const WhisperManager = require("../../src/helpers/whisper");

const VERBOSE = {
  task: "transcribe",
  language: "en",
  text: " So the tier.",
  segments: [{ text: " So the tier.", words: [
    { word: " So", start: 0, end: 0.3, t_dtw: -1, probability: 0.97 },
    { word: " the", start: 0.3, end: 0.5, t_dtw: -1, probability: 0.99 },
    { word: " tier", start: 0.5, end: 0.9, t_dtw: -1, probability: 0.64 },
    { word: ".", start: 0.9, end: 1, t_dtw: -1, probability: 0.5 },
  ] }],
};
const EXPECTED_WORDS = [{ w: "So", p: 0.97, t: 0 }, { w: "the", p: 0.99, t: 0.3 }, { w: "tier.", p: 0.64, t: 0.5 }];

const parser = () => Object.create(WhisperManager.prototype);

test("verbose_json keeps the normalised text and adds whisper.cpp word confidence", () => {
  assert.deepEqual(parser().parseWhisperResult(VERBOSE, { wordConfidence: true }), {
    success: true,
    text: "So the tier.",
    confidence: { engine: "whisper.cpp", words: EXPECTED_WORDS },
  });
});

test("without the option the result shape is exactly today's", () => {
  assert.deepEqual(parser().parseWhisperResult(VERBOSE), { success: true, text: "So the tier." });
});

test("a verbose response without words still returns its text", () => {
  assert.deepEqual(parser().parseWhisperResult({ text: " Hi.", segments: [] }, { wordConfidence: true }), {
    success: true,
    text: "Hi.",
  });
});

test("transcribeLocalWhisper forwards the option to the server and the parser", async () => {
  const manager = parser();
  let seen = null;
  manager.serverManager = {
    isAvailable: () => true,
    start: async () => {},
    port: 1,
    transcribe: async (_buffer, options) => {
      seen = options;
      return VERBOSE;
    },
  };
  manager.getModelPath = () => __filename;
  manager.getVadModelPath = () => null;
  manager.resolveGpuStartOptions = () => ({});
  const out = await manager.transcribeLocalWhisper(Buffer.from("audio"), { model: "base", wordConfidence: true });
  assert.equal(seen.wordConfidence, true);
  assert.deepEqual(out.confidence, { engine: "whisper.cpp", words: EXPECTED_WORDS });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/whisperServerInferenceFields.test.js test/helpers/whisperWordConfidence.test.js`
Expected: FAIL. The verbose test gets `json` instead of `verbose_json`, the parser returns no `confidence`, and `seen.wordConfidence` is `undefined`.

- [ ] **Step 3: Implement**

1. `src/helpers/whisperServer.js:868`. Change the destructure to:

   ```js
       const { language, initialPrompt, signal, skipDecoderThresholds, wordConfidence } = options;
   ```

   Replace the `response_format` block at `:918-923` with:

   ```js
       // Labs word confidence (Plan 08): verbose_json carries per-token
       // probabilities. The language-probability pass is never wanted here.
       parts.push(
         `--${boundary}\r\n` +
           `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
           `${wordConfidence ? "verbose_json" : "json"}\r\n`
       );
       if (wordConfidence) {
         parts.push(
           `--${boundary}\r\n` +
             `Content-Disposition: form-data; name="no_language_probabilities"\r\n\r\n` +
             `true\r\n`
         );
       }
   ```

2. `src/helpers/whisper.js`:
   - At the top with the other requires, add `const { mergeTokensToWords, tokensFromWhisperVerbose } = require("./wordConfidence");`.
   - In `transcribeLocalWhisper`, the options object passed to `transcribeViaServer` (`:397-400`) gains `wordConfidence: options.wordConfidence === true,`.
   - In `_runServerTranscription`, the `serverManager.transcribe` options (`:466-471`) gain `wordConfidence: options.wordConfidence === true,`. Change `return this.parseWhisperResult(result);` (`:479`) to:

     ```js
         return this.parseWhisperResult(result, { wordConfidence: options.wordConfidence === true });
     ```

   - Change the signature at `:533` to `parseWhisperResult(output, { wordConfidence = false } = {}) {` and replace the server branch at `:565-571` with:

     ```js
         // Handle whisper-server format (has "text" field directly)
         if (result.text !== undefined) {
           const text = typeof result.text === "string" ? this.normalizeWhitespace(result.text) : "";
           if (!text || this.isBlankAudioMarker(text)) {
             return { success: false, message: "No audio detected" };
           }
           if (wordConfidence) {
             const words = mergeTokensToWords(tokensFromWhisperVerbose(result));
             if (words.length) return { success: true, text, confidence: { engine: "whisper.cpp", words } };
           }
           return { success: true, text };
         }
     ```

   - `transcribeViaLan` (`:482`) is unchanged. LAN servers stay on `json`, so LAN results never carry confidence.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/whisperServerInferenceFields.test.js test/helpers/whisperWordConfidence.test.js test/helpers/whisperServerWavInput.test.js test/helpers/whisperServerVadArgs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/whisperServer.js src/helpers/whisper.js test/helpers/whisperServerInferenceFields.test.js test/helpers/whisperWordConfidence.test.js
git commit -m "feat(stt): whisper.cpp word confidence via verbose_json behind an option"
```

---

### Task 5: sherpa-onnx Parakeet — carry tokens from the WS result to the parse

Run this only if sherpa-onnx is GO.

**Files:**
- Modify: `src/helpers/parakeetWsResult.js:1-9` (add `parseOfflinePayload`) and `:65` (export)
- Modify: `src/helpers/parakeetWsServer.js:15` (import) and `:385` (resolve tokens)
- Modify: `src/helpers/parakeetServer.js:215-227` (offset and join the segment tokens)
- Modify: `src/helpers/parakeet.js`:
  - `:293` (`transcribeLocalParakeet` passes the option to the parser);
  - `parseParakeetResult` (`:296-321`).
- Test: `test/helpers/parakeetWsResult.test.js` (append), `test/helpers/parakeetServer.test.js` (append), `test/helpers/parakeetWordConfidence.test.js` (new)

**Interfaces:**
- Consumes Task 3: `tokensFromSherpaOffline`, `offsetTokens`, `mergeTokensToWords`.
- Produces:
  - `parseOfflinePayload(message): object | null`;
  - `ParakeetWsServer#transcribe` resolves `{ text, elapsed, tokens: Token[] }`;
  - `ParakeetServerManager#transcribe` resolves `{ text, elapsed, tokens, truncated? }`;
  - `ParakeetManager#parseParakeetResult(output, { wordConfidence? })` returns `{ …, confidence?: { engine: "sherpa-onnx", words } }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/helpers/parakeetWsResult.test.js` (keep its existing imports; add `parseOfflinePayload` to the destructured require at the top):

```js
test("parseOfflinePayload returns the raw sherpa JSON, or null for plain text", () => {
  const raw = JSON.stringify({ text: "hi", tokens: ["▁hi"], ys_log_probs: [-0.1] });
  assert.deepEqual(parseOfflinePayload(raw), { text: "hi", tokens: ["▁hi"], ys_log_probs: [-0.1] });
  assert.equal(parseOfflinePayload("hello there"), null);
  assert.equal(parseOfflinePayload(""), null);
});
```

Append to `test/helpers/parakeetServer.test.js`:

```js
test("segmented decodes keep tokens in order with per-segment time offsets", async () => {
  const fake = fakeWsServer([
    { text: "first", tokens: [{ text: "▁first", p: 0.9, t: 1 }] },
    { text: "second", tokens: [{ text: "sec", p: 0.8, t: 0.5 }, { text: "ond", p: 0.7, t: 0.7 }] },
  ]);
  const manager = managerWith(fake);

  const result = await manager.transcribe(wavFromSeconds([{ seconds: 20 }]));

  assert.equal(result.text, "first second");
  assert.deepEqual(result.tokens, [
    { text: "▁first", p: 0.9, t: 1 },
    { text: " sec", p: 0.8, t: 15.5 },
    { text: "ond", p: 0.7, t: 15.7 },
  ]);
});
```

Create `test/helpers/parakeetWordConfidence.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const ParakeetManager = require("../../src/helpers/parakeet");

const parser = () => Object.create(ParakeetManager.prototype);
const OUTPUT = {
  text: "the tier",
  elapsed: 3,
  tokens: [{ text: "▁the", p: 0.99, t: 0.1 }, { text: "▁ti", p: 0.64, t: 0.4 }, { text: "er", p: 1, t: 0.5 }],
};

test("Parakeet results carry sherpa-onnx word confidence on request", () => {
  assert.deepEqual(parser().parseParakeetResult(OUTPUT, { wordConfidence: true }), {
    success: true,
    text: "the tier",
    confidence: { engine: "sherpa-onnx", words: [{ w: "the", p: 0.99, t: 0.1 }, { w: "tier", p: 0.8, t: 0.4 }] },
  });
});

test("without the option, or without tokens, the result is exactly today's", () => {
  assert.deepEqual(parser().parseParakeetResult(OUTPUT), { success: true, text: "the tier" });
  assert.deepEqual(parser().parseParakeetResult({ text: "x" }, { wordConfidence: true }), { success: true, text: "x" });
});

test("a truncated decode keeps its warning alongside confidence", () => {
  const out = parser().parseParakeetResult({ ...OUTPUT, truncated: true }, { wordConfidence: true });
  assert.equal(out.warning, "truncated");
  assert.equal(out.confidence.engine, "sherpa-onnx");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/parakeetWsResult.test.js test/helpers/parakeetServer.test.js test/helpers/parakeetWordConfidence.test.js`
Expected: FAIL. `parseOfflinePayload is not a function`, `result.tokens` is `undefined`, and there is no `confidence` key.

- [ ] **Step 3: Implement**

1. `src/helpers/parakeetWsResult.js`. Add after `parseOfflineMessage`:

   ```js
   // The offline server's full JSON (tokens, ys_log_probs, timestamps…), or null
   // when it sent plain text. parseOfflineMessage stays the text source of truth.
   function parseOfflinePayload(message) {
     try {
       const parsed = JSON.parse(String(message || "").trim());
       return parsed && typeof parsed === "object" ? parsed : null;
     } catch {
       return null;
     }
   }
   ```

   Change the export at `:65` to `module.exports = { parseOfflineMessage, parseOfflinePayload, parseOnlineMessages, createOnlineAccumulator };`.

2. `src/helpers/parakeetWsServer.js`:
   - Change `:15` to `const { parseOfflineMessage, parseOfflinePayload, createOnlineAccumulator } = require("./parakeetWsResult");`.
   - Add `const { tokensFromSherpaOffline } = require("./wordConfidence");`.
   - Change `:385` to:

     ```js
             resolve({
               text: parseOfflineMessage(result),
               tokens: tokensFromSherpaOffline(parseOfflinePayload(result)),
               elapsed,
             });
     ```

3. `src/helpers/parakeetServer.js`:
   - Add `const { offsetTokens } = require("./wordConfidence");` with the requires.
   - Replace the join at `:219-227` with:

     ```js
           const text = results
             .map((result) => result.text)
             .filter(Boolean)
             .join(" ");
           // Token times restart per segment; shift them onto the recording's clock.
           const tokens = results.flatMap((result, index) =>
             offsetTokens(result.tokens, index * maxSegmentSeconds)
           );
           const elapsed = results.reduce((sum, result) => sum + (result.elapsed || 0), 0);
           return results.some((result) => result.truncated)
             ? { text, elapsed, tokens, truncated: true }
             : { text, elapsed, tokens };
     ```

   The single-request path (`:164-176`) already returns the WS result object, so its `tokens` ride along.

4. `src/helpers/parakeet.js`:
   - Add `const { mergeTokensToWords } = require("./wordConfidence");`.
   - Change `return this.parseParakeetResult(result);` in `transcribeLocalParakeet` to `return this.parseParakeetResult(result, { wordConfidence: options.wordConfidence === true });`.
   - Change the signature to `parseParakeetResult(output, { wordConfidence = false } = {}) {` and replace its final two statements (from `const text = output.text.trim();`) with:

     ```js
         const text = output.text.trim();

         if (!text) {
           return { success: false, code: "NO_SPEECH_DETECTED", message: "No audio detected" };
         }

         const words = wordConfidence ? mergeTokensToWords(output.tokens) : [];
         const confidence = words.length ? { confidence: { engine: "sherpa-onnx", words } } : {};

         // Surfaced by the renderer as a partial-transcription warning toast.
         return output.truncated
           ? { success: true, text, warning: "truncated", ...confidence }
           : { success: true, text, ...confidence };
     ```

   Upload and meeting callers never pass `wordConfidence`, so their results are unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/parakeetWsResult.test.js test/helpers/parakeetServer.test.js test/helpers/parakeetWordConfidence.test.js test/helpers/parakeetWsStartup.test.js`
Expected: PASS. Pre-existing `deepEqual`s on `transcribe()` results may now see an extra `tokens: []`. If one does, update only that expectation to include `tokens: []` and name it in the commit body.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/parakeetWsResult.js src/helpers/parakeetWsServer.js src/helpers/parakeetServer.js src/helpers/parakeet.js test/helpers/parakeetWsResult.test.js test/helpers/parakeetServer.test.js test/helpers/parakeetWordConfidence.test.js
git commit -m "feat(stt): Parakeet word confidence from sherpa-onnx token log-probs"
```

---

### Task 6: Confidence storage, migration, IPC and lifecycle

**Files:**
- Modify: `src/helpers/localDatabaseSchema.js` (append before the closing backtick at `:329`)
- Modify: `src/helpers/database.js`:
  - requires (`:1-21`);
  - `saveTranscription` (`:156-205`);
  - `getTranscriptions` (`:534-548`);
  - `updateTranscriptionText` (`:605-623`);
  - `getTranscriptionById` (`:649-658`);
  - a new `getTranscriptionConfidence` after `getTranscriptionById`.
- Modify: `src/helpers/ipcHandlers.js` (register `db-get-transcription-confidence` after `db-get-transcriptions` at `:1263-1265`)
- Modify: `preload.js` (after `getTranscriptionById` at `:197`)
- Modify: `src/types/electron.ts`:
  - new exported types above `TranscriptionItem` (`:97`);
  - `has_confidence` on `TranscriptionItem`;
  - `saveTranscription` options (`:818-828`);
  - the new method after `getTranscriptionById` (`:839`).
- Test: `test/helpers/transcriptionConfidenceDatabase.test.js`

**Interfaces:**
- Consumes Task 3: `buildStoredConfidence`.
- Produces:
  - `DatabaseManager#saveTranscription(text, rawText, { …, confidence?: Candidate | null })`;
  - `DatabaseManager#getTranscriptionConfidence(id): TranscriptionConfidence | null`;
  - every transcription row from `getTranscriptions`, `getTranscriptionById` and `saveTranscription().transcription` carries `has_confidence: 0 | 1`.
  - Preload: `window.electronAPI.getTranscriptionConfidence(id)`.
  - Types in `src/types/electron.ts`:

    ```ts
    export type ConfidenceEngine = "whisper.cpp" | "sherpa-onnx";
    export interface TranscriptionConfidenceInput { engine: ConfidenceEngine; words: Array<{ w: string; p: number; t?: number }> }
    export interface TranscriptionConfidenceWord { s: number; e: number; p: number; t?: number }
    export interface TranscriptionConfidence { v: 1; engine: ConfidenceEngine; words: TranscriptionConfidenceWord[] }
    ```

- [ ] **Step 1: Write the failing test**

Create `test/helpers/transcriptionConfidenceDatabase.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDb } = require("./harness/db");
const DatabaseManager = require("../../src/helpers/database");

const INPUT = { engine: "whisper.cpp", words: [{ w: "Maria", p: 0.58, t: 1.2 }, { w: "wants", p: 0.91 }] };
const STORED = { v: 1, engine: "whisper.cpp", words: [{ s: 0, e: 5, p: 0.58, t: 1.2 }, { s: 6, e: 11, p: 0.91 }] };
const confidenceRows = (db) => db.db.prepare("SELECT COUNT(*) AS n FROM transcription_confidence").get().n;

test("a transcription saved with confidence round-trips and flags history rows", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { id, transcription } = db.saveTranscription("Maria wants it.", "Maria wants it.", { confidence: INPUT });
  assert.equal(transcription.has_confidence, 1);
  assert.deepEqual(db.getTranscriptionConfidence(id), STORED);
  assert.equal(db.getTranscriptions().find((row) => row.id === id).has_confidence, 1);
  assert.equal(db.getTranscriptionById(id).has_confidence, 1);
});

test("confidence aligns to raw_text, not the cleaned text", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { id } = db.saveTranscription("MARIA WANTS IT!", "Maria wants it.", { confidence: INPUT });
  assert.deepEqual(db.getTranscriptionConfidence(id), STORED);
});

test("rows without confidence cost nothing and read as 0", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { id, transcription } = db.saveTranscription("plain", "plain");
  assert.equal(transcription.has_confidence, 0);
  assert.equal(db.getTranscriptionConfidence(id), null);
  assert.equal(confidenceRows(db), 0);
});

test("a malformed payload never blocks saving the transcription", (t) => {
  const db = createDb(t);
  if (!db) return;
  for (const confidence of [{ engine: "whisper.cpp", words: "nope" }, { engine: "evil", words: INPUT.words }, 42]) {
    const { id, success, transcription } = db.saveTranscription("keep me", "keep me", { confidence });
    assert.equal(success, true);
    assert.equal(transcription.text, "keep me");
    assert.equal(db.getTranscriptionConfidence(id), null);
  }
});

test("confidence follows the raw text: editing or retrying it drops the stale words", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { id } = db.saveTranscription("Maria wants it.", "Maria wants it.", { confidence: INPUT });
  db.updateTranscriptionText(id, "Maria wants it, edited.", "Maria wants it.");
  assert.deepEqual(db.getTranscriptionConfidence(id), STORED, "a cleaned-text edit keeps raw-aligned words");
  db.updateTranscriptionText(id, "Retried text", "Retried text");
  assert.equal(db.getTranscriptionConfidence(id), null);
  assert.equal(db.getTranscriptionById(id).has_confidence, 0);
});

test("deleting, clearing and retention purge confidence with the transcription", (t) => {
  const db = createDb(t);
  if (!db) return;
  const a = db.saveTranscription("Maria wants it.", "Maria wants it.", { confidence: INPUT }).id;
  const b = db.saveTranscription("Maria wants it.", "Maria wants it.", { confidence: INPUT }).id;
  db.deleteTranscription(a);
  assert.equal(db.getTranscriptionConfidence(a), null);
  db.db.prepare("UPDATE transcriptions SET created_at = datetime('now', '-40 days') WHERE id = ?").run(b);
  db.deleteTranscriptionsExpiredBefore(30);
  assert.equal(confidenceRows(db), 0);
  db.saveTranscription("Maria wants it.", "Maria wants it.", { confidence: INPUT });
  db.clearTranscriptions();
  assert.equal(confidenceRows(db), 0);
});

test("a profile created before Plan 08 gains the table on open and keeps its history", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { id } = db.saveTranscription("older row", "older row");
  db.db.exec("DROP TABLE transcription_confidence");
  db.db.close();
  const reopened = new DatabaseManager();
  t.after(() => reopened.db.close());
  assert.ok(
    reopened.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'transcription_confidence'").get()
  );
  assert.equal(reopened.getTranscriptionById(id).text, "older row");
  assert.equal(reopened.getTranscriptionById(id).has_confidence, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/helpers/transcriptionConfidenceDatabase.test.js`
Expected: FAIL. `transcription.has_confidence` is `undefined`, and `db.getTranscriptionConfidence is not a function`. If the run reports skips instead, run `npm run native:node` first.

- [ ] **Step 3: Implement**

1. `src/helpers/localDatabaseSchema.js`. Insert before the final `` `; ``:

   ```sql
   -- Word-level recognition confidence (Plan 08, WS-M4, Labs). One row per
   -- transcription; words_json is [{s,e,p,t?}] with s/e as offsets into raw_text.
   -- A side table so existing profiles gain it from this idempotent script and
   -- history's SELECT * rows stay small.
   CREATE TABLE IF NOT EXISTS transcription_confidence (
     transcription_id INTEGER PRIMARY KEY REFERENCES transcriptions(id) ON DELETE CASCADE,
     engine TEXT NOT NULL,
     words_json TEXT NOT NULL,
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );
   ```

2. `src/helpers/database.js`:
   - Add `const { buildStoredConfidence } = require("./wordConfidence");` with the requires.
   - Add below the module constants (after `:26`):

     ```js
     // History rows carry a cheap has_confidence flag; the words load lazily.
     const TRANSCRIPTION_ROW_SELECT = `SELECT t.*, EXISTS (
         SELECT 1 FROM transcription_confidence c WHERE c.transcription_id = t.id
       ) AS has_confidence FROM transcriptions t`;
     ```

   - In `saveTranscription`, add `confidence = null,` to the destructured options. Replace the `stmt.run(...)` through the fetch with:

     ```js
           const result = this.db.transaction(() => {
             const inserted = stmt.run(
               text,
               rawText,
               status,
               errorMessage,
               errorCode,
               routeKind,
               clientTranscriptionId,
               occurredAt
             );
             this._saveTranscriptionConfidence(inserted.lastInsertRowid, confidence, rawText ?? text);
             return inserted;
           })();

           const transcription = this.db
             .prepare(`${TRANSCRIPTION_ROW_SELECT} WHERE t.id = ?`)
             .get(result.lastInsertRowid);
     ```

   - Add these methods after `saveTranscription`:

     ```js
       // Invalid or unalignable input is dropped, never thrown: the transcription
       // itself must always save (content is preserved on every failure).
       _saveTranscriptionConfidence(id, input, rawText) {
         if (!input) return false;
         const stored = buildStoredConfidence(input, rawText);
         if (!stored) return false;
         this.db
           .prepare(
             "INSERT OR REPLACE INTO transcription_confidence (transcription_id, engine, words_json) VALUES (?, ?, ?)"
           )
           .run(id, stored.engine, JSON.stringify(stored.words));
         return true;
       }
     ```

   - `getTranscriptions`. Change the SQL to:

     ```js
           const statusFilter = includeDiscarded ? "" : " AND t.status != 'discarded'";
           const stmt = this.db.prepare(
             `${TRANSCRIPTION_ROW_SELECT} WHERE t.deleted_at IS NULL${statusFilter} ORDER BY t.timestamp DESC, t.id DESC LIMIT ?`
           );
     ```

   - `updateTranscriptionText`. Inside the transaction, before `stmt.run(text, rawText, id);`, add:

     ```js
             // Words are pinned to raw_text offsets; a new raw text (edit or retry)
             // makes them lie, so they go.
             if (existing && existing.raw_text !== rawText) {
               this.db.prepare("DELETE FROM transcription_confidence WHERE transcription_id = ?").run(id);
             }
     ```

   - `getTranscriptionById`. Change the statement to `this.db.prepare(\`${TRANSCRIPTION_ROW_SELECT} WHERE t.id = ?\`)`.
   - Add after `getTranscriptionById`:

     ```js
       getTranscriptionConfidence(id) {
         if (!this.db) throw new Error("Database not initialized");
         const row = this.db
           .prepare("SELECT engine, words_json FROM transcription_confidence WHERE transcription_id = ?")
           .get(id);
         if (!row) return null;
         try {
           return { v: 1, engine: row.engine, words: JSON.parse(row.words_json) };
         } catch (error) {
           debugLogger.warn("Unreadable transcription confidence", { id, error: error.message }, "database");
           return null;
         }
       }
     ```

3. `src/helpers/ipcHandlers.js`. After the `db-get-transcriptions` handler (`:1263-1265`):

   ```js
       ipcMain.handle("db-get-transcription-confidence", async (_event, id) => {
         return this.databaseManager.getTranscriptionConfidence(id);
       });
   ```

4. `preload.js`. After `getTranscriptionById` (`:197`):

   ```js
     getTranscriptionConfidence: (id) => ipcRenderer.invoke("db-get-transcription-confidence", id),
   ```

5. `src/types/electron.ts`:
   - Add the four exported types from **Interfaces** above `export interface TranscriptionItem` (`:97`).
   - Add `has_confidence?: number;` inside `TranscriptionItem` after `route_kind?: string | null;`.
   - Add `routeKind?: string | null;` and `confidence?: TranscriptionConfidenceInput | null;` to the `saveTranscription` options type (`:821-827`).
   - After `getTranscriptionById` (`:839`), add:

     ```ts
           getTranscriptionConfidence?: (id: number) => Promise<TranscriptionConfidence | null>;
     ```

   - Add `confidence?: TranscriptionConfidenceInput;` to `ParakeetTranscriptionResult` (`:528`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/transcriptionConfidenceDatabase.test.js test/helpers/personalIpcContract.test.js test/helpers/personalDatabase.test.js test/helpers/transcriptRetention.test.js test/helpers/translationHistory.test.js && npm run typecheck`
Expected: PASS. The IPC contract test confirms the new `db-*` channel is registered and that `getTranscriptionConfidence` exists on `DatabaseManager`.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/localDatabaseSchema.js src/helpers/database.js src/helpers/ipcHandlers.js preload.js src/types/electron.ts test/helpers/transcriptionConfidenceDatabase.test.js
git commit -m "feat(db): store word confidence beside transcriptions, aligned to raw text"
```

---

### Task 7: Renderer pipeline — request, carry and save confidence

**Files:**
- Modify: `src/helpers/audioManager.js`:
  - `processWithLocalWhisper` (`:1953-1956` options, `:2012-2016` retry call, `:2085-2092` result);
  - `processWithLocalParakeet` (`:2145-2148` call, `:2170-2178` result);
  - `saveTranscription` (`:3043-3047` signature, `:3079-3083` IPC call).
- Modify: `src/hooks/useAudioRecording.js:537-545` (forward `result.confidence`)
- Test: `test/helpers/audioManagerWordConfidence.test.js`

**Interfaces:**
- Consumes the Task 2 setting `labsConfidenceTypography`. It consumes Task 4 and Task 5 results (`result.confidence`) and the Task 6 `saveTranscription` option `confidence`.
- Produces:
  - dictation results `{ …, rawText, confidence?: TranscriptionConfidenceInput }`;
  - `AudioManager#saveTranscription(text, rawText, { clientTranscriptionId, analyticsOccurredAt, confidence })`.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/audioManagerWordConfidence.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");

const AUDIO_BLOB = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" });
const WHISPER_CONFIDENCE = { engine: "whisper.cpp", words: [{ w: "Hello", p: 0.6 }] };
const SHERPA_CONFIDENCE = { engine: "sherpa-onnx", words: [{ w: "Hello", p: 0.6 }] };

async function setup(t, settings) {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "loqui-word-confidence-test-",
    settingsKey: "__wordConfidenceSettings",
    settings: {
      useLocalWhisper: true,
      localTranscriptionProvider: "whisper",
      whisperModel: "base",
      cloudTranscriptionMode: "byok",
      dataRetentionEnabled: true,
      audioRetentionDays: 0,
      ...settings,
    },
  });
  const manager = loaded.createManager({
    getEffectiveSttLanguage: () => "en-US",
    getCustomDictionaryPrompt: () => null,
    getWhisperPrompt: () => null,
    processTranscription: async (text) => `cleaned: ${text}`,
  });
  return { ...loaded, manager };
}

test("with the Labs flag off, whisper is asked exactly as today", async (t) => {
  const { window, manager } = await setup(t, { labsConfidenceTypography: false });
  const calls = [];
  window.electronAPI.transcribeLocalWhisper = async (_buffer, options) => {
    calls.push(options);
    return { success: true, text: "Hello" };
  };
  const result = await manager.processWithLocalWhisper(AUDIO_BLOB, "base");
  assert.equal("wordConfidence" in calls[0], false);
  assert.equal("confidence" in result, false);
});

test("with the Labs flag on, whisper confidence rides with the raw text", async (t) => {
  const { window, manager } = await setup(t, { labsConfidenceTypography: true });
  const calls = [];
  window.electronAPI.transcribeLocalWhisper = async (_buffer, options) => {
    calls.push(options);
    return { success: true, text: "Hello", confidence: WHISPER_CONFIDENCE };
  };
  const result = await manager.processWithLocalWhisper(AUDIO_BLOB, "base");
  assert.equal(calls[0].wordConfidence, true);
  assert.equal(result.rawText, "Hello");
  assert.equal(result.text, "cleaned: Hello");
  assert.deepEqual(result.confidence, WHISPER_CONFIDENCE);
});

test("the dictionary-echo retry keeps asking for confidence and its own result wins", async (t) => {
  const { window, manager } = await setup(t, { labsConfidenceTypography: true });
  const prompt = "Alcahest, Chromium, TypeScript, Electron, testing, data, benchmark, inference";
  manager.getCustomDictionaryPrompt = () => prompt;
  manager.getWhisperPrompt = () => prompt;
  const calls = [];
  const retryConfidence = { engine: "whisper.cpp", words: [{ w: "The", p: 0.9 }] };
  window.electronAPI.transcribeLocalWhisper = async (_buffer, options) => {
    calls.push(options);
    return calls.length === 1
      ? { success: true, text: prompt, confidence: WHISPER_CONFIDENCE }
      : { success: true, text: "The database migration completed successfully.", confidence: retryConfidence };
  };
  const result = await manager.processWithLocalWhisper(AUDIO_BLOB, "base");
  assert.equal(calls.length, 2, "the echo triggered the prompt-free retry");
  assert.equal(calls[1].wordConfidence, true);
  assert.deepEqual(result.confidence, retryConfidence);
});

test("Parakeet asks for confidence only while the Labs flag is on", async (t) => {
  const { window, manager } = await setup(t, { labsConfidenceTypography: true, localTranscriptionProvider: "nvidia" });
  const calls = [];
  window.electronAPI.transcribeLocalParakeet = async (_buffer, options) => {
    calls.push(options);
    return { success: true, text: "Hello", confidence: SHERPA_CONFIDENCE };
  };
  const result = await manager.processWithLocalParakeet(AUDIO_BLOB, "parakeet-tdt-0.6b-v3");
  assert.equal(calls[0].wordConfidence, true);
  assert.deepEqual(result.confidence, SHERPA_CONFIDENCE);
});

test("saveTranscription forwards confidence to the database call, and omits it when absent", async (t) => {
  const { window, manager } = await setup(t, {});
  const saved = [];
  window.electronAPI.recordAnalyticsEvent = async () => {};
  window.electronAPI.saveTranscription = async (text, rawText, options) => {
    saved.push(options);
    return { id: 1, success: true };
  };
  await manager.saveTranscription("cleaned: Hello", "Hello", { confidence: WHISPER_CONFIDENCE });
  await manager.saveTranscription("plain", "plain", {});
  assert.deepEqual(saved[0].confidence, WHISPER_CONFIDENCE);
  assert.equal("confidence" in saved[1], false);
});
```

The echo test depends on the dictionary-echo heuristics (`audioManager.js:1990-2078`). If it does not trigger the retry with this prompt, copy the prompt and first outcome from the first case in `test/helpers/audioManagerDictionaryPromptRecovery.test.js:86-110`, which is known to retry.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/helpers/audioManagerWordConfidence.test.js`
Expected: FAIL. `calls[0].wordConfidence` is `undefined` and `result.confidence` is `undefined` in the flag-on cases.

- [ ] **Step 3: Implement**

1. `processWithLocalWhisper`. After `options.language = language;` (the `if (language)` block at `:1954-1956`), add:

   ```js
         // Labs (WS-M4): word probabilities are requested only while the
         // prototype is on, so the default request stays plain json.
         if (getSettings().labsConfidenceTypography) {
           options.wordConfidence = true;
         }
   ```

   In the retry call at `:2012-2016`, add `...(options.wordConfidence ? { wordConfidence: true } : {}),` after the `language` spread. In the success return at `:2085-2092`, add `...(result.confidence ? { confidence: result.confidence } : {}),` after `rawText,`.

2. `processWithLocalParakeet`. Change the call at `:2145-2148` to:

   ```js
           result = await window.electronAPI.transcribeLocalParakeet(arrayBuffer, {
             model,
             language: getBaseLanguageCode(this.getEffectiveSttLanguage(getSettings())),
             ...(getSettings().labsConfidenceTypography ? { wordConfidence: true } : {}),
           });
   ```

   In the success return at `:2170-2178`, add `...(result.confidence ? { confidence: result.confidence } : {}),` after `rawText,`. The streamed-text path builds `result = { success: true, text: streamedText }`, so it never carries confidence.

3. `saveTranscription`. Change the destructure at `:3046` to `{ clientTranscriptionId, analyticsOccurredAt, confidence } = {}`, and the IPC call at `:3079-3083` to:

   ```js
         const result = await window.electronAPI.saveTranscription(text, rawText, {
           clientTranscriptionId: eventId,
           routeKind: this.translationRequested ? "translation" : null,
           analyticsOccurredAt: occurredAt.toISOString(),
           ...(confidence ? { confidence } : {}),
         });
   ```

4. `src/hooks/useAudioRecording.js:537-545`. In the options object passed to `audioManagerRef.current.saveTranscription(...)`, add after the `analyticsOccurredAt` spread:

   ```js
                     ...(result.confidence ? { confidence: result.confidence } : {}),
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/audioManagerWordConfidence.test.js test/helpers/audioManagerDictionaryPromptRecovery.test.js test/helpers/audioManagerOccurrenceTime.test.js test/helpers/audioManagerWakeWordLanguage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/audioManager.js src/hooks/useAudioRecording.js test/helpers/audioManagerWordConfidence.test.js
git commit -m "feat(dictation): carry Labs word confidence from local engines to history"
```

---

### Task 8: Confidence tokens, buckets and `ConfidenceText`

**Files:**
- Create: `src/lib/wordConfidence.ts`
- Create: `src/components/ui/ConfidenceText.tsx`
- Modify: `src/index.css`:
  - `@theme` block at `:7` (light tokens);
  - `.dark` block at `:113` (Plum Night tokens);
  - a new "Confidence typography" rule block appended at the end of the file.
- Test: `test/lib/wordConfidence.test.js`, `test/components/confidenceText.test.js`

**Interfaces:**
- Consumes the types `TranscriptionConfidence` and `TranscriptionConfidenceWord` from `src/types/electron.ts` (Task 6).
- Produces `src/lib/wordConfidence.ts`:

  ```ts
  export type ConfidenceBucket = "sure" | "maybe" | "unsure";
  export const CONFIDENCE_THRESHOLDS: { sure: number; maybe: number };   // default { sure: 0.9, maybe: 0.7 } unless the spike changed them
  export const CONFIDENCE_WEIGHT: Record<ConfidenceBucket, number>;      // { sure: 420, maybe: 400, unsure: 380 }
  export function confidenceBucket(p: number): ConfidenceBucket;
  export type TranscriptSegment = { text: string; word?: TranscriptionConfidenceWord; index?: number };
  export function segmentTranscript(text: string, words: TranscriptionConfidenceWord[]): TranscriptSegment[];
  export function confidencePercent(p: number): number;                  // 0..100, rounded
  ```

- Produces `ConfidenceText` (`src/components/ui/ConfidenceText.tsx`):

  ```ts
  export interface ConfidenceTextProps {
    text: string;
    confidence: TranscriptionConfidence | null;
    show: boolean;                               // false = plain weight 420, no underlines, no buttons
    className?: string;
    onClick?: React.MouseEventHandler<HTMLParagraphElement>;   // keeps Plan 06's click-to-copy on the row
    renderWord?: (args: { word: TranscriptionConfidenceWord; bucket: "maybe" | "unsure"; label: string; children: string }) => React.ReactNode;
  }
  export function ConfidenceText(props: ConfidenceTextProps): JSX.Element;
  ```

  Without `renderWord`, an uncertain word renders as a focusable `<span role="button" tabIndex={0}>` with an `aria-label`. Task 9 passes `renderWord` to wrap it in the popover.
- Produces CSS custom properties `--color-confidence-maybe` and `--color-confidence-low`, and classes `.confidence-text`, `.confidence-word[data-confidence=…]`.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/wordConfidence.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/wordConfidence.ts");

test("buckets follow the spec mapping at the boundaries", async () => {
  const { confidenceBucket, CONFIDENCE_WEIGHT } = await load();
  assert.equal(confidenceBucket(0.9), "sure");
  assert.equal(confidenceBucket(0.8999), "maybe");
  assert.equal(confidenceBucket(0.7), "maybe");
  assert.equal(confidenceBucket(0.6999), "unsure");
  assert.equal(confidenceBucket(Number.NaN), "sure", "bad data never accuses a word");
  assert.deepEqual(CONFIDENCE_WEIGHT, { sure: 420, maybe: 400, unsure: 380 });
});

test("segments cover the text exactly once, in order, and ignore broken offsets", async () => {
  const { segmentTranscript } = await load();
  const text = "Maria wants the tier names.";
  const segments = segmentTranscript(text, [
    { s: 16, e: 20, p: 0.64 },
    { s: 0, e: 5, p: 0.58 },
    { s: 3, e: 8, p: 0.1 },
    { s: 30, e: 40, p: 0.1 },
    { s: 21, e: 21, p: 0.1 },
  ]);
  assert.equal(segments.map((s) => s.text).join(""), text);
  assert.deepEqual(segments.filter((s) => s.word).map((s) => s.text), ["Maria", "tier"]);
  assert.deepEqual(segmentTranscript("plain", []), [{ text: "plain" }]);
});

test("percent labels are whole numbers", async () => {
  const { confidencePercent } = await load();
  assert.equal(confidencePercent(0.584), 58);
  assert.equal(confidencePercent(1), 100);
});
```

Create `test/components/confidenceText.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const repoRoot = path.join(__dirname, "../..");
const load = () => import("../../src/components/ui/ConfidenceText.tsx");
const CONF = { v: 1, engine: "whisper.cpp", words: [{ s: 0, e: 5, p: 0.58 }, { s: 6, e: 11, p: 0.95 }, { s: 16, e: 20, p: 0.8 }] };
const TEXT = "Maria wants the tier names.";

test("uncertain words are focusable, labelled and carry their bucket; sure words stay plain", async () => {
  const { ConfidenceText } = await load();
  const html = renderStatic(ConfidenceText, { text: TEXT, confidence: CONF, show: true });
  assert.match(html, /class="confidence-text[^"]*"[^>]*data-show="true"/);
  assert.match(html, /data-confidence="unsure"[^>]*role="button"[^>]*tabindex="0"[^>]*>Maria</);
  assert.match(html, /data-confidence="maybe"[^>]*>tier</);
  assert.match(html, /aria-label="history\.confidence\.wordLabel"/);
  assert.doesNotMatch(html, /data-confidence="sure"[^>]*role="button"/);
  assert.equal(html.replace(/<[^>]+>/g, ""), TEXT, "text content is unchanged");
});

test("with confidence hidden nothing is interactive", async () => {
  const { ConfidenceText } = await load();
  const html = renderStatic(ConfidenceText, { text: TEXT, confidence: CONF, show: false });
  assert.match(html, /data-show="false"/);
  assert.doesNotMatch(html, /role="button"/);
});

test("weight is never the only signal, and reduced motion drops the transition", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  for (const bucket of ["maybe", "unsure"]) {
    const rule = css.match(new RegExp(`\\.confidence-text\\[data-show="true"\\] \\.confidence-word\\[data-confidence="${bucket}"\\]\\s*\\{([^}]*)\\}`));
    assert.ok(rule, `${bucket} rule`);
    assert.match(rule[1], /text-decoration-line:\s*underline/);
    assert.match(rule[1], /text-decoration-style:\s*dotted/);
  }
  assert.match(css, /\.confidence-word\s*\{[^}]*transition:[^}]*var\(--motion-fast\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.confidence-word\s*\{\s*transition:\s*none;/);
});

test("underline colours reach 3:1 on page and card surfaces in both themes", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8"));
  for (const [theme, tokens] of [["light", light], ["dark", dark]]) {
    for (const fg of ["--color-confidence-maybe", "--color-confidence-low"]) {
      for (const bg of ["--color-background", "--color-card"]) {
        assert.ok(contrastRatio(tokens[fg], tokens[bg]) >= 3, `${theme} ${fg} on ${bg}`);
      }
    }
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/lib/wordConfidence.test.js test/components/confidenceText.test.js`
Expected: FAIL with `Cannot find module '../../src/lib/wordConfidence.ts'`.

- [ ] **Step 3: Implement**

Create `src/lib/wordConfidence.ts`:

```ts
import type { TranscriptionConfidenceWord } from "../types/electron";

// WS-M4 (Plan 08). Thresholds come from the audit spec; Task 1's spike may
// have recalibrated them. Weights ride Inter Variable's continuous wght axis.
export type ConfidenceBucket = "sure" | "maybe" | "unsure";

export const CONFIDENCE_THRESHOLDS = { sure: 0.9, maybe: 0.7 } as const;
export const CONFIDENCE_WEIGHT: Record<ConfidenceBucket, number> = { sure: 420, maybe: 400, unsure: 380 };

export function confidenceBucket(p: number): ConfidenceBucket {
  if (!Number.isFinite(p) || p >= CONFIDENCE_THRESHOLDS.sure) return "sure";
  return p >= CONFIDENCE_THRESHOLDS.maybe ? "maybe" : "unsure";
}

export function confidencePercent(p: number): number {
  return Math.round(Math.max(0, Math.min(1, p)) * 100);
}

export type TranscriptSegment = { text: string; word?: TranscriptionConfidenceWord; index?: number };

// Splits text into plain runs and word runs. Words that overlap an earlier
// word, fall outside the text or are empty are ignored, so the segments always
// concatenate back to exactly `text`.
export function segmentTranscript(
  text: string,
  words: TranscriptionConfidenceWord[]
): TranscriptSegment[] {
  const sorted = [...words].sort((a, b) => a.s - b.s);
  const segments: TranscriptSegment[] = [];
  let cursor = 0;
  sorted.forEach((word, index) => {
    if (word.s < cursor || word.e <= word.s || word.e > text.length) return;
    if (word.s > cursor) segments.push({ text: text.slice(cursor, word.s) });
    segments.push({ text: text.slice(word.s, word.e), word, index });
    cursor = word.e;
  });
  if (cursor < text.length || segments.length === 0) segments.push({ text: text.slice(cursor) });
  return segments;
}
```

The gate outcome is enforced in main (`ENGINES` in `src/helpers/wordConfidence.js`): the UI shows only what main stored. If the spike recalibrated, set `CONFIDENCE_THRESHOLDS` to the report's values and update the boundary assertions in `test/lib/wordConfidence.test.js` to match.

Create `src/components/ui/ConfidenceText.tsx`:

```tsx
import type { MouseEventHandler, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TranscriptionConfidence, TranscriptionConfidenceWord } from "../../types/electron";
import { confidenceBucket, confidencePercent, segmentTranscript } from "../../lib/wordConfidence";
import { cn } from "../lib/utils";

export interface ConfidenceTextProps {
  text: string;
  confidence: TranscriptionConfidence | null;
  show: boolean;
  className?: string;
  onClick?: MouseEventHandler<HTMLParagraphElement>;
  renderWord?: (args: {
    word: TranscriptionConfidenceWord;
    bucket: "maybe" | "unsure";
    label: string;
    children: string;
  }) => ReactNode;
}

// The type itself shows what the machine was unsure about (WS-M4). Weight is
// never the only signal: the CSS pairs it with a dotted underline.
export function ConfidenceText({ text, confidence, show, className, onClick, renderWord }: ConfidenceTextProps) {
  const { t } = useTranslation();
  const segments = segmentTranscript(text, confidence?.words ?? []);

  return (
    <p dir="auto" className={cn("confidence-text", className)} data-show={show ? "true" : "false"} onClick={onClick}>
      {segments.map((segment, i) => {
        if (!segment.word) return segment.text;
        const bucket = confidenceBucket(segment.word.p);
        if (!show || bucket === "sure") {
          return (
            <span key={i} className="confidence-word" data-confidence={bucket}>
              {segment.text}
            </span>
          );
        }
        const label = t("history.confidence.wordLabel", {
          word: segment.text,
          percent: confidencePercent(segment.word.p),
        });
        if (renderWord) {
          return <span key={i}>{renderWord({ word: segment.word, bucket, label, children: segment.text })}</span>;
        }
        return (
          <span key={i} className="confidence-word" data-confidence={bucket} role="button" tabIndex={0} aria-label={label}>
            {segment.text}
          </span>
        );
      })}
    </p>
  );
}
```

In `src/index.css`:
- Add to the `@theme` block (`:7`), after the `--color-accent-foreground` line:

  ```css
    /* WS-M4 confidence underlines (non-text, ≥3:1 on background and card). */
    --color-confidence-maybe: #767676;
    --color-confidence-low: #d90078;
  ```

- Add to `.dark` (`:113`), after its `--color-accent-foreground` line:

  ```css
    --color-confidence-maybe: #a8989f;
    --color-confidence-low: #ff6db8;
  ```

- Append at the end of the file:

  ```css
  /* Confidence typography (WS-M4, Labs). Inter Variable's wght axis carries
     certainty; a dotted underline always accompanies the lighter weight so
     the signal never depends on weight alone. */
  .confidence-text {
    font-weight: 420;
    font-variation-settings: "wght" 420;
  }
  .confidence-word {
    border-radius: 3px;
    transition:
      font-variation-settings var(--motion-fast) var(--motion-ease-std),
      font-weight var(--motion-fast) var(--motion-ease-std),
      text-decoration-color var(--motion-fast) var(--motion-ease-std);
  }
  .confidence-text[data-show="true"] .confidence-word[data-confidence="maybe"] {
    font-weight: 400;
    font-variation-settings: "wght" 400;
    text-decoration-line: underline;
    text-decoration-style: dotted;
    text-decoration-color: var(--color-confidence-maybe);
    text-decoration-thickness: 1.5px;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .confidence-text[data-show="true"] .confidence-word[data-confidence="unsure"] {
    font-weight: 380;
    font-variation-settings: "wght" 380;
    text-decoration-line: underline;
    text-decoration-style: dotted;
    text-decoration-color: var(--color-confidence-low);
    text-decoration-thickness: 1.5px;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .confidence-word:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .confidence-word {
      transition: none;
    }
  }
  ```

The `history.confidence.wordLabel` key is added in Task 10 Step 3. Until then, the SSR test sees the raw key, as the existing tests do.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/lib/wordConfidence.test.js test/components/confidenceText.test.js test/components/motionTokens.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wordConfidence.ts src/components/ui/ConfidenceText.tsx src/index.css test/lib/wordConfidence.test.js test/components/confidenceText.test.js
git commit -m "feat(ui): ConfidenceText draws recognition certainty in Inter's weight axis"
```

---

### Task 9: Word popover — Add to Words, Play 2 s

**Files:**
- Create: `src/components/ui/ConfidenceWordPopover.tsx`
- Create: `src/lib/wordAudio.ts`
- Test: `test/lib/wordAudio.test.js`, `test/components/confidenceWordPopover.test.js`

**Interfaces:**
- Consumes:
  - `Popover`, `PopoverTrigger`, `PopoverContent` from `src/components/ui/popover.tsx`;
  - `useSettingsStore((s) => s.updateCustomDictionary)` (`settingsStore.ts:1914`, `({ add, remove }) => void`);
  - `window.electronAPI.getAudioBuffer(id)` (preload, `get-audio-buffer`).
- Produces:
  - `src/lib/wordAudio.ts`:
    - `audioWindow(startSeconds: number, durationSeconds: number | null): { offset: number; length: number }`. It returns 2 s starting 0.5 s before the word, clamped to the recording.
    - `playWordAudio(transcriptionId: number, startSeconds: number, durationMs: number | null): Promise<boolean>`
  - `ConfidenceWordPopover(props: { transcriptionId: number; word: TranscriptionConfidenceWord; bucket: "maybe" | "unsure"; label: string; text: string; canPlay: boolean; durationMs: number | null; onAdded?: (word: string) => void }): JSX.Element`
- Keys on a focused uncertain word: `A` adds the word to the dictionary, `P` plays 2 s (only when `canPlay`), `Escape` closes. Hover opens after the pointer enters and closes 220 ms after it leaves both the word and the popover. Focus opens.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/wordAudio.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/wordAudio.ts");

test("the window starts half a second early and lasts two seconds", async () => {
  const { audioWindow } = await load();
  assert.deepEqual(audioWindow(3, 10), { offset: 2.5, length: 2 });
});

test("the window is clamped to the start and end of the recording", async () => {
  const { audioWindow } = await load();
  assert.deepEqual(audioWindow(0.2, 10), { offset: 0, length: 2 });
  assert.deepEqual(audioWindow(9.8, 10), { offset: 8, length: 2 });
  assert.deepEqual(audioWindow(0.5, 1.2), { offset: 0, length: 1.2 });
  assert.deepEqual(audioWindow(4, null), { offset: 3.5, length: 2 }, "unknown duration keeps 2 s");
  assert.deepEqual(audioWindow(Number.NaN, 10), { offset: 0, length: 2 });
});
```

Create `test/components/confidenceWordPopover.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function render(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-confidence-popover-test-",
    mockModules: {
      // Suffix match on the import source: ConfidenceWordPopover imports "./popover".
      "/popover": `
        import { createElement } from "react";
        const pass = (props) => createElement("div", { "data-part": props["data-part"] }, props.children);
        export const Popover = (props) => createElement("div", { "data-open": String(!!props.open) }, props.children);
        export const PopoverTrigger = (props) => props.children;
        export const PopoverContent = pass;
      `,
      "/stores/settingsStore": `export const useSettingsStore = (sel) => sel({ updateCustomDictionary() {} });`,
    },
  });
  const mod = await vite.ssrLoadModule("/components/ui/ConfidenceWordPopover.tsx");
  return renderToStaticMarkup(createElement(mod.ConfidenceWordPopover, props));
}

const BASE = {
  transcriptionId: 7,
  word: { s: 0, e: 5, p: 0.58, t: 1.2 },
  bucket: "unsure",
  label: "Maria, 58 percent",
  text: "Maria",
  durationMs: 9000,
};

test("the trigger is the word itself, labelled and keyboard reachable", async (t) => {
  const html = await render(t, { ...BASE, canPlay: true });
  assert.match(html, /class="confidence-word"[^>]*data-confidence="unsure"[^>]*role="button"[^>]*tabindex="0"[^>]*aria-label="Maria, 58 percent"[^>]*>Maria</);
  assert.match(html, /aria-haspopup="dialog"/);
});

test("the popover offers Add to Words always and Play only with retained audio", async (t) => {
  const withAudio = await render(t, { ...BASE, canPlay: true });
  assert.match(withAudio, /history\.confidence\.addToWords/);
  assert.match(withAudio, /history\.confidence\.play/);
  assert.match(withAudio, /history\.confidence\.percent/);
  assert.doesNotMatch(withAudio, /alternatives/i, "CCR-4: no n-best list");
  const noAudio = await render(t, { ...BASE, canPlay: false });
  assert.doesNotMatch(noAudio, /history\.confidence\.play/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/lib/wordAudio.test.js test/components/confidenceWordPopover.test.js`
Expected: FAIL. The modules are not found.

- [ ] **Step 3: Implement**

Create `src/lib/wordAudio.ts`:

```ts
const LEAD_SECONDS = 0.5;
const WINDOW_SECONDS = 2;

export function audioWindow(
  startSeconds: number,
  durationSeconds: number | null
): { offset: number; length: number } {
  const start = Number.isFinite(startSeconds) ? Math.max(0, startSeconds) : 0;
  const total = durationSeconds != null && Number.isFinite(durationSeconds) ? durationSeconds : null;
  const length = total != null ? Math.min(WINDOW_SECONDS, total) : WINDOW_SECONDS;
  let offset = Math.max(0, start - LEAD_SECONDS);
  if (total != null) offset = Math.min(offset, Math.max(0, total - length));
  return { offset: Math.round(offset * 1000) / 1000, length: Math.round(length * 1000) / 1000 };
}

// Plays two seconds of the retained recording around a word. Returns false when
// there is no audio (retention off, file purged) so callers can say so.
export async function playWordAudio(
  transcriptionId: number,
  startSeconds: number,
  durationMs: number | null
): Promise<boolean> {
  const buffer = await window.electronAPI?.getAudioBuffer?.(transcriptionId);
  if (!buffer) return false;
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(buffer);
    const { offset, length } = audioWindow(startSeconds, durationMs != null ? durationMs / 1000 : decoded.duration);
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    source.onended = () => void context.close();
    source.start(0, offset, length);
    return true;
  } catch {
    void context.close();
    return false;
  }
}
```

`getAudioBuffer` is typed `(id: number) => Promise<ArrayBuffer | null>` (`src/types/electron.ts:855`).

Create `src/components/ui/ConfidenceWordPopover.tsx`:

```tsx
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TranscriptionConfidenceWord } from "../../types/electron";
import { confidencePercent } from "../../lib/wordConfidence";
import { playWordAudio } from "../../lib/wordAudio";
import { useSettingsStore } from "../../stores/settingsStore";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const CLOSE_DELAY_MS = 220;

export interface ConfidenceWordPopoverProps {
  transcriptionId: number;
  word: TranscriptionConfidenceWord;
  bucket: "maybe" | "unsure";
  label: string;
  text: string;
  canPlay: boolean;
  durationMs: number | null;
  onAdded?: (word: string) => void;
}

// CCR-4: no engine supplies per-word alternatives, so the popover offers what
// is real: the score, Add to Words and a 2 s replay.
export function ConfidenceWordPopover({
  transcriptionId,
  word,
  bucket,
  label,
  text,
  canPlay,
  durationMs,
  onAdded,
}: ConfidenceWordPopoverProps) {
  const { t } = useTranslation();
  const updateCustomDictionary = useSettingsStore((s) => s.updateCustomDictionary);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bare = text.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
  const playable = canPlay && word.t !== undefined;

  const keepOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  const addToWords = () => {
    if (!bare) return;
    updateCustomDictionary({ add: [bare] });
    onAdded?.(bare);
    setOpen(false);
  };
  const play = async () => {
    if (!playable || playing) return;
    setPlaying(true);
    await playWordAudio(transcriptionId, word.t as number, durationMs);
    setTimeout(() => setPlaying(false), 2000);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          className="confidence-word"
          data-confidence={bucket}
          role="button"
          tabIndex={0}
          aria-label={label}
          aria-haspopup="dialog"
          onMouseEnter={keepOpen}
          onMouseLeave={closeSoon}
          onFocus={keepOpen}
          onKeyDown={(event) => {
            const key = event.key.toLowerCase();
            if (key === "a") {
              event.preventDefault();
              addToWords();
            } else if (key === "p" && playable) {
              event.preventDefault();
              void play();
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        >
          {text}
        </span>
      </PopoverTrigger>
      <PopoverContent
        data-part="confidence-popover"
        className="w-56 p-2 text-xs"
        onMouseEnter={keepOpen}
        onMouseLeave={closeSoon}
        onOpenAutoFocus={(event: Event) => event.preventDefault()}
      >
        <p className="px-2 pb-1 font-medium text-muted-foreground">
          {t("history.confidence.percent", { percent: confidencePercent(word.p) })}
        </p>
        <button
          type="button"
          className="flex h-7 w-full items-center justify-between rounded-md px-2 text-start hover:bg-foreground/6"
          onClick={addToWords}
        >
          <span>{t("history.confidence.addToWords")}</span>
          <kbd className="text-muted-foreground">A</kbd>
        </button>
        {playable && (
          <button
            type="button"
            className="flex h-7 w-full items-center justify-between rounded-md px-2 text-start hover:bg-foreground/6"
            onClick={() => void play()}
            aria-busy={playing}
          >
            <span>{t(playing ? "history.confidence.playing" : "history.confidence.play")}</span>
            <kbd className="text-muted-foreground">P</kbd>
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

`PopoverContent` spreads its remaining props onto Radix `Content` (`src/components/ui/popover.tsx:23`), so `onOpenAutoFocus`, `onMouseEnter` and `onMouseLeave` pass through.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/lib/wordAudio.test.js test/components/confidenceWordPopover.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wordAudio.ts src/components/ui/ConfidenceWordPopover.tsx test/lib/wordAudio.test.js test/components/confidenceWordPopover.test.js
git commit -m "feat(ui): confidence word popover with Add to Words and 2 s replay"
```

---

### Task 10: History integration, preview stub, and docs

**Files:**
- Create: `src/hooks/useTranscriptionConfidence.ts`
- Modify: `src/components/ui/TranscriptionItem.tsx`:
  - imports (`:1-28`);
  - menu actions (`:115-146`);
  - text paragraph (`:279-285`);
  - raw-transcript paragraph (`:314-316`).
- Modify: `src/components/HistoryView.tsx` (the ⌥C listener)
- Modify: `src/preview/browserPreview.ts:177` (a `getTranscriptionConfidence` stub)
- Modify: `src/locales/*/translation.json` (`history.confidence.*`)
- Modify: `DESIGN.md` (a "Confidence typography (Labs)" subsection), `docs/PRIVACY.md` (local storage of word scores)
- Test: `test/components/transcriptionItemConfidence.test.js`

**Interfaces:**
- Consumes:
  - `ConfidenceText` (Task 8) and `ConfidenceWordPopover` (Task 9);
  - `window.electronAPI.getTranscriptionConfidence` and `item.has_confidence` (Task 6);
  - the settings `labsConfidenceTypography`, `historyShowConfidence` and `setHistoryShowConfidence` (Task 2).
- Produces `useTranscriptionConfidence(id: number, rawText: string | null, enabled: boolean): TranscriptionConfidence | null`. It uses a module-level cache keyed by `${id}:${rawText}`, so a changed raw text refetches.
- Behaviour:
  - **List row.** It shows `ConfidenceText` only when all of these hold: Labs is on, `historyShowConfidence` is on, the row has confidence, and `item.text === item.raw_text`. If cleanup changed the text, the words belong to the raw text, so the cleaned row stays plain.
  - **Expanded raw transcript.** It always shows `ConfidenceText` with `show` true when Labs is on and data exists (spec: "default on in the expanded raw view").
  - **Kebab item.** "Show confidence" or "Hide confidence" toggles `historyShowConfidence`, only on rows that have data.
  - **⌥C.** In History it toggles the same setting while Labs is on.

- [ ] **Step 1: Write the failing test**

Create `test/components/transcriptionItemConfidence.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const repoRoot = path.join(__dirname, "../..");
const CONF = { v: 1, engine: "whisper.cpp", words: [{ s: 0, e: 5, p: 0.58 }] };

async function renderRow(t, { settings, item }) {
  installBrowserGlobals(t);
  globalThis.__rowSettings = settings;
  t.after(() => delete globalThis.__rowSettings);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-row-confidence-test-",
    mockModules: {
      "/stores/settingsStore": `export const useSettingsStore = (sel) => sel(globalThis.__rowSettings);`,
      "/hooks/useTranscriptionConfidence": `export const useTranscriptionConfidence = (_id, _raw, enabled) => (enabled ? ${JSON.stringify(CONF)} : null);`,
      // Mock keys match the end of the import source ("./dropdown-menu", "./popover").
      "/dropdown-menu": `
        import { createElement } from "react";
        const pass = (p) => createElement("div", null, p.children);
        export const DropdownMenu = pass; export const DropdownMenuTrigger = pass;
        export const DropdownMenuContent = pass; export const DropdownMenuItem = pass;
      `,
      "/utils/platform": `export const getCachedPlatform = () => "darwin";`,
      "/popover": `
        export const Popover = (p) => p.children; export const PopoverTrigger = (p) => p.children;
        export const PopoverContent = () => null;
      `,
    },
  });
  const mod = await vite.ssrLoadModule("/components/ui/TranscriptionItem.tsx");
  return renderToStaticMarkup(
    createElement(mod.default, {
      item,
      onCopy() {},
      onDelete() {},
      onShowAudioInFolder() {},
      onRetryTranscription: async () => {},
    })
  );
}

const ITEM = {
  id: 1, text: "Maria wants it.", raw_text: "Maria wants it.", timestamp: "2026-10-14 10:00:00", created_at: "2026-10-14 10:00:00",
  has_audio: 0, audio_duration_ms: null, provider: null, model: null, status: "completed", error_message: null,
  error_code: null, route_kind: null, client_transcription_id: "c1", cloud_id: null, sync_status: "synced", deleted_at: null,
  has_confidence: 1,
};
const ON = { labsConfidenceTypography: true, historyShowConfidence: true, setHistoryShowConfidence() {}, updateCustomDictionary() {} };

test("with Labs on and the toggle on, the row draws confidence", async (t) => {
  const html = await renderRow(t, { settings: ON, item: ITEM });
  assert.match(html, /class="confidence-text[^"]*"[^>]*data-show="true"/);
  assert.match(html, /history\.confidence\.hide/);
});

test("with Labs off, the row is exactly today's plain paragraph and has no confidence menu item", async (t) => {
  const html = await renderRow(t, { settings: { ...ON, labsConfidenceTypography: false }, item: ITEM });
  assert.doesNotMatch(html, /confidence-/);
  assert.doesNotMatch(html, /history\.confidence\./);
});

test("cleaned text that differs from the raw text stays plain in the list", async (t) => {
  const html = await renderRow(t, { settings: ON, item: { ...ITEM, text: "MARIA WANTS IT!" } });
  const list = html.slice(0, html.indexOf("controlPanel.history.rawTranscript"));
  assert.doesNotMatch(list, /confidence-text/);
  assert.match(html.slice(html.indexOf("controlPanel.history.rawTranscript")), /confidence-text[^"]*"[^>]*data-show="true"/);
});

test("rows from engines without data never show the toggle", async (t) => {
  const html = await renderRow(t, { settings: ON, item: { ...ITEM, has_confidence: 0 } });
  assert.doesNotMatch(html, /history\.confidence\./);
});

test("every locale carries the confidence strings with their placeholders", () => {
  const dir = path.join(repoRoot, "src/locales");
  for (const lang of fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "translation.json")))) {
    const c = JSON.parse(fs.readFileSync(path.join(dir, lang, "translation.json"), "utf8")).history?.confidence;
    assert.ok(c, `${lang} history.confidence`);
    for (const k of ["show", "hide", "addToWords", "play", "playing"]) assert.ok(c[k], `${lang}.${k}`);
    assert.match(c.wordLabel, /\{\{word\}\}/);
    assert.match(c.wordLabel, /\{\{percent\}\}/);
    assert.match(c.percent, /\{\{percent\}\}/);
  }
});
```

The props match `TranscriptionItemProps` (`TranscriptionItem.tsx:49-56`). If Plan 06 changed them, pass its required props instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/transcriptionItemConfidence.test.js`
Expected: FAIL. No `confidence-text` appears, and `en history.confidence` is missing.

- [ ] **Step 3: Implement**

1. Create `src/hooks/useTranscriptionConfidence.ts`:

   ```ts
   import { useEffect, useState } from "react";
   import type { TranscriptionConfidence } from "../types/electron";

   // Keyed by id and raw text: a retry or edit changes raw_text, and main drops
   // the stale words, so the old cache entry must not be reused.
   const cache = new Map<string, TranscriptionConfidence | null>();

   export function useTranscriptionConfidence(
     id: number,
     rawText: string | null,
     enabled: boolean
   ): TranscriptionConfidence | null {
     const key = `${id}:${rawText ?? ""}`;
     const [value, setValue] = useState<TranscriptionConfidence | null>(() => cache.get(key) ?? null);

     useEffect(() => {
       if (!enabled) return;
       if (cache.has(key)) {
         setValue(cache.get(key) ?? null);
         return;
       }
       let stale = false;
       window.electronAPI
         ?.getTranscriptionConfidence?.(id)
         .then((result) => {
           cache.set(key, result ?? null);
           if (!stale) setValue(result ?? null);
         })
         .catch(() => {
           if (!stale) setValue(null);
         });
       return () => {
         stale = true;
       };
     }, [enabled, id, key]);

     return enabled ? value : null;
   }
   ```

2. `src/components/ui/TranscriptionItem.tsx`:
   - Imports. Add:

     ```tsx
     import { ConfidenceText } from "./ConfidenceText";
     import { ConfidenceWordPopover } from "./ConfidenceWordPopover";
     import { useSettingsStore } from "../../stores/settingsStore";
     import { useTranscriptionConfidence } from "../../hooks/useTranscriptionConfidence";
     ```

     Also add `Gauge` to the `../icons` import list (exported at `src/components/icons/index.ts:45`).

   - After `const hasAudio = item.has_audio === 1;` (`:97`), add:

     ```tsx
       const labsConfidence = useSettingsStore((s) => s.labsConfidenceTypography);
       const showConfidence = useSettingsStore((s) => s.historyShowConfidence);
       const setShowConfidence = useSettingsStore((s) => s.setHistoryShowConfidence);
       const hasConfidence = labsConfidence && isTranscribed && item.has_confidence === 1;
       const confidence = useTranscriptionConfidence(item.id, rawText, hasConfidence);
       const confidenceInList = hasConfidence && showConfidence && rawText === item.text;
       const renderConfidenceWord = ({ word, bucket, label, children }: {
         word: { s: number; e: number; p: number; t?: number };
         bucket: "maybe" | "unsure";
         label: string;
         children: string;
       }) => (
         <ConfidenceWordPopover
           transcriptionId={item.id}
           word={word}
           bucket={bucket}
           label={label}
           text={children}
           canPlay={hasAudio}
           durationMs={item.audio_duration_ms}
         />
       );
     ```

   - In `candidateActions`, insert after the `raw` entry:

     ```tsx
         hasConfidence && {
           key: "confidence",
           icon: Gauge,
           label: t(showConfidence ? "history.confidence.hide" : "history.confidence.show"),
           onSelect: () => setShowConfidence(!showConfidence),
         },
     ```

   - Replace the text paragraph at `:279-285` with the block below. After Plan 06, use the paragraph's then-current `className` (`text-body line-clamp-4 …`) in both branches, and pass its `onClick={copyUnlessSelecting}` to both: `ConfidenceText` forwards `onClick` to its `<p>`.

     ```tsx
             ) : confidenceInList ? (
               <ConfidenceText
                 text={item.text}
                 confidence={confidence}
                 show
                 className="text-base leading-normal wrap-break-word whitespace-pre-wrap text-foreground"
                 renderWord={renderConfidenceWord}
               />
             ) : (
               <p
                 dir="auto"
                 className="text-base leading-normal wrap-break-word whitespace-pre-wrap text-foreground"
               >
                 {item.text}
               </p>
             )}
     ```

   - Replace the raw paragraph at `:314-316` with:

     ```tsx
                   {hasConfidence ? (
                     <ConfidenceText
                       text={rawText}
                       confidence={confidence}
                       show
                       className="mt-1 text-xs leading-relaxed text-muted-foreground/80"
                       renderWord={renderConfidenceWord}
                     />
                   ) : (
                     <p dir="auto" className="mt-1 text-xs leading-relaxed text-muted-foreground/80">
                       {rawText}
                     </p>
                   )}
     ```

3. `src/components/HistoryView.tsx`. Next to its other hooks, add a ⌥C listener:

   ```tsx
     const labsConfidence = useSettingsStore((s) => s.labsConfidenceTypography);
     const toggleShowConfidence = useSettingsStore((s) => s.setHistoryShowConfidence);
     const showConfidence = useSettingsStore((s) => s.historyShowConfidence);
     useEffect(() => {
       if (!labsConfidence) return;
       const onKeyDown = (event: KeyboardEvent) => {
         // ⌥C / Alt+C (spec WS-M4). event.code survives the macOS dead-key "ç".
         if (event.altKey && !event.metaKey && !event.ctrlKey && event.code === "KeyC") {
           const target = event.target as HTMLElement | null;
           if (target?.closest("input, textarea, [contenteditable='true']")) return;
           event.preventDefault();
           toggleShowConfidence(!showConfidence);
         }
       };
       window.addEventListener("keydown", onKeyDown);
       return () => window.removeEventListener("keydown", onKeyDown);
     }, [labsConfidence, showConfidence, toggleShowConfidence]);
   ```

   Import `useEffect` from React and `useSettingsStore` from `../stores/settingsStore` if `HistoryView` does not already. Draft Plan 06 adds `HistoryMenu({ showDiscarded, onToggleDiscarded, onClearAll, hasHistory })` in `src/components/home/HistoryMenu.tsx`. If it merged, give it two optional props, `showConfidence?: boolean` and `onToggleConfidence?: () => void`. When `onToggleConfidence` is set, render a `DropdownMenuCheckboxItem` labelled `t("history.confidence.show")` with `checked={showConfidence}` after "Show discarded". `HistoryView` passes them only while `labsConfidence` is on. This matches the spec's "Toggle Show confidence in History menu (⌥C)".

4. `src/preview/browserPreview.ts`. After `getTranscriptions: async () => [...history],` (`:177`), add:

   ```ts
       getTranscriptionConfidence: async () => null,
   ```

5. Locales. Add `history.confidence` to every locale:

   ```bash
   node -e '
   const fs=require("fs"),p=require("path");
   const L={
    en:["Show confidence","Hide confidence","{{word}}, {{percent}} percent confidence","{{percent}}% sure","Add to Words","Play 2 s","Playing…"],
    de:["Sicherheit zeigen","Sicherheit ausblenden","{{word}}, {{percent}} Prozent Sicherheit","{{percent}} % sicher","Zu Wörtern hinzufügen","2 s abspielen","Wird abgespielt…"],
    es:["Mostrar confianza","Ocultar confianza","{{word}}, {{percent}} por ciento de confianza","{{percent}} % de seguridad","Añadir a Palabras","Reproducir 2 s","Reproduciendo…"],
    fr:["Afficher la confiance","Masquer la confiance","{{word}}, confiance de {{percent}} pour cent","Sûr à {{percent}} %","Ajouter aux mots","Écouter 2 s","Lecture…"],
    it:["Mostra affidabilità","Nascondi affidabilità","{{word}}, affidabilità {{percent}} per cento","Sicuro al {{percent}}%","Aggiungi alle parole","Riproduci 2 s","Riproduzione…"],
    pt:["Mostrar confiança","Ocultar confiança","{{word}}, {{percent}} por cento de confiança","{{percent}}% de certeza","Adicionar às Palavras","Reproduzir 2 s","Reproduzindo…"],
    ru:["Показать уверенность","Скрыть уверенность","{{word}}, уверенность {{percent}} процентов","Уверенность {{percent}}%","Добавить в слова","Воспроизвести 2 с","Воспроизведение…"],
    ja:["確信度を表示","確信度を隠す","{{word}}、確信度 {{percent}} パーセント","確信度 {{percent}}%","単語に追加","2 秒再生","再生中…"],
    "zh-CN":["显示置信度","隐藏置信度","{{word}}，置信度 {{percent}}%","{{percent}}% 确定","添加到词汇","播放 2 秒","正在播放…"],
    "zh-TW":["顯示信心度","隱藏信心度","{{word}}，信心度 {{percent}}%","{{percent}}% 確定","加入詞彙","播放 2 秒","播放中…"],
    ar:["إظهار الثقة","إخفاء الثقة","{{word}}، ثقة {{percent}} بالمئة","متأكد بنسبة {{percent}}٪","إضافة إلى الكلمات","تشغيل ثانيتين","جارٍ التشغيل…"]};
   for(const [l,[show,hide,wordLabel,percent,addToWords,play,playing]] of Object.entries(L)){const f=p.join("src/locales",l,"translation.json");const j=JSON.parse(fs.readFileSync(f,"utf8"));j.history=j.history||{};j.history.confidence={show,hide,wordLabel,percent,addToWords,play,playing};fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");}'
   npx prettier --check "src/locales/**/translation.json" || npx prettier --write "src/locales/**/translation.json"
   ```

   The English "Add to Words" matches the Dictionary view's name for the custom dictionary. If the `en` locale's sidebar label for the dictionary is not "Words" (`grep -n '"dictionary"' src/locales/en/translation.json`), use that label instead in every language.

6. In `DESIGN.md`, add the following under `## Motion`, or near the typography section if one exists:

   ```markdown
   ### Confidence typography (Labs, WS-M4)

   Recognition certainty is drawn in the type. Inter Variable's `wght` axis: p ≥ 0.90 → 420, 0.70–0.90 → 400 + dotted underline `--color-confidence-maybe`, < 0.70 → 380 + dotted underline `--color-confidence-low` (fuchsia = machine uncertainty). Weight never stands alone: the underline always comes with it. Transitions use `--motion-fast`; reduced motion is instant. Words with no engine data render at 420 with no underline. Only local whisper.cpp and Parakeet supply data; everything else shows plain text and no toggle.
   ```

7. In `docs/PRIVACY.md`, add one sentence to the local-storage section: "With Labs → Confidence in transcripts on, local Whisper and Parakeet word scores are stored beside each transcript in the local database, and are deleted with it."

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/transcriptionItemConfidence.test.js test/components/confidenceText.test.js && npm run i18n:check && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTranscriptionConfidence.ts src/components/ui/TranscriptionItem.tsx src/components/HistoryView.tsx src/preview/browserPreview.ts src/locales DESIGN.md docs/PRIVACY.md test/components/transcriptionItemConfidence.test.js
git commit -m "feat(history): Labs confidence typography in history rows and raw view"
```

---

## Part B — WS-M5: The Table

### Task 11: Table storage and IPC

**Files:**
- Create: `src/types/table.ts`
- Modify: `src/helpers/localDatabaseSchema.js` (append three tables after the Task 6 block, before the closing backtick)
- Modify: `src/helpers/database.js` (constants after `:26`; a new "The Table" method group after `getPrivateSpaceId`, `:1386-1395`)
- Modify: `src/helpers/ipcHandlers.js` (register five `db-*` handlers after `db-get-spaces` at `:1780`)
- Modify: `preload.js` (after `getSpaces`/`updateSpace` at `:264-265`)
- Modify: `src/types/electron.ts` (import the table types at the top; add the methods after `getSpaces?:` at `:1006`)
- Test: `test/helpers/tableLayoutDatabase.test.js`

**Interfaces:**
- Produces `src/types/table.ts`:

  ```ts
  export type TableEntityType = "note" | "dictation" | "chat";
  export type TableCardKind = "note" | "meeting" | "dictation" | "chat";
  export interface TableEntityRef { type: TableEntityType; id: number }
  export interface TableLayout { x: number; y: number; w: number | null; h: number | null; z: number; hidden: boolean }
  export interface TableEntity {
    ref: TableEntityRef;
    kind: TableCardKind;
    title: string | null;
    excerpt: string;           // raw markdown/plain text, ≤ 600 chars
    at: string;                // updated_at / timestamp, DB format
    durationMs: number | null;
    participants: string[];    // display names, ≤ 6
    hrefs: string[];           // non-web, non-person link targets found in the note body, ≤ 50
    noteId: number | null;     // chat: the note the conversation is about
    layout: TableLayout | null;
  }
  export interface TableLink { a: TableEntityRef; b: TableEntityRef }
  export interface TableViewport { x: number; y: number; scale: number }
  export interface TableBoardData {
    spaceId: number;
    cards: TableEntity[];      // placed and visible first, then unplaced space notes; ≤ 500
    inbox: TableEntity[];      // hidden notes, unplaced dictations (7 days, ≤ 20), unplaced answered chats (≤ 10)
    links: TableLink[];        // only links whose two ends are in cards ∪ inbox
    viewport: TableViewport | null;
    truncated: boolean;
  }
  export interface TablePlacement extends TableEntityRef { x: number; y: number; w?: number | null; h?: number | null; z?: number }
  ```

- Produces `DatabaseManager` methods:
  - `getTableBoard(spaceId): TableBoardData`. It prunes stale rows first.
  - `placeTableCards(spaceId, placements: TablePlacement[]): { success: true; placed: number } | { success: false; code: "TABLE_FULL" }`
  - `hideTableCards(spaceId, refs: TableEntityRef[]): { success: true; hidden: number }`. A note row becomes `hidden = 1`, and the note is kept. Dictation and chat rows are deleted.
  - `linkTableCards(spaceId, a, b): { success: boolean }`. Links are undirected and deduplicated.
  - `setTableViewport(spaceId, { x, y, scale }): { success: boolean }`. Scale is clamped to [0.25, 2].
- Produces the IPC channels `db-get-table-board`, `db-place-table-cards`, `db-hide-table-cards`, `db-link-table-cards` and `db-set-table-viewport`, and the matching preload methods `getTableBoard`, `placeTableCards`, `hideTableCards`, `linkTableCards` and `setTableViewport`.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/tableLayoutDatabase.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDb } = require("./harness/db");
const DatabaseManager = require("../../src/helpers/database");

function seed(db) {
  const spaceId = db.getPrivateSpaceId();
  const note = db.saveNote("Pricing FAQ", "See [Review](note:999) and [web](https://x.test) and [@Maya](mention:maya%40x.test)", "personal", null, null, null, spaceId).note;
  const meeting = db.saveNote("Pricing review", "Decision: Thursday", "meeting", null, null, null, spaceId).note;
  const dictation = db.saveTranscription("Remind me to send the announcement.", "Remind me to send the announcement.").id;
  const chat = db.createAgentConversation("Pricing", note.id, spaceId, null);
  db.addAgentMessage(chat.id, "user", "When does it ship?");
  db.addAgentMessage(chat.id, "assistant", "Thursday, not Monday.");
  return { spaceId, note, meeting, dictation, chatId: chat.id };
}
const keys = (list) => list.map((e) => `${e.ref.type}:${e.ref.id}`).sort();

test("a fresh board shows the space's notes unplaced and recent captures in the inbox", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, meeting, dictation, chatId } = seed(db);
  const board = db.getTableBoard(spaceId);
  assert.deepEqual(keys(board.cards), [`note:${meeting.id}`, `note:${note.id}`].sort());
  assert.ok(board.cards.every((c) => c.layout === null));
  assert.equal(board.cards.find((c) => c.ref.id === meeting.id).kind, "meeting");
  assert.deepEqual(keys(board.inbox), [`chat:${chatId}`, `dictation:${dictation}`].sort());
  assert.equal(board.inbox.find((e) => e.ref.type === "chat").excerpt, "Thursday, not Monday.");
  assert.equal(board.inbox.find((e) => e.ref.type === "chat").noteId, note.id);
  assert.deepEqual(board.cards.find((c) => c.ref.id === note.id).hrefs, ["note:999"], "web and person links are not entity links");
  assert.equal(board.viewport, null);
  assert.equal(board.truncated, false);
});

test("placements persist across a reopen and only real entities can be placed", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, dictation } = seed(db);
  const res = db.placeTableCards(spaceId, [
    { type: "note", id: note.id, x: 232, y: 32 },
    { type: "dictation", id: dictation, x: 248, y: 240, w: 220 },
    { type: "note", id: 424242, x: 0, y: 0 },
    { type: "note", id: note.id + 0.5, x: 0, y: 0 },
    { type: "bogus", id: 1, x: 0, y: 0 },
    { type: "dictation", id: dictation, x: Number.NaN, y: 0 },
  ]);
  assert.deepEqual(res, { success: true, placed: 2 });
  db.setTableViewport(spaceId, { x: -40, y: 12, scale: 9 });
  db.db.close();
  const reopened = new DatabaseManager();
  t.after(() => reopened.db.close());
  const board = reopened.getTableBoard(spaceId);
  assert.deepEqual(board.cards.find((c) => c.ref.type === "note" && c.ref.id === note.id).layout, { x: 232, y: 32, w: null, h: null, z: 0, hidden: false });
  assert.equal(board.cards.find((c) => c.ref.type === "dictation").layout.w, 220);
  assert.ok(!board.inbox.some((e) => e.ref.type === "dictation"), "placed dictations leave the inbox");
  assert.deepEqual(board.viewport, { x: -40, y: 12, scale: 2 }, "scale is clamped");
});

test("removing a note hides it and keeps the note; placing it again brings it back", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, dictation } = seed(db);
  db.placeTableCards(spaceId, [{ type: "note", id: note.id, x: 40, y: 40 }, { type: "dictation", id: dictation, x: 0, y: 0 }]);
  db.hideTableCards(spaceId, [{ type: "note", id: note.id }, { type: "dictation", id: dictation }]);
  let board = db.getTableBoard(spaceId);
  assert.ok(db.getNote(note.id), "the note itself is untouched");
  assert.ok(board.inbox.some((e) => e.ref.type === "note" && e.ref.id === note.id));
  assert.ok(!board.cards.some((c) => c.ref.type === "note" && c.ref.id === note.id));
  assert.ok(board.inbox.some((e) => e.ref.type === "dictation"), "a removed dictation goes back to the inbox");
  db.placeTableCards(spaceId, [{ type: "note", id: note.id, x: 80, y: 80 }]);
  board = db.getTableBoard(spaceId);
  assert.equal(board.cards.find((c) => c.ref.type === "note" && c.ref.id === note.id).layout.hidden, false);
});

test("deleted entities are pruned and their links disappear", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, meeting, dictation } = seed(db);
  db.placeTableCards(spaceId, [{ type: "note", id: note.id, x: 0, y: 0 }, { type: "dictation", id: dictation, x: 0, y: 200 }]);
  db.linkTableCards(spaceId, { type: "note", id: note.id }, { type: "dictation", id: dictation });
  db.linkTableCards(spaceId, { type: "note", id: meeting.id }, { type: "note", id: note.id });
  assert.equal(db.getTableBoard(spaceId).links.length, 2);
  db.deleteTranscription(dictation);
  db.deleteNote(meeting.id);
  const board = db.getTableBoard(spaceId);
  assert.deepEqual(board.links, []);
  const rows = db.db.prepare("SELECT entity_type, entity_id FROM note_layout").all();
  assert.deepEqual(rows, [{ entity_type: "note", entity_id: note.id }]);
});

test("links are undirected, deduplicated, and never self-referential", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, meeting } = seed(db);
  const a = { type: "note", id: note.id };
  const b = { type: "note", id: meeting.id };
  assert.equal(db.linkTableCards(spaceId, a, b).success, true);
  db.linkTableCards(spaceId, b, a);
  assert.equal(db.linkTableCards(spaceId, a, a).success, false);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM note_layout_links").get().n, 1);
});

test("the table refuses a 501st placed card and keeps the first 500", (t) => {
  const db = createDb(t);
  if (!db) return;
  const spaceId = db.getPrivateSpaceId();
  const ids = Array.from({ length: 501 }, (_, i) => db.saveTranscription(`d${i}`, `d${i}`).id);
  const first = db.placeTableCards(spaceId, ids.slice(0, 500).map((id, i) => ({ type: "dictation", id, x: i * 8, y: 0 })));
  assert.deepEqual(first, { success: true, placed: 500 });
  assert.deepEqual(db.placeTableCards(spaceId, [{ type: "dictation", id: ids[500], x: 0, y: 0 }]), { success: false, code: "TABLE_FULL" });
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM note_layout").get().n, 500);
});

test("a profile created before Plan 08 gains the table tables on open", (t) => {
  const db = createDb(t);
  if (!db) return;
  db.db.exec("DROP TABLE note_layout; DROP TABLE note_layout_links; DROP TABLE note_layout_viewport;");
  db.db.close();
  const reopened = new DatabaseManager();
  t.after(() => reopened.db.close());
  const names = reopened.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'note_layout%'").all().map((r) => r.name).sort();
  assert.deepEqual(names, ["note_layout", "note_layout_links", "note_layout_viewport"]);
  assert.ok(reopened.getTableBoard(reopened.getPrivateSpaceId()));
});
```

If `saveNote` with an explicit `spaceId` is not how notes join a Space after Plan 06, use the space-assignment call Plan 06 documents. The board query keys on `notes.space_id`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/helpers/tableLayoutDatabase.test.js`
Expected: FAIL with `db.getTableBoard is not a function`.

- [ ] **Step 3: Implement**

1. Create `src/types/table.ts` with the block from **Interfaces**.

2. `src/helpers/localDatabaseSchema.js`. Append before the closing backtick:

   ```sql
   -- The Table (Plan 08, WS-M5, Labs): per-space card positions. Rows are
   -- polymorphic (note | dictation | chat), so there is no FK; reads prune rows
   -- whose entity is gone. hidden = 1 keeps a removed note off the table
   -- without touching the note.
   CREATE TABLE IF NOT EXISTS note_layout (
     space_id INTEGER NOT NULL,
     entity_type TEXT NOT NULL CHECK (entity_type IN ('note', 'dictation', 'chat')),
     entity_id INTEGER NOT NULL,
     x REAL NOT NULL,
     y REAL NOT NULL,
     w REAL,
     h REAL,
     z INTEGER NOT NULL DEFAULT 0,
     hidden INTEGER NOT NULL DEFAULT 0,
     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (space_id, entity_type, entity_id)
   );
   CREATE TABLE IF NOT EXISTS note_layout_links (
     space_id INTEGER NOT NULL,
     a_type TEXT NOT NULL,
     a_id INTEGER NOT NULL,
     b_type TEXT NOT NULL,
     b_id INTEGER NOT NULL,
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (space_id, a_type, a_id, b_type, b_id)
   );
   CREATE TABLE IF NOT EXISTS note_layout_viewport (
     space_id INTEGER PRIMARY KEY,
     x REAL NOT NULL DEFAULT 0,
     y REAL NOT NULL DEFAULT 0,
     scale REAL NOT NULL DEFAULT 1,
     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );
   ```

3. `src/helpers/database.js`:
   - Add these module-level constants and helpers after `:26`:

     ```js
     // The Table (Plan 08, WS-M5).
     const TABLE_ENTITY_TYPES = new Set(["note", "dictation", "chat"]);
     const TABLE_CARD_CAP = 500;
     const TABLE_EXCERPT_CHARS = 600;
     const TABLE_INBOX_DICTATIONS = 20;
     const TABLE_INBOX_CHATS = 10;
     const TABLE_COORD_LIMIT = 1e6;
     const MARKDOWN_HREF = /\]\(([^)\s]+)\)/g;
     const NON_ENTITY_HREF = /^(https?:|mailto:|mention:)/i;

     const tableKey = (type, id) => `${type}:${id}`;
     const clampCoord = (n) => Math.max(-TABLE_COORD_LIMIT, Math.min(TABLE_COORD_LIMIT, n));
     const finiteOrNull = (n) => (Number.isFinite(n) && n > 0 ? Math.min(n, 4000) : null);
     const isTableRef = (ref) => !!ref && TABLE_ENTITY_TYPES.has(ref.type) && Number.isInteger(ref.id);

     function extractEntityHrefs(markdown) {
       const hrefs = new Set();
       for (const match of String(markdown || "").matchAll(MARKDOWN_HREF)) {
         if (!NON_ENTITY_HREF.test(match[1])) hrefs.add(match[1]);
         if (hrefs.size >= 50) break;
       }
       return [...hrefs];
     }

     function parseParticipantNames(raw) {
       try {
         const list = JSON.parse(raw || "[]");
         if (!Array.isArray(list)) return [];
         return list
           .map((p) => (typeof p === "string" ? p : p?.name || p?.displayName || p?.email || ""))
           .filter(Boolean)
           .slice(0, 6);
       } catch {
         return [];
       }
     }
     ```

   - Add this method group after `getPrivateSpaceId` (`:1386-1395`):

     ```js
       // ---- The Table (Plan 08, WS-M5, Labs) -------------------------------

       _pruneTableLayout(spaceId) {
         this.db
           .prepare(
             `DELETE FROM note_layout WHERE space_id = ? AND (
                (entity_type = 'note' AND NOT EXISTS (SELECT 1 FROM notes n
                   WHERE n.id = note_layout.entity_id AND n.space_id = note_layout.space_id AND n.deleted_at IS NULL))
             OR (entity_type = 'dictation' AND NOT EXISTS (SELECT 1 FROM transcriptions t
                   WHERE t.id = note_layout.entity_id AND t.deleted_at IS NULL AND t.status = 'completed'))
             OR (entity_type = 'chat' AND NOT EXISTS (SELECT 1 FROM agent_conversations c
                   WHERE c.id = note_layout.entity_id AND c.space_id = note_layout.space_id AND c.deleted_at IS NULL)))`
           )
           .run(spaceId);
       }

       _tableEntityExists(spaceId, type, id) {
         const sql = {
           note: "SELECT 1 FROM notes WHERE id = ? AND space_id = ? AND deleted_at IS NULL",
           dictation: "SELECT 1 FROM transcriptions WHERE id = ? AND deleted_at IS NULL AND status = 'completed'",
           chat: "SELECT 1 FROM agent_conversations WHERE id = ? AND space_id = ? AND deleted_at IS NULL",
         }[type];
         const params = type === "dictation" ? [id] : [id, spaceId];
         return !!this.db.prepare(sql).get(...params);
       }

       getTableBoard(spaceId) {
         if (!this.db) throw new Error("Database not initialized");
         return this.db.transaction(() => {
           this._pruneTableLayout(spaceId);
           const layoutByKey = new Map(
             this.db
               .prepare("SELECT entity_type, entity_id, x, y, w, h, z, hidden FROM note_layout WHERE space_id = ?")
               .all(spaceId)
               .map((row) => [tableKey(row.entity_type, row.entity_id), row])
           );
           const layoutOf = (type, id) => {
             const row = layoutByKey.get(tableKey(type, id));
             return row ? { x: row.x, y: row.y, w: row.w, h: row.h, z: row.z, hidden: row.hidden === 1 } : null;
           };
           const entity = (ref, fields) => ({
             ref,
             title: null,
             durationMs: null,
             participants: [],
             hrefs: [],
             noteId: null,
             ...fields,
             layout: layoutOf(ref.type, ref.id),
           });

           const scope = this._personalScopeCondition("notes");
           const notes = this.db
             .prepare(
               `SELECT id, title, note_type, content, enhanced_content, participants, updated_at, audio_duration_seconds
                FROM notes WHERE space_id = ? AND deleted_at IS NULL AND ${scope.sql}
                ORDER BY updated_at DESC, id DESC LIMIT ?`
             )
             .all(spaceId, ...scope.params, TABLE_CARD_CAP);
           const dictationFields = (row) => ({
             kind: "dictation",
             excerpt: String(row.text || "").slice(0, TABLE_EXCERPT_CHARS),
             at: row.timestamp,
             durationMs: row.audio_duration_ms ?? null,
           });
           const placedDictations = this.db
             .prepare(
               `SELECT t.id, t.text, t.timestamp, t.audio_duration_ms FROM transcriptions t
                JOIN note_layout l ON l.space_id = ? AND l.entity_type = 'dictation' AND l.entity_id = t.id
                WHERE t.deleted_at IS NULL AND t.status = 'completed'`
             )
             .all(spaceId);
           const inboxDictations = this.db
             .prepare(
               `SELECT t.id, t.text, t.timestamp, t.audio_duration_ms FROM transcriptions t
                WHERE t.deleted_at IS NULL AND t.status = 'completed' AND t.text != ''
                  AND t.timestamp >= datetime('now', '-7 days')
                  AND NOT EXISTS (SELECT 1 FROM note_layout l
                    WHERE l.space_id = ? AND l.entity_type = 'dictation' AND l.entity_id = t.id)
                ORDER BY t.timestamp DESC, t.id DESC LIMIT ?`
             )
             .all(spaceId, TABLE_INBOX_DICTATIONS);
           const chats = this.db
             .prepare(
               `SELECT c.id, c.title, c.note_id, c.updated_at,
                  (SELECT substr(m.content, 1, ?) FROM agent_messages m
                    WHERE m.conversation_id = c.id AND m.role = 'assistant'
                    ORDER BY m.id DESC LIMIT 1) AS answer
                FROM agent_conversations c
                WHERE c.space_id = ? AND c.deleted_at IS NULL AND c.archived_at IS NULL
                ORDER BY c.updated_at DESC LIMIT ?`
             )
             .all(TABLE_EXCERPT_CHARS, spaceId, TABLE_CARD_CAP);

           const cards = [];
           const inbox = [];
           for (const n of notes) {
             const body = n.enhanced_content && n.enhanced_content.trim() ? n.enhanced_content : n.content || "";
             const e = entity(
               { type: "note", id: n.id },
               {
                 kind: n.note_type === "meeting" ? "meeting" : "note",
                 title: n.title,
                 excerpt: body.slice(0, TABLE_EXCERPT_CHARS),
                 at: n.updated_at,
                 durationMs: n.audio_duration_seconds != null ? Math.round(n.audio_duration_seconds * 1000) : null,
                 participants: parseParticipantNames(n.participants),
                 hrefs: extractEntityHrefs(body),
               }
             );
             (e.layout?.hidden ? inbox : cards).push(e);
           }
           for (const d of placedDictations) cards.push(entity({ type: "dictation", id: d.id }, dictationFields(d)));
           for (const d of inboxDictations) inbox.push(entity({ type: "dictation", id: d.id }, dictationFields(d)));
           let inboxChats = 0;
           for (const c of chats) {
             const e = entity(
               { type: "chat", id: c.id },
               { kind: "chat", title: c.title, excerpt: c.answer || "", at: c.updated_at, noteId: c.note_id ?? null }
             );
             if (e.layout && !e.layout.hidden) cards.push(e);
             else if (c.answer && inboxChats < TABLE_INBOX_CHATS) {
               inbox.push(e);
               inboxChats += 1;
             }
           }

           // Placed cards first so the cap never drops something the user arranged.
           cards.sort((a, b) => (a.layout ? 0 : 1) - (b.layout ? 0 : 1));
           const shown = cards.slice(0, TABLE_CARD_CAP);
           const present = new Set([...shown, ...inbox].map((e) => tableKey(e.ref.type, e.ref.id)));
           const links = this.db
             .prepare("SELECT a_type, a_id, b_type, b_id FROM note_layout_links WHERE space_id = ?")
             .all(spaceId)
             .map((l) => ({ a: { type: l.a_type, id: l.a_id }, b: { type: l.b_type, id: l.b_id } }))
             .filter((l) => present.has(tableKey(l.a.type, l.a.id)) && present.has(tableKey(l.b.type, l.b.id)));
           const viewport = this.db
             .prepare("SELECT x, y, scale FROM note_layout_viewport WHERE space_id = ?")
             .get(spaceId);

           return {
             spaceId,
             cards: shown,
             inbox,
             links,
             viewport: viewport ? { x: viewport.x, y: viewport.y, scale: viewport.scale } : null,
             truncated: cards.length > TABLE_CARD_CAP,
           };
         })();
       }

       placeTableCards(spaceId, placements) {
         if (!this.db) throw new Error("Database not initialized");
         if (!Array.isArray(placements) || placements.length === 0) return { success: true, placed: 0 };
         const upsert = this.db.prepare(
           `INSERT INTO note_layout (space_id, entity_type, entity_id, x, y, w, h, z, hidden, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
            ON CONFLICT(space_id, entity_type, entity_id) DO UPDATE SET
              x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h, z = excluded.z,
              hidden = 0, updated_at = CURRENT_TIMESTAMP`
         );
         try {
           return this.db.transaction(() => {
             let placed = 0;
             for (const p of placements) {
               if (!isTableRef(p) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
               if (!this._tableEntityExists(spaceId, p.type, p.id)) continue;
               upsert.run(spaceId, p.type, p.id, clampCoord(p.x), clampCoord(p.y), finiteOrNull(p.w), finiteOrNull(p.h), Number.isInteger(p.z) ? p.z : 0);
               placed += 1;
             }
             const visible = this.db
               .prepare("SELECT COUNT(*) AS n FROM note_layout WHERE space_id = ? AND hidden = 0")
               .get(spaceId).n;
             if (visible > TABLE_CARD_CAP) throw Object.assign(new Error("table full"), { code: "TABLE_FULL" });
             return { success: true, placed };
           })();
         } catch (error) {
           if (error.code === "TABLE_FULL") return { success: false, code: "TABLE_FULL" };
           throw error;
         }
       }

       hideTableCards(spaceId, refs) {
         if (!this.db) throw new Error("Database not initialized");
         return this.db.transaction(() => {
           let hidden = 0;
           for (const ref of Array.isArray(refs) ? refs : []) {
             if (!isTableRef(ref)) continue;
             if (ref.type === "note") {
               // A space's notes auto-appear; hiding keeps the note and its last spot.
               hidden += this.db
                 .prepare(
                   `INSERT INTO note_layout (space_id, entity_type, entity_id, x, y, hidden) VALUES (?, 'note', ?, 0, 0, 1)
                    ON CONFLICT(space_id, entity_type, entity_id) DO UPDATE SET hidden = 1, updated_at = CURRENT_TIMESTAMP`
                 )
                 .run(spaceId, ref.id).changes;
             } else {
               hidden += this.db
                 .prepare("DELETE FROM note_layout WHERE space_id = ? AND entity_type = ? AND entity_id = ?")
                 .run(spaceId, ref.type, ref.id).changes;
             }
           }
           return { success: true, hidden };
         })();
       }

       linkTableCards(spaceId, a, b) {
         if (!this.db) throw new Error("Database not initialized");
         if (!isTableRef(a) || !isTableRef(b)) return { success: false };
         const ka = tableKey(a.type, a.id);
         const kb = tableKey(b.type, b.id);
         if (ka === kb) return { success: false };
         const [first, second] = ka < kb ? [a, b] : [b, a];
         this.db
           .prepare(
             "INSERT OR IGNORE INTO note_layout_links (space_id, a_type, a_id, b_type, b_id) VALUES (?, ?, ?, ?, ?)"
           )
           .run(spaceId, first.type, first.id, second.type, second.id);
         return { success: true };
       }

       setTableViewport(spaceId, viewport) {
         if (!this.db) throw new Error("Database not initialized");
         const { x, y, scale } = viewport || {};
         if (![x, y, scale].every(Number.isFinite)) return { success: false };
         this.db
           .prepare(
             `INSERT INTO note_layout_viewport (space_id, x, y, scale, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(space_id) DO UPDATE SET x = excluded.x, y = excluded.y, scale = excluded.scale, updated_at = CURRENT_TIMESTAMP`
           )
           .run(spaceId, clampCoord(x), clampCoord(y), Math.max(0.25, Math.min(2, scale)));
         return { success: true };
       }
     ```

4. `src/helpers/ipcHandlers.js`. After the `db-get-spaces` handler (`:1780`):

   ```js
       ipcMain.handle("db-get-table-board", async (_event, spaceId) => {
         return this.databaseManager.getTableBoard(spaceId);
       });
       ipcMain.handle("db-place-table-cards", async (_event, spaceId, placements) => {
         return this.databaseManager.placeTableCards(spaceId, placements);
       });
       ipcMain.handle("db-hide-table-cards", async (_event, spaceId, refs) => {
         return this.databaseManager.hideTableCards(spaceId, refs);
       });
       ipcMain.handle("db-link-table-cards", async (_event, spaceId, a, b) => {
         return this.databaseManager.linkTableCards(spaceId, a, b);
       });
       ipcMain.handle("db-set-table-viewport", async (_event, spaceId, viewport) => {
         return this.databaseManager.setTableViewport(spaceId, viewport);
       });
   ```

5. `preload.js`. After `updateSpace` (`:265`):

   ```js
     getTableBoard: (spaceId) => ipcRenderer.invoke("db-get-table-board", spaceId),
     placeTableCards: (spaceId, placements) => ipcRenderer.invoke("db-place-table-cards", spaceId, placements),
     hideTableCards: (spaceId, refs) => ipcRenderer.invoke("db-hide-table-cards", spaceId, refs),
     linkTableCards: (spaceId, a, b) => ipcRenderer.invoke("db-link-table-cards", spaceId, a, b),
     setTableViewport: (spaceId, viewport) => ipcRenderer.invoke("db-set-table-viewport", spaceId, viewport),
   ```

6. `src/types/electron.ts`. Add at the top: `import type { TableBoardData, TableEntityRef, TablePlacement, TableViewport } from "./table";`. After `getSpaces?:` (`:1006`), add:

   ```ts
         getTableBoard?: (spaceId: number) => Promise<TableBoardData>;
         placeTableCards?: (
           spaceId: number,
           placements: TablePlacement[]
         ) => Promise<{ success: true; placed: number } | { success: false; code: "TABLE_FULL" }>;
         hideTableCards?: (spaceId: number, refs: TableEntityRef[]) => Promise<{ success: boolean; hidden: number }>;
         linkTableCards?: (spaceId: number, a: TableEntityRef, b: TableEntityRef) => Promise<{ success: boolean }>;
         setTableViewport?: (spaceId: number, viewport: TableViewport) => Promise<{ success: boolean }>;
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/tableLayoutDatabase.test.js test/helpers/personalIpcContract.test.js test/helpers/personalDatabase.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/table.ts src/helpers/localDatabaseSchema.js src/helpers/database.js src/helpers/ipcHandlers.js preload.js src/types/electron.ts test/helpers/tableLayoutDatabase.test.js
git commit -m "feat(db): The Table layout, links and viewport in local SQLite"
```

---

### Task 12: Table geometry

**Files:**
- Create: `src/components/table/tableGeometry.ts`
- Test: `test/components/tableGeometry.test.js`

**Interfaces:**
- Produces:

  ```ts
  export interface Point { x: number; y: number }
  export interface Rect { x: number; y: number; w: number; h: number }
  export interface Viewport { x: number; y: number; scale: number }   // screen = world * scale + (x, y)
  export interface Size { width: number; height: number }
  export type Direction = "left" | "right" | "up" | "down";
  export interface Placed { id: string; rect: Rect }
  export const MIN_SCALE = 0.25, MAX_SCALE = 2, GRID = 8, DOT_GRID = 24;
  export const DEFAULT_VIEWPORT: Viewport;
  export function clampScale(scale: number): number;
  export function screenToWorld(p: Point, v: Viewport): Point;
  export function worldToScreen(p: Point, v: Viewport): Point;
  export function zoomAt(v: Viewport, factor: number, anchor: Point): Viewport;   // anchor in screen px stays put
  export function snapToGrid(n: number, grid?: number): number;
  export function normalizeRect(a: Point, b: Point): Rect;
  export function rectsIntersect(a: Rect, b: Rect): boolean;
  export function lassoSelect(items: Placed[], screenRect: Rect, v: Viewport): string[];
  export function visibleIds(items: Placed[], v: Viewport, size: Size, always?: Iterable<string>, margin?: number): Set<string>;
  export function ensureVisible(rect: Rect, v: Viewport, size: Size, pad?: number): Viewport;
  export function nearestInDirection(fromId: string, items: Placed[], dir: Direction): string | null;
  export function connectorPath(a: Rect, b: Rect): string;
  export function autoPlace(sizes: Array<{ w: number; h: number }>, occupied: Rect[], columns?: number, gap?: number): Point[];
  export function fitViewport(rects: Rect[], size: Size, pad?: number): Viewport;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/tableGeometry.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/table/tableGeometry.ts");
const card = (id, x, y, w = 100, h = 50) => ({ id, rect: { x, y, w, h } });

test("screen and world coordinates invert each other", async () => {
  const { screenToWorld, worldToScreen } = await load();
  const v = { x: 40, y: -20, scale: 2 };
  assert.deepEqual(worldToScreen({ x: 10, y: 10 }, v), { x: 60, y: 0 });
  assert.deepEqual(screenToWorld({ x: 60, y: 0 }, v), { x: 10, y: 10 });
});

test("zoom keeps the anchor fixed and clamps to 25–200%", async () => {
  const { zoomAt, screenToWorld } = await load();
  const v = { x: 0, y: 0, scale: 1 };
  const z = zoomAt(v, 2, { x: 100, y: 100 });
  assert.deepEqual(z, { x: -100, y: -100, scale: 2 });
  assert.deepEqual(screenToWorld({ x: 100, y: 100 }, z), screenToWorld({ x: 100, y: 100 }, v));
  assert.equal(zoomAt(z, 10, { x: 0, y: 0 }).scale, 2);
  assert.equal(zoomAt(v, 0.01, { x: 0, y: 0 }).scale, 0.25);
  assert.equal(zoomAt(v, Number.NaN, { x: 0, y: 0 }).scale, 1);
});

test("snapping lands on the 8px grid", async () => {
  const { snapToGrid } = await load();
  assert.deepEqual([3, 4, 12, -5].map((n) => snapToGrid(n)), [0, 8, 16, -8]);
});

test("lasso selects cards it touches in world space", async () => {
  const { lassoSelect } = await load();
  const items = [card("a", 0, 0), card("b", 300, 0), card("c", 0, 300)];
  assert.deepEqual(lassoSelect(items, { x: 50, y: 25, w: 300, h: 10 }, { x: 0, y: 0, scale: 1 }), ["a", "b"]);
  assert.deepEqual(lassoSelect(items, { x: 0, y: 140, w: 20, h: 20 }, { x: 0, y: 0, scale: 0.5 }), ["c"]);
});

test("virtualisation renders 1.5x the viewport and never culls focused or selected cards", async () => {
  const { visibleIds } = await load();
  const items = [card("near", 10, 10), card("edge", 1200, 10), card("far", 5000, 5000)];
  const ids = visibleIds(items, { x: 0, y: 0, scale: 1 }, { width: 1000, height: 600 });
  assert.deepEqual([...ids].sort(), ["edge", "near"]);
  assert.ok(visibleIds(items, { x: 0, y: 0, scale: 1 }, { width: 1000, height: 600 }, ["far"]).has("far"));
});

test("ensureVisible pans the least distance needed", async () => {
  const { ensureVisible } = await load();
  const size = { width: 800, height: 600 };
  const v = { x: 0, y: 0, scale: 1 };
  assert.equal(ensureVisible({ x: 100, y: 100, w: 100, h: 50 }, v, size), v, "already visible: same object");
  assert.deepEqual(ensureVisible({ x: 900, y: 100, w: 100, h: 50 }, v, size), { x: -224, y: 0, scale: 1 });
  assert.deepEqual(ensureVisible({ x: -50, y: -80, w: 100, h: 50 }, v, size), { x: 74, y: 104, scale: 1 });
});

test("arrow focus picks the nearest card in that direction", async () => {
  const { nearestInDirection } = await load();
  const items = [card("o", 0, 0), card("r", 200, 10), card("rr", 400, 0), card("d", 0, 200), card("diag", 150, 150)];
  assert.equal(nearestInDirection("o", items, "right"), "r");
  assert.equal(nearestInDirection("o", items, "down"), "d");
  assert.equal(nearestInDirection("o", items, "left"), null);
  assert.equal(nearestInDirection("missing", items, "left"), null);
});

test("connectors leave the facing edges with a smooth curve", async () => {
  const { connectorPath } = await load();
  assert.equal(connectorPath({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 }), "M100 25 C200 25 200 25 300 25");
  assert.equal(connectorPath({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 200, w: 100, h: 50 }), "M50 50 C50 125 50 125 50 200");
});

test("auto-placement fills rows below arranged cards on the grid", async () => {
  const { autoPlace } = await load();
  const sizes = Array.from({ length: 5 }, () => ({ w: 280, h: 152 }));
  assert.deepEqual(autoPlace(sizes, []), [
    { x: 32, y: 32 }, { x: 344, y: 32 }, { x: 656, y: 32 }, { x: 968, y: 32 }, { x: 32, y: 216 },
  ]);
  const below = autoPlace([{ w: 220, h: 112 }], [{ x: 96, y: 40, w: 280, h: 160 }]);
  assert.deepEqual(below, [{ x: 96, y: 264 }]);
});

test("fit shows every card, never zooms past 100%, and centres", async () => {
  const { fitViewport, DEFAULT_VIEWPORT } = await load();
  assert.deepEqual(fitViewport([], { width: 800, height: 600 }), DEFAULT_VIEWPORT);
  assert.deepEqual(fitViewport([{ x: 0, y: 0, w: 100, h: 100 }], { width: 800, height: 600 }), { x: 350, y: 250, scale: 1 });
  const wide = fitViewport([{ x: 0, y: 0, w: 2000, h: 100 }], { width: 800, height: 600 });
  assert.equal(wide.scale, 0.352);
});
```

The expected numbers:
- `visibleIds`: a 1.5× margin on 1000 × 600 covers world x −250…1250. A card at x 1200 is in, and one at 5000 is out.
- `ensureVisible`: in the right case, the card's right edge is at 1000. The target is 800 − 24 = 776, so dx = −224. In the left/top case, dx = 24 − (−50) = 74 and dy = 24 − (−80) = 104.
- `autoPlace`:
  - Columns are 280 + 32 = 312 apart and rows 152 + 32 = 184 apart, so card 5 lands at y 216.
  - In the below case, top = 40 + 160 + 64 = 264.
- `fitViewport` wide case: (800 − 96) / 2000 = 0.352.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/tableGeometry.test.js`
Expected: FAIL with `Cannot find module '../../src/components/table/tableGeometry.ts'`.

- [ ] **Step 3: Implement**

Create `src/components/table/tableGeometry.ts`:

```ts
// Pure geometry for The Table (WS-M5). World coordinates are physical pixels
// at 100%; the viewport maps them to the screen: screen = world * scale + (x, y).
// The canvas is spatial like a map, so arrows and coordinates do not mirror in RTL.

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Viewport { x: number; y: number; scale: number }
export interface Size { width: number; height: number }
export type Direction = "left" | "right" | "up" | "down";
export interface Placed { id: string; rect: Rect }

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2;
export const GRID = 8;
export const DOT_GRID = 24;
export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function clampScale(scale: number): number {
  return Number.isFinite(scale) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) : 1;
}

export function screenToWorld(p: Point, v: Viewport): Point {
  return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
}

export function worldToScreen(p: Point, v: Viewport): Point {
  return { x: p.x * v.scale + v.x, y: p.y * v.scale + v.y };
}

export function zoomAt(v: Viewport, factor: number, anchor: Point): Viewport {
  const scale = Number.isFinite(factor) ? clampScale(v.scale * factor) : clampScale(Number.NaN);
  const k = scale / v.scale;
  return { scale, x: anchor.x - (anchor.x - v.x) * k, y: anchor.y - (anchor.y - v.y) * k };
}

export function snapToGrid(n: number, grid: number = GRID): number {
  return Math.round(n / grid) * grid;
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function lassoSelect(items: Placed[], screenRect: Rect, v: Viewport): string[] {
  const world: Rect = {
    x: (screenRect.x - v.x) / v.scale,
    y: (screenRect.y - v.y) / v.scale,
    w: screenRect.w / v.scale,
    h: screenRect.h / v.scale,
  };
  return items.filter((item) => rectsIntersect(item.rect, world)).map((item) => item.id);
}

export function visibleIds(
  items: Placed[],
  v: Viewport,
  size: Size,
  always: Iterable<string> = [],
  margin = 1.5
): Set<string> {
  const extraW = (size.width * (margin - 1)) / 2;
  const extraH = (size.height * (margin - 1)) / 2;
  const world: Rect = {
    x: (-extraW - v.x) / v.scale,
    y: (-extraH - v.y) / v.scale,
    w: (size.width * margin) / v.scale,
    h: (size.height * margin) / v.scale,
  };
  const out = new Set<string>(always);
  for (const item of items) if (rectsIntersect(item.rect, world)) out.add(item.id);
  return out;
}

export function ensureVisible(rect: Rect, v: Viewport, size: Size, pad = 24): Viewport {
  const s = worldToScreen(rect, v);
  const w = rect.w * v.scale;
  const h = rect.h * v.scale;
  let dx = 0;
  let dy = 0;
  if (s.x < pad) dx = pad - s.x;
  else if (s.x + w > size.width - pad) dx = size.width - pad - (s.x + w);
  if (s.y < pad) dy = pad - s.y;
  else if (s.y + h > size.height - pad) dy = size.height - pad - (s.y + h);
  return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
}

const DIRS: Record<Direction, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export function nearestInDirection(fromId: string, items: Placed[], dir: Direction): string | null {
  const from = items.find((item) => item.id === fromId);
  if (!from) return null;
  const [ux, uy] = DIRS[dir];
  const origin = center(from.rect);
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item.id === fromId) continue;
    const c = center(item.rect);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const along = dx * ux + dy * uy;
    const across = Math.abs(dx * uy) + Math.abs(dy * ux);
    if (along > 0 && along * 1.2 > across) {
      const score = along + across * 1.5;
      if (score < bestScore) {
        bestScore = score;
        best = item.id;
      }
    }
  }
  return best;
}

export function connectorPath(a: Rect, b: Rect): string {
  const ac = center(a);
  const bc = center(b);
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  if (Math.abs(dx) > Math.abs(dy) * 0.8) {
    const x1 = a.x + (dx > 0 ? a.w : 0);
    const x2 = b.x + (dx > 0 ? 0 : b.w);
    const m = (x2 - x1) / 2;
    return `M${round1(x1)} ${round1(ac.y)} C${round1(x1 + m)} ${round1(ac.y)} ${round1(x2 - m)} ${round1(bc.y)} ${round1(x2)} ${round1(bc.y)}`;
  }
  const y1 = a.y + (dy > 0 ? a.h : 0);
  const y2 = b.y + (dy > 0 ? 0 : b.h);
  const n = (y2 - y1) / 2;
  return `M${round1(ac.x)} ${round1(y1)} C${round1(ac.x)} ${round1(y1 + n)} ${round1(bc.x)} ${round1(y2 - n)} ${round1(bc.x)} ${round1(y2)}`;
}

export function autoPlace(
  sizes: Array<{ w: number; h: number }>,
  occupied: Rect[],
  columns = 4,
  gap = 32
): Point[] {
  if (sizes.length === 0) return [];
  const top = occupied.length ? Math.max(...occupied.map((r) => r.y + r.h)) + gap * 2 : 32;
  const left = occupied.length ? Math.min(...occupied.map((r) => r.x)) : 32;
  const colW = Math.max(...sizes.map((s) => s.w)) + gap;
  const rowH = Math.max(...sizes.map((s) => s.h)) + gap;
  return sizes.map((_, i) => ({
    x: snapToGrid(left + (i % columns) * colW),
    y: snapToGrid(top + Math.floor(i / columns) * rowH),
  }));
}

export function fitViewport(rects: Rect[], size: Size, pad = 48): Viewport {
  if (rects.length === 0) return DEFAULT_VIEWPORT;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const scale = round3(clampScale(Math.min((size.width - pad * 2) / bw, (size.height - pad * 2) / bh, 1)));
  return {
    scale,
    x: round1((size.width - bw * scale) / 2 - minX * scale),
    y: round1((size.height - bh * scale) / 2 - minY * scale),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/tableGeometry.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/table/tableGeometry.ts test/components/tableGeometry.test.js
git commit -m "feat(table): pure canvas geometry for pan, zoom, lasso and focus"
```

---

### Task 13: Table model — cards, edges, context and state

**Files:**
- Create: `src/components/table/tableModel.ts`
- Create: `src/components/table/tableEdges.ts`
- Test: `test/components/tableModel.test.js`

**Interfaces:**
- Consumes the Task 11 types (`src/types/table.ts`) and the Task 12 geometry. It consumes `TranscriptionItem` from `src/types/electron.ts`.
- Consumes Plan 06's `parseMentionHref` from `src/utils/mentionMarkdown.ts` (CCR-2).
- Produces `tableEdges.ts`: `parseEntityHref(href: string): TableEntityRef | null`.
- Produces `tableModel.ts`:

  ```ts
  export const CARD_WIDTH: Record<TableCardKind, number>;          // note 280, meeting 320, dictation 220, chat 340
  export const CARD_HEIGHT_ESTIMATE: Record<TableCardKind, number>; // note 152, meeting 176, dictation 112, chat 176
  export function refKey(ref: TableEntityRef): string;             // "note:7"
  export function parseRefKey(key: string): TableEntityRef | null;
  export interface TableCardModel { key: string; entity: TableEntity; rect: Rect; placed: boolean; z: number }
  export function buildCards(entities: TableEntity[], measured?: Record<string, number>): TableCardModel[];
  export function deriveEdges(cards: TableCardModel[], links: TableLink[], parseHref: (href: string) => TableEntityRef | null): Array<{ a: string; b: string }>;
  export function plainExcerpt(markdown: string, max?: number): string;
  export function buildSelectionContext(spaceName: string, entities: TableEntity[]): string;
  export function buildGroupedNote(entities: TableEntity[], labels: { title: string; untitled: string; kind: Record<TableCardKind, string> }): { title: string; content: string };
  export function dictationEntityFromItem(item: TranscriptionItem): TableEntity;
  export interface TableState { board: TableBoardData | null; measured: Record<string, number>; overrides: Record<string, Point>; selection: string[]; focused: string | null; viewport: Viewport }
  export type TableAction =
    | { type: "loaded"; board: TableBoardData }
    | { type: "measured"; key: string; h: number }
    | { type: "moved"; positions: Record<string, Point> }
    | { type: "placed"; placements: TablePlacement[] }
    | { type: "hidden"; keys: string[] }
    | { type: "inboxArrived"; entity: TableEntity }
    | { type: "clickCard"; key: string; additive: boolean }
    | { type: "select"; keys: string[] }
    | { type: "focus"; key: string | null }
    | { type: "viewport"; viewport: Viewport };
  export function initialTableState(): TableState;
  export function tableReducer(state: TableState, action: TableAction): TableState;
  export function cardsFor(state: TableState): TableCardModel[];   // board cards + live drag overrides
  export function placementsFor(state: TableState, keys: string[], positions?: Record<string, Point>): TablePlacement[];
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/tableModel.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/table/tableModel.ts");
const loadEdges = () => import("../../src/components/table/tableEdges.ts");

const entity = (type, id, extra = {}) => ({
  ref: { type, id },
  kind: type === "chat" ? "chat" : type === "dictation" ? "dictation" : "note",
  title: type === "dictation" ? null : `T${id}`,
  excerpt: "body",
  at: "2026-10-14 10:00:00",
  durationMs: null,
  participants: [],
  hrefs: [],
  noteId: null,
  layout: null,
  ...extra,
});
const board = (cards, extra = {}) => ({ spaceId: 1, cards, inbox: [], links: [], viewport: null, truncated: false, ...extra });

test("placed cards keep their spot; unplaced ones flow below them on the grid", async () => {
  const { buildCards } = await load();
  const cards = buildCards([
    entity("note", 1, { layout: { x: 96, y: 40, w: null, h: null, z: 2, hidden: false } }),
    entity("note", 2),
    entity("chat", 3),
  ]);
  assert.deepEqual(cards.map((c) => [c.key, c.placed, c.rect.x, c.rect.y, c.rect.w]), [
    ["note:1", true, 96, 40, 280],
    ["note:2", false, 96, 256, 280],
    ["chat:3", false, 472, 256, 340],
  ]);
  assert.equal(cards[0].z, 2);
});

test("measured heights replace estimates", async () => {
  const { buildCards } = await load();
  const [c] = buildCards([entity("note", 1)], { "note:1": 230 });
  assert.equal(c.rect.h, 230);
});

test("edges merge stored links, chat-about-note and mention links, once each, on-board only", async () => {
  const { buildCards, deriveEdges } = await load();
  const { parseEntityHref } = await loadEdges();
  const cards = buildCards([
    entity("note", 1, { hrefs: ["note:2", "note:9", "https://x"] }),
    entity("note", 2, { hrefs: ["note:1"] }),
    entity("chat", 3, { noteId: 1 }),
  ]);
  const edges = deriveEdges(cards, [{ a: { type: "chat", id: 3 }, b: { type: "note", id: 1 } }, { a: { type: "note", id: 2 }, b: { type: "dictation", id: 99 } }], parseEntityHref);
  assert.deepEqual(edges, [{ a: "chat:3", b: "note:1" }, { a: "note:1", b: "note:2" }]);
});

test("entity hrefs map meetings to note cards and ignore folders and people", async () => {
  const { parseEntityHref } = await loadEdges();
  assert.deepEqual(parseEntityHref("note:12"), { type: "note", id: 12 });
  assert.deepEqual(parseEntityHref("meeting:4"), { type: "note", id: 4 });
  assert.deepEqual(parseEntityHref("dictation:7"), { type: "dictation", id: 7 });
  assert.equal(parseEntityHref("folder:2"), null);
  assert.equal(parseEntityHref("mention:maya%40x"), null);
  assert.equal(parseEntityHref("note:abc"), null);
  assert.equal(parseEntityHref("note:0"), null);
});

test("excerpts drop markdown syntax and cut on a word", async () => {
  const { plainExcerpt } = await load();
  assert.equal(plainExcerpt("# Plan\n- [ ] Ship **Thursday** with [Maya](mention:m)\n> quoted `code`"), "Plan Ship Thursday with Maya quoted code");
  assert.equal(plainExcerpt("one two three four", 9), "one two…");
});

test("selection context names the space and fences each item", async () => {
  const { buildSelectionContext } = await load();
  const ctx = buildSelectionContext("Work", [entity("note", 1, { title: 'He said "hi"' }), entity("dictation", 2)]);
  assert.match(ctx, /^The user selected 2 items on the canvas of the space "Work"\./);
  assert.match(ctx, /<item type="note" title="He said &quot;hi&quot;"/);
  assert.match(ctx, /<item type="dictation" title=""/);
});

test("grouped notes list every source, untitled dictations by kind", async () => {
  const { buildGroupedNote } = await load();
  const out = buildGroupedNote([entity("note", 1), entity("dictation", 2, { excerpt: "Remind me" })], {
    title: "Grouped",
    untitled: "Untitled",
    kind: { note: "Note", meeting: "Meeting", dictation: "Dictation", chat: "Answer" },
  });
  assert.equal(out.title, "Grouped");
  assert.equal(out.content, "- **T1**: body\n- **Dictation**: Remind me");
});

test("a new dictation becomes an inbox entity", async () => {
  const { dictationEntityFromItem } = await load();
  const e = dictationEntityFromItem({ id: 5, text: "Hi there", timestamp: "2026-10-14 11:00:00", audio_duration_ms: 4000 });
  assert.deepEqual([e.ref, e.kind, e.excerpt, e.durationMs, e.layout], [{ type: "dictation", id: 5 }, "dictation", "Hi there", 4000, null]);
});

test("reducer: drag overrides move cards until placement lands in the board", async () => {
  const { initialTableState, tableReducer, cardsFor, placementsFor } = await load();
  let s = tableReducer(initialTableState(), { type: "loaded", board: board([entity("note", 1)]) });
  s = tableReducer(s, { type: "moved", positions: { "note:1": { x: 500, y: 60 } } });
  assert.deepEqual(cardsFor(s)[0].rect.x, 500);
  const placements = placementsFor(s, ["note:1"]);
  assert.deepEqual(placements, [{ type: "note", id: 1, x: 504, y: 64, w: null, h: null, z: 0 }]);
  s = tableReducer(s, { type: "placed", placements });
  assert.deepEqual(s.overrides, {});
  assert.deepEqual([cardsFor(s)[0].placed, cardsFor(s)[0].rect.x], [true, 504]);
});

test("reducer: clicks select, shift-clicks toggle, hidden cards leave selection and go to the inbox", async () => {
  const { initialTableState, tableReducer } = await load();
  let s = tableReducer(initialTableState(), { type: "loaded", board: board([entity("note", 1), entity("note", 2)]) });
  s = tableReducer(s, { type: "clickCard", key: "note:1", additive: false });
  s = tableReducer(s, { type: "clickCard", key: "note:2", additive: true });
  assert.deepEqual(s.selection, ["note:1", "note:2"]);
  s = tableReducer(s, { type: "clickCard", key: "note:1", additive: true });
  assert.deepEqual(s.selection, ["note:2"]);
  s = tableReducer(s, { type: "hidden", keys: ["note:2"] });
  assert.deepEqual(s.selection, []);
  assert.deepEqual(s.board.cards.map((c) => c.ref.id), [1]);
  assert.deepEqual(s.board.inbox.map((c) => c.ref.id), [2]);
});

test("reducer: the first load restores the saved view; reloads keep the live view and drop stale selection", async () => {
  const { initialTableState, tableReducer } = await load();
  let s = tableReducer(initialTableState(), { type: "loaded", board: board([entity("note", 1)], { viewport: { x: 5, y: 6, scale: 0.5 } }) });
  assert.deepEqual(s.viewport, { x: 5, y: 6, scale: 0.5 });
  s = tableReducer(s, { type: "viewport", viewport: { x: 90, y: 0, scale: 1 } });
  s = tableReducer(s, { type: "select", keys: ["note:1"] });
  s = tableReducer(s, { type: "focus", key: "note:1" });
  s = tableReducer(s, { type: "loaded", board: board([], { viewport: { x: 5, y: 6, scale: 0.5 } }) });
  assert.deepEqual([s.selection, s.focused, s.viewport], [[], null, { x: 90, y: 0, scale: 1 }]);
});

test("reducer: arrivals join the inbox once", async () => {
  const { initialTableState, tableReducer, dictationEntityFromItem } = await load();
  let s = tableReducer(initialTableState(), { type: "loaded", board: board([]) });
  const e = dictationEntityFromItem({ id: 9, text: "x", timestamp: "t", audio_duration_ms: null });
  s = tableReducer(s, { type: "inboxArrived", entity: e });
  s = tableReducer(s, { type: "inboxArrived", entity: e });
  assert.equal(s.board.inbox.length, 1);
});
```

Expected values:
- **`buildCards`.** The placed card occupies y 40–192 (estimated height 152), so the auto row starts at 192 + 64 = 256, with left = 96. The column width is max(280, 340) + 32 = 372, so the second auto card has x = 468, which snaps to 472.
- **`placementsFor`.** It snaps 500 → 504 and 60 → 64.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/tableModel.test.js`
Expected: FAIL. The modules are not found.

- [ ] **Step 3: Implement**

Confirm Plan 06's parser is on `main`: `grep -n "export function parseMentionHref" src/utils/mentionMarkdown.ts`. Then create `src/components/table/tableEdges.ts`:

```ts
import type { TableEntityRef } from "../../types/table";
import { parseMentionHref } from "../../utils/mentionMarkdown";

// Adapter over Plan 06's universal mention hrefs (CCR-2). Meetings are notes on
// the Table; folders and people are not cards, so they draw no connector.
export function parseEntityHref(href: string): TableEntityRef | null {
  const mention = parseMentionHref(href);
  const id = mention?.entityId != null ? Number(mention.entityId) : Number.NaN;
  if (!mention || !Number.isInteger(id) || id <= 0) return null;
  if (mention.kind === "note" || mention.kind === "meeting") return { type: "note", id };
  if (mention.kind === "dictation") return { type: "dictation", id };
  return null;
}
```

If the grep finds nothing (Plan 06 shipped without Task 17), use this body instead and keep the same tests:

```ts
export function parseEntityHref(href: string): TableEntityRef | null {
  const match = /^(note|meeting|dictation):([1-9]\d*)$/.exec(href.trim());
  if (!match) return null;
  return { type: match[1] === "dictation" ? "dictation" : "note", id: Number(match[2]) };
}
```

Create `src/components/table/tableModel.ts`:

```ts
import type { TranscriptionItem } from "../../types/electron";
import type {
  TableBoardData,
  TableCardKind,
  TableEntity,
  TableEntityRef,
  TableLink,
  TablePlacement,
} from "../../types/table";
import { autoPlace, DEFAULT_VIEWPORT, snapToGrid, type Point, type Rect, type Viewport } from "./tableGeometry";

export const CARD_WIDTH: Record<TableCardKind, number> = { note: 280, meeting: 320, dictation: 220, chat: 340 };
export const CARD_HEIGHT_ESTIMATE: Record<TableCardKind, number> = { note: 152, meeting: 176, dictation: 112, chat: 176 };
const CONTEXT_ITEMS = 12;
const CONTEXT_CHARS = 600;

export const refKey = (ref: TableEntityRef) => `${ref.type}:${ref.id}`;

export function parseRefKey(key: string): TableEntityRef | null {
  const match = /^(note|dictation|chat):(\d+)$/.exec(key);
  return match ? { type: match[1] as TableEntityRef["type"], id: Number(match[2]) } : null;
}

export interface TableCardModel { key: string; entity: TableEntity; rect: Rect; placed: boolean; z: number }

const sizeOf = (e: TableEntity, measured: Record<string, number>) => ({
  w: e.layout?.w ?? CARD_WIDTH[e.kind],
  h: measured[refKey(e.ref)] ?? e.layout?.h ?? CARD_HEIGHT_ESTIMATE[e.kind],
});

export function buildCards(entities: TableEntity[], measured: Record<string, number> = {}): TableCardModel[] {
  const placed = entities.filter((e) => e.layout && !e.layout.hidden);
  const unplaced = entities.filter((e) => !e.layout || e.layout.hidden);
  const placedCards = placed.map((e) => ({
    key: refKey(e.ref),
    entity: e,
    rect: { x: e.layout!.x, y: e.layout!.y, ...sizeOf(e, measured) },
    placed: true,
    z: e.layout!.z,
  }));
  const spots = autoPlace(unplaced.map((e) => sizeOf(e, measured)), placedCards.map((c) => c.rect));
  const autoCards = unplaced.map((e, i) => ({
    key: refKey(e.ref),
    entity: e,
    rect: { ...spots[i], ...sizeOf(e, measured) },
    placed: false,
    z: 0,
  }));
  return [...placedCards, ...autoCards];
}

export function deriveEdges(
  cards: TableCardModel[],
  links: TableLink[],
  parseHref: (href: string) => TableEntityRef | null
): Array<{ a: string; b: string }> {
  const present = new Set(cards.map((c) => c.key));
  const seen = new Set<string>();
  const out: Array<{ a: string; b: string }> = [];
  const add = (x: string, y: string) => {
    if (x === y || !present.has(x) || !present.has(y)) return;
    const [a, b] = x < y ? [x, y] : [y, x];
    if (seen.has(`${a}|${b}`)) return;
    seen.add(`${a}|${b}`);
    out.push({ a, b });
  };
  for (const link of links) add(refKey(link.a), refKey(link.b));
  for (const card of cards) {
    if (card.entity.kind === "chat" && card.entity.noteId != null) {
      add(card.key, refKey({ type: "note", id: card.entity.noteId }));
    }
    for (const href of card.entity.hrefs) {
      const ref = parseHref(href);
      if (ref) add(card.key, refKey(ref));
    }
  }
  return out;
}

export function plainExcerpt(markdown: string, max = 240): string {
  const text = String(markdown || "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > 0 ? cut.slice(0, space) : cut}…`;
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Instructions to the model, not UI copy: English like useContainerChat's context.
export function buildSelectionContext(spaceName: string, entities: TableEntity[]): string {
  const header = `The user selected ${entities.length} items on the canvas of the space "${spaceName}". Answer about these items only.`;
  const blocks = entities.slice(0, CONTEXT_ITEMS).map(
    (e) =>
      `<item type="${e.kind}" title="${escapeAttr(e.title ?? "")}" at="${escapeAttr(e.at)}">\n${e.excerpt.slice(0, CONTEXT_CHARS)}\n</item>`
  );
  return [header, ...blocks].join("\n\n");
}

export function buildGroupedNote(
  entities: TableEntity[],
  labels: { title: string; untitled: string; kind: Record<TableCardKind, string> }
): { title: string; content: string } {
  const lines = entities.map((e) => {
    const name = e.title?.trim() || (e.kind === "dictation" ? labels.kind.dictation : labels.untitled);
    return `- **${name}**: ${plainExcerpt(e.excerpt, 160)}`;
  });
  return { title: labels.title, content: lines.join("\n") };
}

export function dictationEntityFromItem(
  item: Pick<TranscriptionItem, "id" | "text" | "timestamp" | "audio_duration_ms">
): TableEntity {
  return {
    ref: { type: "dictation", id: item.id },
    kind: "dictation",
    title: null,
    excerpt: String(item.text || "").slice(0, CONTEXT_CHARS),
    at: item.timestamp,
    durationMs: item.audio_duration_ms ?? null,
    participants: [],
    hrefs: [],
    noteId: null,
    layout: null,
  };
}

export interface TableState {
  board: TableBoardData | null;
  measured: Record<string, number>;
  overrides: Record<string, Point>;
  selection: string[];
  focused: string | null;
  viewport: Viewport;
}

export type TableAction =
  | { type: "loaded"; board: TableBoardData }
  | { type: "measured"; key: string; h: number }
  | { type: "moved"; positions: Record<string, Point> }
  | { type: "placed"; placements: TablePlacement[] }
  | { type: "hidden"; keys: string[] }
  | { type: "inboxArrived"; entity: TableEntity }
  | { type: "clickCard"; key: string; additive: boolean }
  | { type: "select"; keys: string[] }
  | { type: "focus"; key: string | null }
  | { type: "viewport"; viewport: Viewport };

export function initialTableState(): TableState {
  return { board: null, measured: {}, overrides: {}, selection: [], focused: null, viewport: DEFAULT_VIEWPORT };
}

export function tableReducer(state: TableState, action: TableAction): TableState {
  switch (action.type) {
    case "loaded": {
      const present = new Set(action.board.cards.map((e) => refKey(e.ref)));
      return {
        ...state,
        board: action.board,
        overrides: {},
        selection: state.selection.filter((k) => present.has(k)),
        focused: state.focused && present.has(state.focused) ? state.focused : null,
        // Only the first load restores the saved view; later reloads (after a
        // placement or a chat answer) must not snap a pan the user just made.
        viewport: state.board === null ? (action.board.viewport ?? state.viewport) : state.viewport,
      };
    }
    case "measured":
      return state.measured[action.key] === action.h
        ? state
        : { ...state, measured: { ...state.measured, [action.key]: action.h } };
    case "moved":
      return { ...state, overrides: { ...state.overrides, ...action.positions } };
    case "placed": {
      if (!state.board) return state;
      const byKey = new Map(action.placements.map((p) => [refKey(p), p]));
      const place = (e: TableEntity): TableEntity => {
        const p = byKey.get(refKey(e.ref));
        return p ? { ...e, layout: { x: p.x, y: p.y, w: p.w ?? null, h: p.h ?? null, z: p.z ?? 0, hidden: false } } : e;
      };
      const fromInbox = state.board.inbox.filter((e) => byKey.has(refKey(e.ref))).map(place);
      const overrides = { ...state.overrides };
      for (const key of byKey.keys()) delete overrides[key];
      return {
        ...state,
        overrides,
        board: {
          ...state.board,
          cards: [...state.board.cards.map(place), ...fromInbox],
          inbox: state.board.inbox.filter((e) => !byKey.has(refKey(e.ref))),
        },
      };
    }
    case "hidden": {
      if (!state.board) return state;
      const gone = new Set(action.keys);
      const leaving = state.board.cards.filter((e) => gone.has(refKey(e.ref)));
      return {
        ...state,
        selection: state.selection.filter((k) => !gone.has(k)),
        focused: state.focused && gone.has(state.focused) ? null : state.focused,
        board: {
          ...state.board,
          cards: state.board.cards.filter((e) => !gone.has(refKey(e.ref))),
          inbox: [...leaving.map((e) => ({ ...e, layout: null })), ...state.board.inbox],
        },
      };
    }
    case "inboxArrived": {
      if (!state.board) return state;
      const key = refKey(action.entity.ref);
      const known = [...state.board.cards, ...state.board.inbox].some((e) => refKey(e.ref) === key);
      return known ? state : { ...state, board: { ...state.board, inbox: [action.entity, ...state.board.inbox] } };
    }
    case "clickCard": {
      if (!action.additive) return { ...state, selection: [action.key], focused: action.key };
      const has = state.selection.includes(action.key);
      return {
        ...state,
        focused: action.key,
        selection: has ? state.selection.filter((k) => k !== action.key) : [...state.selection, action.key],
      };
    }
    case "select":
      return { ...state, selection: action.keys };
    case "focus":
      return { ...state, focused: action.key };
    case "viewport":
      return { ...state, viewport: action.viewport };
  }
}

export function cardsFor(state: TableState): TableCardModel[] {
  if (!state.board) return [];
  return buildCards(state.board.cards, state.measured).map((card) => {
    const o = state.overrides[card.key];
    return o ? { ...card, rect: { ...card.rect, x: o.x, y: o.y } } : card;
  });
}

export function placementsFor(
  state: TableState,
  keys: string[],
  positions: Record<string, Point> = {}
): TablePlacement[] {
  const wanted = new Set(keys);
  return cardsFor(state)
    .filter((card) => wanted.has(card.key))
    .map((card) => {
      const at = positions[card.key] ?? card.rect;
      return {
        ...card.entity.ref,
        x: snapToGrid(at.x),
        y: snapToGrid(at.y),
        w: card.entity.layout?.w ?? null,
        h: card.entity.layout?.h ?? null,
        z: card.z,
      };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/tableModel.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/table/tableModel.ts src/components/table/tableEdges.ts test/components/tableModel.test.js
git commit -m "feat(table): card model, connectors from links and mentions, board reducer"
```

---

### Task 14: Gestures and keyboard as pure state machines

**Files:**
- Create: `src/components/table/tableGestures.ts`
- Test: `test/components/tableGestures.test.js`

**Interfaces:**
- Consumes Task 12 (`Point`, `Rect`, `Viewport`, `Direction`, `GRID`, `snapToGrid`, `zoomAt`, `normalizeRect`).
- Produces:

  ```ts
  export const DRAG_THRESHOLD = 4;
  export type Gesture =
    | { kind: "idle" }
    | { kind: "pan"; start: Point; origin: Viewport; moved: boolean }
    | { kind: "drag"; keys: string[]; start: Point; origins: Record<string, Point>; scale: number; moved: boolean; pressed: string; additive: boolean }
    | { kind: "lasso"; start: Point; current: Point };
  export interface PressInput { point: Point; cardKey: string | null; shift: boolean; spaceHeld: boolean; viewport: Viewport; selection: string[]; positions: Record<string, Point> }
  export function press(input: PressInput): Gesture;
  export type MoveEffect = { type: "viewport"; viewport: Viewport } | { type: "positions"; positions: Record<string, Point> } | { type: "lasso"; rect: Rect } | null;
  export function move(gesture: Gesture, point: Point): { gesture: Gesture; effect: MoveEffect };
  export type ReleaseEffect =
    | { type: "drop"; positions: Record<string, Point> }
    | { type: "click-card"; key: string; additive: boolean }
    | { type: "click-background" }
    | { type: "lasso-end"; rect: Rect }
    | { type: "pan-end"; viewport: Viewport }
    | null;
  export function release(gesture: Gesture, point: Point): ReleaseEffect;
  export function wheel(v: Viewport, e: { deltaX: number; deltaY: number; ctrlKey: boolean; metaKey: boolean; point: Point }): Viewport;
  export type KeyAction =
    | { type: "focusMove"; dir: Direction } | { type: "nudge"; dx: number; dy: number } | { type: "open" }
    | { type: "toggleSelect" } | { type: "clearSelection" } | { type: "remove" }
    | { type: "zoomIn" } | { type: "zoomOut" } | { type: "resetView" };
  export function keyAction(e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }, onCard: boolean): KeyAction | null;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/tableGestures.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/table/tableGestures.ts");
const V = { x: 0, y: 0, scale: 2 };
const base = { shift: false, spaceHeld: false, viewport: V, selection: [], positions: { "note:1": { x: 10, y: 10 }, "note:2": { x: 100, y: 10 } } };

test("pressing a card drags it; a selected card drags the whole selection", async () => {
  const { press } = await load();
  assert.deepEqual(press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1" }).keys, ["note:1"]);
  assert.deepEqual(press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1", selection: ["note:1", "note:2"] }).keys, ["note:1", "note:2"]);
});

test("background press pans, shift-press lassos, space-held pans even on a card", async () => {
  const { press } = await load();
  assert.equal(press({ ...base, point: { x: 0, y: 0 }, cardKey: null }).kind, "pan");
  assert.equal(press({ ...base, point: { x: 0, y: 0 }, cardKey: null, shift: true }).kind, "lasso");
  assert.equal(press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1", spaceHeld: true }).kind, "pan");
});

test("drags move in world units and only after the threshold; release snaps to the grid", async () => {
  const { press, move, release } = await load();
  let g = press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1" });
  let r = move(g, { x: 2, y: 1 });
  assert.equal(r.effect, null, "under the 4px threshold nothing moves");
  r = move(r.gesture, { x: 21, y: 9 });
  assert.deepEqual(r.effect, { type: "positions", positions: { "note:1": { x: 20.5, y: 14.5 } } });
  assert.deepEqual(release(r.gesture, { x: 21, y: 9 }), { type: "drop", positions: { "note:1": { x: 24, y: 16 } } });
});

test("a press without movement is a click; shift makes it additive", async () => {
  const { press, release } = await load();
  assert.deepEqual(release(press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:2", shift: true }), { x: 1, y: 1 }), { type: "click-card", key: "note:2", additive: true });
  assert.deepEqual(release(press({ ...base, point: { x: 0, y: 0 }, cardKey: null }), { x: 0, y: 0 }), { type: "click-background" });
});

test("panning moves the viewport in screen pixels and reports the end state", async () => {
  const { press, move, release } = await load();
  const g = press({ ...base, point: { x: 10, y: 10 }, cardKey: null });
  const r = move(g, { x: 40, y: -10 });
  assert.deepEqual(r.effect, { type: "viewport", viewport: { x: 30, y: -20, scale: 2 } });
  assert.deepEqual(release(r.gesture, { x: 40, y: -10 }), { type: "pan-end", viewport: { x: 30, y: -20, scale: 2 } });
});

test("lasso reports a normalised screen rectangle", async () => {
  const { press, move, release } = await load();
  const g = press({ ...base, point: { x: 50, y: 50 }, cardKey: null, shift: true });
  const r = move(g, { x: 10, y: 80 });
  assert.deepEqual(r.effect, { type: "lasso", rect: { x: 10, y: 50, w: 40, h: 30 } });
  assert.deepEqual(release(r.gesture, { x: 10, y: 80 }), { type: "lasso-end", rect: { x: 10, y: 50, w: 40, h: 30 } });
});

test("the wheel pans; with Ctrl or ⌘ (and trackpad pinch) it zooms around the pointer", async () => {
  const { wheel } = await load();
  const v = { x: 0, y: 0, scale: 1 };
  assert.deepEqual(wheel(v, { deltaX: 5, deltaY: 20, ctrlKey: false, metaKey: false, point: { x: 0, y: 0 } }), { x: -5, y: -20, scale: 1 });
  const z = wheel(v, { deltaX: 0, deltaY: -100, ctrlKey: true, metaKey: false, point: { x: 100, y: 100 } });
  assert.ok(z.scale > 1 && z.scale <= 2);
});

test("keyboard: arrows move focus, shift-arrows nudge 8px, and the rest map to actions", async () => {
  const { keyAction } = await load();
  const k = (key, mods = {}) => keyAction({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods }, true);
  assert.deepEqual(k("ArrowLeft"), { type: "focusMove", dir: "left" });
  assert.deepEqual(k("ArrowDown", { shiftKey: true }), { type: "nudge", dx: 0, dy: 8 });
  assert.deepEqual([k("Enter"), k(" "), k("Escape"), k("Delete"), k("Backspace")].map((a) => a.type), ["open", "toggleSelect", "clearSelection", "remove", "remove"]);
  assert.deepEqual([k("+"), k("="), k("-"), k("0")].map((a) => a.type), ["zoomIn", "zoomIn", "zoomOut", "resetView"]);
  assert.equal(k("a", { metaKey: true }), null, "app shortcuts pass through");
  assert.equal(keyAction({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, false), null, "Enter on the background does nothing");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/tableGestures.test.js`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

Create `src/components/table/tableGestures.ts`:

```ts
import { GRID, normalizeRect, snapToGrid, zoomAt, type Direction, type Point, type Rect, type Viewport } from "./tableGeometry";

// Pointer and key handling for The Table as pure functions, so every rule is
// testable without a DOM. TableCanvas only forwards events and applies effects.

export const DRAG_THRESHOLD = 4;
const WHEEL_ZOOM_RATE = 0.01;

export type Gesture =
  | { kind: "idle" }
  | { kind: "pan"; start: Point; origin: Viewport; moved: boolean }
  | {
      kind: "drag";
      keys: string[];
      start: Point;
      origins: Record<string, Point>;
      scale: number;
      moved: boolean;
      pressed: string;
      additive: boolean;
    }
  | { kind: "lasso"; start: Point; current: Point };

export interface PressInput {
  point: Point;
  cardKey: string | null;
  shift: boolean;
  spaceHeld: boolean;
  viewport: Viewport;
  selection: string[];
  positions: Record<string, Point>;
}

export function press(input: PressInput): Gesture {
  if (input.cardKey && !input.spaceHeld) {
    const keys = input.selection.includes(input.cardKey) ? input.selection : [input.cardKey];
    const origins: Record<string, Point> = {};
    for (const key of keys) if (input.positions[key]) origins[key] = input.positions[key];
    return {
      kind: "drag",
      keys,
      start: input.point,
      origins,
      scale: input.viewport.scale,
      moved: false,
      pressed: input.cardKey,
      additive: input.shift,
    };
  }
  if (input.shift && !input.cardKey) return { kind: "lasso", start: input.point, current: input.point };
  return { kind: "pan", start: input.point, origin: input.viewport, moved: false };
}

export type MoveEffect =
  | { type: "viewport"; viewport: Viewport }
  | { type: "positions"; positions: Record<string, Point> }
  | { type: "lasso"; rect: Rect }
  | null;

const passed = (a: Point, b: Point) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > DRAG_THRESHOLD;

function dragPositions(g: Extract<Gesture, { kind: "drag" }>, point: Point, snap: boolean) {
  const dx = (point.x - g.start.x) / g.scale;
  const dy = (point.y - g.start.y) / g.scale;
  const out: Record<string, Point> = {};
  for (const [key, o] of Object.entries(g.origins)) {
    out[key] = snap ? { x: snapToGrid(o.x + dx), y: snapToGrid(o.y + dy) } : { x: o.x + dx, y: o.y + dy };
  }
  return out;
}

export function move(gesture: Gesture, point: Point): { gesture: Gesture; effect: MoveEffect } {
  switch (gesture.kind) {
    case "pan": {
      const moved = gesture.moved || passed(gesture.start, point);
      const next = { ...gesture, moved };
      if (!moved) return { gesture: next, effect: null };
      const viewport = {
        ...gesture.origin,
        x: gesture.origin.x + point.x - gesture.start.x,
        y: gesture.origin.y + point.y - gesture.start.y,
      };
      return { gesture: next, effect: { type: "viewport", viewport } };
    }
    case "drag": {
      const moved = gesture.moved || passed(gesture.start, point);
      const next = { ...gesture, moved };
      return { gesture: next, effect: moved ? { type: "positions", positions: dragPositions(next, point, false) } : null };
    }
    case "lasso": {
      const next = { ...gesture, current: point };
      return { gesture: next, effect: { type: "lasso", rect: normalizeRect(gesture.start, point) } };
    }
    default:
      return { gesture, effect: null };
  }
}

export type ReleaseEffect =
  | { type: "drop"; positions: Record<string, Point> }
  | { type: "click-card"; key: string; additive: boolean }
  | { type: "click-background" }
  | { type: "lasso-end"; rect: Rect }
  | { type: "pan-end"; viewport: Viewport }
  | null;

export function release(gesture: Gesture, point: Point): ReleaseEffect {
  switch (gesture.kind) {
    case "drag":
      return gesture.moved
        ? { type: "drop", positions: dragPositions(gesture, point, true) }
        : { type: "click-card", key: gesture.pressed, additive: gesture.additive };
    case "pan":
      return gesture.moved
        ? {
            type: "pan-end",
            viewport: {
              ...gesture.origin,
              x: gesture.origin.x + point.x - gesture.start.x,
              y: gesture.origin.y + point.y - gesture.start.y,
            },
          }
        : { type: "click-background" };
    case "lasso":
      return { type: "lasso-end", rect: normalizeRect(gesture.start, point) };
    default:
      return null;
  }
}

export function wheel(
  v: Viewport,
  e: { deltaX: number; deltaY: number; ctrlKey: boolean; metaKey: boolean; point: Point }
): Viewport {
  // macOS trackpad pinch arrives as a wheel event with ctrlKey set.
  if (e.ctrlKey || e.metaKey) return zoomAt(v, Math.exp(-e.deltaY * WHEEL_ZOOM_RATE), e.point);
  return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
}

export type KeyAction =
  | { type: "focusMove"; dir: Direction }
  | { type: "nudge"; dx: number; dy: number }
  | { type: "open" }
  | { type: "toggleSelect" }
  | { type: "clearSelection" }
  | { type: "remove" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "resetView" };

const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
const STEP: Record<Direction, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export function keyAction(
  e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  onCard: boolean
): KeyAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const dir = ARROWS[e.key];
  if (dir && onCard) {
    if (e.shiftKey) return { type: "nudge", dx: STEP[dir][0] * GRID, dy: STEP[dir][1] * GRID };
    return { type: "focusMove", dir };
  }
  if (e.key === "+" || e.key === "=") return { type: "zoomIn" };
  if (e.key === "-") return { type: "zoomOut" };
  if (e.key === "0") return { type: "resetView" };
  if (e.key === "Escape") return { type: "clearSelection" };
  if (!onCard) return null;
  if (e.key === "Enter") return { type: "open" };
  if (e.key === " ") return { type: "toggleSelect" };
  if (e.key === "Delete" || e.key === "Backspace") return { type: "remove" };
  return null;
}
```

Expected values in the drag test: the scale is 2, so a 21 px move is 10.5 world units, giving x = 20.5 (snapped 24) and y = 14.5 (snapped 16).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/tableGestures.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/table/tableGestures.ts test/components/tableGestures.test.js
git commit -m "feat(table): pointer, wheel and keyboard rules as pure state machines"
```

---

### Task 15: `TableCanvas`, `TableCard` and canvas CSS

**Files:**
- Create: `src/components/table/TableCard.tsx`
- Create: `src/components/table/TableCanvas.tsx`
- Modify: `src/index.css`:
  - `@theme` (`:7`): `--color-table-dot`, `--color-table-connector`;
  - `.dark` (`:113`): the same two tokens;
  - a new "The Table" rule block at the end of the file.
- Test: `test/components/tableCanvas.test.js`

**Interfaces:**
- Consumes Tasks 12–14 and `TableCardModel`. It also consumes `--color-agent-brand` (`index.css:19`, the violet chat rail), `--color-ring` (selection and focus) and `--motion-spring-snap` (Plan 01).
- Produces:

  ```ts
  export interface TableCardProps {
    card: TableCardModel;
    selected: boolean;
    focusable: boolean;          // roving tabindex: exactly one card has tabIndex 0
    dragging: boolean;
    snapping: boolean;
    expanded: boolean;
    onMeasure: (key: string, h: number) => void;
  }
  export function TableCard(props: TableCardProps): JSX.Element;

  export interface TableCanvasProps {
    cards: TableCardModel[];
    edges: Array<{ a: string; b: string }>;
    viewport: Viewport;
    selection: string[];
    focused: string | null;
    expanded: string | null;
    label: string;
    onViewport: (v: Viewport, persist: boolean) => void;
    onMove: (positions: Record<string, Point>) => void;
    onDrop: (positions: Record<string, Point>) => void;
    onClickCard: (key: string, additive: boolean) => void;
    onSelect: (keys: string[]) => void;
    onFocus: (key: string | null) => void;
    onOpen: (key: string) => void;
    onRemove: (keys: string[]) => void;
    onNudge: (keys: string[], dx: number, dy: number) => void;
    onMeasure: (key: string, h: number) => void;
    onDropRef?: (key: string, world: Point) => void;   // inbox drag-and-drop target
    onResize?: (size: Size) => void;                   // lets TableView anchor zoom and fit on the real size
  }
  export function TableCanvas(props: TableCanvasProps): JSX.Element;
  ```

- The canvas is a `role="listbox"` with `aria-multiselectable="true"`, `aria-roledescription={t("table.canvasRole")}` and `aria-label={label}`. Cards are `role="option"` with `aria-selected`. This is a spatial listbox: arrows move by geometry, not by order.

- [ ] **Step 1: Write the failing test**

Create `test/components/tableCanvas.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const repoRoot = path.join(__dirname, "../..");
const load = () => import("../../src/components/table/TableCanvas.tsx");
const card = (key, kind, x, y, extra = {}) => {
  const [type, id] = key.split(":");
  return {
    key,
    placed: true,
    z: 0,
    rect: { x, y, w: 280, h: 150 },
    entity: { ref: { type, id: Number(id) }, kind, title: `T${id}`, excerpt: "body text", at: "2026-10-14 10:00:00", durationMs: 9000, participants: ["Maya Chen"], hrefs: [], noteId: null, layout: null, ...extra },
  };
};
const noop = () => {};
const props = (over = {}) => ({
  cards: [card("note:1", "note", 32, 32), card("chat:2", "chat", 400, 32), card("note:3", "meeting", 9000, 9000)],
  edges: [{ a: "chat:2", b: "note:1" }],
  viewport: { x: 0, y: 0, scale: 1 },
  selection: ["chat:2"],
  focused: null,
  expanded: null,
  label: "Canvas: Work",
  onViewport: noop, onMove: noop, onDrop: noop, onClickCard: noop, onSelect: noop, onFocus: noop,
  onOpen: noop, onRemove: noop, onNudge: noop, onMeasure: noop,
  ...over,
});

test("the canvas is a labelled multiselect listbox with a transformed world", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(TableCanvas, props({ viewport: { x: 12, y: -8, scale: 0.5 } }));
  assert.match(html, /role="listbox"[^>]*aria-multiselectable="true"[^>]*aria-roledescription="table\.canvasRole"[^>]*aria-label="Canvas: Work"/);
  assert.match(html, /class="table-world"[^>]*style="transform:translate3d\(12px, -8px, 0\) scale\(0\.5\)"/);
});

test("cards are options with selection state, kind and a single tab stop", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(TableCanvas, props());
  assert.match(html, /role="option"[^>]*aria-selected="false"[^>]*tabindex="0"[^>]*data-card-key="note:1"[^>]*data-kind="note"/);
  assert.match(html, /role="option"[^>]*aria-selected="true"[^>]*tabindex="-1"[^>]*data-card-key="chat:2"[^>]*data-kind="chat"/);
  assert.equal((html.match(/tabindex="0"/g) || []).length, 2, "one card plus the canvas itself");
});

test("cards far outside 1.5x the viewport are not rendered unless focused", async () => {
  const { TableCanvas } = await load();
  assert.doesNotMatch(renderStatic(TableCanvas, props()), /data-card-key="note:3"/);
  assert.match(renderStatic(TableCanvas, props({ focused: "note:3" })), /data-card-key="note:3"/);
});

test("connectors are drawn between rendered cards only", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(TableCanvas, props({ edges: [{ a: "chat:2", b: "note:1" }, { a: "note:1", b: "note:3" }] }));
  // Card icons are Lucide SVGs with their own <path>s, so count inside the connector layer only.
  const svg = html.match(/<svg class="table-connectors"[\s\S]*?<\/svg>/)[0];
  assert.equal((svg.match(/<path /g) || []).length, 1);
  assert.match(html, /class="table-connectors"[^>]*aria-hidden="true"/);
});

test("meeting cards show initials, durations and the kind label", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(TableCanvas, props({ cards: [card("note:4", "meeting", 0, 0)] }));
  assert.match(html, /table\.kind\.meeting/);
  assert.match(html, />MC</);
  assert.match(html, />00:09</);
});

test("CSS: physical world, reduced motion drops the spring, tokens meet 3:1", async () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  assert.match(css, /\.table-world\s*\{[^}]*left:\s*0;[^}]*transform-origin:\s*0 0;/);
  assert.match(css, /\.table-card\[data-snapping="true"\]\s*\{[^}]*var\(--motion-spring-snap\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.table-card\[data-snapping="true"\]\s*\{\s*transition:\s*none;/);
  assert.match(css, /\.table-card\[data-kind="chat"\]\s*\{[^}]*border-inline-start:[^}]*var\(--color-agent-brand\)/);
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(css);
  for (const [theme, t] of [["light", light], ["dark", dark]]) {
    for (const fg of ["--color-table-connector", "--color-agent-brand"]) {
      assert.ok(contrastRatio(t[fg], t["--color-background"]) >= 3, `${theme} ${fg}`);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/tableCanvas.test.js`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

Create `src/components/table/TableCard.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, MessageSquare, Mic, NotebookPen } from "../icons";
import { formatMmSs } from "../../utils/formatDuration";
import type { TableCardModel } from "./tableModel";
import { plainExcerpt } from "./tableModel";

const KIND_ICON = { note: NotebookPen, meeting: CalendarDays, dictation: Mic, chat: MessageSquare } as const;
const EXCERPT = { note: 200, meeting: 160, dictation: 220, chat: 260 } as const;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

export interface TableCardProps {
  card: TableCardModel;
  selected: boolean;
  focusable: boolean;
  dragging: boolean;
  snapping: boolean;
  expanded: boolean;
  onMeasure: (key: string, h: number) => void;
}

// Cards are DOM, not canvas pixels, so text stays selectable by assistive tech
// and inherits theme, zoom and font settings. The dictation glyph is neutral:
// orange is reserved for live voice (D1).
export function TableCard({ card, selected, focusable, dragging, snapping, expanded, onMeasure }: TableCardProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { entity } = card;
  const Icon = KIND_ICON[entity.kind];
  const kindLabel = t(`table.kind.${entity.kind}`);
  const title = entity.title?.trim() || (entity.kind === "dictation" ? "" : t("table.card.untitled"));
  const excerpt = entity.excerpt
    ? plainExcerpt(entity.excerpt, expanded ? 600 : EXCERPT[entity.kind])
    : entity.kind === "chat"
      ? t("table.card.answerPending")
      : "";

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => onMeasure(card.key, el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [card.key, onMeasure]);

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={focusable ? 0 : -1}
      data-card-key={card.key}
      data-kind={entity.kind}
      data-dragging={dragging ? "true" : undefined}
      data-snapping={snapping ? "true" : undefined}
      aria-label={t("table.card.label", { kind: kindLabel, title: title || excerpt.slice(0, 60) })}
      className="table-card"
      style={{ left: card.rect.x, top: card.rect.y, width: card.rect.w, zIndex: dragging ? 1000 : card.z }}
    >
      <div className="table-card__kind">
        <Icon size={12} aria-hidden="true" />
        <span>{kindLabel}</span>
      </div>
      {title && <h3 className="table-card__title">{title}</h3>}
      {excerpt && <p className="table-card__excerpt">{excerpt}</p>}
      {(entity.durationMs != null || entity.participants.length > 0) && (
        <div className="table-card__meta">
          {entity.participants.length > 0 && (
            <span className="table-card__people" aria-hidden="true">
              {entity.participants.slice(0, 3).map((name) => (
                <span key={name} className="table-card__avatar">
                  {initials(name)}
                </span>
              ))}
            </span>
          )}
          {entity.durationMs != null && <span>{formatMmSs(Math.round(entity.durationMs / 1000))}</span>}
        </div>
      )}
    </div>
  );
}
```

All four icons are exported from `src/components/icons/index.ts` (`CalendarDays` `:18`, `MessageSquare` `:59`, `Mic` `:61`, `NotebookPen` `:71`). `formatMmSs(totalSeconds)` (`src/utils/formatDuration.ts:1`) returns `"00:09"` for 9; the test expects that.

Create `src/components/table/TableCanvas.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent, DragEvent as ReactDragEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_VIEWPORT,
  DOT_GRID,
  connectorPath,
  ensureVisible,
  lassoSelect,
  nearestInDirection,
  screenToWorld,
  visibleIds,
  zoomAt,
  type Point,
  type Rect,
  type Size,
  type Viewport,
} from "./tableGeometry";
import { keyAction, move, press, release, wheel, type Gesture } from "./tableGestures";
import { TableCard } from "./TableCard";
import type { TableCardModel } from "./tableModel";

export const TABLE_REF_MIME = "application/x-loqui-table-ref";
const SNAP_MS = 380;
const ZOOM_STEP = 1.2;

export interface TableCanvasProps {
  cards: TableCardModel[];
  edges: Array<{ a: string; b: string }>;
  viewport: Viewport;
  selection: string[];
  focused: string | null;
  expanded: string | null;
  label: string;
  onViewport: (v: Viewport, persist: boolean) => void;
  onMove: (positions: Record<string, Point>) => void;
  onDrop: (positions: Record<string, Point>) => void;
  onClickCard: (key: string, additive: boolean) => void;
  onSelect: (keys: string[]) => void;
  onFocus: (key: string | null) => void;
  onOpen: (key: string) => void;
  onRemove: (keys: string[]) => void;
  onNudge: (keys: string[], dx: number, dy: number) => void;
  onMeasure: (key: string, h: number) => void;
  onDropRef?: (key: string, world: Point) => void;
  onResize?: (size: Size) => void;
}

export function TableCanvas(props: TableCanvasProps) {
  const { cards, edges, viewport, selection, focused, expanded, label } = props;
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture>({ kind: "idle" });
  const spaceHeld = useRef(false);
  const [size, setSize] = useState<Size>({ width: 1200, height: 800 });
  const [lasso, setLasso] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState<string[]>([]);
  const [snapping, setSnapping] = useState<string[]>([]);
  const onResizeRef = useRef(props.onResize);
  onResizeRef.current = props.onResize;

  const placed = useMemo(() => cards.map((c) => ({ id: c.key, rect: c.rect })), [cards]);
  const byKey = useMemo(() => new Map(cards.map((c) => [c.key, c])), [cards]);
  const always = useMemo(() => [...selection, ...(focused ? [focused] : []), ...dragging], [selection, focused, dragging]);
  const visible = useMemo(() => visibleIds(placed, viewport, size, always), [placed, viewport, size, always]);
  const tabStop = focused && byKey.has(focused) ? focused : (cards[0]?.key ?? null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setSize(next);
      onResizeRef.current?.(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // React's onWheel is passive; zoom must preventDefault to stop page zoom.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const r = el.getBoundingClientRect();
      props.onViewport(
        wheel(viewport, {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          point: { x: event.clientX - r.left, y: event.clientY - r.top },
        }),
        true
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [viewport, props]);

  // Keep DOM focus on the focused card; it is always in the render set.
  useEffect(() => {
    if (!focused) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-card-key="${focused}"]`);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [focused, visible]);

  const local = (event: { clientX: number; clientY: number }): Point => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: event.clientX - (r?.left ?? 0), y: event.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const cardEl = (event.target as HTMLElement).closest<HTMLElement>("[data-card-key]");
    const positions: Record<string, Point> = {};
    for (const c of cards) positions[c.key] = { x: c.rect.x, y: c.rect.y };
    gestureRef.current = press({
      point: local(event),
      cardKey: cardEl?.dataset.cardKey ?? null,
      shift: event.shiftKey,
      spaceHeld: spaceHeld.current,
      viewport,
      selection,
      positions,
    });
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { gesture, effect } = move(gestureRef.current, local(event));
    gestureRef.current = gesture;
    if (!effect) return;
    if (effect.type === "viewport") props.onViewport(effect.viewport, false);
    if (effect.type === "positions") {
      setDragging(Object.keys(effect.positions));
      props.onMove(effect.positions);
    }
    if (effect.type === "lasso") {
      setLasso(effect.rect);
      props.onSelect(lassoSelect(placed, effect.rect, viewport));
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const effect = release(gestureRef.current, local(event));
    gestureRef.current = { kind: "idle" };
    setDragging([]);
    setLasso(null);
    if (!effect) return;
    if (effect.type === "drop") {
      const keys = Object.keys(effect.positions);
      setSnapping(keys);
      setTimeout(() => setSnapping([]), SNAP_MS);
      props.onDrop(effect.positions);
    }
    if (effect.type === "click-card") props.onClickCard(effect.key, effect.additive);
    if (effect.type === "click-background") props.onSelect([]);
    if (effect.type === "pan-end") props.onViewport(effect.viewport, true);
  };

  const zoomBy = useCallback(
    (factor: number) => props.onViewport(zoomAt(viewport, factor, { x: size.width / 2, y: size.height / 2 }), true),
    [props, viewport, size]
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const cardKey = (event.target as HTMLElement).closest<HTMLElement>("[data-card-key]")?.dataset.cardKey ?? null;
    if (event.key === " " && !cardKey) spaceHeld.current = true;
    const action = keyAction(event, cardKey !== null);
    if (!action) return;
    event.preventDefault();
    const targets = cardKey && selection.includes(cardKey) ? selection : cardKey ? [cardKey] : [];
    switch (action.type) {
      case "focusMove": {
        const next = cardKey ? nearestInDirection(cardKey, placed, action.dir) : null;
        if (!next) return;
        props.onFocus(next);
        const rect = byKey.get(next)?.rect;
        if (rect) {
          const v = ensureVisible(rect, viewport, size);
          if (v !== viewport) props.onViewport(v, true);
        }
        return;
      }
      case "nudge":
        return props.onNudge(targets, action.dx, action.dy);
      case "open":
        return cardKey ? props.onOpen(cardKey) : undefined;
      case "toggleSelect":
        return cardKey ? props.onClickCard(cardKey, true) : undefined;
      case "clearSelection":
        return props.onSelect([]);
      case "remove":
        return props.onRemove(targets);
      case "zoomIn":
        return zoomBy(ZOOM_STEP);
      case "zoomOut":
        return zoomBy(1 / ZOOM_STEP);
      case "resetView":
        return props.onViewport(DEFAULT_VIEWPORT, true);
    }
  };

  const onDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (props.onDropRef && event.dataTransfer.types.includes(TABLE_REF_MIME)) event.preventDefault();
  };
  const onDropRef = (event: ReactDragEvent<HTMLDivElement>) => {
    const key = event.dataTransfer.getData(TABLE_REF_MIME);
    if (!key || !props.onDropRef) return;
    event.preventDefault();
    props.onDropRef(key, screenToWorld(local(event), viewport));
  };

  const rendered = cards.filter((c) => visible.has(c.key));

  return (
    <div
      ref={rootRef}
      role="listbox"
      aria-multiselectable="true"
      aria-roledescription={t("table.canvasRole")}
      aria-label={label}
      tabIndex={0}
      className="table-canvas"
      data-panning={gestureRef.current.kind === "pan" ? "true" : undefined}
      style={{
        backgroundSize: `${DOT_GRID * viewport.scale}px ${DOT_GRID * viewport.scale}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === " ") spaceHeld.current = false;
      }}
      onFocus={(event) => {
        const key = (event.target as HTMLElement).closest<HTMLElement>("[data-card-key]")?.dataset.cardKey;
        if (key && key !== focused) props.onFocus(key);
      }}
      onDoubleClick={(event) => {
        // Pointer capture retargets click/dblclick to the root, so hit-test the point instead.
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        const key = hit?.closest<HTMLElement>("[data-card-key]")?.dataset.cardKey;
        if (key) props.onOpen(key);
      }}
      onDragOver={onDragOver}
      onDrop={onDropRef}
    >
      <div
        className="table-world"
        style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})` }}
      >
        <svg className="table-connectors" aria-hidden="true">
          {edges
            .filter((e) => visible.has(e.a) && visible.has(e.b))
            .map((e) => (
              <path key={`${e.a}|${e.b}`} d={connectorPath(byKey.get(e.a)!.rect, byKey.get(e.b)!.rect)} />
            ))}
        </svg>
        {rendered.map((card) => (
          <TableCard
            key={card.key}
            card={card}
            selected={selection.includes(card.key)}
            focusable={card.key === tabStop}
            dragging={dragging.includes(card.key)}
            snapping={snapping.includes(card.key)}
            expanded={expanded === card.key}
            onMeasure={props.onMeasure}
          />
        ))}
      </div>
      {lasso && (
        <div
          className="table-lasso"
          style={{ left: lasso.x, top: lasso.y, width: lasso.w, height: lasso.h }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
```

The lasso overlay uses physical `left`/`top`, because it shares the canvas's physical coordinate space. That is intended (see Global Constraints, RTL).

In `src/index.css`:
- Add to `@theme` after `--color-confidence-low` (or after `--color-accent-foreground` if Part A was gated off):

  ```css
    /* The Table (WS-M5): decorative dot grid; connectors are non-text UI (≥3:1). */
    --color-table-dot: #dcd7d9;
    --color-table-connector: #8a8a8a;
  ```

- Add to `.dark`:

  ```css
    --color-table-dot: #3a2832;
    --color-table-connector: #8f7d87;
  ```

- Append at the end of the file:

  ```css
  /* The Table (WS-M5, Labs). The world is physical like a map; only chrome
     (toolbar, inbox, selection bar) uses logical properties. */
  .table-canvas {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    touch-action: none;
    cursor: grab;
    background-color: var(--color-background);
    background-image: radial-gradient(circle, var(--color-table-dot) 1px, transparent 1.3px);
  }
  .table-canvas[data-panning="true"] {
    cursor: grabbing;
  }
  .table-canvas:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: -2px;
  }
  .table-world {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    will-change: transform;
  }
  .table-connectors {
    position: absolute;
    left: 0;
    top: 0;
    width: 1px;
    height: 1px;
    overflow: visible;
    pointer-events: none;
  }
  .table-connectors path {
    fill: none;
    stroke: var(--color-table-connector);
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
  }
  .table-card {
    position: absolute;
    padding: 12px 14px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: var(--color-card);
    color: var(--color-card-foreground);
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.06),
      0 8px 20px -12px rgb(0 0 0 / 0.25);
    cursor: grab;
    user-select: none;
  }
  .table-card[data-kind="chat"] {
    border-inline-start: 3px solid var(--color-agent-brand);
  }
  .table-card[aria-selected="true"] {
    outline: 2px solid var(--color-ring);
    outline-offset: 1px;
  }
  .table-card:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 3px;
  }
  .table-card[data-dragging="true"] {
    cursor: grabbing;
    box-shadow: 0 18px 38px -12px rgb(0 0 0 / 0.4);
  }
  .table-card[data-snapping="true"] {
    transition:
      left 380ms var(--motion-spring-snap),
      top 380ms var(--motion-spring-snap);
  }
  .table-card__kind {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 5px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }
  .table-card__title {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 600;
  }
  .table-card__excerpt {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--color-muted-foreground);
  }
  .table-card__meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--color-muted-foreground);
  }
  .table-card__people {
    display: inline-flex;
  }
  .table-card__avatar {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    margin-inline-end: -4px;
    border: 1px solid var(--color-card);
    border-radius: 999px;
    background: var(--color-muted);
    font-size: 9px;
    font-weight: 700;
  }
  .table-lasso {
    position: absolute;
    border: 1px solid var(--color-ring);
    background: color-mix(in srgb, var(--color-ring) 10%, transparent);
    pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .table-card[data-snapping="true"] {
      transition: none;
    }
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/tableCanvas.test.js test/components/motionTokens.test.js && npm run typecheck`
Expected: PASS. If the `--color-agent-brand` light check fails (its expected ratio on `#ffffff` is about 3.03), darken the token only in this plan's scope by adding `--color-table-chat-rail: #7070ef` to `@theme` and `.dark`. Use it in the `.table-card[data-kind="chat"]` rule and in the test instead of `--color-agent-brand`.

- [ ] **Step 5: Commit**

```bash
git add src/components/table/TableCard.tsx src/components/table/TableCanvas.tsx src/index.css test/components/tableCanvas.test.js
git commit -m "feat(table): DOM cards on a pannable, zoomable, virtualised canvas"
```

---

### Task 16: `TableView` — board hook, inbox tray, selection bar, and the Space's chat

**Files:**
- Create: `src/components/table/useTableBoard.ts`
- Create: `src/components/table/TableInbox.tsx`
- Create: `src/components/table/TableSelectionBar.tsx`
- Create: `src/components/table/TableView.tsx`
- Modify: `src/hooks/useContainerChat.ts` (`UseContainerChatOptions` at `:13-17`, the destructure at `:43-47`, `noteContext` at `:75`)
- Modify: `src/locales/*/translation.json` (the `table.*` keys)
- Test: `test/components/tableView.test.js`

**Interfaces:**
- Consumes Tasks 11–15. It consumes `useContainerChat` and `OverviewAskSection` (`src/components/notes/overview/OverviewAskSection.tsx`, props as at `ContainerOverview.tsx:129-139`). It consumes `window.electronAPI.saveNote(title, content, noteType, sourceFile, audioDuration, folderId, spaceId)` (`preload.js:224`) and `window.electronAPI.onTranscriptionAdded(cb)` (`preload.js:345-363`).
- Produces:
  - `useContainerChat({ space, folder, notes, contextOverride?: string | null })`. When `contextOverride` is set, it replaces the container context sent with each message.
  - `useTableBoard(spaceId: number)`, which returns:

    ```ts
    {
      state: TableState; cards: TableCardModel[]; edges: Array<{ a: string; b: string }>;
      dispatch: React.Dispatch<TableAction>; reload: () => Promise<void>;
      place: (placements: TablePlacement[]) => Promise<boolean>;
      hide: (keys: string[]) => Promise<void>;
      link: (a: TableEntityRef, b: TableEntityRef) => Promise<void>;
      setViewport: (v: Viewport, persist: boolean) => void;
      status: "idle" | "full" | "saveFailed";
    }
    ```

  - `TableInbox({ entities, onPlace }: { entities: TableEntity[]; onPlace: (key: string) => void })`
  - `TableSelectionBar({ count, onSummarise, onAsk, onGroup, onRemove, busy }: { count: number; …; busy: boolean })`
  - `export default function TableView({ space, onOpenNote, viewSwitch }: { space: SpaceItem; onOpenNote: (noteId: number) => void; viewSwitch: React.ReactNode })`

- [ ] **Step 1: Write the failing test**

Create `test/components/tableView.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const repoRoot = path.join(__dirname, "../..");
const inboxEntity = { ref: { type: "dictation", id: 9 }, kind: "dictation", title: null, excerpt: "Remind me to send it", at: "2026-10-14 16:02:00", durationMs: 4000, participants: [], hrefs: [], noteId: null, layout: null };

async function render(t, file, exportName, props, mocks = {}) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-table-view-test-", mockModules: mocks });
  const mod = await vite.ssrLoadModule(file);
  return renderToStaticMarkup(createElement(mod[exportName], props));
}

test("the inbox tray lists captures as keyboard-placeable, draggable buttons", async (t) => {
  const html = await render(t, "/components/table/TableInbox.tsx", "TableInbox", { entities: [inboxEntity], onPlace() {} });
  assert.match(html, /<aside[^>]*aria-label="table\.inbox\.title"/);
  assert.match(html, /<button[^>]*draggable="true"[^>]*data-ref="dictation:9"[^>]*>/);
  assert.match(html, /Remind me to send it/);
});

test("an empty inbox says so", async (t) => {
  const html = await render(t, "/components/table/TableInbox.tsx", "TableInbox", { entities: [], onPlace() {} });
  assert.match(html, /table\.inbox\.empty/);
});

test("the selection bar is a toolbar with the four CCR-5 actions and no Delete", async (t) => {
  const html = await render(t, "/components/table/TableSelectionBar.tsx", "TableSelectionBar", {
    count: 3, busy: false, onSummarise() {}, onAsk() {}, onGroup() {}, onRemove() {},
  });
  assert.match(html, /role="toolbar"/);
  for (const k of ["count", "summarise", "ask", "group", "remove"]) assert.match(html, new RegExp(`table\\.selection\\.${k}`));
  assert.doesNotMatch(html, /delete/i);
});

test("TableView composes toolbar, canvas, inbox and a live status region", async (t) => {
  const html = await render(
    t,
    "/components/table/TableView.tsx",
    "default",
    { space: { id: 1, name: "Work", kind: "private" }, onOpenNote() {}, viewSwitch: createElement("span", null, "SWITCH") },
    {
      // Suffix match on the import source: TableView imports "./useTableBoard".
      "/useTableBoard": `
        export function useTableBoard() {
          return {
            state: { board: { spaceId: 1, cards: [], inbox: ${JSON.stringify([inboxEntity])}, links: [], viewport: null, truncated: true },
                     measured: {}, overrides: {}, selection: [], focused: null, viewport: { x: 0, y: 0, scale: 1 } },
            cards: [], edges: [], dispatch() {}, reload: async () => {}, place: async () => true,
            hide: async () => {}, link: async () => {}, setViewport() {}, status: "idle",
          };
        }`,
      "/hooks/useContainerChat": `
        export function useContainerChat() {
          return { messages: [], agentState: "idle", sendMessage: async () => {}, cancelStream() {}, conversations: [],
                   activeConversationId: null, switchConversation: async () => {}, startNewChat() {} };
        }`,
      "/overview/OverviewAskSection": `export function OverviewAskSection() { return null; }`,
    }
  );
  assert.match(html, /SWITCH/);
  assert.match(html, /role="toolbar"[^>]*aria-label="table\.view\.label"/);
  assert.match(html, /table\.zoomOut/);
  assert.match(html, /table\.resetView/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /table\.inbox\.title/);
  assert.match(html, /role="status"[^>]*aria-live="polite"[^>]*>[^<]*table\.status\.truncated/);
});

test("every locale carries the table strings with their placeholders", () => {
  const dir = path.join(repoRoot, "src/locales");
  for (const lang of fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "translation.json")))) {
    const tbl = JSON.parse(fs.readFileSync(path.join(dir, lang, "translation.json"), "utf8")).table;
    assert.ok(tbl, `${lang}.table`);
    assert.match(tbl.canvasLabel, /\{\{space\}\}/, lang);
    assert.match(tbl.zoomLevel, /\{\{percent\}\}/, lang);
    assert.match(tbl.selection.count, /\{\{count\}\}/, lang);
    assert.match(tbl.card.label, /\{\{kind\}\}/, lang);
    for (const k of ["note", "meeting", "dictation", "chat"]) assert.ok(tbl.kind[k], `${lang}.table.kind.${k}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/tableView.test.js`
Expected: FAIL. The modules are not found and `en.table` is missing.

- [ ] **Step 3: Implement**

1. `src/hooks/useContainerChat.ts`:
   - Add `contextOverride?: string | null;` to `UseContainerChatOptions`, and `contextOverride = null,` to the destructure.
   - Pass `noteContext: contextOverride ?? containerContext,` in the `useChatStreaming({...})` call (today `noteContext: containerContext`).
   - Existing callers pass nothing, so their behaviour is unchanged.

2. Create `src/components/table/useTableBoard.ts`:

   ```ts
   import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
   import type { TableEntityRef, TablePlacement } from "../../types/table";
   import type { Viewport } from "./tableGeometry";
   import { parseEntityHref } from "./tableEdges";
   import { cardsFor, deriveEdges, dictationEntityFromItem, initialTableState, tableReducer } from "./tableModel";

   const VIEWPORT_SAVE_MS = 400;

   // All persistence for The Table goes through main (CLAUDE.md). Failures never
   // touch content: a failed placement reloads the board from SQLite.
   export function useTableBoard(spaceId: number) {
     const [state, dispatch] = useReducer(tableReducer, undefined, initialTableState);
     const [status, setStatus] = useState<"idle" | "full" | "saveFailed">("idle");
     const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

     const reload = useCallback(async () => {
       const board = await window.electronAPI?.getTableBoard?.(spaceId);
       if (board) dispatch({ type: "loaded", board });
     }, [spaceId]);

     useEffect(() => {
       void reload();
     }, [reload]);

     useEffect(
       () =>
         window.electronAPI?.onTranscriptionAdded?.((item) => {
           if (item?.status === "completed" && item.text) {
             dispatch({ type: "inboxArrived", entity: dictationEntityFromItem(item) });
           }
         }),
       []
     );

     const place = useCallback(
       async (placements: TablePlacement[]) => {
         if (placements.length === 0) return true;
         try {
           const result = await window.electronAPI?.placeTableCards?.(spaceId, placements);
           if (result?.success) {
             dispatch({ type: "placed", placements });
             setStatus("idle");
             return true;
           }
           setStatus(result && "code" in result && result.code === "TABLE_FULL" ? "full" : "saveFailed");
         } catch {
           setStatus("saveFailed");
         }
         await reload();
         return false;
       },
       [reload, spaceId]
     );

     const hide = useCallback(
       async (keys: string[]) => {
         const refs = keys
           .map((key) => /^(note|dictation|chat):(\d+)$/.exec(key))
           .filter((m): m is RegExpExecArray => !!m)
           .map((m) => ({ type: m[1], id: Number(m[2]) }) as TableEntityRef);
         if (!refs.length) return;
         dispatch({ type: "hidden", keys });
         try {
           await window.electronAPI?.hideTableCards?.(spaceId, refs);
         } catch {
           await reload();
         }
       },
       [reload, spaceId]
     );

     const link = useCallback(
       async (a: TableEntityRef, b: TableEntityRef) => {
         await window.electronAPI?.linkTableCards?.(spaceId, a, b);
       },
       [spaceId]
     );

     const setViewport = useCallback(
       (viewport: Viewport, persist: boolean) => {
         dispatch({ type: "viewport", viewport });
         if (!persist) return;
         if (viewportTimer.current) clearTimeout(viewportTimer.current);
         viewportTimer.current = setTimeout(() => {
           void window.electronAPI?.setTableViewport?.(spaceId, viewport);
         }, VIEWPORT_SAVE_MS);
       },
       [spaceId]
     );

     const cards = useMemo(() => cardsFor(state), [state]);
     const edges = useMemo(
       () => deriveEdges(cards, state.board?.links ?? [], parseEntityHref),
       [cards, state.board?.links]
     );

     return { state, cards, edges, dispatch, reload, place, hide, link, setViewport, status };
   }
   ```

3. Create `src/components/table/TableInbox.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import type { TableEntity } from "../../types/table";
   import { TABLE_REF_MIME } from "./TableCanvas";
   import { plainExcerpt, refKey } from "./tableModel";

   export function TableInbox({ entities, onPlace }: { entities: TableEntity[]; onPlace: (key: string) => void }) {
     const { t } = useTranslation();
     return (
       <aside className="table-inbox" aria-label={t("table.inbox.title")}>
         <h2 className="table-inbox__title">{t("table.inbox.title")}</h2>
         <p className="table-inbox__hint">{t("table.inbox.description")}</p>
         {entities.length === 0 ? (
           <p className="table-inbox__hint">{t("table.inbox.empty")}</p>
         ) : (
           <ul className="table-inbox__list">
             {entities.map((e) => {
               const key = refKey(e.ref);
               return (
                 <li key={key}>
                   <button
                     type="button"
                     draggable="true"
                     data-ref={key}
                     className="table-inbox__item"
                     onClick={() => onPlace(key)}
                     onDragStart={(event) => {
                       event.dataTransfer.setData(TABLE_REF_MIME, key);
                       event.dataTransfer.effectAllowed = "move";
                     }}
                   >
                     <span className="table-inbox__kind">{t(`table.kind.${e.kind}`)}</span>
                     <span>{e.title?.trim() || plainExcerpt(e.excerpt, 90)}</span>
                   </button>
                 </li>
               );
             })}
           </ul>
         )}
       </aside>
     );
   }
   ```

4. Create `src/components/table/TableSelectionBar.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { Button } from "../ui/button";

   export interface TableSelectionBarProps {
     count: number;
     busy: boolean;
     onSummarise: () => void;
     onAsk: () => void;
     onGroup: () => void;
     onRemove: () => void;
   }

   // CCR-5: nothing here deletes content. Summarise and Ask go through the
   // Space's own chat, so the route, its locality and Sealed mode all apply.
   export function TableSelectionBar({ count, busy, onSummarise, onAsk, onGroup, onRemove }: TableSelectionBarProps) {
     const { t } = useTranslation();
     return (
       <div role="toolbar" aria-label={t("table.selection.count", { count })} className="table-selbar">
         <span className="table-selbar__count">{t("table.selection.count", { count })}</span>
         <Button size="sm" variant="ghost" className="table-selbar__machine" disabled={busy} onClick={onSummarise}>
           {t("table.selection.summarise")}
         </Button>
         <Button size="sm" variant="ghost" disabled={busy} onClick={onAsk}>
           {t("table.selection.ask")}
         </Button>
         <Button size="sm" variant="ghost" disabled={busy} onClick={onGroup}>
           {t("table.selection.group")}
         </Button>
         <Button size="sm" variant="ghost" onClick={onRemove}>
           {t("table.selection.remove")}
         </Button>
       </div>
     );
   }
   ```

   `Button` has `variant="ghost"` (`src/components/ui/button.tsx:82`) and `size="sm"` (`:112`). If Plan 01 renamed them, use the equivalents. Never use `variant="live"` here: these are not voice controls (D1).

5. Create `src/components/table/TableView.tsx`:

   ```tsx
   import { useEffect, useMemo, useRef, useState } from "react";
   import type { ReactNode } from "react";
   import { useTranslation } from "react-i18next";
   import { useContainerChat } from "../../hooks/useContainerChat";
   import type { NoteItem, SpaceItem } from "../../types/electron";
   import type { TableEntityRef } from "../../types/table";
   import { OverviewAskSection } from "../notes/overview/OverviewAskSection";
   import { Button } from "../ui/button";
   import { TableCanvas } from "./TableCanvas";
   import { TableInbox } from "./TableInbox";
   import { TableSelectionBar } from "./TableSelectionBar";
   import { fitViewport, screenToWorld, snapToGrid, zoomAt, type Point } from "./tableGeometry";
   import { buildGroupedNote, buildSelectionContext, parseRefKey, placementsFor } from "./tableModel";
   import { useTableBoard } from "./useTableBoard";

   const BOARD_CONTEXT_ITEMS = 12;
   // The Table sends its own context; a stable empty list keeps useContainerChat's memo quiet.
   const NO_NOTES: NoteItem[] = [];
   const RELOAD_AFTER_CHAT_MS = 600;

   interface PendingResult { sources: string[]; at: Point }

   export default function TableView({
     space,
     onOpenNote,
     viewSwitch,
   }: {
     space: SpaceItem;
     onOpenNote: (noteId: number) => void;
     viewSwitch: ReactNode;
   }) {
     const { t } = useTranslation();
     const board = useTableBoard(space.id);
     const { state, cards, edges, dispatch } = board;
     const [askOpen, setAskOpen] = useState(false);
     const [expanded, setExpanded] = useState<string | null>(null);
     const [busy, setBusy] = useState(false);
     const pending = useRef<PendingResult | null>(null);
     const canvasSize = useRef({ width: 1200, height: 800 });

     const selected = useMemo(
       () => cards.filter((c) => state.selection.includes(c.key)).map((c) => c.entity),
       [cards, state.selection]
     );
     const context = useMemo(
       () => buildSelectionContext(space.name, selected.length ? selected : cards.slice(0, BOARD_CONTEXT_ITEMS).map((c) => c.entity)),
       [cards, selected, space.name]
     );
     const chat = useContainerChat({ space, folder: null, notes: NO_NOTES, contextOverride: context });

     // An answer created from the table becomes a card below its sources, linked to them.
     useEffect(() => {
       const result = pending.current;
       if (!result || chat.activeConversationId == null) return;
       pending.current = null;
       const chatRef: TableEntityRef = { type: "chat", id: chat.activeConversationId };
       void (async () => {
         await board.place([{ ...chatRef, x: result.at.x, y: result.at.y }]);
         for (const key of result.sources) {
           const ref = parseRefKey(key);
           if (ref) await board.link(ref, chatRef);
         }
         await board.reload();
       })();
     }, [board, chat.activeConversationId]);

     // Answers stream in; refresh the card's excerpt once the chat settles.
     useEffect(() => {
       const id = setTimeout(() => void board.reload(), RELOAD_AFTER_CHAT_MS);
       return () => clearTimeout(id);
     }, [board.reload, chat.messages.length, chat.agentState]);

     const belowSelection = (): Point => {
       const rects = cards.filter((c) => state.selection.includes(c.key)).map((c) => c.rect);
       if (!rects.length) return screenToWorld({ x: canvasSize.current.width / 2, y: canvasSize.current.height / 2 }, state.viewport);
       const cx = rects.reduce((sum, r) => sum + r.x + r.w / 2, 0) / rects.length;
       const bottom = Math.max(...rects.map((r) => r.y + r.h));
       return { x: snapToGrid(cx - 140), y: snapToGrid(bottom + 40) };
     };

     const summarise = async () => {
       setBusy(true);
       pending.current = { sources: [...state.selection], at: belowSelection() };
       setAskOpen(true);
       chat.startNewChat();
       try {
         await chat.sendMessage(t("table.selection.summarisePrompt"));
       } finally {
         setBusy(false);
       }
     };

     const group = async () => {
       setBusy(true);
       try {
         const { title, content } = buildGroupedNote(selected, {
           title: t("table.groupedNote.title"),
           untitled: t("table.card.untitled"),
           kind: {
             note: t("table.kind.note"),
             meeting: t("table.kind.meeting"),
             dictation: t("table.kind.dictation"),
             chat: t("table.kind.chat"),
           },
         });
         const saved = await window.electronAPI.saveNote(title, content, "personal", null, null, null, space.id);
         if (saved?.note) {
           const noteRef: TableEntityRef = { type: "note", id: saved.note.id };
           const at = belowSelection();
           await board.place([{ ...noteRef, x: at.x, y: at.y }]);
           for (const e of selected) await board.link(e.ref, noteRef);
           await board.reload();
         }
       } finally {
         setBusy(false);
       }
     };

     const open = (key: string) => {
       const ref = parseRefKey(key);
       if (!ref) return;
       if (ref.type === "note") onOpenNote(ref.id);
       else if (ref.type === "chat") {
         setAskOpen(true);
         void chat.switchConversation(ref.id);
       } else setExpanded((current) => (current === key ? null : key));
     };

     const placeFromInbox = (key: string, world?: Point) => {
       const ref = parseRefKey(key);
       if (!ref) return;
       const at = world ?? screenToWorld({ x: canvasSize.current.width / 2, y: canvasSize.current.height / 2 }, state.viewport);
       void board.place([{ ...ref, x: snapToGrid(at.x), y: snapToGrid(at.y) }]);
     };

     const status =
       board.status === "full"
         ? t("table.status.full")
         : board.status === "saveFailed"
           ? t("table.status.saveFailed")
           : state.board?.truncated
             ? t("table.status.truncated")
             : "";

     return (
       <div className="table-view">
         <div role="toolbar" aria-label={t("table.view.label")} className="table-toolbar">
           {viewSwitch}
           <Button size="sm" variant="ghost" aria-label={t("table.zoomOut")} onClick={() => board.setViewport(zoomAt(state.viewport, 1 / 1.2, { x: canvasSize.current.width / 2, y: canvasSize.current.height / 2 }), true)}>
             −
           </Button>
           <span className="table-toolbar__zoom">{t("table.zoomLevel", { percent: Math.round(state.viewport.scale * 100) })}</span>
           <Button size="sm" variant="ghost" aria-label={t("table.zoomIn")} onClick={() => board.setViewport(zoomAt(state.viewport, 1.2, { x: canvasSize.current.width / 2, y: canvasSize.current.height / 2 }), true)}>
             +
           </Button>
           <Button size="sm" variant="ghost" onClick={() => board.setViewport(fitViewport(cards.map((c) => c.rect), canvasSize.current), true)}>
             {t("table.resetView")}
           </Button>
           <span className="table-toolbar__hint">{t("table.hint")}</span>
           <Button size="sm" variant="ghost" className="ms-auto" aria-expanded={askOpen} onClick={() => setAskOpen((v) => !v)}>
             {t(askOpen ? "table.ask.close" : "table.ask.open")}
           </Button>
         </div>
         <p role="status" aria-live="polite" className="table-status">{status}</p>
         <div className="table-body">
           <TableInbox entities={state.board?.inbox ?? []} onPlace={(key) => placeFromInbox(key)} />
           <TableCanvas
             cards={cards}
             edges={edges}
             viewport={state.viewport}
             selection={state.selection}
             focused={state.focused}
             expanded={expanded}
             label={t("table.canvasLabel", { space: space.name })}
             onViewport={board.setViewport}
             onMove={(positions) => dispatch({ type: "moved", positions })}
             onDrop={(positions) => void board.place(placementsFor(state, Object.keys(positions), positions))}
             onClickCard={(key, additive) => dispatch({ type: "clickCard", key, additive })}
             onSelect={(keys) => dispatch({ type: "select", keys })}
             onFocus={(key) => dispatch({ type: "focus", key })}
             onOpen={open}
             onRemove={(keys) => void board.hide(keys)}
             onNudge={(keys, dx, dy) => {
               const positions = Object.fromEntries(
                 cards.filter((c) => keys.includes(c.key)).map((c) => [c.key, { x: c.rect.x + dx, y: c.rect.y + dy }])
               );
               void board.place(placementsFor(state, keys, positions));
             }}
             onMeasure={(key, h) => dispatch({ type: "measured", key, h })}
             onDropRef={(key, world) => placeFromInbox(key, world)}
             onResize={(size) => {
               canvasSize.current = size;
             }}
           />
           {askOpen && (
             <aside className="table-ask" aria-label={t("table.ask.open")}>
               <OverviewAskSection
                 messages={chat.messages}
                 agentState={chat.agentState}
                 onTextSubmit={chat.sendMessage}
                 onCancel={chat.cancelStream}
                 conversations={chat.conversations}
                 activeConversationId={chat.activeConversationId}
                 onSwitchConversation={chat.switchConversation}
                 onNewChat={chat.startNewChat}
                 onOpenNote={onOpenNote}
               />
             </aside>
           )}
         </div>
         {state.selection.length > 0 && (
           <TableSelectionBar
             count={state.selection.length}
             busy={busy}
             onSummarise={() => void summarise()}
             onAsk={() => setAskOpen(true)}
             onGroup={() => void group()}
             onRemove={() => void board.hide(state.selection)}
           />
         )}
       </div>
     );
   }
   ```

6. Append to `src/index.css` after the Task 15 block:

   ```css
   .table-view {
     position: relative;
     display: flex;
     flex: 1;
     min-height: 0;
     flex-direction: column;
   }
   .table-toolbar {
     display: flex;
     flex-wrap: wrap;
     align-items: center;
     gap: 8px;
     padding-block: 8px;
     padding-inline: 14px;
   }
   .table-toolbar__zoom {
     min-width: 42px;
     text-align: center;
     font-size: 12px;
     font-variant-numeric: tabular-nums;
   }
   .table-toolbar__hint,
   .table-status {
     font-size: 11.5px;
     color: var(--color-muted-foreground);
   }
   .table-status {
     margin: 0;
     padding-inline: 14px;
     min-height: 1em;
   }
   .table-body {
     position: relative;
     display: flex;
     flex: 1;
     min-height: 0;
     gap: 8px;
     padding: 0 12px 12px;
   }
   .table-inbox {
     width: 220px;
     flex-shrink: 0;
     overflow-y: auto;
     padding: 10px;
     border: 1px solid var(--color-border);
     border-radius: 12px;
     background: var(--color-card);
   }
   .table-inbox__title {
     margin: 0;
     font-size: 12px;
     font-weight: 600;
   }
   .table-inbox__hint {
     margin: 2px 0 8px;
     font-size: 11.5px;
     color: var(--color-muted-foreground);
   }
   .table-inbox__list {
     display: grid;
     gap: 6px;
     margin: 0;
     padding: 0;
     list-style: none;
   }
   .table-inbox__item {
     display: grid;
     gap: 2px;
     width: 100%;
     padding: 8px;
     border: 1px dashed var(--color-border);
     border-radius: 8px;
     background: var(--color-background);
     font-size: 12.5px;
     text-align: start;
     cursor: grab;
   }
   .table-inbox__kind {
     font-size: 10.5px;
     font-weight: 700;
     text-transform: uppercase;
     color: var(--color-muted-foreground);
   }
   .table-ask {
     width: 360px;
     flex-shrink: 0;
     overflow-y: auto;
     border: 1px solid var(--color-border);
     border-radius: 12px;
     background: var(--color-card);
   }
   .table-selbar {
     position: absolute;
     inset-block-end: 24px;
     inset-inline-start: 50%;
     translate: -50% 0;
     display: flex;
     align-items: center;
     gap: 4px;
     height: 40px;
     padding-inline: 10px;
     border: 1px solid var(--color-border);
     border-radius: 999px;
     background: var(--color-popover);
     box-shadow: 0 12px 28px -12px rgb(0 0 0 / 0.35);
   }
   [dir="rtl"] .table-selbar {
     translate: 50% 0;
   }
   .table-selbar__count {
     padding-inline: 6px;
     font-size: 12px;
     font-variant-numeric: tabular-nums;
   }
   .table-selbar__machine {
     color: var(--color-ai-text);
   }
   ```

   Summarise text uses Plan 06's `--color-ai-text` (CR-06-4), because fuchsia means machine-authored (audit M5) and that token is already contrast-tested as text. If `--color-ai-text` is not on `main`, use `--color-accent` (#d90078, 4.97:1 on `#ffffff`). In that case, also check that Plum Night's `--color-accent` reaches 4.5:1 on `--color-popover`, and if it does not, use `--color-confidence-low` for `.dark .table-selbar__machine`.

7. Locales. Add `table.*` to every locale. This script writes each nested key from a flat path list:

   ```bash
   node -e '
   const fs=require("fs"),p=require("path");
   const K=["view.label","view.list","view.table","canvasLabel","canvasRole","zoomIn","zoomOut","resetView","zoomLevel","hint","kind.note","kind.meeting","kind.dictation","kind.chat","card.label","card.untitled","card.answerPending","inbox.title","inbox.description","inbox.empty","selection.count","selection.summarise","selection.ask","selection.group","selection.remove","selection.summarisePrompt","groupedNote.title","status.full","status.truncated","status.saveFailed","ask.open","ask.close"];
   const L={
    en:["View","List","Table","Canvas: {{space}}","canvas","Zoom in","Zoom out","Reset view","{{percent}}%","Drag cards or the background. Shift-drag to select. Ctrl or ⌘ with the wheel zooms. Arrow keys move between cards; Shift with arrows nudges.","Note","Meeting","Dictation","Answer","{{kind}}: {{title}}","Untitled","Waiting for the answer…","Inbox","New captures. Drag one onto the table, or press Enter.","Nothing new","Selected: {{count}}","Summarise","Ask about these","Group into note","Remove from table","Summarise the selected items in a few sentences.","Grouped from the table","The table holds up to 500 cards. Remove some first.","Showing the 500 most recent cards.","Couldn’t save that position. Nothing else changed.","Ask","Close"],
    de:["Ansicht","Liste","Tisch","Leinwand: {{space}}","Leinwand","Vergrößern","Verkleinern","Ansicht zurücksetzen","{{percent}} %","Karten oder den Hintergrund ziehen. Mit Umschalt ziehen, um auszuwählen. Strg oder ⌘ mit dem Mausrad zoomt. Pfeiltasten wechseln zwischen Karten; mit Umschalt verschieben sie.","Notiz","Besprechung","Diktat","Antwort","{{kind}}: {{title}}","Ohne Titel","Warte auf die Antwort …","Eingang","Neue Aufnahmen. Auf den Tisch ziehen oder Eingabe drücken.","Nichts Neues","Ausgewählt: {{count}}","Zusammenfassen","Dazu fragen","Zu Notiz bündeln","Vom Tisch nehmen","Fasse die ausgewählten Elemente in wenigen Sätzen zusammen.","Vom Tisch gebündelt","Der Tisch fasst bis zu 500 Karten. Entferne zuerst einige.","Die 500 neuesten Karten werden angezeigt.","Position konnte nicht gespeichert werden. Sonst hat sich nichts geändert.","Fragen","Schließen"],
    es:["Vista","Lista","Mesa","Lienzo: {{space}}","lienzo","Acercar","Alejar","Restablecer vista","{{percent}} %","Arrastra tarjetas o el fondo. Mayús y arrastrar para seleccionar. Ctrl o ⌘ con la rueda hace zoom. Las flechas cambian de tarjeta; con Mayús la desplazan.","Nota","Reunión","Dictado","Respuesta","{{kind}}: {{title}}","Sin título","Esperando la respuesta…","Bandeja","Capturas nuevas. Arrastra una a la mesa o pulsa Intro.","Nada nuevo","Seleccionadas: {{count}}","Resumir","Preguntar sobre esto","Agrupar en una nota","Quitar de la mesa","Resume los elementos seleccionados en pocas frases.","Agrupado desde la mesa","La mesa admite hasta 500 tarjetas. Quita algunas primero.","Se muestran las 500 tarjetas más recientes.","No se pudo guardar esa posición. No cambió nada más.","Preguntar","Cerrar"],
    fr:["Vue","Liste","Table","Canevas : {{space}}","canevas","Zoom avant","Zoom arrière","Réinitialiser la vue","{{percent}} %","Faites glisser les cartes ou le fond. Maj + glisser pour sélectionner. Ctrl ou ⌘ avec la molette pour zoomer. Les flèches passent d’une carte à l’autre ; avec Maj, elles la déplacent.","Note","Réunion","Dictée","Réponse","{{kind}} : {{title}}","Sans titre","En attente de la réponse…","Boîte de réception","Nouvelles captures. Faites-en glisser une sur la table ou appuyez sur Entrée.","Rien de nouveau","Sélection : {{count}}","Résumer","Poser une question","Regrouper dans une note","Retirer de la table","Résume les éléments sélectionnés en quelques phrases.","Regroupé depuis la table","La table contient au plus 500 cartes. Retirez-en d’abord.","Affichage des 500 cartes les plus récentes.","Impossible d’enregistrer cette position. Rien d’autre n’a changé.","Demander","Fermer"],
    it:["Vista","Elenco","Tavolo","Tela: {{space}}","tela","Ingrandisci","Riduci","Ripristina vista","{{percent}}%","Trascina le schede o lo sfondo. Maiusc e trascina per selezionare. Ctrl o ⌘ con la rotellina per lo zoom. Le frecce passano da una scheda all’altra; con Maiusc la spostano.","Nota","Riunione","Dettatura","Risposta","{{kind}}: {{title}}","Senza titolo","In attesa della risposta…","In arrivo","Nuove acquisizioni. Trascinane una sul tavolo o premi Invio.","Niente di nuovo","Selezionati: {{count}}","Riassumi","Chiedi su questi","Raggruppa in una nota","Togli dal tavolo","Riassumi gli elementi selezionati in poche frasi.","Raggruppato dal tavolo","Il tavolo contiene al massimo 500 schede. Rimuovine prima qualcuna.","Sono mostrate le 500 schede più recenti.","Impossibile salvare la posizione. Nient’altro è cambiato.","Chiedi","Chiudi"],
    pt:["Visualização","Lista","Mesa","Tela: {{space}}","tela","Aproximar","Afastar","Redefinir visualização","{{percent}}%","Arraste cartões ou o fundo. Shift e arrastar para selecionar. Ctrl ou ⌘ com a roda faz zoom. As setas mudam de cartão; com Shift, movem-no.","Nota","Reunião","Ditado","Resposta","{{kind}}: {{title}}","Sem título","Aguardando a resposta…","Entrada","Novas capturas. Arraste uma para a mesa ou pressione Enter.","Nada novo","Selecionados: {{count}}","Resumir","Perguntar sobre estes","Agrupar em uma nota","Tirar da mesa","Resuma os itens selecionados em poucas frases.","Agrupado a partir da mesa","A mesa comporta até 500 cartões. Remova alguns primeiro.","Mostrando os 500 cartões mais recentes.","Não foi possível salvar essa posição. Nada mais mudou.","Perguntar","Fechar"],
    ru:["Вид","Список","Стол","Холст: {{space}}","холст","Увеличить","Уменьшить","Сбросить вид","{{percent}} %","Перетаскивайте карточки или фон. Shift и перетаскивание — выделение. Ctrl или ⌘ с колесом — масштаб. Стрелки переходят между карточками; со Shift — сдвигают её.","Заметка","Встреча","Диктовка","Ответ","{{kind}}: {{title}}","Без названия","Ожидание ответа…","Входящие","Новые записи. Перетащите на стол или нажмите Enter.","Ничего нового","Выбрано: {{count}}","Кратко изложить","Спросить об этом","Собрать в заметку","Убрать со стола","Кратко изложи выбранные элементы в нескольких предложениях.","Собрано со стола","На столе помещается до 500 карточек. Сначала уберите часть.","Показаны 500 последних карточек.","Не удалось сохранить положение. Больше ничего не изменилось.","Спросить","Закрыть"],
    ja:["表示","リスト","テーブル","キャンバス: {{space}}","キャンバス","拡大","縮小","表示をリセット","{{percent}}%","カードや背景をドラッグ。Shift を押しながらドラッグで選択。Ctrl または ⌘ とホイールでズーム。矢印キーでカード間を移動し、Shift と矢印で少しずつ動かします。","メモ","ミーティング","音声入力","回答","{{kind}}: {{title}}","無題","回答を待っています…","受信箱","新しいキャプチャ。テーブルにドラッグするか Enter を押します。","新着なし","選択中: {{count}}","要約","これについて質問","メモにまとめる","テーブルから外す","選択した項目を数文で要約してください。","テーブルからまとめたメモ","テーブルに置けるカードは 500 枚までです。先にいくつか外してください。","最新の 500 枚を表示しています。","その位置を保存できませんでした。ほかには何も変わっていません。","質問","閉じる"],
    "zh-CN":["视图","列表","桌面","画布：{{space}}","画布","放大","缩小","重置视图","{{percent}}%","拖动卡片或背景。按住 Shift 拖动可框选。Ctrl 或 ⌘ 加滚轮可缩放。方向键在卡片间移动；Shift 加方向键可微调位置。","笔记","会议","听写","回答","{{kind}}：{{title}}","无标题","正在等待回答…","收件箱","新的记录。拖到桌面上，或按 Enter。","暂无新内容","已选择：{{count}}","总结","就这些提问","合并为笔记","从桌面移除","用几句话总结所选内容。","从桌面合并","桌面最多容纳 500 张卡片。请先移除一些。","显示最近的 500 张卡片。","无法保存该位置。其他内容均未更改。","提问","关闭"],
    "zh-TW":["檢視","清單","桌面","畫布：{{space}}","畫布","放大","縮小","重設檢視","{{percent}}%","拖曳卡片或背景。按住 Shift 拖曳可框選。Ctrl 或 ⌘ 加滾輪可縮放。方向鍵在卡片間移動；Shift 加方向鍵可微調位置。","筆記","會議","聽寫","回答","{{kind}}：{{title}}","未命名","正在等待回答…","收件匣","新的記錄。拖到桌面上，或按 Enter。","沒有新內容","已選取：{{count}}","摘要","針對這些提問","合併為筆記","從桌面移除","用幾句話摘要所選內容。","從桌面合併","桌面最多可容納 500 張卡片。請先移除一些。","顯示最近的 500 張卡片。","無法儲存該位置。其他內容均未變更。","提問","關閉"],
    ar:["العرض","قائمة","طاولة","لوحة: {{space}}","لوحة","تكبير","تصغير","إعادة ضبط العرض","{{percent}}٪","اسحب البطاقات أو الخلفية. اسحب مع Shift للتحديد. Ctrl أو ⌘ مع العجلة للتكبير. تنتقل الأسهم بين البطاقات، ومع Shift تحرّكها قليلًا.","ملاحظة","اجتماع","إملاء","إجابة","{{kind}}: {{title}}","بلا عنوان","بانتظار الإجابة…","الوارد","التقاطات جديدة. اسحب واحدًا إلى الطاولة أو اضغط Enter.","لا جديد","المحدد: {{count}}","تلخيص","اسأل عن هذه","تجميع في ملاحظة","إزالة من الطاولة","لخّص العناصر المحددة في بضع جمل.","مجمّعة من الطاولة","تتسع الطاولة لـ 500 بطاقة كحد أقصى. أزل بعضها أولًا.","تُعرض أحدث 500 بطاقة.","تعذّر حفظ هذا الموضع. لم يتغير شيء آخر.","اسأل","إغلاق"]};
   for(const [l,vals] of Object.entries(L)){if(vals.length!==K.length)throw new Error(l+" has "+vals.length+" values");const f=p.join("src/locales",l,"translation.json");const j=JSON.parse(fs.readFileSync(f,"utf8"));j.table={};K.forEach((k,i)=>{const parts=k.split(".");let o=j.table;parts.slice(0,-1).forEach((s)=>{o=o[s]=o[s]||{};});o[parts.at(-1)]=vals[i];});fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");}'
   npx prettier --check "src/locales/**/translation.json" || npx prettier --write "src/locales/**/translation.json"
   ```

   The `count` strings take the form "Selected: {{count}}" on purpose. A label shape that never inflects avoids CLDR plural forms (Arabic needs six), which `npm run i18n:check` would otherwise require.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/tableView.test.js test/components/tableCanvas.test.js test/components/tableModel.test.js && npm run i18n:check && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/table src/hooks/useContainerChat.ts src/index.css src/locales test/components/tableView.test.js
git commit -m "feat(table): inbox tray, selection actions and the Space's chat on The Table"
```

---

### Task 17: Entry point — `List | Table` in the Space overview, preview stubs, docs

**Files:**
- Modify: `src/components/notes/overview/ContainerOverview.tsx`:
  - imports (`:1-21`);
  - state, after `:47`;
  - an early return for Table mode before `return (` at `:93`;
  - the header actions row at `:113`.
- Modify: `src/preview/browserPreview.ts` (stubs after `getSpaceNotes` at `:196`)
- Modify: `src/locales/*/translation.json`. No new keys: the switch reuses `table.view.*` from Task 16.
- Modify: `DESIGN.md` (a "The Table (Labs)" subsection), `docs/PRIVACY.md` (local layout storage)
- Test: `test/components/containerOverviewTable.test.js`

**Interfaces:**
- Consumes the `labsTable` setting (Task 2) and `TableView` (Task 16, lazily imported).
- Produces:
  - `TableViewSwitch({ value, onChange }: { value: "list" | "table"; onChange: (v: "list" | "table") => void })`, exported from `ContainerOverview.tsx`: a two-button segmented control with `aria-pressed`.
  - The per-Space view choice, persisted in `localStorage` under `notes.overview.view.<spaceId>`. The default is `"list"`. A missing or unknown value reads as `"list"`. The Table appears only at the Space root (`folder === null`) and only while `labsTable` is on.

- [ ] **Step 1: Write the failing test**

Create `test/components/containerOverviewTable.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function render(t, { labsTable, folder = null, storedView = null }) {
  installBrowserGlobals(t, { initialStorage: storedView ? { "notes.overview.view.1": storedView } : {} });
  globalThis.__overviewSettings = { labsTable };
  t.after(() => delete globalThis.__overviewSettings);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-overview-table-test-",
    mockModules: {
      "/stores/settingsStore": `export const useSettingsStore = (sel) => sel(globalThis.__overviewSettings);`,
      "/hooks/useContainerChat": `export function useContainerChat() { return { messages: [], agentState: "idle", sendMessage: async () => {}, cancelStream() {}, conversations: [], activeConversationId: null, switchConversation: async () => {}, startNewChat() {} }; }`,
      "/stores/noteStore": `
        export const useFolders = () => []; export const useNotes = () => []; export const useNotesByContainer = () => ({});
        export const useFolderCounts = () => ({}); export const useSpaceRootCounts = () => ({});`,
      "/OverviewAskSection": `export function OverviewAskSection() { return null; }`,
      "/OverviewNoteList": `export function OverviewNoteList() { return null; }`,
      "/OverviewExplainerBanner": `export function OverviewExplainerBanner() { return null; }`,
      "/SpaceIconButton": `export function SpaceIconButton() { return null; }`,
      "/ContainerIcon": `export function ContainerIcon() { return null; }`,
      "/table/TableView": `import { createElement } from "react"; export default function TableView(p) { return createElement("div", { "data-table-view": "" }, p.viewSwitch); }`,
    },
  });
  const mod = await vite.ssrLoadModule("/components/notes/overview/ContainerOverview.tsx");
  return renderToStaticMarkup(
    createElement(mod.ContainerOverview, {
      space: { id: 1, name: "Personal", kind: "private" },
      folder,
      onOpenNote() {},
      onNewNote() {},
    })
  );
}

test("with Labs off the overview is unchanged: no view switch", async (t) => {
  const html = await render(t, { labsTable: false });
  assert.doesNotMatch(html, /table\.view\./);
});

test("with Labs on, the Space root offers List | Table, List first by default", async (t) => {
  const html = await render(t, { labsTable: true });
  assert.match(html, /role="group"[^>]*aria-label="table\.view\.label"/);
  assert.match(html, /aria-pressed="true"[^>]*>table\.view\.list</);
  assert.match(html, /aria-pressed="false"[^>]*>table\.view\.table</);
});

test("a remembered Table choice renders The Table with the switch inside it", async (t) => {
  const html = await render(t, { labsTable: true, storedView: "table" });
  assert.match(html, /data-table-view/);
  assert.match(html, /aria-pressed="true"[^>]*>table\.view\.table</);
});

test("folders never offer the Table, and a junk stored value reads as List", async (t) => {
  const folderHtml = await render(t, { labsTable: true, folder: { id: 3, name: "Meetings", space_id: 1, is_default: 1 } });
  assert.doesNotMatch(folderHtml, /table\.view\./);
  const junk = await render(t, { labsTable: true, storedView: "spreadsheet" });
  assert.doesNotMatch(junk, /data-table-view/);
});
```

With `React.lazy`, SSR through `renderToStaticMarkup` cannot resolve a lazy component. For this reason `ContainerOverview` imports `TableView` **statically** when it is rendered in tests. To keep the main bundle lean, `TableView` is lazy-loaded one level up instead, in `ControlPanel`'s existing lazy `PersonalNotesView` chunk (`ControlPanel.tsx:72-80`). Nothing extra is needed: `ContainerOverview` is already inside that chunk.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/containerOverviewTable.test.js`
Expected: FAIL. With Labs on, there is no `table.view.label` group.

- [ ] **Step 3: Implement**

1. `src/components/notes/overview/ContainerOverview.tsx`:
   - Imports. Add:

     ```tsx
     import { useSettingsStore } from "../../../stores/settingsStore";
     import TableView from "../../table/TableView";
     ```

     Change the React import to `import { useEffect, useMemo, useState } from "react";` (it is unchanged if already so).

   - Add above `interface ContainerOverviewProps`:

     ```tsx
     type OverviewView = "list" | "table";
     const viewStorageKey = (spaceId: number) => `notes.overview.view.${spaceId}`;
     const readView = (spaceId: number): OverviewView =>
       typeof localStorage !== "undefined" && localStorage.getItem(viewStorageKey(spaceId)) === "table" ? "table" : "list";

     export function TableViewSwitch({ value, onChange }: { value: OverviewView; onChange: (v: OverviewView) => void }) {
       const { t } = useTranslation();
       return (
         <div role="group" aria-label={t("table.view.label")} className="inline-flex rounded-full bg-surface-3 p-0.5">
           {(["list", "table"] as const).map((v) => (
             <button
               key={v}
               type="button"
               aria-pressed={value === v}
               onClick={() => onChange(v)}
               className={cn(
                 "h-7 rounded-full px-3 text-xs font-medium",
                 value === v ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground"
               )}
             >
               {t(`table.view.${v}`)}
             </button>
           ))}
         </div>
       );
     }
     ```

   - After `const [spaceNotes, setSpaceNotes] = useState<NoteItem[] | null>(null);` (`:47`), add:

     ```tsx
       const labsTable = useSettingsStore((s) => s.labsTable);
       const [view, setView] = useState<OverviewView>(() => readView(space.id));
       const tableAvailable = labsTable && !folder;
       const changeView = (next: OverviewView) => {
         setView(next);
         localStorage.setItem(viewStorageKey(space.id), next);
       };
       const viewSwitch = tableAvailable ? <TableViewSwitch value={view} onChange={changeView} /> : null;
     ```

   - Directly before the component's `return (` (`:93`), add:

     ```tsx
       if (tableAvailable && view === "table") {
         return <TableView space={space} onOpenNote={onOpenNote} viewSwitch={viewSwitch} />;
       }
     ```

   - In the header's `<div className="mt-1 flex items-center gap-2">` (`:113`), render `{viewSwitch}` before the New note button.

   `useContainerChat` is still called above the early return, so the hook order stays stable. The Table builds its own chat with the selection context.

2. `src/preview/browserPreview.ts`. After `getSpaceNotes` (`:196`):

   ```ts
       getTableBoard: async (spaceId) => ({
         spaceId,
         cards: notes.map((note) => ({
           ref: { type: "note", id: note.id },
           kind: note.note_type === "meeting" ? "meeting" : "note",
           title: note.title,
           excerpt: note.content ?? "",
           at: note.updated_at,
           durationMs: null,
           participants: [],
           hrefs: [],
           noteId: null,
           layout: null,
         })),
         inbox: history.slice(0, 3).map((item) => ({
           ref: { type: "dictation", id: item.id },
           kind: "dictation",
           title: null,
           excerpt: item.text,
           at: item.timestamp,
           durationMs: item.audio_duration_ms,
           participants: [],
           hrefs: [],
           noteId: null,
           layout: null,
         })),
         links: [],
         viewport: null,
         truncated: false,
       }),
       placeTableCards: async (_spaceId, placements) => ({ success: true, placed: placements.length }),
       hideTableCards: async (_spaceId, refs) => ({ success: true, hidden: refs.length }),
       linkTableCards: async () => ({ success: true }),
       setTableViewport: async () => ({ success: true }),
   ```

   The fields match `makeNote` (`src/preview/browserPreview.ts:21`: `note_type`, `title`, `content`, `updated_at`) and the preview `history` items (`:92-112`: `id`, `text`, `timestamp`, `audio_duration_ms`).

3. Existing suites that load `ContainerOverview` (`test/components/spaceEmoji.test.js`, `test/components/containerOverviewDefaultFolder.test.js`) now pull in the settings store and the Table graph. Add these two entries to each suite's `mockModules`, so the suites stay isolated from Labs:

   ```js
   "/stores/settingsStore": `export const useSettingsStore = (sel) => sel({ labsTable: false });`,
   "/table/TableView": `export default function TableView() { return null; }`,
   ```

   If a suite already mocks `/stores/settingsStore`, add `labsTable: false` to its state object instead.

4. `DESIGN.md`. Add after the Task 10 subsection:

   ```markdown
   ### The Table (Labs, WS-M5)

   A per-Space canvas, reached from the Space overview's `List | Table` switch when Labs → The Table is on.
   - **World**: physical coordinates like a map (not mirrored in RTL); 24px dot grid; zoom 25–200%; drag snaps to an 8px grid with `--motion-spring-snap` (380ms), instant under reduced motion.
   - **Cards** are DOM: note 280px, meeting 320px (initials + duration), dictation 220px (neutral mic glyph: orange is live voice only, D1), answer 340px with a `--color-agent-brand` inline-start rail. Selection and focus use `--color-ring`.
   - **Connectors**: 1.5px `--color-table-connector` curves from user links, chat-about-note, and note mentions.
   - **A11y**: a spatial listbox. One tab stop; arrows move to the nearest card; Shift+arrows nudge 8px; Space selects; Enter opens; Delete removes from the table (never deletes content).
   - **Inbox**: hidden notes and recent unplaced dictations/answers; drag in or press Enter.
   ```

5. `docs/PRIVACY.md`. Add one sentence to the local-storage section: "With Labs → The Table on, card positions, links and the last view of each space's canvas are stored in the local database. They contain no note text, and removing a card never deletes the note."

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/containerOverviewTable.test.js test/components/spaceEmoji.test.js test/components/containerOverviewDefaultFolder.test.js test/components/tableView.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/notes/overview/ContainerOverview.tsx src/preview/browserPreview.ts DESIGN.md docs/PRIVACY.md test/components/containerOverviewTable.test.js test/components/spaceEmoji.test.js test/components/containerOverviewDefaultFolder.test.js
git commit -m "feat(notes): List | Table switch for a space when Labs is on"
```

---

### Task 18: Whole-plan verification

**Files:** none new. This task runs every check and fixes what it surfaces.

- [ ] **Step 1: Run the full suite and static checks**

```bash
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run format:check
```

Expected: everything passes. A failing pre-existing test may be updated in this branch only when it pins exactly what this plan intentionally changed. Those cases are:
- a `transcribe()` result `deepEqual` that now includes `tokens: []` (Task 5);
- a history-row `deepEqual` that now includes `has_confidence` (Task 6).

Name every such test in the PR description. Any other failure is a regression; fix the code.

- [ ] **Step 2: Flags-off regression check**

With both Labs switches off (the default for a fresh profile), confirm nothing changed:
- Run `npm test -- test/helpers/whisperServerInferenceFields.test.js`. The default request still sends `response_format=json`.
- In the app, dictate once with local Whisper and once with Parakeet. The history row is the plain paragraph, the kebab has no confidence item, and ⌥C does nothing.
- Open Notes → Personal. There is no `List | Table` switch.

- [ ] **Step 3: Visual verification in the desktop app (light and Plum Night)**

Use a fresh test profile. Never use a personal profile.

```bash
npm run native:electron
LOQUI_PROFILE_DIR="$(mktemp -d)" npm run dev
```

Screenshot each of these for the PR:
1. **Settings → System → Labs.** Both switches are present and off. Turn both on.
2. **Confidence with local Whisper.** Dictate "Call Siobhan at four thirty about the Qdrant migration." In History, expand the raw transcript: low-confidence words are lighter with a fuchsia dotted underline, and medium ones have a grey dotted underline.
   - Hover a word: the popover shows the percent, Add to Words, and Play 2 s (with audio retention on).
   - Press `A` on a focused word: it appears in Dictionary.
   - Press ⌥C: the list row toggles. A row whose cleaned text differs from the raw text stays plain in the list.
3. **Confidence with Parakeet.** Repeat step 2.
4. **A cloud provider (any).** The new row has no confidence and no toggle.
5. **Retry a confidence row.** After retry the underlines are gone, or they are fresh if the engine supplied new data.
6. **Reduced motion** (System Settings → Accessibility → Reduce motion). Toggling confidence is instant, and dropping a card does not spring.
7. **The Table.** Open Notes → Personal → `Table`.
   - Notes auto-flow. Drag one: it springs to the grid. Reload the app: it stays.
   - Shift-drag lasso three cards, then:
     - **Group into note:** a new note appears linked to all three.
     - **Summarise:** the Ask panel opens. Its model chip shows the route's locality (Plan 03 and Plan 06), and the answer becomes a linked Answer card.
     - **Remove from table:** the cards move to the Inbox, and the notes still exist in List.
   - Drag an Inbox dictation in. Arrow between cards, Shift+arrow to nudge, Enter to open a note.
   - Zoom with Ctrl or ⌘ plus the wheel and with a pinch; Reset view fits everything.
   - Dictate while the Table is open: the new capture appears in the Inbox.
8. **RTL** (UI language Arabic). The Inbox sits at the inline start (right), the selection bar is centred, and the canvas world is not mirrored.
9. **Sealed mode** (if Plan 07 has merged). Turn Sealed on with a remote chat route: Summarise or Ask is blocked by main exactly as the Space's Ask box is, and no new path bypasses it.

- [ ] **Step 4: Commit any fixes, then hand off**

The owner asked that this plan not be pushed by its planning thread. When executing, get the owner's explicit OK before `git push` and `gh pr create`; publishing a PR is outward-facing. The PR body lists one line per Task 1–17 commit, links the spec, this plan and the spike report, embeds the Step 3 screenshots, and names any intentionally updated pre-existing tests (Step 1).
