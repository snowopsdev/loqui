# Loqui UI/UX Plan 08 — The Table (WS-M5 spatial canvas prototype) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship WS-M5, The Table, as a Labs prototype behind an off-by-default flag. It is a per-Space spatial canvas with:
- draggable, resizable note, meeting, dictation and chat-answer cards;
- connectors, lasso, pan and zoom;
- an inbox tray;
- Summarise and Ask through the Space's own chat, with the route disclosed before anything is sent.

Positions persist in local SQLite, owned by main. WS-M4 (confidence typography) is on hold per spec D11. Its plan is summarised in the "Deferred: WS-M4" appendix.

**Architecture:** A Space's root overview gains a `List | Table` switch.
- Main owns three new tables (`note_layout`, `note_layout_links`, `note_layout_viewport`), validates every write, and returns a ready-to-draw board.
- The renderer keeps geometry, model and gesture logic in pure, tested modules (`src/components/table/*.ts`).
- Thin React components draw DOM cards over a transformed world.
- AI actions reuse `useContainerChat` and Plan 03's route resolver, so there is no new provider request path.

**Tech Stack:**
- Electron 44 main process (CommonJS), with better-sqlite3 13.0.3.
- React 19, TypeScript, Tailwind CSS 4 and zustand 5.
- Node `node:test`, using the tsx loader, `react-dom/server`, and the Vite SSR harness (`test/lib/rendererTestHarness.js`).

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md`: the Plan 08 row in §3, decisions D11 (WS-M4 on hold) and D12 (The Table never deletes content), constraints §4 and contracts §5.
- Acceptance reference: `design-explorations/loqui-uiux-review.html#ws-m5`, with source `design-explorations/loqui-uiux-review/parts/04-workspace.html:1591-1633` for the markup and `:2694-2810` for the interactive mock.
- Research: `.omc/research/ui-review/audit-workspace.md` §4 M5.

---

## Contract change requests

Spec §5 says only the owning plan may change a contract. These requests go to the owner and the owning plans. Plan 08 codes against the assumption stated in each one, so execution can proceed if the request is accepted as written.

1. **CCR-1, new §5.5 "Space surface" (owner: Plan 06; consumer: Plan 08).** Plan 06 reshapes the sidebar and Spaces (WS-R1 B). Plan 08 needs a stable place to mount a per-Space view switch.
   - **Request:** Plan 06 publishes, as a contract, the component that renders a Space's root content and a `viewSwitch` slot in its header. Alternatively, it keeps `ContainerOverview` (`src/components/notes/overview/ContainerOverview.tsx`) with its current props `{ space, folder, onOpenNote, onNewNote, onAddExisting }`, rendered by `PersonalNotesView` when no note is open.
   - **Assumption used in Task 8:** the latter.
2. **CCR-2, new §5.6 "Entity mention links" (owner: Plan 06; consumer: Plan 08).** WS-R7 B (universal mentions) lets notes mention notes, meetings and dictations. The Table draws connectors from these links.
   - Plan 06 (its universal-mentions task) defines the scheme `<kind>:<positiveInt>`, stored as `[@Label](note:17)`, with kinds `note | meeting | dictation | folder`. It also defines `parseMentionHref(href): { kind; entityId: string | null; email: string | null } | null` in `src/utils/mentionMarkdown.ts`.
   - **Request:** Plan 06 publishes the scheme and `parseMentionHref` in spec §5.
   - **Plan 08's use:** Task 4 wraps it as `parseEntityHref` in `src/components/table/tableEdges.ts`:
     - `note` and `meeting` map to a note card;
     - `dictation` maps to a dictation card;
     - `folder` and `person` map to nothing.
3. **CCR-3, new §5.7 "Labs flags" (owner: Plan 08; consumers: any later prototype).**
   - **Plan 08 produces:**
     - the boolean setting `labsTable` in `src/stores/settingsStore.ts` (`BOOLEAN_SETTINGS`, `readBoolean`, `createBooleanSetter`);
     - a `LabsSettings` panel (`src/components/settings/LabsSettings.tsx`) rendered in Settings → System.
   - **Rule:** a Labs flag defaults to `false`, gates both UI and any request change, and turning it off restores today's behaviour exactly. A later prototype adds its own flag and row to the same panel.
4. **CCR-4, resolved by D11 (WS-M4 on hold).** The owner chose not to ship confidence typography without per-word alternatives. See the "Deferred: WS-M4" appendix.
5. **CCR-5, resolved by D12 (approved as written).** The Table's selection action is "Remove from table": the card returns to the Inbox tray and nothing is ever deleted.
   - Summarise and Ask about these reuse the Space's existing chat (`useContainerChat`). The answer becomes a chat-answer card linked to its sources.
   - There is no new AI request path, so Sealed mode (Plan 07, D6) covers these actions without changes.
6. **CCR-6, publish the route chips (owner: Plan 03; consumers: Plan 08, and any surface that discloses a route).** The Table discloses the chat route with Plan 03's two chips:
   - `RouteDestinationChip(props: { route: Pick<ResolvedRoute, "locality" | "providerId" | "model">; className?: string })`;
   - `RouteStateChip(props: { state: RouteState; className?: string })`.

   They live in `src/components/settings/routing/RouteChips.tsx`.
   - **Request:** Plan 03 lists them, and `ResolvedRoute.providerId`, in spec §5.1.
   - **If declined:** Plan 08 renders `LocalityRing` plus `providerDisplayLabel(providerId, t)` itself, in a local `TableRouteChip` with the same props.

## Review response (independent review 2026-10-15, Codex gpt-6.1-sol xhigh: 0 Critical, 7 Important, 3 Minor)

All ten findings are closed and none is disputed. Five of them concerned WS-M4. They went on hold with it (D11): the fixes are recorded in the appendix and apply when WS-M4 is restored.

| Finding | Resolution |
|---|---|
| I4 Table AI actions lack route disclosure; Labs copy over-promises | Task 7: the toolbar, the Ask panel and the selection bar show Plan 03's `RouteDestinationChip`, which renders `LocalityRing` and `providerDisplayLabel(providerId, t)`, from `useResolvedRoute("chat")` before anything is sent. A non-ready route shows `RouteStateChip` and disables Summarise and Ask. One test renders the real chip. Task 1: the Labs copy says card positions stay on the device and Summarise and Ask use the chat provider. Per-answer route stamps remain Plan 06's, in `ChatView`. |
| I6 Ask uses the live selection; large selections are silently cut | Tasks 4 and 7: `pinSelection` freezes the selection's keys and context when Ask or Summarise starts. The Ask panel shows "Pinned cards: N". Selection AI actions are limited to 12 with an on-bar explanation, and `buildSelectionContext` never truncates. Board context names the total and says what it left out. |
| I7 Acceptance features missing | Card resize is Task 9, with a corner handle, Alt+arrows, clamped and snapped sizes, `w`/`h` persisted, and cancel restoring the old size. The raw versus cleaned diff belonged to WS-M4 and is deferred with it. |
| M1 Preview ignores `placedKeys` | Task 8: `src/preview/previewTable.ts` is an in-memory store that honours `placedKeys`, hide and links, with a place → read → hide → read test. |
| M3 No per-frame performance evidence; hard-coded 380 ms | Task 6: pointer moves are coalesced per animation frame, and the snap uses `--motion-slow` (a test forbids literal `ms` in Table CSS). Task 7: handlers are stable. Task 10 Step 4 adds a 500-card trace with pass criteria. |
| I1, I2, I3, I5, M2 (WS-M4) | On hold with WS-M4 (D11). The appendix records each fix: positional alignment, the `raw_text` trigger, the two-stage gate, Plan 06 token-guard compliance, and the storage budget. I5 no longer applies to this plan, because Plan 08 no longer touches `TranscriptionItem.tsx`. |

Execution order: Plan 08 runs after Plans 03 and 06 are implemented. Before starting, check that `useResolvedRoute`, `RouteDestinationChip`, `RouteStateChip`, `parseMentionHref` and `--color-ai-text` are on `main`.

## Owner decisions

- **D11 (2026-10-15):** WS-M4 is on hold until per-word alternatives exist. Plan 08 delivers WS-M5 only.
- **D12 (2026-10-15):** "Remove from table" returns the card to the Inbox, and nothing is ever deleted.
- **The inbox defaults stand (2026-10-14):** removed cards of any age, dictations from the last 7 days (up to 20), and recent answered chats (up to 10).
- **The Table is per Space, not per folder (2026-10-14).** One canvas per Space means a note has one position, so there is never a second, conflicting arrangement of the same cards.
- **Labs lives in Settings → System (2026-10-14).**

## Assumptions about Plan 06 (Workspace)

These were checked against Plan 06's plan (`snowopsdev/plan/uiux-06-workspace`). Plan 08 executes after Plan 06 merges. Before Task 1, the executor runs `git log --oneline main -- src/components/notes src/hooks/useContainerChat.ts` and reads Plan 06's plan. Where an assumption below is false, the affected task says what to do.

- **A1.** The Space root overview is still `ContainerOverview`, with the props above (CCR-1). There is still exactly one Space, "Personal" (`spaces.kind CHECK (kind = 'private')`, `src/helpers/localDatabaseSchema.js:276`), but all Plan 08 code is keyed by `space_id` and works unchanged with more Spaces.
- **A2.** Plan 06 does not touch `useContainerChat`. `src/hooks/useContainerChat.ts` still returns `{ messages, agentState, sendMessage, cancelStream, conversations, activeConversationId, switchConversation, startNewChat }`, and `OverviewAskSection` still takes the props passed at `ContainerOverview.tsx:129-139`.
- **A3.** Plan 06 adds `--color-ai-text` (CR-06-4), which Task 7 uses for the machine-authored Summarise label.
- **A4.** Tokens from Plan 01 exist: `--motion-*`, `--color-agent-brand`, and the hex dark tokens in `.dark`. Helpers exist: `src/utils/contrast.ts` (`contrastRatio`) and `test/helpers/harness/cssTokens.js` (`resolveTokens`).

## Data model and migration

Loqui has no migration system. `initDatabase` (`src/helpers/database.js:100-107`) runs the idempotent `CREATE … IF NOT EXISTS` script in `src/helpers/localDatabaseSchema.js` on every start. Adding a column to an existing table would not reach installed profiles. Plan 08 therefore adds **only new tables**:

| Table | Purpose | Lifecycle |
|---|---|---|
| `note_layout(space_id, entity_type ∈ note/dictation/chat, entity_id, x, y, w, h, z, hidden, updated_at; PK(space_id, entity_type, entity_id))` | Card positions and sizes. The name and columns follow the acceptance reference. `hidden` implements D12: a removed card of any kind returns to the Inbox, whatever its age. | Polymorphic, so no FK. Every read and write prunes rows whose entity is gone, in the same transaction. |
| `note_layout_links(space_id, a_type, a_id, b_type, b_id, created_at; PK on all five)` | User-made connectors (Group into note, Summarise, Ask). | Both ends are validated on insert. Links to deleted entities are pruned with the layout, and reads return only links whose two ends are on the board or in the Inbox. |
| `note_layout_viewport(space_id PK, x, y, scale, updated_at)` | Last pan and zoom per Space. | Overwritten on change. |

Upgrade: an existing profile gains all three tables on next launch, and Task 2 tests this by dropping them and reopening. Downgrade: older builds ignore the unknown tables, and no existing table changes.

## Global Constraints

- Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md, spec §4).
- Local and remote choices stay explicit. Nothing silently switches provider or moves work from local to remote. Content is preserved on every failure, and The Table never deletes content (D12).
- The Labs flag defaults to `false`. With it off, every request, IPC payload and render must be exactly what it is today.
- Text contrast is at least 4.5:1 and non-text UI (connectors, card borders, chat rail) at least 3:1, in light theme and Plum Night.
- Motion uses the shared tokens only (`--motion-*`). Every loop is gated to its active state. Reduced motion keeps opacity and colour feedback and drops transforms (the existing policy in `src/index.css`). The Table's spring snap is off under reduced motion.
- Every visible string goes through i18n in all 11 locales: `ar de en es fr it ja pt ru zh-CN zh-TW`. `npm run i18n:check` passes. Plan 06 adds `scripts/merge-locale-keys.js`, an all-or-nothing merge that refuses conflicting values. If it is on `main`, feed it the same key and value tables as Tasks 1 and 7 instead of their inline `node -e` writers.
- RTL: use logical properties (`ms-`, `me-`, `start-`, `end-`, `inset-inline-*`). Canvas world coordinates stay physical; only chrome (inbox tray, toolbar, selection bar) flips.
- Tests: run `npm run native:node` once, then `npm test -- <files>`. Run `npm run native:electron` before launching the desktop app. Never use personal profiles in tests.
- Before a PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run i18n:check`.
- Node: `~/.nvm/versions/node/v24.21.0/bin` (matches `.node-version` 24.21.0).
- `DESIGN.md` is the source of truth (D10). Task 8 updates it, and `docs/PRIVACY.md` gains the new local store.

## Review Focus

1. **Keyboard focus on a virtualised canvas.** Arrowing to a card that is outside the rendered 1.5× viewport must still move focus there and bring it into view. Selected and focused cards must never be culled. With the first card off screen, there must still be a reachable tab stop.
   - Pinned in Task 3 (`visibleIds` always keeps `always`, and `ensureVisible` pans), Task 5 (`enterCards`) and Task 6 (the focused id stays in the render set, and "the tab stop moves to a rendered card").
2. **Notes removed or deleted while the board is open, or between sessions.** A note deleted in the editor, a dictation purged by retention, or a chat deleted must not leave a ghost card or a dangling connector. "Remove from table" must never delete anything (D12).
   - Pinned in Task 2 ("deleted entities are pruned", "removing a note hides it and keeps the note", "a removed old dictation stays in the inbox", "deleting an entity frees its capacity") and Task 4 (edges drop endpoints that are not on the board).
   - Task 7's board hook reloads on note and transcription lifecycle events and applies only the placements main accepted.
3. **Hostile or garbage placements over IPC.** The renderer is not trusted: an unknown Space, ids that do not exist, non-integer ids, `NaN` coordinates, batches over 500, and links to missing entities must be refused without writing.
   - Pinned in Task 2 ("only real entities can be placed", "links and hides to missing entities or Spaces are refused", "the table refuses a 501st placed card").
4. **AI actions on a route that cannot run, or with too many cards.** If the chat route needs a key, is sealed, or is unreachable, Summarise and Ask must say why and stay disabled. More than 12 selected cards must disable them with an explanation, never silently truncate.
   - Pinned in Task 4 ("pinning freezes up to 12 selected items and refuses more") and Task 7 ("a route that cannot run disables the AI actions and says why", "more than 12 selected cards disables AI actions").
5. **A cancelled or contested pointer.** A system gesture, lost capture, or a second finger must never commit a half-finished drag, pan or resize.
   - Pinned in Task 5 ("a cancelled pointer restores positions and viewport", and the resize cancel in Task 9) and Task 6 (one owning pointer id).

---

## Tasks

### Task 1: Labs flag and the Labs settings panel

Covers CCR-3.

**Files:**
- Modify: `src/stores/settingsStore.ts`:
  - `BOOLEAN_SETTINGS` at `:195-~240` (add next to `"saveDiscardedTranscriptions"` at `:222`);
  - `SettingsState` body at `:786` (after `audioCuesEnabled: boolean;`);
  - the setter type next to `:1089`;
  - initial state next to `:1489`;
  - the setter next to `:2201`.
- Create: `src/components/settings/LabsSettings.tsx`
- Modify: `src/components/SettingsPage.tsx`. Import the panel, and render it in `case "system":` (`:2963`) after `<UpdateSettings />`. Plan 03 may have restructured this. If so, run `grep -n "UpdateSettings" src/components/SettingsPage.tsx src/components/settings/*.tsx` and mount `<LabsSettings />` directly after `<UpdateSettings />`, wherever that now renders.
- Modify: `src/locales/{ar,de,en,es,fr,it,ja,pt,ru,zh-CN,zh-TW}/translation.json` (`settingsPage.labs.*`).
- Test: `test/components/labsSettings.test.js`

**Interfaces:**
- Produces the settings-store key `labsTable`: boolean, default `false`, persisted in `localStorage` and synced across windows through `BOOLEAN_SETTINGS`. Its setter is `setLabsTable(value: boolean)`.
- Produces `export default function LabsSettings(): JSX.Element`, a panel with one switch per Labs prototype. A later prototype adds its own row here (CCR-3).

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

test("Labs lists The Table as a switch, off by default", async (t) => {
  const html = await renderLabs(t, { labsTable: false, setLabsTable() {} });
  assert.match(html, /settingsPage\.labs\.title/);
  assert.match(html, /settingsPage\.labs\.table\.label/);
  assert.equal((html.match(/role="switch"/g) || []).length, 1);
  assert.match(html, /aria-checked="false"/);
});

test("the store declares labsTable as a synced boolean that defaults to off", () => {
  const src = fs.readFileSync(path.join(repoRoot, "src/stores/settingsStore.ts"), "utf8");
  const set = src.slice(src.indexOf("const BOOLEAN_SETTINGS"), src.indexOf("]);", src.indexOf("const BOOLEAN_SETTINGS")));
  assert.match(set, /"labsTable"/);
  assert.match(src, /labsTable: readBoolean\("labsTable", false\)/);
  assert.match(src, /setLabsTable: createBooleanSetter\("labsTable"\)/);
});

test("every locale names the Labs panel and The Table, without a local-only promise", () => {
  const dir = path.join(repoRoot, "src/locales");
  for (const lang of fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "translation.json")))) {
    const labs = JSON.parse(fs.readFileSync(path.join(dir, lang, "translation.json"), "utf8")).settingsPage?.labs;
    assert.ok(labs?.title && labs?.description, `${lang} labs title`);
    assert.ok(labs.table?.label && labs.table?.description, `${lang} labs.table`);
  }
  const en = JSON.parse(fs.readFileSync(path.join(dir, "en", "translation.json"), "utf8"));
  assert.match(en.settingsPage.labs.table.description, /use your chat provider/, "AI actions are not promised to stay local");
  assert.doesNotMatch(en.settingsPage.labs.description, /stay on this device/, "no blanket local-only claim");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/labsSettings.test.js`
Expected: FAIL. Vite cannot resolve `/components/settings/LabsSettings.tsx`, the store has no `"labsTable"`, and `en labs title` fails.

- [ ] **Step 3: Implement**

1. In `src/stores/settingsStore.ts`:
   - Add `"labsTable",` to `BOOLEAN_SETTINGS`, directly after `"saveDiscardedTranscriptions",` (`:222`).
   - In `export interface SettingsState … {`, add after `audioCuesEnabled: boolean;` (`:786`):

     ```ts
       // Labs prototype (Plan 08). Off by default; off means today's behaviour exactly.
       labsTable: boolean;
     ```

   - Next to `setSaveDiscardedTranscriptions: (value: boolean) => void;` (`:1089`), add `setLabsTable: (value: boolean) => void;`.
   - Next to `saveDiscardedTranscriptions: readBoolean("saveDiscardedTranscriptions", false),` (`:1489`), add `labsTable: readBoolean("labsTable", false),`.
   - Next to `setSaveDiscardedTranscriptions: createBooleanSetter("saveDiscardedTranscriptions"),` (`:2201`), add `setLabsTable: createBooleanSetter("labsTable"),`.

2. Create `src/components/settings/LabsSettings.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { useSettingsStore } from "../../stores/settingsStore";
   import { SectionHeader, SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";
   import { Toggle } from "../ui/toggle";

   // Labs: prototypes that ship off. Each switch gates both the UI and any
   // request change behind it (CCR-3, Plan 08).
   export default function LabsSettings() {
     const { t } = useTranslation();
     const table = useSettingsStore((s) => s.labsTable);
     const setTable = useSettingsStore((s) => s.setLabsTable);

     return (
       <div>
         <SectionHeader title={t("settingsPage.labs.title")} description={t("settingsPage.labs.description")} />
         <SettingsPanel>
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
    en:["Labs", "Prototypes that are still being shaped. You can turn them off at any time.", "The Table", "A canvas view for a space: spread notes, dictations and answers out and link them. Card positions stay on this device; Summarise and Ask use your chat provider."],
    de:["Labs", "Prototypen in Arbeit. Du kannst sie jederzeit ausschalten.", "Der Tisch", "Eine Leinwand für einen Bereich: Notizen, Diktate und Antworten auslegen und verbinden. Kartenpositionen bleiben auf diesem Gerät; Zusammenfassen und Fragen nutzen deinen Chat-Anbieter."],
    es:["Labs", "Prototipos aún en desarrollo. Puedes desactivarlos cuando quieras.", "La Mesa", "Un lienzo para un espacio: extiende notas, dictados y respuestas y enlázalos. Las posiciones se quedan en este dispositivo; Resumir y Preguntar usan tu proveedor de chat."],
    fr:["Labs", "Des prototypes encore en chantier. Vous pouvez les désactiver à tout moment.", "La Table", "Un canevas pour un espace : étalez notes, dictées et réponses, puis reliez-les. Les positions restent sur cet appareil ; Résumer et Demander utilisent votre fournisseur de chat."],
    it:["Labs", "Prototipi ancora in lavorazione. Puoi disattivarli quando vuoi.", "Il Tavolo", "Una tela per uno spazio: disponi note, dettature e risposte e collegale. Le posizioni restano su questo dispositivo; Riassumi e Chiedi usano il tuo provider di chat."],
    pt:["Labs", "Protótipos ainda em evolução. Você pode desativá-los a qualquer momento.", "A Mesa", "Uma tela para um espaço: espalhe notas, ditados e respostas e ligue-os. As posições ficam neste dispositivo; Resumir e Perguntar usam seu provedor de chat."],
    ru:["Лаборатория", "Прототипы в разработке. Их можно отключить в любой момент.", "Стол", "Холст для пространства: раскладывайте заметки, диктовки и ответы и связывайте их. Положение карточек хранится на этом устройстве; «Кратко изложить» и «Спросить» используют ваш чат-провайдер."],
    ja:["Labs", "開発中のプロトタイプです。いつでもオフにできます。", "テーブル", "スペース用のキャンバス。メモ、音声入力、回答を広げてつなげられます。カードの配置はこのデバイスに保存され、要約と質問はチャットのプロバイダーを使います。"],
    "zh-CN":["实验室", "仍在打磨的原型功能。可随时关闭。", "桌面", "空间的画布视图：铺开笔记、听写和回答并把它们连起来。卡片位置保存在此设备上；总结和提问使用你的聊天服务提供方。"],
    "zh-TW":["實驗室", "仍在打磨的原型功能。可隨時關閉。", "桌面", "空間的畫布檢視：鋪開筆記、聽寫與回答並將它們連起來。卡片位置保存在此裝置上；摘要與提問使用你的聊天服務提供者。"],
    ar:["المختبر", "نماذج أولية ما زالت قيد التشكيل. يمكنك إيقافها في أي وقت.", "الطاولة", "لوحة لمساحة: افرد الملاحظات والإملاءات والإجابات واربط بينها. تبقى مواضع البطاقات على هذا الجهاز، ويستخدم التلخيص والسؤال مزوّد الدردشة لديك."]};
   for(const [l,[title,desc,tl,td]] of Object.entries(L)){const f=p.join("src/locales",l,"translation.json");const j=JSON.parse(fs.readFileSync(f,"utf8"));j.settingsPage=j.settingsPage||{};j.settingsPage.labs={title,description:desc,table:{label:tl,description:td}};fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");}'
   npx prettier --check "src/locales/**/translation.json" || npx prettier --write "src/locales/**/translation.json"
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/labsSettings.test.js test/locales/translationCoverage.test.js && npm run i18n:check && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/components/settings/LabsSettings.tsx src/components/SettingsPage.tsx src/locales test/components/labsSettings.test.js
git commit -m "feat(settings): Labs panel with an off-by-default Table flag"
```

---

### Task 2: Table storage and IPC

**Files:**
- Create: `src/types/table.ts`
- Modify: `src/helpers/localDatabaseSchema.js` (append three tables before the closing backtick)
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
    cards: TableEntity[];      // all placed, visible cards, then the newest unplaced space notes up to 500 in total
    inbox: TableEntity[];      // removed cards of any kind or age (≤ 50 each), new dictations (7 days, ≤ 20), new answered chats (≤ 10)
    links: TableLink[];        // only links whose two ends are in cards ∪ inbox
    viewport: TableViewport | null;
    truncated: boolean;
  }
  export interface TablePlacement extends TableEntityRef { x: number; y: number; w?: number | null; h?: number | null; z?: number }
  ```

- Produces `DatabaseManager` methods:
  - `getTableBoard(spaceId): TableBoardData`. It prunes stale rows first.
  - `placeTableCards(spaceId, placements: TablePlacement[]): { success: true; placed: number; placedKeys: string[] } | { success: false; code: "TABLE_FULL" | "INVALID" }`. Only entities that exist in the Space are placed; `placedKeys` lists them.
  - `hideTableCards(spaceId, refs: TableEntityRef[]): { success: boolean; hidden: number }`. Every kind gets `hidden = 1`: nothing is deleted, the card returns to the inbox whatever its age, and its last position is kept.
  - `linkTableCards(spaceId, a, b): { success: boolean }`. Both ends must exist in the Space. Links are undirected and deduplicated, and are pruned when an end is deleted.
  - Every method refuses an unknown or non-private Space, non-positive or unsafe ids, and batches over 500.
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
  assert.deepEqual(res, { success: true, placed: 2, placedKeys: [`note:${note.id}`, `dictation:${dictation}`] });
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
  assert.ok(board.inbox.some((e) => e.ref.type === "dictation" && e.layout?.hidden), "a removed dictation goes back to the inbox");
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
  assert.equal(first.placed, 500);
  assert.deepEqual(db.placeTableCards(spaceId, [{ type: "dictation", id: ids[500], x: 0, y: 0 }]), { success: false, code: "TABLE_FULL" });
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM note_layout").get().n, 500);
});

test("an arranged old note survives 500 newer notes, and truncation is reported", (t) => {
  const db = createDb(t);
  if (!db) return;
  const spaceId = db.getPrivateSpaceId();
  const old = db.saveNote("Old but arranged", "", "personal", null, null, null, spaceId).note;
  db.placeTableCards(spaceId, [{ type: "note", id: old.id, x: 0, y: 0 }]);
  for (let i = 0; i < 500; i++) db.saveNote(`n${i}`, "", "personal", null, null, null, spaceId);
  const board = db.getTableBoard(spaceId);
  assert.equal(board.cards.length, 500);
  assert.ok(board.cards.some((c) => c.ref.id === old.id && c.layout), "the arranged card is kept");
  assert.equal(board.truncated, true);
});

test("deleting an entity frees its capacity without a board read in between", (t) => {
  const db = createDb(t);
  if (!db) return;
  const spaceId = db.getPrivateSpaceId();
  const ids = Array.from({ length: 501 }, (_, i) => db.saveTranscription(`d${i}`, `d${i}`).id);
  db.placeTableCards(spaceId, ids.slice(0, 500).map((id) => ({ type: "dictation", id, x: 0, y: 0 })));
  db.deleteTranscription(ids[0]);
  assert.equal(db.placeTableCards(spaceId, [{ type: "dictation", id: ids[500], x: 0, y: 0 }]).success, true);
});

test("links and hides to missing entities or Spaces are refused, and dead links are pruned", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { spaceId, note, dictation } = seed(db);
  assert.equal(db.linkTableCards(spaceId, { type: "note", id: note.id }, { type: "note", id: 424242 }).success, false);
  assert.equal(db.hideTableCards(spaceId, [{ type: "note", id: 424242 }]).hidden, 0);
  assert.equal(db.getTableBoard(9999).cards.length, 0, "unknown Space reads empty");
  assert.deepEqual(db.placeTableCards(9999, [{ type: "note", id: note.id, x: 0, y: 0 }]), { success: false, code: "INVALID" });
  db.linkTableCards(spaceId, { type: "note", id: note.id }, { type: "dictation", id: dictation });
  db.deleteTranscription(dictation);
  db.getTableBoard(spaceId);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM note_layout_links").get().n, 0);
});

test("a removed old dictation stays in the inbox", (t) => {
  const db = createDb(t);
  if (!db) return;
  const spaceId = db.getPrivateSpaceId();
  const id = db.saveTranscription("from last month", "from last month").id;
  db.db.prepare("UPDATE transcriptions SET timestamp = datetime('now', '-30 days') WHERE id = ?").run(id);
  db.placeTableCards(spaceId, [{ type: "dictation", id, x: 0, y: 0 }]);
  db.hideTableCards(spaceId, [{ type: "dictation", id }]);
  assert.ok(db.getTableBoard(spaceId).inbox.some((e) => e.ref.type === "dictation" && e.ref.id === id));
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
     const TABLE_INBOX_HIDDEN = 50;
     const TABLE_BATCH_LIMIT = 500;
     const TABLE_COORD_LIMIT = 1e6;
     const MARKDOWN_HREF = /\]\(([^)\s]+)\)/g;
     const NON_ENTITY_HREF = /^(https?:|mailto:|mention:)/i;

     const tableKey = (type, id) => `${type}:${id}`;
     const clampCoord = (n) => Math.max(-TABLE_COORD_LIMIT, Math.min(TABLE_COORD_LIMIT, n));
     const finiteOrNull = (n) => (Number.isFinite(n) && n > 0 ? Math.min(n, 4000) : null);
     const isTableRef = (ref) =>
       !!ref && TABLE_ENTITY_TYPES.has(ref.type) && Number.isSafeInteger(ref.id) && ref.id > 0;

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
       // Every entry point validates the Space and every entity, because the
       // renderer is not trusted to send ids that exist.

       _isTableSpace(spaceId) {
         return (
           Number.isSafeInteger(spaceId) &&
           spaceId > 0 &&
           !!this.db
             .prepare("SELECT 1 FROM spaces WHERE id = ? AND kind = 'private' AND deleted_at IS NULL")
             .get(spaceId)
         );
       }

       _tableEntityExists(spaceId, type, id) {
         const sql = {
           note: "SELECT 1 FROM notes WHERE id = ? AND space_id = ? AND deleted_at IS NULL",
           dictation: "SELECT 1 FROM transcriptions WHERE id = ? AND deleted_at IS NULL AND status = 'completed'",
           chat: "SELECT 1 FROM agent_conversations WHERE id = ? AND space_id = ? AND deleted_at IS NULL",
         }[type];
         if (!sql) return false;
         const params = type === "dictation" ? [id] : [id, spaceId];
         return !!this.db.prepare(sql).get(...params);
       }

       // Deleting a note, conversation or transcription never touches these
       // tables (no FK is possible across three entity tables), so every read
       // and write prunes first.
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
         const drop = this.db.prepare("DELETE FROM note_layout_links WHERE rowid = ?");
         for (const l of this.db
           .prepare("SELECT rowid, a_type, a_id, b_type, b_id FROM note_layout_links WHERE space_id = ?")
           .all(spaceId)) {
           if (!this._tableEntityExists(spaceId, l.a_type, l.a_id) || !this._tableEntityExists(spaceId, l.b_type, l.b_id)) {
             drop.run(l.rowid);
           }
         }
       }

       getTableBoard(spaceId) {
         if (!this.db) throw new Error("Database not initialized");
         const empty = { spaceId, cards: [], inbox: [], links: [], viewport: null, truncated: false };
         if (!this._isTableSpace(spaceId)) return empty;
         return this.db.transaction(() => {
           this._pruneTableLayout(spaceId);
           const layoutOf = (row) =>
             row.l_x == null
               ? null
               : { x: row.l_x, y: row.l_y, w: row.l_w, h: row.l_h, z: row.l_z, hidden: row.l_hidden === 1 };
           const LAYOUT_COLUMNS = "l.x AS l_x, l.y AS l_y, l.w AS l_w, l.h AS l_h, l.z AS l_z, l.hidden AS l_hidden";
           const layoutJoin = (type, alias) =>
             `LEFT JOIN note_layout l ON l.space_id = ${Number(spaceId)} AND l.entity_type = '${type}' AND l.entity_id = ${alias}.id`;
           const scope = this._personalScopeCondition("n");

           const noteRows = (layoutClause, limit) =>
             this.db
               .prepare(
                 `SELECT n.id, n.title, n.note_type, n.content, n.enhanced_content, n.participants, n.updated_at,
                         n.audio_duration_seconds, ${LAYOUT_COLUMNS}
                  FROM notes n ${layoutJoin("note", "n")}
                  WHERE n.space_id = ? AND n.deleted_at IS NULL AND ${scope.sql} AND ${layoutClause}
                  ORDER BY n.updated_at DESC, n.id DESC LIMIT ?`
               )
               .all(spaceId, ...scope.params, limit);
           const dictationRows = (layoutClause, extra, limit) =>
             this.db
               .prepare(
                 `SELECT t.id, t.text, t.timestamp, t.audio_duration_ms, ${LAYOUT_COLUMNS}
                  FROM transcriptions t ${layoutJoin("dictation", "t")}
                  WHERE t.deleted_at IS NULL AND t.status = 'completed' AND ${layoutClause} ${extra}
                  ORDER BY t.timestamp DESC, t.id DESC LIMIT ?`
               )
               .all(limit);
           const chatRows = (layoutClause, extra, limit) =>
             this.db
               .prepare(
                 `SELECT c.id, c.title, c.note_id, c.updated_at, ${LAYOUT_COLUMNS},
                    (SELECT substr(m.content, 1, ${TABLE_EXCERPT_CHARS}) FROM agent_messages m
                      WHERE m.conversation_id = c.id AND m.role = 'assistant'
                      ORDER BY m.id DESC LIMIT 1) AS answer
                  FROM agent_conversations c ${layoutJoin("chat", "c")}
                  WHERE c.space_id = ? AND c.deleted_at IS NULL AND c.archived_at IS NULL AND ${layoutClause} ${extra}
                  ORDER BY c.updated_at DESC LIMIT ?`
               )
               .all(spaceId, limit);

           const noteEntity = (n) => {
             const body = n.enhanced_content && n.enhanced_content.trim() ? n.enhanced_content : n.content || "";
             return {
               ref: { type: "note", id: n.id },
               kind: n.note_type === "meeting" ? "meeting" : "note",
               title: n.title,
               excerpt: body.slice(0, TABLE_EXCERPT_CHARS),
               at: n.updated_at,
               durationMs: n.audio_duration_seconds != null ? Math.round(n.audio_duration_seconds * 1000) : null,
               participants: parseParticipantNames(n.participants),
               hrefs: extractEntityHrefs(body),
               noteId: null,
               layout: layoutOf(n),
             };
           };
           const dictationEntity = (d) => ({
             ref: { type: "dictation", id: d.id },
             kind: "dictation",
             title: null,
             excerpt: String(d.text || "").slice(0, TABLE_EXCERPT_CHARS),
             at: d.timestamp,
             durationMs: d.audio_duration_ms ?? null,
             participants: [],
             hrefs: [],
             noteId: null,
             layout: layoutOf(d),
           });
           const chatEntity = (c) => ({
             ref: { type: "chat", id: c.id },
             kind: "chat",
             title: c.title,
             excerpt: c.answer || "",
             at: c.updated_at,
             durationMs: null,
             participants: [],
             hrefs: [],
             noteId: c.note_id ?? null,
             layout: layoutOf(c),
           });

           // Arranged cards first and in full (placement caps them at 500), so
           // an old arranged note can never be pushed out by newer ones.
           const placed = [
             ...noteRows("l.hidden = 0", TABLE_CARD_CAP).map(noteEntity),
             ...dictationRows("l.hidden = 0", "", TABLE_CARD_CAP).map(dictationEntity),
             ...chatRows("l.hidden = 0", "", TABLE_CARD_CAP).map(chatEntity),
           ];
           const room = Math.max(0, TABLE_CARD_CAP - placed.length);
           const unplacedNotes = noteRows("l.entity_id IS NULL", room + 1).map(noteEntity);
           const cards = [...placed, ...unplacedNotes.slice(0, room)];

           // Removed cards stay in the inbox regardless of age; new captures are recent only.
           const inbox = [
             ...noteRows("l.hidden = 1", TABLE_INBOX_HIDDEN).map(noteEntity),
             ...dictationRows("l.hidden = 1", "", TABLE_INBOX_HIDDEN).map(dictationEntity),
             ...chatRows("l.hidden = 1", "", TABLE_INBOX_HIDDEN).map(chatEntity),
             ...dictationRows(
               "l.entity_id IS NULL",
               "AND t.text != '' AND t.timestamp >= datetime('now', '-7 days')",
               TABLE_INBOX_DICTATIONS
             ).map(dictationEntity),
             ...chatRows("l.entity_id IS NULL", "AND answer IS NOT NULL", TABLE_INBOX_CHATS).map(chatEntity),
           ];

           const present = new Set([...cards, ...inbox].map((e) => tableKey(e.ref.type, e.ref.id)));
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
             cards,
             inbox,
             links,
             viewport: viewport ? { x: viewport.x, y: viewport.y, scale: viewport.scale } : null,
             truncated: unplacedNotes.length > room,
           };
         })();
       }

       placeTableCards(spaceId, placements) {
         if (!this.db) throw new Error("Database not initialized");
         if (!this._isTableSpace(spaceId) || !Array.isArray(placements) || placements.length > TABLE_BATCH_LIMIT) {
           return { success: false, code: "INVALID" };
         }
         const upsert = this.db.prepare(
           `INSERT INTO note_layout (space_id, entity_type, entity_id, x, y, w, h, z, hidden, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
            ON CONFLICT(space_id, entity_type, entity_id) DO UPDATE SET
              x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h, z = excluded.z,
              hidden = 0, updated_at = CURRENT_TIMESTAMP`
         );
         try {
           return this.db.transaction(() => {
             // Prune before counting so deleted entities never hold capacity.
             this._pruneTableLayout(spaceId);
             const placedKeys = [];
             for (const p of placements) {
               if (!isTableRef(p) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
               if (!this._tableEntityExists(spaceId, p.type, p.id)) continue;
               upsert.run(spaceId, p.type, p.id, clampCoord(p.x), clampCoord(p.y), finiteOrNull(p.w), finiteOrNull(p.h), Number.isInteger(p.z) ? p.z : 0);
               placedKeys.push(tableKey(p.type, p.id));
             }
             const visible = this.db
               .prepare("SELECT COUNT(*) AS n FROM note_layout WHERE space_id = ? AND hidden = 0")
               .get(spaceId).n;
             if (visible > TABLE_CARD_CAP) throw Object.assign(new Error("table full"), { code: "TABLE_FULL" });
             return { success: true, placed: placedKeys.length, placedKeys };
           })();
         } catch (error) {
           if (error.code === "TABLE_FULL") return { success: false, code: "TABLE_FULL" };
           throw error;
         }
       }

       hideTableCards(spaceId, refs) {
         if (!this.db) throw new Error("Database not initialized");
         if (!this._isTableSpace(spaceId) || !Array.isArray(refs) || refs.length > TABLE_BATCH_LIMIT) {
           return { success: false, hidden: 0 };
         }
         const hide = this.db.prepare(
           `INSERT INTO note_layout (space_id, entity_type, entity_id, x, y, hidden) VALUES (?, ?, ?, 0, 0, 1)
            ON CONFLICT(space_id, entity_type, entity_id) DO UPDATE SET hidden = 1, updated_at = CURRENT_TIMESTAMP`
         );
         return this.db.transaction(() => {
           let hidden = 0;
           for (const ref of refs) {
             // Hidden, never deleted: the card returns to the inbox whatever its age,
             // and its last spot is kept for when it comes back.
             if (!isTableRef(ref) || !this._tableEntityExists(spaceId, ref.type, ref.id)) continue;
             hidden += hide.run(spaceId, ref.type, ref.id).changes;
           }
           return { success: true, hidden };
         })();
       }

       linkTableCards(spaceId, a, b) {
         if (!this.db) throw new Error("Database not initialized");
         if (!this._isTableSpace(spaceId) || !isTableRef(a) || !isTableRef(b)) return { success: false };
         const ka = tableKey(a.type, a.id);
         const kb = tableKey(b.type, b.id);
         if (ka === kb) return { success: false };
         if (!this._tableEntityExists(spaceId, a.type, a.id) || !this._tableEntityExists(spaceId, b.type, b.id)) {
           return { success: false };
         }
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
         if (!this._isTableSpace(spaceId) || ![x, y, scale].every(Number.isFinite)) return { success: false };
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
         ) => Promise<
           | { success: true; placed: number; placedKeys: string[] }
           | { success: false; code: "TABLE_FULL" | "INVALID" }
         >;
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

### Task 3: Table geometry

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

### Task 4: Table model — cards, edges, context and state

**Files:**
- Create: `src/components/table/tableModel.ts`
- Create: `src/components/table/tableEdges.ts`
- Test: `test/components/tableModel.test.js`

**Interfaces:**
- Consumes the Task 2 types (`src/types/table.ts`) and the Task 3 geometry. It consumes `TranscriptionItem` from `src/types/electron.ts`.
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
  export const SELECTION_AI_LIMIT = 12;   // Summarise and Ask take at most 12 cards; the bar says so
  export function buildSelectionContext(spaceName: string, entities: TableEntity[]): string;   // every given item, no silent cut
  export function buildBoardContext(spaceName: string, entities: TableEntity[]): string;       // nothing selected: names the total, includes the first 12
  export function pinSelection(spaceName: string, entities: TableEntity[]): { keys: string[]; context: string } | { error: "empty" | "tooMany" };
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

test("pinning freezes up to 12 selected items and refuses more, never truncating", async () => {
  const { pinSelection, SELECTION_AI_LIMIT } = await load();
  assert.equal(SELECTION_AI_LIMIT, 12);
  const twelve = Array.from({ length: 12 }, (_, i) => entity("note", i + 1));
  const pin = pinSelection("Work", twelve);
  assert.equal(pin.keys.length, 12);
  assert.match(pin.context, /^The user selected 12 items/);
  assert.equal((pin.context.match(/<item /g) || []).length, 12);
  assert.deepEqual(pinSelection("Work", [...twelve, entity("note", 13)]), { error: "tooMany" });
  assert.deepEqual(pinSelection("Work", []), { error: "empty" });
});

test("board context names the total and says which items it left out", async () => {
  const { buildBoardContext } = await load();
  const ctx = buildBoardContext("Work", Array.from({ length: 20 }, (_, i) => entity("note", i + 1)));
  assert.match(ctx, /holds 20 cards\. Excerpts of the first 12 are below; the rest are not included\./);
  assert.equal((ctx.match(/<item /g) || []).length, 12);
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

If the grep finds nothing (Plan 06 shipped without its universal-mentions task), use this body instead and keep the same tests:

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
export const SELECTION_AI_LIMIT = 12;
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

const itemBlock = (e: TableEntity) =>
  `<item type="${e.kind}" title="${escapeAttr(e.title ?? "")}" at="${escapeAttr(e.at)}">\n${e.excerpt.slice(0, CONTEXT_CHARS)}\n</item>`;

// Instructions to the model, not UI copy: English like useContainerChat's context.
// Every given item is included; callers enforce SELECTION_AI_LIMIT up front.
export function buildSelectionContext(spaceName: string, entities: TableEntity[]): string {
  const header = `The user selected ${entities.length} items on the canvas of the space "${spaceName}". Answer about these items only. Each item is an excerpt.`;
  return [header, ...entities.map(itemBlock)].join("\n\n");
}

export function buildBoardContext(spaceName: string, entities: TableEntity[]): string {
  const shown = entities.slice(0, SELECTION_AI_LIMIT);
  const header =
    `The user is looking at the canvas of the space "${spaceName}", which holds ${entities.length} cards. ` +
    (shown.length < entities.length
      ? `Excerpts of the first ${shown.length} are below; the rest are not included.`
      : "Excerpts of all of them are below.");
  return [header, ...shown.map(itemBlock)].join("\n\n");
}

export function pinSelection(
  spaceName: string,
  entities: TableEntity[]
): { keys: string[]; context: string } | { error: "empty" | "tooMany" } {
  if (entities.length === 0) return { error: "empty" };
  if (entities.length > SELECTION_AI_LIMIT) return { error: "tooMany" };
  return { keys: entities.map((e) => refKey(e.ref)), context: buildSelectionContext(spaceName, entities) };
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

### Task 5: Gestures and keyboard as pure state machines

**Files:**
- Create: `src/components/table/tableGestures.ts`
- Test: `test/components/tableGestures.test.js`

**Interfaces:**
- Consumes Task 3 (`Point`, `Rect`, `Viewport`, `Direction`, `GRID`, `snapToGrid`, `zoomAt`, `normalizeRect`).
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
    | { type: "zoomIn" } | { type: "zoomOut" } | { type: "resetView" } | { type: "enterCards" };
  export function cancel(gesture: Gesture): MoveEffect;   // pointercancel / lost capture: undo, never commit
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

test("a cancelled pointer restores positions and viewport instead of committing", async () => {
  const { press, move, cancel } = await load();
  const drag = move(press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1" }), { x: 40, y: 0 }).gesture;
  assert.deepEqual(cancel(drag), { type: "positions", positions: { "note:1": { x: 10, y: 10 } } });
  const pan = move(press({ ...base, point: { x: 0, y: 0 }, cardKey: null }), { x: 40, y: 0 }).gesture;
  assert.deepEqual(cancel(pan), { type: "viewport", viewport: V });
  assert.equal(cancel(press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1" })), null, "an unmoved press has nothing to undo");
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
  assert.deepEqual(keyAction({ key: "ArrowRight", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, false), { type: "enterCards" });
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

// A cancelled pointer (system gesture, lost capture) restores where things were.
export function cancel(gesture: Gesture): MoveEffect {
  if (gesture.kind === "drag" && gesture.moved) return { type: "positions", positions: { ...gesture.origins } };
  if (gesture.kind === "pan" && gesture.moved) return { type: "viewport", viewport: gesture.origin };
  return null;
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
  | { type: "resetView" }
  | { type: "enterCards" };

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
  // From the canvas itself, an arrow steps into the cards.
  if (dir) return { type: "enterCards" };
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
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/table/tableGestures.ts test/components/tableGestures.test.js
git commit -m "feat(table): pointer, wheel and keyboard rules as pure state machines"
```

---

### Task 6: `TableCanvas`, `TableCard` and canvas CSS

**Files:**
- Create: `src/components/table/TableCard.tsx`
- Create: `src/components/table/TableCanvas.tsx`
- Modify: `src/index.css`:
  - `@theme` (`:7`): `--color-table-dot`, `--color-table-connector`;
  - `.dark` (`:113`): the same two tokens;
  - a new "The Table" rule block at the end of the file.
- Test: `test/components/tableCanvas.test.js`

**Interfaces:**
- Consumes Tasks 3–5 and `TableCardModel`. It also consumes `--color-agent-brand` (`index.css:19`, the violet chat rail), `--color-ring` (selection and focus) and `--motion-spring-snap` (Plan 01).
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

test("when the first card is off screen, the tab stop moves to a rendered card", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(TableCanvas, props({ cards: [card("note:9", "note", 9000, 9000), card("note:1", "note", 32, 32)], selection: [] }));
  assert.match(html, /tabindex="0"[^>]*data-card-key="note:1"/);
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
  assert.match(css, /\.table-card\[data-snapping="true"\]\s*\{[^}]*var\(--motion-slow\) var\(--motion-spring-snap\)/);
  assert.doesNotMatch(css.slice(css.indexOf("/* The Table (WS-M5")), /\b\d+ms\b/, "Table motion uses shared duration tokens only");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.table-card\[data-snapping="true"\]\s*\{\s*transition:\s*none;/);
  assert.match(css, /\.table-card\[data-kind="chat"\]\s*\{[^}]*border-inline-start:[^}]*var\(--color-agent-brand\)/);
  assert.match(css, /\.table-card\s*\{[^}]*border:\s*1px solid var\(--color-table-card-border\)/);
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(css);
  for (const [theme, t] of [["light", light], ["dark", dark]]) {
    for (const fg of ["--color-table-connector", "--color-agent-brand"]) {
      assert.ok(contrastRatio(t[fg], t["--color-background"]) >= 3, `${theme} ${fg}`);
    }
    for (const bg of ["--color-background", "--color-card"]) {
      assert.ok(contrastRatio(t["--color-table-card-border"], t[bg]) >= 3, `${theme} card border on ${bg}`);
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
import { cancel, keyAction, move, press, release, wheel, type Gesture } from "./tableGestures";
import { TableCard } from "./TableCard";
import type { TableCardModel } from "./tableModel";

export const TABLE_REF_MIME = "application/x-loqui-table-ref";
const SNAP_MS = 360; // matches --motion-slow, the shared duration the snap spring runs on
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
  // One pointer owns a gesture; a second touch never hijacks it.
  const pointerIdRef = useRef<number | null>(null);
  // Pointer moves are coalesced to one per animation frame.
  const frameRef = useRef<number | null>(null);
  const latestPoint = useRef<Point | null>(null);

  const placed = useMemo(() => cards.map((c) => ({ id: c.key, rect: c.rect })), [cards]);
  const byKey = useMemo(() => new Map(cards.map((c) => [c.key, c])), [cards]);
  const always = useMemo(() => [...selection, ...(focused ? [focused] : []), ...dragging], [selection, focused, dragging]);
  const visible = useMemo(() => visibleIds(placed, viewport, size, always), [placed, viewport, size, always]);
  const rendered = cards.filter((c) => visible.has(c.key));
  // The tab stop is always a rendered card, so a restored viewport can never strand keyboard users.
  const tabStop = focused && visible.has(focused) ? focused : (rendered[0]?.key ?? null);

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

  // Move DOM focus to the focused card, but only when focus is already inside
  // the canvas: reloads, zooms and resizes must never pull it out of the Ask
  // box, the toolbar or the inbox.
  useEffect(() => {
    const root = rootRef.current;
    if (!focused || !root || !root.contains(document.activeElement)) return;
    const el = root.querySelector<HTMLElement>(`[data-card-key="${focused}"]`);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [focused]);

  const local = (event: { clientX: number; clientY: number }): Point => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: event.clientX - (r?.left ?? 0), y: event.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || pointerIdRef.current !== null) return;
    pointerIdRef.current = event.pointerId;
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

  const applyMove = () => {
    frameRef.current = null;
    const point = latestPoint.current;
    if (!point) return;
    const { gesture, effect } = move(gestureRef.current, point);
    gestureRef.current = gesture;
    if (!effect) return;
    if (effect.type === "viewport") props.onViewport(effect.viewport, false);
    if (effect.type === "positions") {
      const keys = Object.keys(effect.positions);
      setDragging((current) => (current.length === keys.length ? current : keys));
      props.onMove(effect.positions);
    }
    if (effect.type === "lasso") {
      setLasso(effect.rect);
      props.onSelect(lassoSelect(placed, effect.rect, viewport));
    }
  };
  const cancelFrame = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerIdRef.current) return;
    latestPoint.current = local(event);
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(applyMove);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerIdRef.current) return;
    pointerIdRef.current = null;
    cancelFrame(); // release() computes from the final point itself
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

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerIdRef.current) return;
    pointerIdRef.current = null;
    cancelFrame();
    const effect = cancel(gestureRef.current);
    gestureRef.current = { kind: "idle" };
    setDragging([]);
    setLasso(null);
    if (effect?.type === "positions") props.onMove(effect.positions);
    if (effect?.type === "viewport") props.onViewport(effect.viewport, false);
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
      case "enterCards":
        return tabStop ? props.onFocus(tabStop) : undefined;
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
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
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
- Add to `@theme` after `--color-accent-foreground`:

  ```css
    /* The Table (WS-M5): decorative dot grid; connectors are non-text UI (≥3:1). */
    --color-table-dot: #dcd7d9;
    --color-table-connector: #8a8a8a;
    /* Cards sit on a same-coloured canvas, so their border is what identifies them (≥3:1). */
    --color-table-card-border: #949494;
  ```

- Add to `.dark`:

  ```css
    --color-table-dot: #3a2832;
    --color-table-connector: #8f7d87;
    --color-table-card-border: #7d6672;
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
    border: 1px solid var(--color-table-card-border);
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
      left var(--motion-slow) var(--motion-spring-snap),
      top var(--motion-slow) var(--motion-spring-snap);
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

### Task 7: `TableView` — board hook, inbox tray, selection bar, and the Space's chat

**Files:**
- Create: `src/components/table/useTableBoard.ts`
- Create: `src/components/table/TableInbox.tsx`
- Create: `src/components/table/TableSelectionBar.tsx`
- Create: `src/components/table/TableView.tsx`
- Modify: `src/hooks/useContainerChat.ts` (`UseContainerChatOptions` at `:13-17`, the destructure at `:43-47`, `noteContext` at `:75`)
- Modify: `src/locales/*/translation.json` (the `table.*` keys)
- Test: `test/components/tableView.test.js`

**Interfaces:**
- Consumes Tasks 2–6. It consumes `useContainerChat` and `OverviewAskSection` (`src/components/notes/overview/OverviewAskSection.tsx`, props as at `ContainerOverview.tsx:129-139`). It consumes `window.electronAPI.saveNote(title, content, noteType, sourceFile, audioDuration, folderId, spaceId)` (`preload.js:224`) and `window.electronAPI.onTranscriptionAdded(cb)` (`preload.js:345-363`).
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

const READY = { locality: "remote", providerId: "openai", model: "gpt-x", state: { status: "ready" } };
const CHIP_STUBS = {
  "/routing/RouteChips": `
    import { createElement } from "react";
    export const RouteDestinationChip = ({ route }) => createElement("span", { "data-route-chip": route.locality, "data-provider": route.providerId });
    export const RouteStateChip = ({ state }) => createElement("span", { "data-route-state": state.status });`,
};
const bar = (t, props, mocks = CHIP_STUBS) =>
  render(t, "/components/table/TableSelectionBar.tsx", "TableSelectionBar", {
    count: 3, busy: false, route: READY, onSummarise() {}, onAsk() {}, onGroup() {}, onRemove() {}, ...props,
  }, mocks);
const disabled = (html, key) => new RegExp(`<button(?=[^>]*disabled)[^>]*>${key.replace(/\./g, "\\.")}<`).test(html);

test("the selection bar is a toolbar with the four CCR-5 actions and no Delete", async (t) => {
  const html = await bar(t, {});
  assert.match(html, /role="toolbar"/);
  for (const k of ["count", "summarise", "ask", "group", "remove"]) assert.match(html, new RegExp(`table\\.selection\\.${k}`));
  assert.doesNotMatch(html, /delete/i);
});

test("the bar shows where Summarise and Ask will send before anything is sent", async (t) => {
  const html = await bar(t, {});
  assert.match(html, /data-route-chip="remote"[^>]*data-provider="openai"/);
  assert.equal(disabled(html, "table.selection.summarise"), false);
});

test("a route that cannot run disables the AI actions and says why", async (t) => {
  const html = await bar(t, { route: { ...READY, state: { status: "needsKey", provider: "OpenAI" } } });
  assert.match(html, /data-route-state="needsKey"/);
  assert.ok(disabled(html, "table.selection.summarise") && disabled(html, "table.selection.ask"));
  assert.equal(disabled(html, "table.selection.group"), false, "grouping is local and stays available");
});

test("more than 12 selected cards disables AI actions and explains the limit", async (t) => {
  const html = await bar(t, { count: 13 });
  assert.ok(disabled(html, "table.selection.summarise") && disabled(html, "table.selection.ask"));
  assert.match(html, /table\.selection\.limit/);
});

test("composition: the real route chip draws Plan 01's LocalityRing", async (t) => {
  const html = await bar(t, {}, {});
  assert.match(html, /role="img"[^>]*data-locality="remote"|data-locality="remote"[^>]*role="img"/);
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
      "/lib/routes": `export const useResolvedRoute = () => (${JSON.stringify({ id: "chat", kind: "text", locality: "remote", provider: "OpenAI", providerId: "openai", model: "gpt-x", state: { status: "ready" }, sends: "x", settingsPath: "llms/chat" })});`,
      ...CHIP_STUBS,
    }
  );
  assert.match(html, /SWITCH/);
  assert.match(html, /table-toolbar__route[^>]*><span data-route-chip="remote"/, "the chat route is visible on the Table itself");
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
    assert.match(tbl.selection.limit, /\{\{limit\}\}/, lang);
    assert.match(tbl.ask.pinned, /\{\{count\}\}/, lang);
    assert.ok(tbl.ask.wholeTable, `${lang}.table.ask.wholeTable`);
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
   import { cardsFor, deriveEdges, dictationEntityFromItem, initialTableState, refKey, tableReducer } from "./tableModel";

   const VIEWPORT_SAVE_MS = 400;
   const LIFECYCLE_RELOAD_MS = 250;

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

     // Notes and dictations change elsewhere (editor, history, retention). A
     // short-debounced reload keeps ghost cards from lingering; conversation
     // deletions are caught by the next placement, which main refuses.
     useEffect(() => {
       const api = window.electronAPI;
       let timer: ReturnType<typeof setTimeout> | undefined;
       const soon = () => {
         clearTimeout(timer);
         timer = setTimeout(() => void reload(), LIFECYCLE_RELOAD_MS);
       };
       const offs = [
         api?.onNoteAdded?.(soon),
         api?.onNoteUpdated?.(soon),
         api?.onNoteDeleted?.(soon),
         api?.onTranscriptionUpdated?.(soon),
         api?.onTranscriptionDeleted?.(soon),
         api?.onTranscriptionsCleared?.(soon),
       ];
       return () => {
         clearTimeout(timer);
         offs.forEach((off) => off?.());
       };
     }, [reload]);

     const place = useCallback(
       async (placements: TablePlacement[]) => {
         if (placements.length === 0) return true;
         try {
           const result = await window.electronAPI?.placeTableCards?.(spaceId, placements);
           if (result?.success) {
             // Apply only what main accepted; anything refused (deleted meanwhile) reloads.
             const accepted = new Set(result.placedKeys);
             const applied = placements.filter((p) => accepted.has(refKey(p)));
             dispatch({ type: "placed", placements: applied });
             setStatus("idle");
             if (applied.length === placements.length) return true;
             await reload();
             return false;
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
   import type { ResolvedRoute } from "../../lib/routes";
   import { RouteDestinationChip, RouteStateChip } from "../settings/routing/RouteChips";
   import { Button } from "../ui/button";
   import { SELECTION_AI_LIMIT } from "./tableModel";

   export interface TableSelectionBarProps {
     count: number;
     busy: boolean;
     route: Pick<ResolvedRoute, "locality" | "providerId" | "model" | "state">;
     onSummarise: () => void;
     onAsk: () => void;
     onGroup: () => void;
     onRemove: () => void;
   }

   // CCR-5: nothing here deletes content. Summarise and Ask go through the
   // Space's own chat; the destination (LocalityRing + provider) is on the bar
   // before anything is sent, and a route that cannot run disables them.
   export function TableSelectionBar({ count, busy, route, onSummarise, onAsk, onGroup, onRemove }: TableSelectionBarProps) {
     const { t } = useTranslation();
     const tooMany = count > SELECTION_AI_LIMIT;
     const routeReady = route.state.status === "ready";
     const aiDisabled = busy || tooMany || !routeReady;
     return (
       <div role="toolbar" aria-label={t("table.selection.count", { count })} className="table-selbar">
         <span className="table-selbar__count">{t("table.selection.count", { count })}</span>
         {routeReady ? <RouteDestinationChip route={route} /> : <RouteStateChip state={route.state} />}
         <Button size="sm" variant="ghost" className="table-selbar__machine" disabled={aiDisabled} onClick={onSummarise}>
           {t("table.selection.summarise")}
         </Button>
         <Button size="sm" variant="ghost" disabled={aiDisabled} onClick={onAsk}>
           {t("table.selection.ask")}
         </Button>
         <Button size="sm" variant="ghost" disabled={busy} onClick={onGroup}>
           {t("table.selection.group")}
         </Button>
         <Button size="sm" variant="ghost" onClick={onRemove}>
           {t("table.selection.remove")}
         </Button>
         {tooMany && <span className="table-selbar__note">{t("table.selection.limit", { limit: SELECTION_AI_LIMIT })}</span>}
       </div>
     );
   }
   ```

   `Button` has `variant="ghost"` (`src/components/ui/button.tsx:82`) and `size="sm"` (`:112`). If Plan 01 renamed them, use the equivalents. Never use `variant="live"` here: these are not voice controls (D1).

5. Create `src/components/table/TableView.tsx`:

   ```tsx
   import { useCallback, useEffect, useMemo, useRef, useState } from "react";
   import type { ReactNode } from "react";
   import { useTranslation } from "react-i18next";
   import { useContainerChat } from "../../hooks/useContainerChat";
   import { useResolvedRoute } from "../../lib/routes";
   import type { NoteItem, SpaceItem } from "../../types/electron";
   import type { TableEntityRef } from "../../types/table";
   import { OverviewAskSection } from "../notes/overview/OverviewAskSection";
   import { RouteDestinationChip, RouteStateChip } from "../settings/routing/RouteChips";
   import { Button } from "../ui/button";
   import { TableCanvas } from "./TableCanvas";
   import { TableInbox } from "./TableInbox";
   import { TableSelectionBar } from "./TableSelectionBar";
   import { fitViewport, screenToWorld, snapToGrid, zoomAt, type Point } from "./tableGeometry";
   import { buildBoardContext, buildGroupedNote, parseRefKey, pinSelection, placementsFor } from "./tableModel";
   import { useTableBoard } from "./useTableBoard";

   // The Table sends its own context; a stable empty list keeps useContainerChat's memo quiet.
   const NO_NOTES: NoteItem[] = [];
   const RELOAD_AFTER_CHAT_MS = 600;

   interface PendingResult { sources: string[]; at: Point }
   interface Pinned { keys: string[]; context: string }

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
     const stateRef = useRef(state);
     stateRef.current = state;
     // Where Summarise and Ask send: shown before anything is sent (spec §4,
     // "local and remote choices stay explicit"). Same resolver the chat uses.
     const chatRoute = useResolvedRoute("chat");
     const [askOpen, setAskOpen] = useState(false);
     const [expanded, setExpanded] = useState<string | null>(null);
     const [busy, setBusy] = useState(false);
     // The selection is frozen when Ask or Summarise starts: changing the
     // selection afterwards never changes what the answer was about.
     const [pinned, setPinned] = useState<Pinned | null>(null);
     const pending = useRef<PendingResult | null>(null);
     const canvasSize = useRef({ width: 1200, height: 800 });

     const selected = useMemo(
       () => cards.filter((c) => state.selection.includes(c.key)).map((c) => c.entity),
       [cards, state.selection]
     );
     const boardContext = useMemo(() => buildBoardContext(space.name, cards.map((c) => c.entity)), [cards, space.name]);
     const chat = useContainerChat({ space, folder: null, notes: NO_NOTES, contextOverride: pinned?.context ?? boardContext });

     const belowSelection = (): Point => {
       const rects = cards.filter((c) => state.selection.includes(c.key)).map((c) => c.rect);
       if (!rects.length) return screenToWorld({ x: canvasSize.current.width / 2, y: canvasSize.current.height / 2 }, state.viewport);
       const cx = rects.reduce((sum, r) => sum + r.x + r.w / 2, 0) / rects.length;
       const bottom = Math.max(...rects.map((r) => r.y + r.h));
       return { x: snapToGrid(cx - 140), y: snapToGrid(bottom + 40) };
     };

     // Summarise and Ask both start a fresh conversation. The prompt is sent
     // only after the reset has rendered, so the sender never reuses the old
     // conversation id or history (useChatMessageSender captures them per render).
     const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
     const startFromSelection = (prompt: string | null) => {
       if (chatRoute.state.status !== "ready") return;
       const pin = pinSelection(space.name, selected);
       if ("error" in pin) return;
       setPinned(pin);
       pending.current = { sources: pin.keys, at: belowSelection() };
       setAskOpen(true);
       chat.startNewChat();
       if (prompt) setQueuedPrompt(prompt);
     };
     useEffect(() => {
       if (!queuedPrompt || chat.activeConversationId !== null || chat.messages.length > 0) return;
       const prompt = queuedPrompt;
       setQueuedPrompt(null);
       setBusy(true);
       void chat.sendMessage(prompt).finally(() => setBusy(false));
     }, [chat.activeConversationId, chat.messages.length, chat.sendMessage, queuedPrompt]);
     // Switching conversation or starting a plain new chat abandons the pin.
     const switchConversation = (id: number) => {
       pending.current = null;
       setPinned(null);
       return chat.switchConversation(id);
     };
     const newChat = () => {
       pending.current = null;
       setPinned(null);
       chat.startNewChat();
     };

     // An answer created from the table (Summarise or Ask) becomes a card below
     // its pinned sources, linked to them, as soon as its conversation exists.
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

     const open = useCallback(
       (key: string) => {
         const ref = parseRefKey(key);
         if (!ref) return;
         if (ref.type === "note") onOpenNote(ref.id);
         else if (ref.type === "chat") {
           setAskOpen(true);
           pending.current = null;
           setPinned(null);
           void chat.switchConversation(ref.id);
         } else setExpanded((current) => (current === key ? null : key));
       },
       [chat.switchConversation, onOpenNote]
     );

     const placeFromInbox = useCallback(
       (key: string, world?: Point) => {
         const ref = parseRefKey(key);
         if (!ref) return;
         const at =
           world ??
           screenToWorld({ x: canvasSize.current.width / 2, y: canvasSize.current.height / 2 }, stateRef.current.viewport);
         void board.place([{ ...ref, x: snapToGrid(at.x), y: snapToGrid(at.y) }]);
       },
       [board.place]
     );

     // Stable handlers: the canvas re-renders on every pointer frame, and a new
     // function identity would reconnect every card's ResizeObserver.
     const onMove = useCallback((positions: Record<string, Point>) => dispatch({ type: "moved", positions }), [dispatch]);
     const onDrop = useCallback(
       (positions: Record<string, Point>) =>
         void board.place(placementsFor(stateRef.current, Object.keys(positions), positions)),
       [board.place]
     );
     const onClickCard = useCallback((key: string, additive: boolean) => dispatch({ type: "clickCard", key, additive }), [dispatch]);
     const onSelect = useCallback((keys: string[]) => dispatch({ type: "select", keys }), [dispatch]);
     const onFocus = useCallback((key: string | null) => dispatch({ type: "focus", key }), [dispatch]);
     const onRemove = useCallback((keys: string[]) => void board.hide(keys), [board.hide]);
     const onNudge = useCallback(
       (keys: string[], dx: number, dy: number) => {
         const current = stateRef.current;
         const positions = Object.fromEntries(
           board.cards.filter((c) => keys.includes(c.key)).map((c) => [c.key, { x: c.rect.x + dx, y: c.rect.y + dy }])
         );
         void board.place(placementsFor(current, keys, positions));
       },
       [board.cards, board.place]
     );
     const onMeasure = useCallback((key: string, h: number) => dispatch({ type: "measured", key, h }), [dispatch]);
     const onResize = useCallback((size: { width: number; height: number }) => {
       canvasSize.current = size;
     }, []);

     const routeChip =
       chatRoute.state.status === "ready" ? (
         <RouteDestinationChip route={chatRoute} />
       ) : (
         <RouteStateChip state={chatRoute.state} />
       );

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
           <span className="ms-auto table-toolbar__route">{routeChip}</span>
           <Button size="sm" variant="ghost" aria-expanded={askOpen} onClick={() => setAskOpen((v) => !v)}>
             {t(askOpen ? "table.ask.close" : "table.ask.open")}
           </Button>
         </div>
         <p role="status" aria-live="polite" className="table-status">{status}</p>
         <div className="table-body">
           <TableInbox entities={state.board?.inbox ?? []} onPlace={placeFromInbox} />
           <TableCanvas
             cards={cards}
             edges={edges}
             viewport={state.viewport}
             selection={state.selection}
             focused={state.focused}
             expanded={expanded}
             label={t("table.canvasLabel", { space: space.name })}
             onViewport={board.setViewport}
             onMove={onMove}
             onDrop={onDrop}
             onClickCard={onClickCard}
             onSelect={onSelect}
             onFocus={onFocus}
             onOpen={open}
             onRemove={onRemove}
             onNudge={onNudge}
             onMeasure={onMeasure}
             onDropRef={placeFromInbox}
             onResize={onResize}
           />
           {askOpen && (
             <aside className="table-ask" aria-label={t("table.ask.open")}>
               <div className="table-ask__head">
                 {routeChip}
                 <p className="table-ask__scope">
                   {pinned ? t("table.ask.pinned", { count: pinned.keys.length }) : t("table.ask.wholeTable")}
                 </p>
               </div>
               <OverviewAskSection
                 messages={chat.messages}
                 agentState={chat.agentState}
                 onTextSubmit={chat.sendMessage}
                 onCancel={chat.cancelStream}
                 conversations={chat.conversations}
                 activeConversationId={chat.activeConversationId}
                 onSwitchConversation={switchConversation}
                 onNewChat={newChat}
                 onOpenNote={onOpenNote}
               />
             </aside>
           )}
         </div>
         {state.selection.length > 0 && (
           <TableSelectionBar
             count={state.selection.length}
             busy={busy}
             route={chatRoute}
             onSummarise={() => startFromSelection(t("table.selection.summarisePrompt"))}
             onAsk={() => startFromSelection(null)}
             onGroup={() => void group()}
             onRemove={() => void board.hide(state.selection)}
           />
         )}
       </div>
     );
   }
   ```

   `useResolvedRoute` and `ResolvedRoute` come from Plan 03 (`src/lib/routes.ts`, spec §5.1). `RouteDestinationChip` and `RouteStateChip` come from Plan 03 (`src/components/settings/routing/RouteChips.tsx`). The destination chip renders Plan 01's `LocalityRing` and names the provider with `providerDisplayLabel(providerId, t)`. When the route is not ready (needs a key, sealed, unreachable), the state chip says why, and the selection bar disables Summarise and Ask. The answer itself is persisted by the same chat path as the Space's Ask box. Per-answer route stamps are Plan 06 Task 21's, in `ChatView`.


6. Append to `src/index.css` after the Task 6 block:

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
     border: 1px dashed var(--color-table-card-border);
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
   .table-selbar__note,
   .table-ask__scope {
     margin: 0;
     font-size: 11.5px;
     color: var(--color-muted-foreground);
   }
   .table-ask__head {
     display: flex;
     flex-wrap: wrap;
     align-items: center;
     gap: 8px;
     padding: 10px 12px 0;
   }
   ```

   Summarise text uses Plan 06's `--color-ai-text` (CR-06-4), because fuchsia means machine-authored (audit M5) and that token is already contrast-tested as text. If `--color-ai-text` is not on `main`, use `--color-accent` (#d90078, 4.97:1 on `#ffffff`). In that case, also check that Plum Night's `--color-accent` reaches 4.5:1 on `--color-popover`, and if it does not, use `#ff6db8` (6.6:1 on Plum Night surfaces) for `.dark .table-selbar__machine`.

7. Locales. Add `table.*` to every locale. This script writes each nested key from a flat path list:

   ```bash
   node -e '
   const fs=require("fs"),p=require("path");
   const K=["view.label","view.list","view.table","canvasLabel","canvasRole","zoomIn","zoomOut","resetView","zoomLevel","hint","kind.note","kind.meeting","kind.dictation","kind.chat","card.label","card.untitled","card.answerPending","inbox.title","inbox.description","inbox.empty","selection.count","selection.summarise","selection.ask","selection.group","selection.remove","selection.summarisePrompt","groupedNote.title","status.full","status.truncated","status.saveFailed","ask.open","ask.close","ask.pinned","ask.wholeTable","selection.limit"];
   const L={
    en:["View","List","Table","Canvas: {{space}}","canvas","Zoom in","Zoom out","Reset view","{{percent}}%","Drag cards or the background. Shift-drag to select. Ctrl or ⌘ with the wheel zooms. Arrow keys move between cards; Shift with arrows nudges.","Note","Meeting","Dictation","Answer","{{kind}}: {{title}}","Untitled","Waiting for the answer…","Inbox","New captures. Drag one onto the table, or press Enter.","Nothing new","Selected: {{count}}","Summarise","Ask about these","Group into note","Remove from table","Summarise the selected items in a few sentences.","Grouped from the table","The table holds up to 500 cards. Remove some first.","Showing the 500 most recent cards.","Couldn’t save that position. Nothing else changed.","Ask","Close","Pinned cards: {{count}}","Asking about the whole table","AI actions work on up to {{limit}} cards."],
    de:["Ansicht","Liste","Tisch","Leinwand: {{space}}","Leinwand","Vergrößern","Verkleinern","Ansicht zurücksetzen","{{percent}} %","Karten oder den Hintergrund ziehen. Mit Umschalt ziehen, um auszuwählen. Strg oder ⌘ mit dem Mausrad zoomt. Pfeiltasten wechseln zwischen Karten; mit Umschalt verschieben sie.","Notiz","Besprechung","Diktat","Antwort","{{kind}}: {{title}}","Ohne Titel","Warte auf die Antwort …","Eingang","Neue Aufnahmen. Auf den Tisch ziehen oder Eingabe drücken.","Nichts Neues","Ausgewählt: {{count}}","Zusammenfassen","Dazu fragen","Zu Notiz bündeln","Vom Tisch nehmen","Fasse die ausgewählten Elemente in wenigen Sätzen zusammen.","Vom Tisch gebündelt","Der Tisch fasst bis zu 500 Karten. Entferne zuerst einige.","Die 500 neuesten Karten werden angezeigt.","Position konnte nicht gespeichert werden. Sonst hat sich nichts geändert.","Fragen","Schließen","Angeheftete Karten: {{count}}","Fragen zum ganzen Tisch","KI-Aktionen funktionieren mit bis zu {{limit}} Karten."],
    es:["Vista","Lista","Mesa","Lienzo: {{space}}","lienzo","Acercar","Alejar","Restablecer vista","{{percent}} %","Arrastra tarjetas o el fondo. Mayús y arrastrar para seleccionar. Ctrl o ⌘ con la rueda hace zoom. Las flechas cambian de tarjeta; con Mayús la desplazan.","Nota","Reunión","Dictado","Respuesta","{{kind}}: {{title}}","Sin título","Esperando la respuesta…","Bandeja","Capturas nuevas. Arrastra una a la mesa o pulsa Intro.","Nada nuevo","Seleccionadas: {{count}}","Resumir","Preguntar sobre esto","Agrupar en una nota","Quitar de la mesa","Resume los elementos seleccionados en pocas frases.","Agrupado desde la mesa","La mesa admite hasta 500 tarjetas. Quita algunas primero.","Se muestran las 500 tarjetas más recientes.","No se pudo guardar esa posición. No cambió nada más.","Preguntar","Cerrar","Tarjetas fijadas: {{count}}","Preguntas sobre toda la mesa","Las acciones de IA admiten hasta {{limit}} tarjetas."],
    fr:["Vue","Liste","Table","Canevas : {{space}}","canevas","Zoom avant","Zoom arrière","Réinitialiser la vue","{{percent}} %","Faites glisser les cartes ou le fond. Maj + glisser pour sélectionner. Ctrl ou ⌘ avec la molette pour zoomer. Les flèches passent d’une carte à l’autre ; avec Maj, elles la déplacent.","Note","Réunion","Dictée","Réponse","{{kind}} : {{title}}","Sans titre","En attente de la réponse…","Boîte de réception","Nouvelles captures. Faites-en glisser une sur la table ou appuyez sur Entrée.","Rien de nouveau","Sélection : {{count}}","Résumer","Poser une question","Regrouper dans une note","Retirer de la table","Résume les éléments sélectionnés en quelques phrases.","Regroupé depuis la table","La table contient au plus 500 cartes. Retirez-en d’abord.","Affichage des 500 cartes les plus récentes.","Impossible d’enregistrer cette position. Rien d’autre n’a changé.","Demander","Fermer","Cartes épinglées : {{count}}","Questions sur toute la table","Les actions d’IA portent sur {{limit}} cartes au maximum."],
    it:["Vista","Elenco","Tavolo","Tela: {{space}}","tela","Ingrandisci","Riduci","Ripristina vista","{{percent}}%","Trascina le schede o lo sfondo. Maiusc e trascina per selezionare. Ctrl o ⌘ con la rotellina per lo zoom. Le frecce passano da una scheda all’altra; con Maiusc la spostano.","Nota","Riunione","Dettatura","Risposta","{{kind}}: {{title}}","Senza titolo","In attesa della risposta…","In arrivo","Nuove acquisizioni. Trascinane una sul tavolo o premi Invio.","Niente di nuovo","Selezionati: {{count}}","Riassumi","Chiedi su questi","Raggruppa in una nota","Togli dal tavolo","Riassumi gli elementi selezionati in poche frasi.","Raggruppato dal tavolo","Il tavolo contiene al massimo 500 schede. Rimuovine prima qualcuna.","Sono mostrate le 500 schede più recenti.","Impossibile salvare la posizione. Nient’altro è cambiato.","Chiedi","Chiudi","Schede fissate: {{count}}","Domande su tutto il tavolo","Le azioni IA funzionano con al massimo {{limit}} schede."],
    pt:["Visualização","Lista","Mesa","Tela: {{space}}","tela","Aproximar","Afastar","Redefinir visualização","{{percent}}%","Arraste cartões ou o fundo. Shift e arrastar para selecionar. Ctrl ou ⌘ com a roda faz zoom. As setas mudam de cartão; com Shift, movem-no.","Nota","Reunião","Ditado","Resposta","{{kind}}: {{title}}","Sem título","Aguardando a resposta…","Entrada","Novas capturas. Arraste uma para a mesa ou pressione Enter.","Nada novo","Selecionados: {{count}}","Resumir","Perguntar sobre estes","Agrupar em uma nota","Tirar da mesa","Resuma os itens selecionados em poucas frases.","Agrupado a partir da mesa","A mesa comporta até 500 cartões. Remova alguns primeiro.","Mostrando os 500 cartões mais recentes.","Não foi possível salvar essa posição. Nada mais mudou.","Perguntar","Fechar","Cartões fixados: {{count}}","Perguntas sobre toda a mesa","As ações de IA funcionam com até {{limit}} cartões."],
    ru:["Вид","Список","Стол","Холст: {{space}}","холст","Увеличить","Уменьшить","Сбросить вид","{{percent}} %","Перетаскивайте карточки или фон. Shift и перетаскивание — выделение. Ctrl или ⌘ с колесом — масштаб. Стрелки переходят между карточками; со Shift — сдвигают её.","Заметка","Встреча","Диктовка","Ответ","{{kind}}: {{title}}","Без названия","Ожидание ответа…","Входящие","Новые записи. Перетащите на стол или нажмите Enter.","Ничего нового","Выбрано: {{count}}","Кратко изложить","Спросить об этом","Собрать в заметку","Убрать со стола","Кратко изложи выбранные элементы в нескольких предложениях.","Собрано со стола","На столе помещается до 500 карточек. Сначала уберите часть.","Показаны 500 последних карточек.","Не удалось сохранить положение. Больше ничего не изменилось.","Спросить","Закрыть","Закреплено карточек: {{count}}","Вопросы обо всём столе","Действия ИИ работают максимум с {{limit}} карточками."],
    ja:["表示","リスト","テーブル","キャンバス: {{space}}","キャンバス","拡大","縮小","表示をリセット","{{percent}}%","カードや背景をドラッグ。Shift を押しながらドラッグで選択。Ctrl または ⌘ とホイールでズーム。矢印キーでカード間を移動し、Shift と矢印で少しずつ動かします。","メモ","ミーティング","音声入力","回答","{{kind}}: {{title}}","無題","回答を待っています…","受信箱","新しいキャプチャ。テーブルにドラッグするか Enter を押します。","新着なし","選択中: {{count}}","要約","これについて質問","メモにまとめる","テーブルから外す","選択した項目を数文で要約してください。","テーブルからまとめたメモ","テーブルに置けるカードは 500 枚までです。先にいくつか外してください。","最新の 500 枚を表示しています。","その位置を保存できませんでした。ほかには何も変わっていません。","質問","閉じる","固定したカード: {{count}}","テーブル全体について質問","AI 操作は最大 {{limit}} 枚のカードまでです。"],
    "zh-CN":["视图","列表","桌面","画布：{{space}}","画布","放大","缩小","重置视图","{{percent}}%","拖动卡片或背景。按住 Shift 拖动可框选。Ctrl 或 ⌘ 加滚轮可缩放。方向键在卡片间移动；Shift 加方向键可微调位置。","笔记","会议","听写","回答","{{kind}}：{{title}}","无标题","正在等待回答…","收件箱","新的记录。拖到桌面上，或按 Enter。","暂无新内容","已选择：{{count}}","总结","就这些提问","合并为笔记","从桌面移除","用几句话总结所选内容。","从桌面合并","桌面最多容纳 500 张卡片。请先移除一些。","显示最近的 500 张卡片。","无法保存该位置。其他内容均未更改。","提问","关闭","已固定卡片：{{count}}","就整个桌面提问","AI 操作最多支持 {{limit}} 张卡片。"],
    "zh-TW":["檢視","清單","桌面","畫布：{{space}}","畫布","放大","縮小","重設檢視","{{percent}}%","拖曳卡片或背景。按住 Shift 拖曳可框選。Ctrl 或 ⌘ 加滾輪可縮放。方向鍵在卡片間移動；Shift 加方向鍵可微調位置。","筆記","會議","聽寫","回答","{{kind}}：{{title}}","未命名","正在等待回答…","收件匣","新的記錄。拖到桌面上，或按 Enter。","沒有新內容","已選取：{{count}}","摘要","針對這些提問","合併為筆記","從桌面移除","用幾句話摘要所選內容。","從桌面合併","桌面最多可容納 500 張卡片。請先移除一些。","顯示最近的 500 張卡片。","無法儲存該位置。其他內容均未變更。","提問","關閉","已釘選卡片：{{count}}","針對整個桌面提問","AI 操作最多支援 {{limit}} 張卡片。"],
    ar:["العرض","قائمة","طاولة","لوحة: {{space}}","لوحة","تكبير","تصغير","إعادة ضبط العرض","{{percent}}٪","اسحب البطاقات أو الخلفية. اسحب مع Shift للتحديد. Ctrl أو ⌘ مع العجلة للتكبير. تنتقل الأسهم بين البطاقات، ومع Shift تحرّكها قليلًا.","ملاحظة","اجتماع","إملاء","إجابة","{{kind}}: {{title}}","بلا عنوان","بانتظار الإجابة…","الوارد","التقاطات جديدة. اسحب واحدًا إلى الطاولة أو اضغط Enter.","لا جديد","المحدد: {{count}}","تلخيص","اسأل عن هذه","تجميع في ملاحظة","إزالة من الطاولة","لخّص العناصر المحددة في بضع جمل.","مجمّعة من الطاولة","تتسع الطاولة لـ 500 بطاقة كحد أقصى. أزل بعضها أولًا.","تُعرض أحدث 500 بطاقة.","تعذّر حفظ هذا الموضع. لم يتغير شيء آخر.","اسأل","إغلاق","البطاقات المثبتة: {{count}}","السؤال عن الطاولة كلها","تعمل إجراءات الذكاء الاصطناعي على {{limit}} بطاقة كحد أقصى."]};
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

### Task 8: Entry point — `List | Table` in the Space overview, preview stubs, docs

**Files:**
- Modify: `src/components/notes/overview/ContainerOverview.tsx`:
  - imports (`:1-21`);
  - state, after `:47`;
  - an early return for Table mode before `return (` at `:93`;
  - the header actions row at `:113`.
- Create: `src/preview/previewTable.ts` (in-memory Table store for the browser preview)
- Modify: `src/preview/browserPreview.ts` (spread it in after `getSpaceNotes` at `:196`)
- Test: `test/components/previewTable.test.js`
- Modify: `src/locales/*/translation.json`. No new keys: the switch reuses `table.view.*` from Task 7.
- Modify: `DESIGN.md` (a "The Table (Labs)" subsection), `docs/PRIVACY.md` (local layout storage)
- Test: `test/components/containerOverviewTable.test.js`

**Interfaces:**
- Consumes the `labsTable` setting (Task 1) and `TableView` (Task 7, lazily imported).
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

2. Preview store. The browser preview must behave like main, or visual review is misleading. Create `src/preview/previewTable.ts`:

   ```ts
   import type { NoteItem, TranscriptionItem } from "../types/electron";
   import type { TableBoardData, TableEntity, TableEntityRef, TableLayout, TablePlacement, TableViewport } from "../types/table";

   // Browser preview only: an in-memory stand-in for main's Table storage, so
   // placing, removing and linking behave like the desktop app (minus persistence).
   export function createPreviewTable(source: {
     notes: () => Pick<NoteItem, "id" | "title" | "content" | "note_type" | "updated_at">[];
     history: () => Pick<TranscriptionItem, "id" | "text" | "timestamp" | "audio_duration_ms">[];
   }) {
     const layout = new Map<string, TableLayout>();
     const links = new Map<string, { a: TableEntityRef; b: TableEntityRef }>();
     let viewport: TableViewport | null = null;
     const key = (r: TableEntityRef) => `${r.type}:${r.id}`;
     const note = (id: number) => source.notes().find((n) => n.id === id);
     const dictation = (id: number) => source.history().find((h) => h.id === id);
     const exists = (r: TableEntityRef) => (r.type === "note" ? !!note(r.id) : r.type === "dictation" ? !!dictation(r.id) : false);
     const base = { participants: [], hrefs: [], noteId: null };
     const noteEntity = (n: ReturnType<typeof note> & object): TableEntity => ({
       ...base,
       ref: { type: "note", id: n.id },
       kind: n.note_type === "meeting" ? "meeting" : "note",
       title: n.title,
       excerpt: n.content ?? "",
       at: n.updated_at,
       durationMs: null,
       layout: layout.get(`note:${n.id}`) ?? null,
     });
     const dictationEntity = (d: ReturnType<typeof dictation> & object): TableEntity => ({
       ...base,
       ref: { type: "dictation", id: d.id },
       kind: "dictation",
       title: null,
       excerpt: d.text,
       at: d.timestamp,
       durationMs: d.audio_duration_ms ?? null,
       layout: layout.get(`dictation:${d.id}`) ?? null,
     });

     return {
       getTableBoard: async (spaceId: number): Promise<TableBoardData> => {
         const notes = source.notes().map(noteEntity);
         const dictations = source.history().map(dictationEntity);
         const cards = [...notes.filter((e) => !e.layout?.hidden), ...dictations.filter((e) => e.layout && !e.layout.hidden)];
         const inbox = [
           ...[...notes, ...dictations].filter((e) => e.layout?.hidden),
           ...dictations.filter((e) => !e.layout).slice(0, 3),
         ];
         const present = new Set([...cards, ...inbox].map((e) => key(e.ref)));
         return {
           spaceId,
           cards,
           inbox,
           links: [...links.values()].filter((l) => present.has(key(l.a)) && present.has(key(l.b))),
           viewport,
           truncated: false,
         };
       },
       placeTableCards: async (_spaceId: number, placements: TablePlacement[]) => {
         const placedKeys: string[] = [];
         for (const p of placements) {
           if (!exists(p)) continue;
           layout.set(key(p), { x: p.x, y: p.y, w: p.w ?? null, h: p.h ?? null, z: p.z ?? 0, hidden: false });
           placedKeys.push(key(p));
         }
         return { success: true as const, placed: placedKeys.length, placedKeys };
       },
       hideTableCards: async (_spaceId: number, refs: TableEntityRef[]) => {
         let hidden = 0;
         for (const r of refs) {
           if (!exists(r)) continue;
           layout.set(key(r), { ...(layout.get(key(r)) ?? { x: 0, y: 0, w: null, h: null, z: 0 }), hidden: true });
           hidden += 1;
         }
         return { success: true, hidden };
       },
       linkTableCards: async (_spaceId: number, a: TableEntityRef, b: TableEntityRef) => {
         if (!exists(a) || !exists(b) || key(a) === key(b)) return { success: false };
         const [first, second] = key(a) < key(b) ? [a, b] : [b, a];
         links.set(`${key(first)}|${key(second)}`, { a: first, b: second });
         return { success: true };
       },
       setTableViewport: async (_spaceId: number, next: TableViewport) => {
         viewport = { ...next };
         return { success: true };
       },
     };
   }
   ```

   In `src/preview/browserPreview.ts`, import it and spread it into the stub object after `getSpaceNotes` (`:196`):

   ```ts
       ...createPreviewTable({ notes: () => notes, history: () => history }),
   ```

   The arrow functions read the current `notes` and `history` (`:21`, `:92-112`), so notes added in the preview appear on the Table.

   Add `test/components/previewTable.test.js`:

   ```js
   const assert = require("node:assert/strict");
   const test = require("node:test");

   const load = () => import("../../src/preview/previewTable.ts");

   test("the preview Table honours placedKeys: place → read, hide → read, link → read", async () => {
     const { createPreviewTable } = await load();
     const notes = [{ id: 1, title: "A", content: "x", note_type: "personal", updated_at: "t" }];
     const history = [{ id: 7, text: "hi", timestamp: "t", audio_duration_ms: null }];
     const api = createPreviewTable({ notes: () => notes, history: () => history });
     assert.equal((await api.getTableBoard(1)).cards[0].layout, null);
     const placed = await api.placeTableCards(1, [{ type: "note", id: 1, x: 40, y: 48 }, { type: "note", id: 99, x: 0, y: 0 }]);
     assert.deepEqual(placed.placedKeys, ["note:1"], "unknown ids are refused like main");
     assert.deepEqual((await api.getTableBoard(1)).cards[0].layout, { x: 40, y: 48, w: null, h: null, z: 0, hidden: false });
     await api.hideTableCards(1, [{ type: "note", id: 1 }]);
     assert.ok((await api.getTableBoard(1)).inbox.some((e) => e.ref.id === 1 && e.layout.hidden));
     await api.placeTableCards(1, [{ type: "dictation", id: 7, x: 0, y: 0 }]);
     assert.equal((await api.linkTableCards(1, { type: "note", id: 1 }, { type: "dictation", id: 7 })).success, true);
     assert.equal((await api.getTableBoard(1)).links.length, 1);
   });
   ```

3. Existing suites that load `ContainerOverview` (`test/components/spaceEmoji.test.js`, `test/components/containerOverviewDefaultFolder.test.js`) now pull in the settings store and the Table graph. Add these two entries to each suite's `mockModules`, so the suites stay isolated from Labs:

   ```js
   "/stores/settingsStore": `export const useSettingsStore = (sel) => sel({ labsTable: false });`,
   "/table/TableView": `export default function TableView() { return null; }`,
   ```

   If a suite already mocks `/stores/settingsStore`, add `labsTable: false` to its state object instead.

4. `DESIGN.md`. Add this subsection after `## Motion` (Plan 01):

   ```markdown
   ### The Table (Labs, WS-M5)

   A per-Space canvas, reached from the Space overview's `List | Table` switch when Labs → The Table is on.
   - **World**: physical coordinates like a map (not mirrored in RTL); 24px dot grid; zoom 25–200%; drag snaps to an 8px grid with `--motion-spring-snap` over `--motion-slow`, instant under reduced motion; cards resize from a bottom-right handle or Alt+arrows.
   - **Cards** are DOM: note 280px, meeting 320px (initials + duration), dictation 220px (neutral mic glyph: orange is live voice only, D1), answer 340px with a `--color-agent-brand` inline-start rail. Selection and focus use `--color-ring`.
   - **Connectors**: 1.5px `--color-table-connector` curves from user links, chat-about-note, and note mentions.
   - **A11y**: a spatial listbox. One tab stop; arrows move to the nearest card; Shift+arrows nudge 8px; Space selects; Enter opens; Delete removes from the table (never deletes content).
   - **Inbox**: removed cards of any kind or age, plus recent unplaced dictations and answers; drag in or press Enter.
   ```

5. `docs/PRIVACY.md`. Add one sentence to the local-storage section: "With Labs → The Table on, card positions, links and the last view of each space's canvas are stored in the local database. They contain no note text, and removing a card never deletes the note."

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/containerOverviewTable.test.js test/components/previewTable.test.js test/components/spaceEmoji.test.js test/components/containerOverviewDefaultFolder.test.js test/components/tableView.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/notes/overview/ContainerOverview.tsx src/preview/browserPreview.ts src/preview/previewTable.ts test/components/previewTable.test.js DESIGN.md docs/PRIVACY.md test/components/containerOverviewTable.test.js test/components/spaceEmoji.test.js test/components/containerOverviewDefaultFolder.test.js
git commit -m "feat(notes): List | Table switch for a space when Labs is on"
```

---

### Task 9: Card resize on The Table (WS-M5)

This covers the M5 acceptance bullet "resize handle bottom-right". The width and height persist in `note_layout.w/h` (Task 2), which until now nothing wrote.

**Files:**
- Modify: `src/components/table/tableGestures.ts`. Add a `resize` gesture, `clampSize`, and Alt+arrow resizing.
- Modify: `src/components/table/tableModel.ts`. Add `sizes` overrides, `fixedH` on cards, and sizes in `placementsFor`.
- Modify: `src/components/table/TableCard.tsx` (the handle and `minHeight`)
- Modify: `src/components/table/TableCanvas.tsx` (route resize presses and effects; add the `onResizeCard` prop)
- Modify: `src/components/table/TableView.tsx` (`onResizeCard`)
- Modify: `src/index.css` (the handle)
- Test: `test/components/tableGestures.test.js`, `test/components/tableModel.test.js`, `test/components/tableCanvas.test.js` (append to each)

**Interfaces:**
- `tableGestures.ts` gains:
  - `MIN_CARD = { w: 180, h: 80 }`, `MAX_CARD = { w: 640, h: 600 }` and `clampSize(size)`;
  - the gesture `{ kind: "resize"; key; start; origin: { w; h }; scale; moved }`;
  - `PressInput.resizeKey?: string | null` and `PressInput.sizes?: Record<string, { w: number; h: number }>`;
  - the move effect `{ type: "size"; key; size }` and the release effect `{ type: "resized"; key; size }` (snapped and clamped);
  - `cancel()` restores the size;
  - the key action `{ type: "resize"; dw; dh }` from Alt+arrows.
- `tableModel.ts` gains:
  - `TableState.sizes: Record<string, { w: number; h: number }>` and the action `{ type: "resized"; key: string; size: { w: number; h: number } }`;
  - `TableCardModel.fixedH: number | null`;
  - `placementsFor` writes the overridden `w`/`h`, and `placed` clears them.
- `TableCanvasProps.onResizeCard?: (key: string, size: { w: number; h: number }, commit: boolean) => void`.

- [ ] **Step 1: Write the failing tests**

Append to `test/components/tableGestures.test.js`:

```js
test("the corner handle resizes in world units, clamped, snaps on release, and cancel restores", async () => {
  const { press, move, release, cancel } = await load();
  const g = press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1", resizeKey: "note:1", sizes: { "note:1": { w: 280, h: 150 } } });
  assert.equal(g.kind, "resize");
  const r = move(g, { x: 41, y: -400 });
  assert.deepEqual(r.effect, { type: "size", key: "note:1", size: { w: 300.5, h: 80 } });
  assert.deepEqual(release(r.gesture, { x: 41, y: -400 }), { type: "resized", key: "note:1", size: { w: 304, h: 80 } });
  assert.deepEqual(cancel(r.gesture), { type: "size", key: "note:1", size: { w: 280, h: 150 } });
  assert.deepEqual(move(g, { x: 4000, y: 4000 }).effect.size, { w: 640, h: 600 });
});

test("Alt+arrows resize the focused card by one grid step", async () => {
  const { keyAction } = await load();
  const k = (key) => keyAction({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: true }, true);
  assert.deepEqual(k("ArrowRight"), { type: "resize", dw: 8, dh: 0 });
  assert.deepEqual(k("ArrowUp"), { type: "resize", dw: 0, dh: -8 });
});
```

Append to `test/components/tableModel.test.js`:

```js
test("reducer: a resize shows at once and persists its size with the placement", async () => {
  const { initialTableState, tableReducer, cardsFor, placementsFor } = await load();
  let s = tableReducer(initialTableState(), {
    type: "loaded",
    board: board([entity("note", 1, { layout: { x: 96, y: 40, w: null, h: null, z: 0, hidden: false } })]),
  });
  s = tableReducer(s, { type: "resized", key: "note:1", size: { w: 320, h: 200 } });
  assert.deepEqual([cardsFor(s)[0].rect.w, cardsFor(s)[0].rect.h, cardsFor(s)[0].fixedH], [320, 200, 200]);
  const placements = placementsFor(s, ["note:1"]);
  assert.deepEqual(placements, [{ type: "note", id: 1, x: 96, y: 40, w: 320, h: 200, z: 0 }]);
  s = tableReducer(s, { type: "placed", placements });
  assert.deepEqual(s.sizes, {});
  assert.deepEqual([cardsFor(s)[0].rect.w, cardsFor(s)[0].rect.h, cardsFor(s)[0].fixedH], [320, 200, 200]);
});
```

Append to `test/components/tableCanvas.test.js`:

```js
test("cards carry a resize handle and keep a resized height as their minimum", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(TableCanvas, props({ cards: [{ ...card("note:1", "note", 32, 32), fixedH: 220 }] }));
  assert.match(html, /data-resize-handle=""[^>]*aria-hidden="true"/);
  assert.match(html, /data-card-key="note:1"[^>]*style="[^"]*min-height:220px/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/components/tableGestures.test.js test/components/tableModel.test.js test/components/tableCanvas.test.js`
Expected: FAIL. `g.kind` is `"drag"`, and `s.sizes` and `data-resize-handle` are missing.

- [ ] **Step 3: Implement**

1. `tableGestures.ts`:
   - Add to the `Gesture` union `| { kind: "resize"; key: string; start: Point; origin: { w: number; h: number }; scale: number; moved: boolean }`.
   - Add `resizeKey?: string | null; sizes?: Record<string, { w: number; h: number }>;` to `PressInput`.
   - Add `| { type: "size"; key: string; size: { w: number; h: number } }` to `MoveEffect`.
   - Add `| { type: "resized"; key: string; size: { w: number; h: number } }` to `ReleaseEffect`.
   - Add `| { type: "resize"; dw: number; dh: number }` to `KeyAction`.
   - Then add:

   ```ts
   export const MIN_CARD = { w: 180, h: 80 };
   export const MAX_CARD = { w: 640, h: 600 };
   export function clampSize(size: { w: number; h: number }): { w: number; h: number } {
     return {
       w: Math.min(MAX_CARD.w, Math.max(MIN_CARD.w, size.w)),
       h: Math.min(MAX_CARD.h, Math.max(MIN_CARD.h, size.h)),
     };
   }
   ```

   - In `press`, before the drag branch:

   ```ts
     const origin = input.resizeKey ? input.sizes?.[input.resizeKey] : undefined;
     if (input.resizeKey && origin) {
       return { kind: "resize", key: input.resizeKey, start: input.point, origin, scale: input.viewport.scale, moved: false };
     }
   ```

   - In `move`, add a case:

   ```ts
       case "resize": {
         const moved = gesture.moved || passed(gesture.start, point);
         const next = { ...gesture, moved };
         if (!moved) return { gesture: next, effect: null };
         const size = clampSize({
           w: gesture.origin.w + (point.x - gesture.start.x) / gesture.scale,
           h: gesture.origin.h + (point.y - gesture.start.y) / gesture.scale,
         });
         return { gesture: next, effect: { type: "size", key: gesture.key, size } };
       }
   ```

   - In `release`, add:

   ```ts
       case "resize":
         return gesture.moved
           ? {
               type: "resized",
               key: gesture.key,
               size: clampSize({
                 w: snapToGrid(gesture.origin.w + (point.x - gesture.start.x) / gesture.scale),
                 h: snapToGrid(gesture.origin.h + (point.y - gesture.start.y) / gesture.scale),
               }),
             }
           : null;
   ```

   - In `cancel`, add: `if (gesture.kind === "resize" && gesture.moved) return { type: "size", key: gesture.key, size: gesture.origin };`
   - In `keyAction`, replace the first line with:

   ```ts
     if (e.metaKey || e.ctrlKey) return null;
     const dir = ARROWS[e.key];
     if (e.altKey) {
       return dir && onCard ? { type: "resize", dw: STEP[dir][0] * GRID, dh: STEP[dir][1] * GRID } : null;
     }
   ```

   Then delete the original `const dir = ARROWS[e.key];` line that followed.

2. `tableModel.ts`:
   - `TableState` gains `sizes: Record<string, { w: number; h: number }>`, and `initialTableState()` returns `sizes: {}`.
   - `TableAction` gains `| { type: "resized"; key: string; size: { w: number; h: number } }`.
   - `TableCardModel` gains `fixedH: number | null`. In `buildCards`, set `fixedH: e.layout?.h ?? null` on both placed and auto cards.
   - Reducer changes:
     - `case "loaded"`: also reset `sizes: {}`.
     - `case "placed"`: also delete the placed keys from a copy of `state.sizes`.
     - Add a case:

     ```ts
         case "resized":
           return { ...state, sizes: { ...state.sizes, [action.key]: action.size } };
     ```

   - `cardsFor` applies a size override after the position override:

   ```ts
       const z = state.sizes[card.key];
       return z ? { ...moved, rect: { ...moved.rect, w: z.w, h: z.h }, fixedH: z.h } : moved;
   ```

     Here `moved` is the card returned by today's position-override branch.
   - In `placementsFor`, write `w: state.sizes[card.key]?.w ?? card.entity.layout?.w ?? null` and `h: state.sizes[card.key]?.h ?? card.entity.layout?.h ?? null`.

3. `TableCard.tsx`:
   - Add `minHeight: card.fixedH ?? undefined` to the style.
   - Add a last child: `<span className="table-card__resize" data-resize-handle="" aria-hidden="true" />`. Keyboard users resize with Alt+arrows.

4. `TableCanvas.tsx`:
   - Add `onResizeCard?: (key: string, size: { w: number; h: number }, commit: boolean) => void;` to the props.
   - In `onPointerDown`, compute `const handle = (event.target as HTMLElement).closest("[data-resize-handle]");` and pass these to `press`:
     - `resizeKey: handle ? (cardEl?.dataset.cardKey ?? null) : null`;
     - `sizes: Object.fromEntries(cards.map((c) => [c.key, { w: c.rect.w, h: c.rect.h }]))`.
   - In `applyMove`, add `if (effect.type === "size") props.onResizeCard?.(effect.key, effect.size, false);`.
   - In `onPointerUp`, add `if (effect.type === "resized") props.onResizeCard?.(effect.key, effect.size, true);`.
   - In `onPointerCancel`, add `if (effect?.type === "size") props.onResizeCard?.(effect.key, effect.size, false);`.
   - In `onKeyDown`, add a case:

   ```tsx
         case "resize": {
           const rect = cardKey ? byKey.get(cardKey)?.rect : undefined;
           if (cardKey && rect) props.onResizeCard?.(cardKey, clampSize({ w: rect.w + action.dw, h: rect.h + action.dh }), true);
           return;
         }
   ```

   - Import `clampSize` from `./tableGestures`.

5. `TableView.tsx`. Add a stable handler and pass `onResizeCard={onResizeCard}` to `TableCanvas`:

   ```tsx
     const onResizeCard = useCallback(
       (key: string, size: { w: number; h: number }, commit: boolean) => {
         dispatch({ type: "resized", key, size });
         if (commit) {
           const next = { ...stateRef.current, sizes: { ...stateRef.current.sizes, [key]: size } };
           void board.place(placementsFor(next, [key]));
         }
       },
       [dispatch, board.place]
     );
   ```

6. `src/index.css`. Append after the Task 6 block (physical corner: the handle lives in world space):

   ```css
   .table-card__resize {
     position: absolute;
     right: 2px;
     bottom: 2px;
     width: 12px;
     height: 12px;
     border-right: 2px solid var(--color-table-card-border);
     border-bottom: 2px solid var(--color-table-card-border);
     border-bottom-right-radius: 4px;
     cursor: nwse-resize;
     opacity: 0;
   }
   .table-card:hover .table-card__resize,
   .table-card:focus-visible .table-card__resize,
   .table-card[aria-selected="true"] .table-card__resize {
     opacity: 1;
   }
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/tableGestures.test.js test/components/tableModel.test.js test/components/tableCanvas.test.js test/components/tableView.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/table src/index.css test/components/tableGestures.test.js test/components/tableModel.test.js test/components/tableCanvas.test.js
git commit -m "feat(table): Resize cards from the corner or with Alt+arrows"
```

---

### Task 10: Whole-plan verification

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

Expected: everything passes. Plan 06's `test/components/workspaceTokenAdoption.test.js` must pass unchanged. Plan 08 creates no files in its scope, and the Table's own CSS test forbids literal durations. Any failure is a regression in this branch; fix the code, never the guard.

- [ ] **Step 2: Flag-off regression check**

With Labs → The Table off (the default for a fresh profile), open Notes → Personal: there is no `List | Table` switch, and the overview renders exactly as before. Task 8's "with Labs off the overview is unchanged" test pins the same behaviour.

- [ ] **Step 3: Visual verification in the desktop app (light and Plum Night)**

Use a fresh test profile. Never use a personal profile.

```bash
npm run native:electron
LOQUI_PROFILE_DIR="$(mktemp -d)" npm run dev
```

Screenshot each of these for the PR:
1. **Settings → System → Labs.** One switch, The Table, present and off. Its description says card positions stay on this device and that Summarise and Ask use the chat provider. Turn it on.
2. **Reduced motion** (System Settings → Accessibility → Reduce motion). Dropping a card does not spring.
3. **The Table.** Open Notes → Personal → `Table`.
   - Notes auto-flow. Drag one: it springs to the grid. Reload the app: it stays.
   - Shift-drag lasso three cards, then:
     - **Group into note:** a new note appears linked to all three.
     - **Summarise:** the Ask panel opens and the answer becomes a linked Answer card. Repeat it after opening an older conversation in the panel: the summary must start a new conversation, without the old history.
     - **Ask about these:** type a question and send it. The answer also becomes an Answer card linked to the selection.
     - **Remove from table:** the cards move to the Inbox, and the notes still exist in List (D12).
   - Drag an Inbox dictation in. Arrow between cards, Shift+arrow to nudge, Enter to open a note.
   - Zoom with Ctrl or ⌘ plus the wheel and with a pinch; Reset view fits everything.
   - Dictate while the Table is open: the new capture appears in the Inbox. Delete a placed note from List view in a second window: its card disappears within a second.
   - Click into the Ask box, then pan or zoom with the wheel: focus stays in the Ask box.
   - Reopen the Table with its first card scrolled off screen, then Tab into the canvas and press an arrow: focus lands on a visible card.
4. **RTL** (UI language Arabic). The Inbox sits at the inline start (right), the selection bar is centred, and the canvas world is not mirrored.
5. **Sealed mode** (if Plan 07 has merged). Turn Sealed on with a remote chat route:
   - Summarise or Ask is blocked by main exactly as the Space's Ask box is, and no new path bypasses it.
   - The selection bar shows the route's sealed state chip, and both AI buttons are disabled.
6. **Route disclosure.**
   - With a remote chat provider, the toolbar, the Ask panel and the selection bar all show the dashed remote `LocalityRing` and the provider's localised name before you click Summarise.
   - Switch the chat route to a local model: the solid device ring replaces it.
   - Select 13 cards: Summarise and Ask disable and the bar explains the 12-card limit.
7. **Pinned selection.** Select two cards and choose Ask. Change the selection to a third card, then type and send a question. The panel says "Pinned cards: 2", and the answer card links to the two pinned cards only.
8. **Resize.**
   - Drag a card's bottom-right corner: it grows on the 8px grid between 180×80 and 640×600, and survives an app restart.
   - Alt+arrows resize the focused card.
   - A cancelled resize (switch apps mid-drag) restores the old size.

- [ ] **Step 4: Performance check with 500 cards**

Seed a throwaway profile with 500 notes in the Space and 200 links, using the DB methods from Task 2 in a one-off script against that profile's database. Open the Table. In Chrome DevTools (View → Toggle Developer Tools), record a Performance trace while you:
- drag one card continuously for 5 s;
- pan with the wheel and pinch-zoom from 25 % to 200 %;
- hold Shift+→ for 3 s on a focused card.

Pass criteria:
- the frame rate stays at or above 50 fps during the drag and the pan;
- no task is longer than 50 ms;
- React commits stay at one per animation frame or fewer (pointer moves are coalesced in `TableCanvas`);
- cards' `ResizeObserver`s do not reconnect on each frame (stable `onMeasure`).

If a criterion fails, profile which of `cardsFor`, `deriveEdges` or card rendering dominates, and memoise that one before the PR. Attach the trace summary to the PR.

- [ ] **Step 5: Commit any fixes, then hand off**

Implementation commits land on this plan's branch and draft PR (#47). Get the owner's explicit OK before marking the PR ready, because publishing is outward-facing. The PR body lists one line per Task 1–9 commit, links the spec and this plan, and embeds the Step 3 screenshots and the Step 4 trace summary.

---

## Appendix — Deferred: WS-M4 (confidence typography)

**Status:** on hold per spec D11 (owner decision, 2026-10-15). WS-M4 drew transcript words lighter, with a dotted underline, where the speech engine was unsure. The owner chose not to ship it without per-word alternatives, which no engine Loqui runs can supply today. The full task text (spike, storage, IPC, `ConfidenceText`, word popover, raw versus cleaned diff, and the `labsConfidenceTypography` flag) is preserved in git at commit `162a0ca`, in this file.

**What the spike research found (desk research from pinned sources, not yet run).**

| Engine (as Loqui runs it) | Scores available | Per-word alternatives |
|---|---|---|
| whisper.cpp server, OpenWhispr fork `0.0.10` | Per **token**, `segments[].words[].probability` in `verbose_json`; Loqui requests `json` today (`src/helpers/whisperServer.js:918-923`) | No, even with `beam_size` |
| sherpa-onnx 1.13.8 offline WS, Parakeet TDT | Per token, `ys_log_probs[]` (natural log) with `tokens[]` and `timestamps[]`, already sent; Loqui reads only `.text` (`src/helpers/parakeetWsResult.js:1-9`) | No (greedy search) |
| OpenAI `gpt-4o(-mini)-transcribe` | Per token with `include[]=logprobs`, `json` only | No |
| Deepgram nova-3, AssemblyAI (streaming) | Per word, `words[].confidence` | Deepgram whole-transcript `alternatives[]`, unconfirmed for streaming |
| `whisper-1`, Groq, xAI, Gemini, Mistral | Segment-level or none | No |

**What restoring WS-M4 needs.**
1. Decoder top-k per token in the OpenWhispr whisper.cpp fork, exposed in `verbose_json`, so each word can carry its runner-up spellings. This is a separate engine project (D11). sherpa-onnx would need the equivalent from its transducer decoder, or Parakeet stays scores-only.
2. Then re-plan from commit `162a0ca`. It starts with the two-stage go/no-go spike, and adds the alternatives list and `Enter`-to-replace back to the word popover.

**Codex review findings that apply when it is restored** (independent review, 2026-10-15). Each fix was designed and tested in the `162a0ca` text:
- **I1 (occurrence-accurate alignment).** Align by position, never by text search. Lay the engine's words out as written and keep a score only for words inside the shared prefix or shared suffix with the saved `raw_text`. Repeats then cannot steal another occurrence's score. 16 alignment tests passed against that code.
- **I2 (no stale scores after downgrade and re-upgrade).** An `AFTER UPDATE OF raw_text` trigger in the database file deletes scores even when an older build edits the text. Retry clears them explicitly.
- **I3 (GO gate on usable words).**
  - Stage 1 measures data presence and request cost.
  - Stage 2 runs the storage code and requires that at least 90 % of the saved transcript's lexical words carry a usable score.
  - The signal check (G4) uses merged, distinct words with fixed labels, and any change to its cut-offs is a named, owner-approved revised gate.
- **I5 (Plan 06 token guard).** Any history-row change must pass Plan 06's `workspaceTokenAdoption.test.js`, for example `text-caption` and full `text-muted-foreground`, never `text-muted-foreground/NN`.
- **M2 (storage budget).** Store compact `[s, e, p, t]` tuples. The measured size is about 570 KB at the 20 000-word cap.
