# Loqui UI/UX Plan 02 — Bug & a11y sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 20 standalone correctness and accessibility quick wins assigned to Plan 02:
- ONB-Q1, ONB-Q2;
- VO-Q6, VO-Q8, VO-Q9, VO-Q16;
- WS-Q1, WS-Q5, WS-Q7;
- SET-Q1, Q2, Q5, Q6, Q7, Q11, Q12, Q13, Q16, Q20, Q25.

They are ship-able on their own and do not depend on Plan 01 merging first.

**Architecture:** Every fix stays inside the component, hook or main-process module that owns the bug. Where the logic is non-trivial, the task extracts a small pure helper next to its caller so `node:test` can pin it without a DOM:
- `chatInputKeys.ts`, `providerTabsKeys.ts`, `upcomingEventGroups.ts`, `audioDeletion.ts`;
- the main-process `systemNotification.js`.

Only one change crosses the IPC boundary. VO-Q16 adds a main-owned native notification (`show-system-notification`) behind a typed preload method. Toast fixes stay on the existing toast API so Plan 04 can migrate them to `notify()` (§5.3).

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Electron (main + preload), i18next, Node `node:test`. Renderer tests use Vite SSR (`test/lib/rendererTestHarness.js`) plus `react-dom/server` or `react-dom/client`. Source-text assertions follow `test/components/rtlMotion.test.js`.

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md`:
- §3, the Plan 02 row;
- decisions D2 (native interruption alerts), D3 (Esc armed until idle) and D1 (`--color-link` for links);
- §4 global constraints;
- §5.2 and §5.3 (Plan 04 owns the lifecycle and `notify()`).

Item text: `.omc/research/ui-review/approved-todo.md` in the research worktree. The format reference is `docs/superpowers/plans/2026-10-15-loqui-uiux-01-foundations.md`.

## Contract change requests

These need the spec owner's sign-off. The plan is written as if they are accepted. If one is rejected, the named task changes as noted.

1. **Add §5.5 System notifications (owner: Plan 02, then Plan 04; consumers: 04).** Task 7 adds:
   ```ts
   window.electronAPI.showSystemNotification(payload: { title: string; body?: string }):
     Promise<{ success: boolean; reason?: "disabled" | "unsupported" | "invalid" }>
   ```
   - Main shows an Electron `Notification`.
   - It honours the existing master `notificationsEnabled` preference.
   - Clicking the notification focuses the window that sent it.

   D2's Linux fallback needs "a persistent notification with a Stop action", and D2 says Plan 04 owns that state. Plan 04 should extend this method with `actions` rather than add a second notification path. **If rejected:** Task 7 still ships, but the method is documented as internal to `MeetingRecordingMount`.
2. **FYI, no spec change: `UpdateStatus.phase` gains `"available"`** (Task 13). It means a manual check found a newer version while automatic updates are off. Plan 03 moves `UpdateSettings` into its new IA and must keep rendering this phase.

No §5 contract from Plan 01 changes. Where this plan touches a Plan 01 token before Plan 01 merges, it uses `var(--motion-*, <fallback>)` so either merge order works (Task 1).

## Interfaces this plan produces for later plans

| Item | Where | Consumer |
|---|---|---|
| `showSystemNotification` (CCR 1) | `preload.js`, `src/types/electron.ts`, `src/helpers/systemNotification.js` | Plan 04 (D2 recorder alerts) |
| `useNow(intervalMs?)` | `src/hooks/useNow.ts` | Plan 06 (Ready strip, sessions) |
| `ProviderTabItem.keySaved` | `src/components/ui/ProviderTabs.tsx` | Plan 03 (SET-R5 keyring wires real key status) |
| `ModelCard` `selectionRole`, `ModelCardList` `ariaLabel` | `src/components/ui/ModelCardList.tsx` | Plan 03 (SET-R4 cartridge cards) |
| `rendererOptions`, `I18N_KEYS_MOCK`, `TOAST_MOCK` | `test/helpers/harness/rendererMocks.js` | every later plan's renderer tests |
| `installTree` | `test/helpers/harness/fakeDomTree.js` | renderer tests that click |

**Notes for Plan 04:**
- **Esc (D3).** Task 6 makes Esc release only on the idle edge in `useAudioRecording`'s `onStateChange` and on unmount. When Plan 04 adds the `cancelled` state, that state counts as idle for Esc. The undo uses ⌥Z, not Esc.
- **Dictation-error cards (VO-Q6).** Task 4 makes a card with a recoverable transcript persistent (`duration: 0`). `notify({ kind: "alert" })` must keep that rule: an alert never auto-dismisses while user content is at stake.

## Global Constraints

- Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md).
- Local and remote choices stay explicit. Nothing silently switches provider or moves work from local to remote. Content is preserved on every failure. In this plan:
  - arrow keys move focus but never select a provider or model (Tasks 11–12);
  - a queued chat draft stays visible until it is actually sent (Task 9).
- Text contrast is at least 4.5:1 and non-text UI at least 3:1, in light and Plum Night.
- Motion uses the shared tokens only (Plan 01: `--motion-*`). Every loop is gated to its active state. Reduced motion keeps opacity and colour feedback and drops transforms (existing policy in `src/index.css`; do not weaken it).
- Every visible string goes through i18n with keys in all 11 locales: `ar de en es fr it ja pt ru zh-CN zh-TW`. Interpolation placeholders must match across locales. `npm run i18n:check` passes, and `test/locales/translationCoverage.test.js` passes.
- RTL: use logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`). The one deliberate exception is the macOS traffic-light clearance in Task 2, which is physical because the traffic lights are.
- Do not edit `src/index.css`. Plan 01 rewrites large parts of it in parallel, so onboarding CSS goes in `src/styles/onboarding-welcome.css`.
- New locale keys go inside existing namespaces, never as new top-level keys. Plan 01 appends a top-level `"locality"` object at the end of each `translation.json`, and new top-level keys would conflict with it. `updates` is the last top-level object, so Task 13 inserts its key mid-object.
- Tests run with Node `node:test`.
  - Setup: `npm run native:node` once, then `npm test -- <files>`. Run `npm run native:electron` before launching the desktop app. Never use personal profiles in tests.
  - Node: `~/.nvm/versions/node/v24.21.0/bin` (matches `.node-version` 24.21.0).
  - The worktree may have no `node_modules`; run `npm ci` first if `npm test` cannot find `vite`.
- Before a PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run i18n:check`, `npm run format:check`.

## Review Focus

1. **Esc stays captured system-wide.** The cancel slot is a global shortcut. Keeping it armed through processing means Esc in any app cancels the dictation while it processes, and swallows that keypress. That is D3's intent, but a slow remote call or a wedged `isProcessing` must not hold Esc forever. Expect release on the idle edge and on unmount, even mid-processing. Pinned in Task 6 by "unmounting releases Esc even mid-processing" and "Esc is released on the idle edge".
2. **Cancel and retry during the onboarding download.** Cancel, then press Download again before main reports the first request's end. The late result of the cancelled request must not flip the new download to "interrupted", and Download stays disabled while the cancel is in flight. Pinned in Task 3 by "a cancelled download returns to idle and a late result cannot mark it interrupted".
3. **IME composition in the chat composer.** A Japanese or Chinese user who presses Enter to accept a candidate must not send or queue the message. Pinned in Task 9 by "Enter during IME composition does nothing", which covers both `isComposing` and `keyCode` 229.
4. **Arrow keys must not switch a provider or model.** Some tabs switch between local and remote (`ReasoningModelSelector` mode tabs), and some model cards are remote. Arrow keys move focus only; Enter, Space or a click selects.
   - Task 11 pins this with "arrow keys only move focus" (a source assertion that the key handler calls `.focus()` and never `onSelect`).
   - Task 12 pins it with "arrow keys are not a selection path".
5. **RTL keyboard and layout.** Under `dir="rtl"`, ArrowLeft moves to the next provider tab. The onboarding header's macOS clearance stays on the physical left, where the traffic lights are.
   - Task 11 pins the tabs with "RTL swaps Left and Right".
   - Task 2 pins the header with "traffic-light clearance is physical, not logical".

---

### Task 1: Accessible, translated download progress bar

Covers SET-Q25 and the "Downloading" part of SET-Q6. This task also creates the shared renderer-test mocks that later tasks use.

**Files:**
- Create: `test/helpers/harness/rendererMocks.js`
- Modify: `src/components/ui/DownloadProgressBar.tsx` (whole component, 87 lines)
- Modify: `src/locales/{ar,de,en,es,fr,it,ja,pt,ru,zh-CN,zh-TW}/translation.json`. Add `models.downloadingNamed` and `models.installingNamed`.
- Test: `test/components/downloadProgressBar.test.js`

**Interfaces:**
- Produces `test/helpers/harness/rendererMocks.js`:
  - `I18N_KEYS_MOCK` (string). It is ESM source for a `react-i18next` mock whose `t(key)` returns `key`, and whose `t(key, { a: 1, b: "x" })` returns `key(a=1,b=x)`. It also exports `initReactI18next`, `Trans` and `I18nextProvider`, because `src/i18n.ts` imports them.
  - `TOAST_MOCK` (string). It is ESM source for `useToast()` returning `{ toast, dismiss }`. `toast(props)` pushes to `globalThis.__toasts`.
  - `rendererOptions(cachePrefix: string, mockModules?: Record<string, string>)`. It returns options for `createRendererServer` with `noExternal: ["react-i18next"]`, the `@` alias and the i18n mock merged in.
- `DownloadProgressBar` keeps its props (`modelName`, `progress: DownloadProgress`, `isInstalling?`). Its root now contains `role="progressbar"`, labelled by the visible "Downloading X" line.

- [ ] **Step 1: Create the shared mocks**

Create `test/helpers/harness/rendererMocks.js`:

```js
const path = require("node:path");

// react-i18next mock for Vite SSR renderer tests. Keys render verbatim so
// assertions match keys, not copy; interpolation options are appended as
// key(name=value,...) so they are visible too. initReactI18next, Trans and
// I18nextProvider exist because src/i18n.ts and a few components import them,
// and the module graph fails to load without them. It only applies with
// noExternal: ["react-i18next"], which rendererOptions sets.
const I18N_KEYS_MOCK = `
const format = (key, options) =>
  options
    ? key + "(" + Object.entries(options).map(([name, value]) => name + "=" + value).join(",") + ")"
    : key;
export const useTranslation = () => ({
  t: format,
  i18n: { language: "en", dir: () => globalThis.__i18nDir ?? "ltr" },
});
export const initReactI18next = { type: "3rdParty", init() {} };
export const Trans = ({ i18nKey }) => i18nKey;
export const I18nextProvider = ({ children }) => children;
`;

const TOAST_MOCK = `
export const useToast = () => ({
  toast(props) {
    (globalThis.__toasts ??= []).push(props);
    return String(globalThis.__toasts.length);
  },
  dismiss() {},
  dismissByPresentation() {},
  toastCount: 0,
  dictationErrorActionCount: 0,
});
`;

function rendererOptions(cachePrefix, mockModules = {}) {
  return {
    cachePrefix,
    noExternal: ["react-i18next"],
    resolveAlias: { "@": path.resolve(__dirname, "../../../src") },
    mockModules: { "react-i18next": I18N_KEYS_MOCK, ...mockModules },
  };
}

module.exports = { I18N_KEYS_MOCK, TOAST_MOCK, rendererOptions };
```

`mockModules` keys match the *import specifier suffix* (`test/lib/rendererTestHarness.js:124-128`). For example, `"/ui/useToast"` matches `../ui/useToast` and `./ui/useToast`, but not `./useToast`.

- [ ] **Step 2: Write the failing test**

Create `test/components/downloadProgressBar.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/ui/DownloadProgressBar.tsx"),
  "utf8"
);

async function render(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-download-progress-bar-"));
  const { DownloadProgressBar } = await vite.ssrLoadModule(
    "/components/ui/DownloadProgressBar.tsx"
  );
  return renderToStaticMarkup(
    createElement(DownloadProgressBar, { modelName: "Parakeet", ...props })
  );
}

const progress = (overrides = {}) => ({
  percentage: 42.4,
  downloadedBytes: 265_000_000,
  totalBytes: 631_000_000,
  ...overrides,
});

test("a known percentage is a progressbar named by its visible label", async (t) => {
  const html = await render(t, { progress: progress() });
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="42"/);
  assert.match(html, /aria-valuemin="0"/);
  assert.match(html, /aria-valuemax="100"/);
  const labelId = html.match(/<p id="([^"]+)"/)[1];
  assert.ok(html.includes(`aria-labelledby="${labelId}"`), "progressbar is labelled by the line");
});

test("the label is translated, never concatenated English", async (t) => {
  const downloading = await render(t, { progress: progress() });
  assert.match(downloading, /models\.downloadingNamed\(model=Parakeet\)/);
  const installing = await render(t, { progress: progress(), isInstalling: true });
  assert.match(installing, /models\.installingNamed\(model=Parakeet\)/);
  assert.doesNotMatch(source, /`(Downloading|Installing) \$\{modelName\}`/);
});

test("installing and byte-only downloads are indeterminate", async (t) => {
  const installing = await render(t, { progress: progress(), isInstalling: true });
  assert.match(installing, /role="progressbar"/);
  assert.doesNotMatch(installing, /aria-valuenow=/);
  const byteOnly = await render(t, { progress: progress({ totalBytes: 0 }) });
  assert.doesNotMatch(byteOnly, /aria-valuenow=/);
});

test("out-of-range or missing percentages are clamped before they reach the DOM", async (t) => {
  for (const [percentage, expected] of [
    [Number.NaN, "0"],
    [-5, "0"],
    [250, "100"],
  ]) {
    const html = await render(t, { progress: progress({ percentage }) });
    assert.match(html, new RegExp(`aria-valuenow="${expected}"`));
    assert.match(html, new RegExp(`width:${expected}%`));
    assert.doesNotMatch(html, />NaN%</);
  }
});

test("the row border and the track are visible in the light theme", () => {
  assert.doesNotMatch(source, /border-white\/5/);
  assert.doesNotMatch(source, /bg-white\/5/);
  assert.match(source, /border-b border-border-subtle/);
  assert.match(source, /bg-muted ring-1 ring-inset ring-border/);
});

test("the fill uses the shared motion tokens with fallbacks", () => {
  assert.match(
    source,
    /width var\(--motion-base, 240ms\) var\(--motion-ease-std, cubic-bezier\(0\.2, 0, 0, 1\)\)/
  );
  assert.doesNotMatch(source, /width 300ms ease-out/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- test/components/downloadProgressBar.test.js`
Expected: FAIL. "a known percentage…" fails on `role="progressbar"`, and "the label is translated" fails on `models.downloadingNamed`.

- [ ] **Step 4: Implement**

Replace `src/components/ui/DownloadProgressBar.tsx` with:

```tsx
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "../icons";
import { formatETA, type DownloadProgress } from "../../hooks/useModelDownload";

interface DownloadProgressBarProps {
  modelName: string;
  progress: DownloadProgress;
  isInstalling?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)}KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)}GB`;
}

export function DownloadProgressBar({
  modelName,
  progress,
  isInstalling,
}: DownloadProgressBarProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const { percentage, downloadedBytes, totalBytes, speed, eta } = progress;
  // A disconnected progress stream can report NaN or overshoot; never render
  // either as text or as a bar width.
  const pct = Number.isFinite(percentage) ? Math.max(0, Math.min(100, Math.round(percentage))) : 0;
  const speedText = speed ? `${speed.toFixed(1)} MB/s` : "";
  const etaText = eta ? formatETA(eta) : "";
  const indeterminate = !isInstalling && totalBytes === 0 && downloadedBytes > 0;
  // ARIA spells "indeterminate" as a progressbar without aria-valuenow.
  const reportsValue = !isInstalling && !indeterminate;

  return (
    <div className="px-2.5 py-2 border-b border-border-subtle">
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex items-center justify-center h-6 min-w-6 px-1.5 shrink-0">
          <div
            className={`absolute inset-0 rounded-md bg-primary/15 ${isInstalling || indeterminate ? "animate-pulse" : ""}`}
          />
          {isInstalling ? (
            <Loader2 className="relative w-3.5 h-3.5 text-primary animate-spin" />
          ) : (
            <span className="relative text-xs font-bold text-primary tabular-nums">
              {indeterminate ? "···" : `${pct}%`}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p id={labelId} className="text-xs font-medium text-foreground truncate">
            {isInstalling
              ? t("models.installingNamed", { model: modelName })
              : t("models.downloadingNamed", { model: modelName })}
          </p>
          {!isInstalling && (indeterminate || speedText || etaText) && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {indeterminate && (
                <span className="text-xs text-muted-foreground/70 tabular-nums">
                  {formatBytes(downloadedBytes)}
                </span>
              )}
              {speedText && (
                <span className="text-xs text-muted-foreground/70 tabular-nums">{speedText}</span>
              )}
              {etaText && (
                <>
                  <span className="text-xs text-muted-foreground/70">·</span>
                  <span className="text-xs text-muted-foreground/70 tabular-nums">{etaText}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={reportsValue ? pct : undefined}
        className="w-full rounded-full overflow-hidden bg-muted ring-1 ring-inset ring-border"
        style={{ height: 4 }}
      >
        {indeterminate ? (
          <div className="h-full w-1/3 rounded-full bg-primary shadow-[0_0_8px_rgb(255_90_31_/_0.4)] animate-[indeterminate_1.5s_ease-in-out_infinite]" />
        ) : (
          <div
            className={`${isInstalling ? "animate-pulse" : ""} bg-primary shadow-[0_0_8px_rgb(255_90_31_/_0.4)]`}
            style={{
              height: "100%",
              width: `${isInstalling ? 100 : pct}%`,
              borderRadius: 9999,
              // Plan 01 defines these tokens; the fallbacks keep the same curve
              // if this lands first.
              transition:
                "width var(--motion-base, 240ms) var(--motion-ease-std, cubic-bezier(0.2, 0, 0, 1))",
            }}
          />
        )}
      </div>
    </div>
  );
}
```

Add the locale keys from the repo root:

```bash
node - <<'EOF'
const fs = require("node:fs");
const path = require("node:path");
const ADD = {
  "models.downloadingNamed": {
    en: "Downloading {{model}}", ar: "جارٍ تنزيل {{model}}", de: "{{model}} wird heruntergeladen",
    es: "Descargando {{model}}", fr: "Téléchargement de {{model}}", it: "Download di {{model}} in corso",
    ja: "{{model}} をダウンロード中", pt: "Baixando {{model}}", ru: "Загрузка {{model}}",
    "zh-CN": "正在下载 {{model}}", "zh-TW": "正在下載 {{model}}",
  },
  "models.installingNamed": {
    en: "Installing {{model}}", ar: "جارٍ تثبيت {{model}}", de: "{{model}} wird installiert",
    es: "Instalando {{model}}", fr: "Installation de {{model}}", it: "Installazione di {{model}} in corso",
    ja: "{{model}} をインストール中", pt: "Instalando {{model}}", ru: "Установка {{model}}",
    "zh-CN": "正在安装 {{model}}", "zh-TW": "正在安裝 {{model}}",
  },
};
for (const lang of fs.readdirSync("src/locales")) {
  const file = path.join("src/locales", lang, "translation.json");
  if (!fs.existsSync(file)) continue;
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [key, values] of Object.entries(ADD)) {
    if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
    const parts = key.split(".");
    let node = json;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    node[parts.at(-1)] = values[lang];
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}
EOF
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/components/downloadProgressBar.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add test/helpers/harness/rendererMocks.js test/components/downloadProgressBar.test.js src/components/ui/DownloadProgressBar.tsx src/locales
git commit -m "fix(a11y): accessible, translated download progress bar"
```

---

### Task 2: Pin the onboarding shell and clear the macOS traffic lights

Covers ONB-Q1.

**Files:**
- Modify: `src/styles/onboarding-welcome.css`. Add rules after `.onboarding-welcome-header` (lines 41–51), and inside `@media (max-width: 760px)` (from line 361).
- Modify: `src/components/OnboardingFlow.tsx`. `StepShell` (lines 143–243) gets a `platform` prop. Its call site (around line 1416) and the `WelcomeScreen` call site (around line 1401) pass `platform`.
- Modify: `src/components/onboarding/WelcomeScreen.tsx`. Add `platform?: string` to `WelcomeScreenProps` (line 7) and put it on the root `.onboarding-welcome`.
- Test: `test/components/onboardingShell.test.js`

**Interfaces:**
- Consumes `rendererOptions` (Task 1).
- Produces a `data-platform` attribute (`"darwin" | "win32" | "linux"`) on every `.onboarding-welcome` root. The value comes from the existing `platform` const in `OnboardingFlow` (lines 1069–1074), which already honours the preview config.

Why this works:
- `src/index.css:195-203` sets only `min-height: 100vh` on `html`, `body` and `#root`. `.onboarding-welcome { height: 100% }` therefore resolves to `auto`, and the footer scrolls away with the content.
- `.onboarding-welcome-split` already scrolls (`overflow-y: auto`, `min-height: 0`, `flex: 1`). Once the shell is pinned, only the middle scrolls.
- On macOS the control panel is frameless with `trafficLightPosition: { x: 20, y: 20 }` (`src/helpers/windowConfig.js:241-245`). The lights cover about 20–72px from the window's left edge.

- [ ] **Step 1: Write the failing test**

Create `test/components/onboardingShell.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

test("the shell pins html, body and #root while onboarding is mounted", () => {
  const css = read("src/styles/onboarding-welcome.css");
  assert.match(
    css,
    /html:has\(\.onboarding-welcome\),\s*html:has\(\.onboarding-welcome\) body,\s*html:has\(\.onboarding-welcome\) #root\s*\{\s*height: 100%;\s*\}/
  );
  assert.doesNotMatch(read("src/index.css"), /onboarding-welcome/, "index.css stays untouched");
});

test("traffic-light clearance is physical, not logical, and survives the narrow layout", () => {
  const css = read("src/styles/onboarding-welcome.css");
  const wide = css.match(
    /\.onboarding-welcome\[data-platform="darwin"\] \.onboarding-welcome-header\s*\{([^}]*)\}/
  );
  assert.ok(wide, "macOS header rule exists");
  assert.match(wide[1], /padding-left: max\(84px, calc\(\(100vw - 1320px\) \/ 2\)\);/);
  assert.doesNotMatch(wide[1], /padding-inline-start/);
  const narrow = css.match(/@media \(max-width: 760px\)\s*\{([\s\S]*?)\n\}/)[1];
  assert.match(
    narrow,
    /\.onboarding-welcome\[data-platform="darwin"\] \.onboarding-welcome-header\s*\{\s*padding-left: 84px;\s*\}/
  );
});

test("both shells carry the platform", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-onboarding-shell-"));
  const { default: WelcomeScreen } = await vite.ssrLoadModule(
    "/components/onboarding/WelcomeScreen.tsx"
  );
  const html = renderToStaticMarkup(
    createElement(WelcomeScreen, {
      platform: "darwin",
      updatesEnabled: true,
      onUpdatesChange() {},
      dataRetentionEnabled: true,
      onDataRetentionChange() {},
      onContinue() {},
      onExplore() {},
    })
  );
  assert.match(html, /<div class="onboarding-welcome" data-platform="darwin">/);

  const flow = read("src/components/OnboardingFlow.tsx");
  assert.match(
    flow,
    /<div className="onboarding-welcome onboarding-guided" data-platform=\{platform\}>/
  );
  assert.match(flow, /<StepShell[\s\S]*?platform=\{platform\}/);
  assert.match(flow, /<WelcomeScreen[\s\S]*?platform=\{platform\}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/onboardingShell.test.js`
Expected: FAIL. No `html:has(.onboarding-welcome)` rule exists, and there is no `data-platform`.

- [ ] **Step 3: Implement**

1. In `src/styles/onboarding-welcome.css`, directly after the `.onboarding-welcome-header { … }` block (it ends at line 51), add:

   ```css
   /* The shell owns the window while onboarding is mounted. index.css only sets
      min-height on html, body and #root, so height: 100% on the shell resolved
      to auto and the footer scrolled away with the content. */
   html:has(.onboarding-welcome),
   html:has(.onboarding-welcome) body,
   html:has(.onboarding-welcome) #root {
     height: 100%;
   }

   /* macOS draws the traffic lights at x:20, y:20 (windowConfig.js) over this
      frameless header, about 52px wide. They stay on the physical left in RTL
      too, so this is padding-left on purpose, not padding-inline-start. */
   .onboarding-welcome[data-platform="darwin"] .onboarding-welcome-header {
     padding-left: max(84px, calc((100vw - 1320px) / 2));
   }
   ```

2. Inside the existing `@media (max-width: 760px) { … }` block, directly after its `.onboarding-welcome-header { … padding: 18px 24px; }` rule, add:

   ```css
     .onboarding-welcome[data-platform="darwin"] .onboarding-welcome-header {
       padding-left: 84px;
     }
   ```

3. In `src/components/OnboardingFlow.tsx`, change `StepShell`:
   - Add `platform,` to the destructured props and `platform: string;` to the props type.
   - Change the root to `<div className="onboarding-welcome onboarding-guided" data-platform={platform}>`.

4. In the same file, pass the existing `platform` const to both shells:

   ```tsx
         <WelcomeScreen
           platform={platform}
           updatesEnabled={updatesEnabled}
   ```

   ```tsx
       <StepShell
         platform={platform}
         step={step}
   ```

5. In `src/components/onboarding/WelcomeScreen.tsx`:
   - add `platform?: string;` to `WelcomeScreenProps`;
   - destructure `platform` in the component signature;
   - change the root `<div className="onboarding-welcome">` to `<div className="onboarding-welcome" data-platform={platform}>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/onboardingShell.test.js test/components/onboardingCleanupWiring.test.js test/components/personalWorkspace.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/styles/onboarding-welcome.css src/components/OnboardingFlow.tsx src/components/onboarding/WelcomeScreen.tsx test/components/onboardingShell.test.js
git commit -m "fix(onboarding): pin the shell and clear the macOS traffic lights"
```

---

### Task 3: Real speech-model download progress in onboarding

Covers ONB-Q2.

**Files:**
- Create: `test/helpers/harness/fakeDomTree.js`. This moves `installTree` out of `test/components/onboardingCleanupWiring.test.js` (lines 11–99) and adds `find`.
- Modify: `test/components/onboardingCleanupWiring.test.js`. Import `installTree`, and add the toast mock to `createRendererServer`.
- Modify: `test/components/personalWorkspace.test.js:27-30`. Add the toast mock.
- Modify: `src/hooks/useModelDownload.ts:269-278`. Optional-call the progress subscriptions.
- Modify: `src/components/OnboardingFlow.tsx`:
  - imports;
  - `SpeechStep` (lines 319–463);
  - `StepShell` footer (lines 221–241);
  - `OnboardingFlow` state and `downloadModel` (lines 1036–1050, 1154–1188);
  - the `SpeechStep` and `StepShell` call sites (around lines 1338 and 1416).
- Modify: `src/styles/onboarding-welcome.css`. Add `.onboarding-download-chip`.
- Modify: `src/locales/*/translation.json`. Add `onboarding.download.chip` and `onboarding.download.chipInstalling`.
- Test: `test/components/onboardingDownloadProgress.test.js`

**Interfaces:**
- Consumes:
  - `useModelDownload({ modelType: "parakeet" })` from `src/hooks/useModelDownload.ts`. It returns `downloads: Record<modelId, { phase: "downloading" | "installing"; progress; downloadedBytes; totalBytes }>`, `cancelDownload(modelId?)` and `isCancellingModel(modelId)`.
  - `DownloadProgressBar` (Task 1).
  - `rendererOptions` and `TOAST_MOCK` (Task 1).
- Produces:
  - `test/helpers/harness/fakeDomTree.js` exports `installTree()`, which returns `{ container, click(label), text(), find(predicate) }`.
  - `StepShell` gets an optional `footerStatus?: ReactNode`, rendered between Back and the right-hand button group.

Design notes:
- `useModelDownload` listens to every Parakeet progress event, whoever started the download. Onboarding keeps starting the download through its own `downloadModel`, so it keeps its own ready and error states, and it reads progress and cancel from the hook.
- A request generation counter (`downloadRequestRef`) makes a cancelled request's late result inert.
- `cancelDownload` no-ops while installing, so Cancel is hidden during install.
- The hook needs `ToastProvider`. The app provides it in `src/renderApp.jsx:32`, and the two existing onboarding tests now mock it.

- [ ] **Step 1: Extract the fake DOM tree**

Create `test/helpers/harness/fakeDomTree.js`. Move the body of `installTree` from `test/components/onboardingCleanupWiring.test.js` lines 14–99 verbatim, then add `find` and export it:

```js
const assert = require("node:assert/strict");
const React = require("react");

// A tiny element tree for react-dom/client tests. The shared fake DOM has no
// events, so click() invokes the onClick React stored on the node.
function installTree() {
  const document = globalThis.document;
  // ...the `make`, createElement/createElementNS/createTextNode overrides,
  // `container`, `walk`, `click` and `text` from onboardingCleanupWiring.test.js
  // lines 15-97, unchanged...
  const find = (predicate) => {
    let found = null;
    walk(container, (node) => {
      if (!found && predicate(node)) found = node;
    });
    return found;
  };
  return { container, click, text, find };
}

module.exports = { installTree };
```

The comment marks where the moved lines go. Nothing in them changes, so copy them exactly and keep `make`, `walk`, `click` and `text` as they are. In `test/components/onboardingCleanupWiring.test.js`:
- delete the local `installTree` function and its comment (lines 11–99);
- add `const { installTree } = require("../helpers/harness/fakeDomTree");` after the harness `require`.

- [ ] **Step 2: Write the failing test**

Create `test/components/onboardingDownloadProgress.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

async function mountSpeechStep(t) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const calls = { downloads: [], cancels: 0 };
  const pending = [];
  const listeners = {};
  const api = {
    getPlatform: () => "darwin",
    downloadParakeetModel: (model) => {
      calls.downloads.push(model);
      const request = deferred();
      pending.push(request);
      return request.promise;
    },
    cancelParakeetDownload: async () => {
      calls.cancels += 1;
      return { success: true };
    },
    onParakeetDownloadProgress: (callback) => {
      listeners.progress = callback;
      return () => {};
    },
    personalInference: {
      codexStatus: async () => ({ available: false, account: null }),
      codexModels: async () => ({ data: [] }),
      codexRateLimits: async () => ({}),
      onTextEvent: () => () => {},
    },
  };
  installBrowserGlobals(t, {
    window: {
      electronAPI: new Proxy(api, {
        get(target, name) {
          if (name in target) return target[name];
          if (typeof name === "symbol" || name === "then") return undefined;
          return () => (/^on[A-Z]/.test(String(name)) ? () => {} : Promise.resolve());
        },
      }),
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
  });
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-onboarding-download-", { "/ui/useToast": TOAST_MOCK })
  );
  const { default: OnboardingFlow } = await vite.ssrLoadModule("/components/OnboardingFlow.tsx");
  root = createRoot(tree.container);
  await React.act(async () => {
    root.render(React.createElement(OnboardingFlow, { onComplete() {}, initialStep: "speech" }));
  });
  const progress = async (model, percentage) =>
    React.act(async () =>
      listeners.progress({}, {
        type: "progress",
        model,
        percentage,
        downloaded_bytes: 265_000_000,
        total_bytes: 631_000_000,
      })
    );
  const progressbar = () => tree.find((node) => node.attributes?.role === "progressbar");
  return { ...tree, calls, pending, progress, progressbar };
}

test("the speech step shows the real download percentage", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("Download model");
  assert.equal(flow.calls.downloads.length, 1);
  await flow.progress(flow.calls.downloads[0], 42);
  const bar = flow.progressbar();
  assert.ok(bar, "a progressbar replaces the pulsing placeholder");
  assert.equal(bar.attributes["aria-valuenow"], "42");
  const placeholder = flow.find((node) =>
    /\bw-2\/3 animate-pulse\b/.test(node.attributes?.class ?? "")
  );
  assert.equal(placeholder, null, "the fake two-thirds bar is gone");
});

test("a download in flight follows the user to later steps as a footer chip", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("Download model");
  await flow.progress(flow.calls.downloads[0], 42);
  await flow.click("Continue");
  assert.match(flow.text(), /onboarding\.download\.chip\(percent=42\)/);
});

test("a cancelled download returns to idle and a late result cannot mark it interrupted", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("Download model");
  await flow.progress(flow.calls.downloads[0], 42);
  await flow.click("common.cancel");
  assert.equal(flow.calls.cancels, 1);
  // Main reports the aborted request after the user already cancelled.
  await React.act(async () => flow.pending[0].resolve({ success: false, error: "cancelled" }));
  assert.match(flow.text(), /Download the selected model/);
  assert.doesNotMatch(flow.text(), /The download was interrupted/);
  assert.equal(flow.progressbar(), null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- test/components/onboardingDownloadProgress.test.js`
Expected: FAIL on "a progressbar replaces the pulsing placeholder", because `progressbar()` returns `null`.

- [ ] **Step 4: Implement**

1. In `src/hooks/useModelDownload.ts`, make the three subscriptions optional calls (lines 269–278). Without this, any `electronAPI` that lacks the method throws inside an effect: the browser preview stub, or a test's `{}`.

   ```ts
       const dispose =
         modelType === "whisper"
           ? window.electronAPI?.onWhisperDownloadProgress?.((_event, data) =>
               handleNativeProgress(data)
             )
           : modelType === "parakeet"
             ? window.electronAPI?.onParakeetDownloadProgress?.((_event, data) =>
                 handleNativeProgress(data)
               )
             : window.electronAPI?.onModelDownloadProgress?.(handleLLMProgress);
   ```

2. In `src/components/OnboardingFlow.tsx`, add imports:

   ```ts
   import { useTranslation } from "react-i18next";
   import { useModelDownload, type DownloadProgress } from "../hooks/useModelDownload";
   import { DownloadProgressBar } from "./ui/DownloadProgressBar";
   ```

   and a module-level constant next to `STEPS`:

   ```ts
   // The browser preview has no download pipeline; show a believable mid-download state.
   const PREVIEW_DOWNLOAD_PROGRESS: DownloadProgress = {
     percentage: 42,
     downloadedBytes: 265_000_000,
     totalBytes: 631_000_000,
   };
   ```

3. `StepShell`: add `footerStatus?: ReactNode;` to the props type and `footerStatus,` to the destructuring. In the footer, render it between the Back button and the right-hand `<div>`:

   ```tsx
         <footer className="onboarding-welcome-actions">
           <button className="onboarding-welcome-back" type="button" onClick={onBack}>
             Back
           </button>
           {footerStatus}
           <div>
   ```

4. `SpeechStep`:
   - Add these props (type and destructuring): `downloadProgress: DownloadProgress; downloadInstalling: boolean; downloadCancelling: boolean; onCancelDownload: () => void;`.
   - Add `const { t } = useTranslation();` as the first line of the body.
   - Replace the Download button (lines 439–446) with:

   ```tsx
               <Button
                 onClick={onDownload}
                 disabled={
                   downloadState === "downloading" || downloadCancelling || !selectedSupportsLanguage
                 }
               >
                 <Download className="me-2 h-4 w-4" />
                 {downloadState === "downloading" ? "Downloading…" : "Download model"}
               </Button>
   ```

   Then replace the fake bar (lines 448–452) with:

   ```tsx
           {downloadState === "downloading" && (
             <div className="mt-3 flex items-end gap-3">
               <div className="min-w-0 flex-1">
                 <DownloadProgressBar
                   modelName={selected.name}
                   progress={downloadProgress}
                   isInstalling={downloadInstalling}
                 />
               </div>
               {!downloadInstalling && (
                 <Button
                   variant="outline"
                   size="sm"
                   onClick={onCancelDownload}
                   disabled={downloadCancelling}
                 >
                   {t("common.cancel")}
                 </Button>
               )}
             </div>
           )}
   ```

5. `OnboardingFlow`: add the following directly after the `downloadState` `useState` (it ends around line 1052):

   ```ts
     const { t } = useTranslation();
     // The hook owns progress events and cancel for the Parakeet pipeline. The
     // download still starts through downloadModel below, so onboarding keeps
     // its own ready and error state.
     const {
       downloads: speechDownloadStatus,
       cancelDownload: cancelSpeechModelDownload,
       isCancellingModel,
     } = useModelDownload({ modelType: "parakeet" });
     // Each start or cancel bumps this, so a cancelled request's late result is ignored.
     const downloadRequestRef = useRef(0);
     const liveSpeechDownload = speechDownloadStatus[selectedModel];
     const speechProgress: DownloadProgress = preview
       ? PREVIEW_DOWNLOAD_PROGRESS
       : {
           percentage: liveSpeechDownload?.progress ?? 0,
           downloadedBytes: liveSpeechDownload?.downloadedBytes ?? 0,
           totalBytes: liveSpeechDownload?.totalBytes ?? 0,
         };
     const speechInstalling = liveSpeechDownload?.phase === "installing";
     const speechCancelling = !preview && isCancellingModel(selectedModel);
   ```

6. Replace `downloadModel` (lines 1154–1188) with a guarded version, and add `cancelSpeechDownload` after it:

   ```ts
     const downloadModel = useCallback(() => {
       const requestedModel = selectedModel;
       const request = ++downloadRequestRef.current;
       const isCurrent = () =>
         request === downloadRequestRef.current && selectedModelRef.current === requestedModel;
       setDownloadState("downloading");
       if (preview) {
         window.setTimeout(() => {
           if (!isCurrent()) return;
           const ready = scenario !== "download-interrupted";
           setDownloadState(ready ? "ready" : "error");
           setSpeechModelReady(ready);
           if (config && ready)
             localStorage.setItem(
               `${onboardingPreviewStorageKey(config)}.speechReadyModel`,
               requestedModel
             );
         }, 500);
         return;
       }
       const download = window.electronAPI?.downloadParakeetModel;
       if (!download) {
         setDownloadState("error");
         return;
       }
       void download(requestedModel)
         .then((result) => {
           if (!isCurrent()) return;
           const ready = Boolean(result?.success && result?.downloaded);
           setSpeechModelReady(ready);
           setDownloadState(ready ? "ready" : "error");
         })
         .catch(() => {
           if (isCurrent()) setDownloadState("error");
         });
     }, [config, preview, scenario, selectedModel]);

     const cancelSpeechDownload = useCallback(() => {
       downloadRequestRef.current += 1;
       setDownloadState("idle");
       if (!preview) void cancelSpeechModelDownload(selectedModelRef.current);
     }, [cancelSpeechModelDownload, preview]);
   ```

7. Pass the new props at the `SpeechStep` call site:

   ```tsx
           downloadProgress={speechProgress}
           downloadInstalling={speechInstalling}
           downloadCancelling={speechCancelling}
           onCancelDownload={cancelSpeechDownload}
   ```

   and add the chip at the `StepShell` call site:

   ```tsx
         footerStatus={
           step !== "speech" && downloadState === "downloading" ? (
             <span className="onboarding-download-chip">
               {speechInstalling
                 ? t("onboarding.download.chipInstalling")
                 : t("onboarding.download.chip", {
                     percent: Math.round(speechProgress.percentage),
                   })}
             </span>
           ) : undefined
         }
   ```

   The chip is deliberately not a live region. Progress ticks every 100 ms, and announcing each tick would drown out the step content. The speech step's progressbar is where assistive tech reads the value.

8. In `src/styles/onboarding-welcome.css`, after the `.onboarding-welcome-actions > div { … }` block, add:

   ```css
   .onboarding-download-chip {
     display: inline-flex;
     min-height: 28px;
     align-items: center;
     padding-inline: 12px;
     border: 1px solid var(--ow-border);
     border-radius: 999px;
     color: var(--ow-secondary);
     font-size: 12px;
     font-variant-numeric: tabular-nums;
     white-space: nowrap;
   }
   ```

   `--ow-secondary` (#525252) on `--ow-panel` (#fff) is 7.8:1.

9. Add the toast mock to the two existing OnboardingFlow tests. The hook calls `useToast()` at the top level, and that throws without a provider.
   - In `test/components/onboardingCleanupWiring.test.js`, change `createRendererServer(t, { cachePrefix: "loqui-onboarding-wiring-test-" })` to:

     ```js
       const vite = await createRendererServer(t, {
         cachePrefix: "loqui-onboarding-wiring-test-",
         mockModules: { "/ui/useToast": TOAST_MOCK },
       });
     ```

     and add `const { TOAST_MOCK } = require("../helpers/harness/rendererMocks");`.
   - In `test/components/personalWorkspace.test.js`, add `"/ui/useToast": TOAST_MOCK,` to the `mockModules` object at lines 27–30, plus the same `require`.

10. Add the locale keys:

    ```bash
    node - <<'EOF'
    const fs = require("node:fs");
    const path = require("node:path");
    const ADD = {
      "onboarding.download.chip": {
        en: "Downloading voice model · {{percent}}%", ar: "جارٍ تنزيل نموذج الصوت · {{percent}}%",
        de: "Sprachmodell wird heruntergeladen · {{percent}}%", es: "Descargando modelo de voz · {{percent}}%",
        fr: "Téléchargement du modèle vocal · {{percent}}%", it: "Download del modello vocale · {{percent}}%",
        ja: "音声モデルをダウンロード中 · {{percent}}%", pt: "Baixando modelo de voz · {{percent}}%",
        ru: "Загрузка голосовой модели · {{percent}}%", "zh-CN": "正在下载语音模型 · {{percent}}%",
        "zh-TW": "正在下載語音模型 · {{percent}}%",
      },
      "onboarding.download.chipInstalling": {
        en: "Installing voice model", ar: "جارٍ تثبيت نموذج الصوت", de: "Sprachmodell wird installiert",
        es: "Instalando el modelo de voz", fr: "Installation du modèle vocal",
        it: "Installazione del modello vocale", ja: "音声モデルをインストール中",
        pt: "Instalando o modelo de voz", ru: "Установка голосовой модели",
        "zh-CN": "正在安装语音模型", "zh-TW": "正在安裝語音模型",
      },
    };
    for (const lang of fs.readdirSync("src/locales")) {
      const file = path.join("src/locales", lang, "translation.json");
      if (!fs.existsSync(file)) continue;
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const [key, values] of Object.entries(ADD)) {
        if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
        const parts = key.split(".");
        let node = json;
        for (const part of parts.slice(0, -1)) node = node[part] ??= {};
        node[parts.at(-1)] = values[lang];
      }
      fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
    }
    EOF
    ```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/components/onboardingDownloadProgress.test.js test/components/onboardingCleanupWiring.test.js test/components/personalWorkspace.test.js test/hooks/modelDownloadErrors.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add test/helpers/harness/fakeDomTree.js test/components/onboardingDownloadProgress.test.js test/components/onboardingCleanupWiring.test.js test/components/personalWorkspace.test.js src/hooks/useModelDownload.ts src/components/OnboardingFlow.tsx src/styles/onboarding-welcome.css src/locales
git commit -m "feat(onboarding): real speech-model download progress with cancel"
```

---

### Task 4: Dictation errors stay long enough to read, and never drop a transcript

Covers VO-Q6. This is a minimal change to the existing toast. Plan 04 migrates it to `notify({ kind: "alert" })` (§5.3).

**Files:**
- Modify: `src/helpers/toastPresentation.js:24-31` (`getDictationErrorDuration`)
- Modify: `src/hooks/useAudioRecording.js:323-330` (the `toast({...})` inside `showDictationError`)
- Test: `test/helpers/toastPresentation.test.js:49-62`, and add a case to `test/helpers/useAudioRecordingForceStop.test.js`

**Interfaces:**
- `getDictationErrorDuration(title, description)` keeps its signature. It now returns `6000 | 8000 | 10000`.
- A dictation-error toast whose card offers "View transcript" is created with `duration: 0`. The provider treats that as no auto-dismiss (`src/components/ui/Toast.tsx:97` only starts a timer when `duration > 0`).

The transcript never reaches the toast as a field. The decision belongs in `showDictationError` (`src/hooks/useAudioRecording.js:300`), which computes `recoverableTranscript` at line 303. `getDictationErrorDuration` only sees title and description, so the rule cannot live there.

- [ ] **Step 1: Write the failing tests**

In `test/helpers/toastPresentation.test.js`, replace the three duration tests (lines 49–62) with:

```js
test("short dictation errors stay for six seconds", async () => {
  const { getDictationErrorDuration } = await load();
  assert.equal(getDictationErrorDuration("Paste Error", "Please try again."), 6000);
});

test("medium dictation errors stay for eight seconds", async () => {
  const { getDictationErrorDuration } = await load();
  assert.equal(getDictationErrorDuration("Error", "a".repeat(100)), 8000);
});

test("long dictation errors stay for ten seconds", async () => {
  const { getDictationErrorDuration } = await load();
  assert.equal(getDictationErrorDuration("Error", "a".repeat(200)), 10000);
});
```

At the end of `test/helpers/useAudioRecordingForceStop.test.js`, add:

```js
test("an error card that holds the transcript never auto-dismisses", async (t) => {
  const harness = await mountHarness(t);
  await harness.forceStop("timeout");
  await harness.complete();
  const [toast] = errorToasts(harness);
  assert.ok(toast.actions.some((a) => a.icon === "transcript"));
  assert.equal(toast.duration, 0, "the user's words stay until they act on them");
});

test("an error card without a transcript keeps the reading-time timer", async (t) => {
  const harness = await mountHarness(t);
  await React.act(async () =>
    globalThis.__forceStopAudioManager.callbacks.onError({ message: "Network down" })
  );
  const [toast] = errorToasts(harness);
  assert.ok(toast, "the error is shown");
  assert.equal(toast.duration, undefined, "the provider picks 6/8/10 s from the text length");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/toastPresentation.test.js test/helpers/useAudioRecordingForceStop.test.js`
Expected: FAIL. `3000 !== 6000`, and `toast.duration` is `undefined`, not `0`.

- [ ] **Step 3: Implement**

In `src/helpers/toastPresentation.js`, replace the function and its comment (lines 24–31):

```js
/** Dictation errors interrupt someone mid-task: give every message time to be
 * read twice. Detailed failures get longer. */
export function getDictationErrorDuration(title = "", description = "") {
  const messageLength = [title, description].filter(Boolean).join(" ").trim().length;

  if (messageLength <= SHORT_MESSAGE_MAX_LENGTH) return 6000;
  if (messageLength <= MEDIUM_MESSAGE_MAX_LENGTH) return 8000;
  return 10000;
}
```

In `src/hooks/useAudioRecording.js`, inside `showDictationError`, change the `toast({...})` call (lines 323–330) to:

```js
      toast({
        title,
        description,
        variant: "destructive",
        presentation: "dictation-error",
        // A card holding the only copy of the user's words stays until they
        // act on it: View transcript, Retry, close, or the next dictation.
        duration: recoverableTranscript ? 0 : duration,
        actions,
      });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/toastPresentation.test.js test/helpers/useAudioRecordingForceStop.test.js test/hooks/dictationErrorAutoHide.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/toastPresentation.js src/hooks/useAudioRecording.js test/helpers/toastPresentation.test.js test/helpers/useAudioRecordingForceStop.test.js
git commit -m "fix(voice): longer dictation error timers; keep cards that hold a transcript"
```

---

### Task 5: Toasts announce themselves and keep a visible close button

Covers VO-Q9. This is a minimal change to the existing toast. Plan 04 owns the replacement `notify()`.

**Files:**
- Modify: `src/components/ui/Toast.tsx`:
  - export the item component (line 238, `const Toast`);
  - the root `<div>` opening tag (lines 353–364; the element closes at line 456);
  - the copy button `aria-label` (line 394);
  - the close button (lines 427–443).
- Test: `test/components/toastLiveRegion.test.js`

**Interfaces:**
- Consumes `rendererOptions` (Task 1).
- Produces `export const Toast` (previously module-private). The props are unchanged: `ToastState & { onClose?, onPauseTimer, onResumeTimer }`.

Notes:
- `DictationErrorCard` already has `role="alert"` (`src/components/dictation/DictationErrorCard.tsx:123`). Only the standard presentation lacks a live region.
- `test/components/rtlMotion.test.js` asserts the class string `toast-enter opacity-100 translate-x-0 scale-100`. Keep it byte-identical.

- [ ] **Step 1: Write the failing test**

Create `test/components/toastLiveRegion.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/ui/Toast.tsx"),
  "utf8"
);

async function renderToast(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-toast-live-region-"));
  const { Toast } = await vite.ssrLoadModule("/components/ui/Toast.tsx");
  return renderToStaticMarkup(
    createElement(Toast, {
      id: "1",
      title: "Saved",
      description: "Your note was saved.",
      presentation: "standard",
      duration: 3500,
      createdAt: 0,
      isExiting: false,
      onClose() {},
      onPauseTimer() {},
      onResumeTimer() {},
      ...props,
    })
  );
}

test("a standard toast is a polite status region", async (t) => {
  const html = await renderToast(t, { variant: "default" });
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-atomic="true"/);
});

test("a destructive toast is an assertive alert", async (t) => {
  const html = await renderToast(t, { variant: "destructive", title: "Couldn't save" });
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-live="assertive"/);
});

test("the close button is visible at rest, full strength on hover or focus, and named", async (t) => {
  const html = await renderToast(t, { variant: "default" });
  const close = html.match(/<button type="button" class="([^"]*-start-2[^"]*)"/);
  assert.ok(close, "close is a type=button");
  assert.match(close[1], /\bopacity-50\b/);
  assert.match(close[1], /group-hover:opacity-100/);
  assert.match(close[1], /focus-visible:opacity-100/);
  assert.doesNotMatch(close[1], /\bopacity-0\b/);
  assert.match(html, /<span class="sr-only">common\.close<\/span>/);
});

test("no hard-coded English accessible names remain", () => {
  assert.doesNotMatch(source, /aria-label="Copy error"/);
  assert.doesNotMatch(source, /<span className="sr-only">Close<\/span>/);
  assert.match(source, /aria-label=\{t\("common\.copy"\)\}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/toastLiveRegion.test.js`
Expected: FAIL. `Toast` is `undefined` (not exported), so `createElement` throws.

- [ ] **Step 3: Implement**

1. Line 238: change `const Toast: React.FC<` to `export const Toast: React.FC<`.
2. Add live-region attributes to the standard root `<div>` (line 353). Leave the `className` untouched:

   ```tsx
       <div
         role={isDestructive ? "alert" : "status"}
         aria-live={isDestructive ? "assertive" : "polite"}
         aria-atomic="true"
         className={cn(
   ```

3. Line 394: change `aria-label="Copy error"` to `aria-label={t("common.copy")}`.
4. Replace the close button (lines 428–442) with:

   ```tsx
           <button
             type="button"
             onClick={onClose}
             className={cn(
               "absolute -start-2 -top-2 size-6 rounded-full",
               "flex items-center justify-center",
               "bg-white/10 backdrop-blur-sm border border-white/10",
               "text-white/70 hover:text-white hover:bg-white/20",
               // Visible at rest so it is discoverable without a mouse; full
               // strength on hover or keyboard focus.
               "opacity-50 group-hover:opacity-100 focus-visible:opacity-100",
               "transition-opacity duration-150",
               "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
             )}
           >
             <X className="size-3" aria-hidden="true" />
             <span className="sr-only">{t("common.close")}</span>
           </button>
   ```

`common.close` ("Close") and `common.copy` ("Copy") already exist in every locale.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/toastLiveRegion.test.js test/components/rtlMotion.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Toast.tsx test/components/toastLiveRegion.test.js
git commit -m "fix(a11y): live regions on toasts and a visible, named close button"
```

---

### Task 6: Esc stays armed until the pipeline is idle

Covers VO-Q8. It is compatible with D3 (Plan 04 adds instant cancel with undo on top).

**Files:**
- Modify: `src/hooks/useAudioRecording.js`. Change line 259 (`performStopRecording`) and lines 341–347 (`onStateChange`), and add a release to the effect cleanup (lines 785–798).
- Modify: `src/App.jsx:358-369`. Route the cancel hotkey to processing too.
- Test: `test/helpers/useAudioRecordingCancelHotkey.test.js`

**Interfaces:**
- Consumes:
  - `window.electronAPI.registerCancelHotkey(key)` and `unregisterCancelHotkey()` (`preload.js:541-543`). These map to `hotkeyManager.registerSlot("cancel", …)` in `src/helpers/ipcHandlers.js:3510-3521`.
  - `cancelProcessing()`, which is already exported by `useAudioRecording` and implemented in `src/helpers/audioManager.js:1745`.
- Produces this invariant for Plan 04: the cancel hotkey is registered from the moment recording starts until `onStateChange` reports `!isRecording && !isProcessing`, or until the hook unmounts.

Today Esc is released in four places:
- `performStartRecording`'s stop-during-start path (line 196). Keep it; register has not run yet.
- `performStopRecording` (line 259). Remove it.
- The `!isRecording` branch of `onStateChange` (line 342). That branch fires on the recording→processing edge, so move the release to the idle edge.
- `cancelRecording` (line 818). Keep it; the user already cancelled.

`App.jsx:365` also ignored the hotkey unless recording.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/useAudioRecordingCancelHotkey.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

// A manager whose state the test drives. startRecording and stopRecording
// emit the same onStateChange sequence the real AudioManager does.
const FAKE_AUDIO_MANAGER_SOURCE = `
export default class FakeAudioManager {
  constructor() {
    this.voiceAgentRequested = false;
    this.translationRequested = false;
    this.sttConfig = {};
    this.state = { isRecording: false, isProcessing: false, isStreaming: false };
    globalThis.__cancelHotkeyManager = this;
  }
  getState() { return this.state; }
  setCallbacks(callbacks) { this.callbacks = callbacks; }
  setVoiceAgentRequested() {}
  setAssistantSelectionContext() {}
  setTranslationRequested() {}
  shouldUseStreaming() { return false; }
  emit(next) {
    this.state = { ...this.state, ...next };
    this.callbacks.onStateChange({ ...this.state });
  }
  startRecording() { this.emit({ isRecording: true }); return Promise.resolve(true); }
  stopRecording() { this.emit({ isRecording: false, isProcessing: true }); return true; }
  cancelProcessing() { this.emit({ isProcessing: false }); return true; }
  cancelRecording() { this.emit({ isRecording: false }); return true; }
  cancelPreparedMicCapture() {}
  cleanup() {}
}
`;

const SETTINGS_STORE_SOURCE = `
export const useSettingsStore = { subscribe: () => () => {} };
export const getSettings = () => ({ pauseMediaOnDictation: false, voiceAgentScreenContext: false, snippets: [] });
`;

const LOGGER_SOURCE = `
const noop = () => {};
export default { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, logReasoning: noop };
`;

const TRANSLATION_SOURCE = `
const translate = (key) => key;
export const useTranslation = () => ({ t: translate });
`;

async function mountHarness(t) {
  let root = null;
  const unmount = async () => {
    if (!root) return;
    const current = root;
    root = null;
    await React.act(async () => current.unmount());
  };
  t.after(unmount);
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
    t.after(() => delete globalThis.requestAnimationFrame);
  }
  const hotkey = [];
  const noopDispose = () => () => {};
  const NOOP = () => {};
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onToggleDictation: noopDispose,
        onToggleVoiceAgent: noopDispose,
        onToggleTranslation: noopDispose,
        onStartDictation: noopDispose,
        onPrepareDictation: noopDispose,
        onCancelDictationPreparation: noopDispose,
        onStopDictation: noopDispose,
        onDictationForceStopped: noopDispose,
        dictationLifecycleStateChanged: NOOP,
        completeDictationPreview: NOOP,
        hideDictationPreview: NOOP,
        setScreenContextEnabled: NOOP,
        registerCancelHotkey: async (key) => hotkey.push(`register:${key}`),
        unregisterCancelHotkey: async () => hotkey.push("unregister"),
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-cancel-hotkey-",
    noExternal: ["react-i18next"],
    mockModules: {
      "/helpers/audioManager": FAKE_AUDIO_MANAGER_SOURCE,
      "/stores/settingsStore": SETTINGS_STORE_SOURCE,
      "/utils/logger": LOGGER_SOURCE,
      "react-i18next": TRANSLATION_SOURCE,
    },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  const api = {};
  function Harness() {
    Object.assign(api, useAudioRecording(() => "", { onDemoEvent: NOOP }));
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  const manager = () => globalThis.__cancelHotkeyManager;
  return {
    hotkey,
    unmount,
    start: () => React.act(async () => api.startRecording()),
    stop: () => React.act(async () => api.stopRecording()),
    emit: (next) => React.act(async () => manager().emit(next)),
  };
}

// The arming that happens before recording starts is not under test.
const sinceStart = (hotkey) => hotkey.slice(hotkey.indexOf("register:Escape"));

test("Esc stays registered while a dictation is processing", async (t) => {
  const h = await mountHarness(t);
  await h.start();
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape"]);
  await h.emit({ isRecording: false, isProcessing: true });
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape"], "processing keeps Esc armed");
});

test("Esc is released on the idle edge", async (t) => {
  const h = await mountHarness(t);
  await h.start();
  await h.emit({ isRecording: false, isProcessing: true });
  await h.emit({ isProcessing: false });
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape", "unregister"]);
});

test("stopping a recording does not release Esc before processing ends", async (t) => {
  const h = await mountHarness(t);
  await h.start();
  await h.stop();
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape"]);
});

test("unmounting releases Esc even mid-processing", async (t) => {
  const h = await mountHarness(t);
  await h.start();
  await h.emit({ isRecording: false, isProcessing: true });
  await h.unmount();
  assert.equal(h.hotkey.at(-1), "unregister");
});

test("the cancel hotkey cancels processing when nothing is recording", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../src/App.jsx"), "utf8");
  assert.match(
    app,
    /onCancelHotkeyPressed\?\.\(\(\) => \{\s*if \(isRecordingRef\.current\) cancelRecording\(\);\s*else if \(isProcessingRef\.current\) cancelProcessing\(\);/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/helpers/useAudioRecordingCancelHotkey.test.js`
Expected: FAIL. "processing keeps Esc armed" sees an extra `"unregister"`, and the App.jsx assertion fails.

- [ ] **Step 3: Implement**

1. In `src/hooks/useAudioRecording.js`, `performStopRecording`: delete line 259, `window.electronAPI?.unregisterCancelHotkey?.();`. Put this comment in its place:

   ```js
         // Esc stays armed through processing; onStateChange releases it at idle.
   ```

2. In `onStateChange`, replace the opening of the `if (!isRecording) {` block (lines 341–343):

   ```js
           if (!isRecording) {
             window.electronAPI?.unregisterCancelHotkey?.();
             // Resume media the instant recording ends, not after transcription.
   ```

   with:

   ```js
           if (!isRecording && !isProcessing) {
             // Esc is armed from recording start until the whole pipeline is
             // idle, so the keyboard can cancel a slow transcription (D3).
             window.electronAPI?.unregisterCancelHotkey?.();
           }
           if (!isRecording) {
             // Resume media the instant recording ends, not after transcription.
   ```

3. In the main effect's cleanup (`return () => {` at line 785), add the following as the first statement after `reportLifecycle("idle");`:

   ```js
         // Never leave a global Esc capture behind a reload or a route change.
         window.electronAPI?.unregisterCancelHotkey?.();
   ```

4. In `src/App.jsx`, replace lines 358–369 with:

   ```jsx
     const isRecordingRef = useRef(isRecording);
     const isProcessingRef = useRef(isProcessing);

     useLayoutEffect(() => {
       isRecordingRef.current = isRecording;
       isProcessingRef.current = isProcessing;
     }, [isRecording, isProcessing]);

     useEffect(() => {
       // useAudioRecording keeps Esc registered until the pipeline is idle, so
       // the hotkey cancels whichever phase is running.
       const unsubscribe = window.electronAPI?.onCancelHotkeyPressed?.(() => {
         if (isRecordingRef.current) cancelRecording();
         else if (isProcessingRef.current) cancelProcessing();
       });
       return () => unsubscribe?.();
     }, [cancelRecording, cancelProcessing]);
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/useAudioRecordingCancelHotkey.test.js test/helpers/useAudioRecordingForceStop.test.js test/helpers/useAudioRecordingPreparingReset.test.js test/helpers/audioManagerCancelLifecycle.test.js test/helpers/voicePillPresentation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAudioRecording.js src/App.jsx test/helpers/useAudioRecordingCancelHotkey.test.js
git commit -m "fix(voice): keep Esc armed until the dictation pipeline is idle"
```

---

### Task 7: Native notification when meeting audio is lost

Covers VO-Q16, per D2: "Interruption alerts go out as native notifications regardless of focus". See Contract change request 1.

**Files:**
- Create: `src/helpers/systemNotification.js`
- Modify: `src/helpers/ipcHandlers.js`. Add `Notification` to the line-1 `require("electron")`, and add a handler next to `sync-notification-preferences` (line 9373).
- Modify: `preload.js`. Add `showSystemNotification` after `syncNotificationPreferences` (line 1083).
- Modify: `src/types/electron.ts`. Add the method type after `syncNotificationPreferences?` (line 2241).
- Modify: `src/components/MeetingRecordingMount.tsx`. Add a native-notice effect after the interruption effect (after line 173), and add a native call to the mic effect (lines 175–193).
- Test: `test/helpers/systemNotification.test.js`. Also extend `test/components/meetingInterruptionWarning.test.js`.

**Interfaces:**
- Produces `src/helpers/systemNotification.js`:
  - `MAX_TITLE_LENGTH = 120`, `MAX_BODY_LENGTH = 400`;
  - `normalizeSystemNotification(payload): { title: string; body: string } | null`;
  - `showSystemNotification({ Notification, payload, prefs, onClick }): { success: boolean; reason?: "disabled" | "unsupported" | "invalid" }`.
- Produces the preload method `window.electronAPI.showSystemNotification(payload: { title: string; body?: string }): Promise<{ success: boolean; reason?: string }>`.
- Consumes the existing translated copy only:
  - `notes.meeting.systemAudioStopped.*` and `notes.meeting.systemAudioQuiet.*`;
  - `hooks.audioRecording.micDisconnected.title` and `.meetingDescription`.

Behaviour:
- A native notice fires once per interruption nonce, whether or not the window is focused or visible. The existing in-app toast keeps its focus gate.
- `recovering` interruptions are self-healing and stay toast-only.
- Main honours the master `notificationsEnabled` preference (`windowManager.notificationPrefs`, `src/helpers/windowManager.js:79`).
- Electron can garbage-collect a `Notification` before its click arrives, so main keeps a reference until `close` or `click`.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/systemNotification.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const {
  normalizeSystemNotification,
  showSystemNotification,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
} = require("../../src/helpers/systemNotification");

function fakeNotificationClass({ supported = true } = {}) {
  const shown = [];
  class FakeNotification extends EventEmitter {
    static isSupported() {
      return supported;
    }
    constructor(options) {
      super();
      this.options = options;
    }
    show() {
      shown.push(this);
    }
  }
  return { FakeNotification, shown };
}

test("payloads are trimmed, capped and rejected when there is no title", () => {
  assert.equal(normalizeSystemNotification(null), null);
  assert.equal(normalizeSystemNotification({ title: "   " }), null);
  assert.equal(normalizeSystemNotification({ title: 42 }), null);
  const long = normalizeSystemNotification({ title: "t".repeat(500), body: "b".repeat(900) });
  assert.equal(long.title.length, MAX_TITLE_LENGTH);
  assert.equal(long.body.length, MAX_BODY_LENGTH);
  assert.deepEqual(normalizeSystemNotification({ title: " Audio stopped " }), {
    title: "Audio stopped",
    body: "",
  });
});

test("a valid payload shows one notification and click runs the focus handler", () => {
  const { FakeNotification, shown } = fakeNotificationClass();
  let clicks = 0;
  const result = showSystemNotification({
    Notification: FakeNotification,
    payload: { title: "Meeting audio stopped", body: "Check your output device." },
    prefs: { notificationsEnabled: true },
    onClick: () => clicks++,
  });
  assert.deepEqual(result, { success: true });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].options.title, "Meeting audio stopped");
  shown[0].emit("click");
  assert.equal(clicks, 1);
});

test("the master notifications switch and unsupported platforms are honoured", () => {
  const { FakeNotification, shown } = fakeNotificationClass();
  assert.deepEqual(
    showSystemNotification({
      Notification: FakeNotification,
      payload: { title: "x" },
      prefs: { notificationsEnabled: false },
    }),
    { success: false, reason: "disabled" }
  );
  const unsupported = fakeNotificationClass({ supported: false });
  assert.deepEqual(
    showSystemNotification({ Notification: unsupported.FakeNotification, payload: { title: "x" } }),
    { success: false, reason: "unsupported" }
  );
  assert.deepEqual(
    showSystemNotification({ Notification: FakeNotification, payload: {} }),
    { success: false, reason: "invalid" }
  );
  assert.equal(shown.length, 0);
});

test("the bridge is wired through preload and main", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
  assert.match(
    read("preload.js"),
    /showSystemNotification: \(payload\) =>\s*ipcRenderer\.invoke\("show-system-notification", payload\)/
  );
  assert.match(read("src/helpers/ipcHandlers.js"), /ipcMain\.handle\("show-system-notification"/);
  assert.match(read("src/types/electron.ts"), /showSystemNotification\?: \(payload: \{/);
});
```

In `test/components/meetingInterruptionWarning.test.js`:
- add this method to the `api` object in `setup` (it starts at line 21):

  ```js
      showSystemNotification(payload) {
        globalThis.__nativeNotices.push(payload);
        return Promise.resolve({ success: true });
      },
  ```

- add `globalThis.__nativeNotices = [];` next to `globalThis.__interruptionToasts = [];`;
- append these tests:

```js
test("a lost meeting audio source raises one native notification even while hidden", async (t) => {
  const { interrupt, focus } = await setup(t);
  globalThis.document.hidden = true;
  globalThis.document.visibilityState = "hidden";
  await interrupt();
  assert.equal(globalThis.__interruptionToasts.length, 0, "the in-app warning still waits");
  assert.equal(globalThis.__nativeNotices.length, 1);
  assert.equal(globalThis.__nativeNotices[0].title, "Meeting audio stopped");
  await focus(false);
  assert.equal(globalThis.__nativeNotices.length, 1, "no replay on focus changes");
});

test("a recovering interruption stays in-app only", async (t) => {
  const { interrupt } = await setup(t);
  await interrupt({ recovering: true });
  assert.equal(globalThis.__nativeNotices.length, 0);
});

test("a remount does not replay a delivered native notification", async (t) => {
  const { interrupt, render } = await setup(t);
  await interrupt({ reason: "gone_quiet" });
  assert.equal(globalThis.__nativeNotices[0].title, "Meeting audio has gone quiet");
  await render(false);
  await render(true);
  assert.equal(globalThis.__nativeNotices.length, 1);
});

test("losing the microphone mid-meeting raises a native notification", async (t) => {
  const { store } = await setup(t);
  await React.act(async () =>
    store.useMeetingRecordingStore.setState({ micCaptureStatus: "unavailable" })
  );
  assert.equal(globalThis.__nativeNotices.length, 1);
  assert.equal(globalThis.__nativeNotices[0].title, "Microphone disconnected");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/systemNotification.test.js test/components/meetingInterruptionWarning.test.js`
Expected: FAIL. `Cannot find module '../../src/helpers/systemNotification'`, and `__nativeNotices.length` is 0.

- [ ] **Step 3: Implement**

1. Create `src/helpers/systemNotification.js`:

   ```js
   // Native OS notifications requested by a renderer. Main owns them so they
   // reach the user when the window is hidden, unfocused or on another Space,
   // which is when an in-app toast cannot (D2).
   const MAX_TITLE_LENGTH = 120;
   const MAX_BODY_LENGTH = 400;

   // Electron can garbage-collect a Notification before its click fires; hold
   // each one until the OS closes it or the user clicks it.
   const active = new Set();

   function normalizeSystemNotification(payload) {
     if (!payload || typeof payload !== "object") return null;
     const title = typeof payload.title === "string" ? payload.title.trim() : "";
     if (!title) return null;
     const body = typeof payload.body === "string" ? payload.body.trim() : "";
     return { title: title.slice(0, MAX_TITLE_LENGTH), body: body.slice(0, MAX_BODY_LENGTH) };
   }

   function showSystemNotification({ Notification, payload, prefs, onClick }) {
     if (prefs && prefs.notificationsEnabled === false) return { success: false, reason: "disabled" };
     if (!Notification || !Notification.isSupported()) return { success: false, reason: "unsupported" };
     const content = normalizeSystemNotification(payload);
     if (!content) return { success: false, reason: "invalid" };
     const notification = new Notification({ title: content.title, body: content.body });
     active.add(notification);
     const release = () => active.delete(notification);
     notification.on("close", release);
     notification.on("click", () => {
       release();
       onClick?.();
     });
     notification.show();
     return { success: true };
   }

   module.exports = {
     MAX_TITLE_LENGTH,
     MAX_BODY_LENGTH,
     normalizeSystemNotification,
     showSystemNotification,
   };
   ```

2. In `src/helpers/ipcHandlers.js`:
   - change line 1 to `const { ipcMain, app, shell, BrowserWindow, systemPreferences, net, Notification } = require("electron");`;
   - add `const { showSystemNotification } = require("./systemNotification");` with the other local requires at the top of the file;
   - directly before `ipcMain.handle("sync-notification-preferences", …)` (line 9373), add:

   ```js
       ipcMain.handle("show-system-notification", async (event, payload) =>
         showSystemNotification({
           Notification,
           payload,
           prefs: this.windowManager.notificationPrefs,
           onClick: () => {
             const win = BrowserWindow.fromWebContents(event.sender);
             if (!win || win.isDestroyed()) return;
             if (win.isMinimized()) win.restore();
             win.show();
             win.focus();
           },
         })
       );
   ```

3. In `preload.js`, after the `syncNotificationPreferences` entry (lines 1083–1084), add:

   ```js
     showSystemNotification: (payload) =>
       ipcRenderer.invoke("show-system-notification", payload),
   ```

4. In `src/types/electron.ts`, after the `syncNotificationPreferences?` member (lines 2241–2243), add:

   ```ts
         showSystemNotification?: (payload: {
           title: string;
           body?: string;
         }) => Promise<{ success: boolean; reason?: "disabled" | "unsupported" | "invalid" }>;
   ```

5. In `src/components/MeetingRecordingMount.tsx`:
   - Add a module-level variable after the imports:

     ```ts
     // Survives remounts within this renderer, so a route change never replays a
     // native notification that already went out.
     let lastNativeInterruptionNonce: number | null = null;
     ```

   - After the interruption effect (it ends at line 173), add:

     ```tsx
       // Native delivery does not wait for focus: a hidden or covered window is
       // exactly when the in-app warning above cannot be seen (D2, VO-Q16).
       useEffect(() => {
         const state = useMeetingRecordingStore.getState();
         const interruption = state.systemAudioInterrupted;
         if (!state.isRecording || !interruption || interruption.recovering) return;
         if (lastNativeInterruptionNonce === state.systemAudioInterruptedNonce) return;
         lastNativeInterruptionNonce = state.systemAudioInterruptedNonce;
         const key =
           interruption.reason === "gone_quiet"
             ? "notes.meeting.systemAudioQuiet"
             : "notes.meeting.systemAudioStopped";
         void window.electronAPI?.showSystemNotification?.({
           title: t(`${key}.title`),
           body: t(`${key}.description`),
         });
       }, [isRecording, systemAudioInterrupted, systemAudioInterruptedNonce, t]);
     ```

   - In the mic effect, inside `if (micCaptureStatus === "unavailable" && !wasMicUnavailable.current) {`, after the existing `toast({...})`, add:

     ```tsx
           void window.electronAPI?.showSystemNotification?.({
             title: t("hooks.audioRecording.micDisconnected.title"),
             body: t("hooks.audioRecording.micDisconnected.meetingDescription"),
           });
     ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/systemNotification.test.js test/components/meetingInterruptionWarning.test.js test/helpers/preloadOnboardingBridge.test.js`
Expected: PASS, including every existing interruption test (the toast gating is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/helpers/systemNotification.js src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/components/MeetingRecordingMount.tsx test/helpers/systemNotification.test.js test/components/meetingInterruptionWarning.test.js
git commit -m "feat(meetings): native notification when meeting audio or the mic is lost"
```

---

### Task 8: "Now" keeps moving in Coming up

Covers WS-Q1.

**Files:**
- Create: `src/hooks/useNow.ts`
- Create: `src/utils/upcomingEventGroups.ts`. This moves `DayGroup`, `MAX_DAY_CARDS` and `groupEventsByDay` out of `UpcomingMeetings.tsx` (lines 38–71), and adds `isEventLive`.
- Modify: `src/components/UpcomingMeetings.tsx`:
  - imports (lines 1–15);
  - delete the moved code (lines 37–71, keeping `MAX_STACKED_AVATARS`);
  - the `now` and `isNowFn` code (lines 290–297).
- Test: `test/utils/upcomingEventGroups.test.js` and `test/hooks/useNow.test.js`

**Interfaces:**
- Produces:
  - `useNow(intervalMs?: number): Date`, with default `NOW_TICK_MS = 30_000`;
  - `groupEventsByDay(events: CalendarEvent[], now: Date): DayGroup[]`;
  - `isEventLive(event: Pick<CalendarEvent, "start_time" | "end_time">, now: Date): boolean`;
  - `type DayGroup`.

Facts from the code:
- The audit's line 290 is right.
- There is no "in N min" label and no time-based early join. The join button reveals on hover or focus (lines 218–229). What freezes is the `isNow` flip and the `isToday` grouping.
- Day keys are `toDateString()` (local time). They roll over at midnight once `now` advances, and a 30 s tick lands within 30 s of midnight.

- [ ] **Step 1: Write the failing tests**

Create `test/utils/upcomingEventGroups.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const load = () => import("../../src/utils/upcomingEventGroups.ts");
const at = (h, m = 0, day = 15) => new Date(2026, 9, day, h, m);
const event = (start, end, summary = "Standup") => ({
  id: summary,
  summary,
  start_time: start.toISOString(),
  end_time: end.toISOString(),
});

test("an event is live from its start to its end, inclusive", async () => {
  const { isEventLive } = await load();
  const standup = event(at(9), at(9, 30));
  assert.equal(isEventLive(standup, at(8, 59)), false);
  assert.equal(isEventLive(standup, at(9)), true);
  assert.equal(isEventLive(standup, at(9, 30)), true);
  assert.equal(isEventLive(standup, at(9, 31)), false);
});

test("unparseable times are never live", async () => {
  const { isEventLive } = await load();
  assert.equal(isEventLive({ start_time: "nope", end_time: "nope" }, at(9)), false);
});

test("an all-day event is live across its local day, matching its day group", async () => {
  const { isEventLive } = await load();
  const allDay = { start_time: "2026-10-15", end_time: "2026-10-16" };
  assert.equal(isEventLive(allDay, at(0, 30)), true);
  assert.equal(isEventLive(allDay, at(23, 30)), true);
  assert.equal(isEventLive(allDay, at(9, 0, 14)), false);
});

test("'today' moves with the clock across midnight", async () => {
  const { groupEventsByDay } = await load();
  const events = [event(at(9, 0, 16), at(9, 30, 16))];
  const before = groupEventsByDay(events, at(23, 59, 15));
  assert.equal(before[0].isToday, true, "an empty today card leads before midnight");
  assert.equal(before[1].isToday, false);
  const after = groupEventsByDay(events, at(0, 0, 16));
  assert.equal(after.length, 1);
  assert.equal(after[0].isToday, true, "the 16th becomes today after midnight");
});

test("UpcomingMeetings no longer freezes its clock", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/components/UpcomingMeetings.tsx"),
    "utf8"
  );
  assert.doesNotMatch(source, /useMemo\(\(\) => new Date\(\), \[\]\)/);
  assert.match(source, /const now = useNow\(\);/);
  assert.match(source, /isEventLive\(event, now\)/);
});
```

Create `test/hooks/useNow.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");

test("useNow re-renders with a later time on every tick and stops on unmount", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-use-now-" });
  const { useNow, NOW_TICK_MS } = await vite.ssrLoadModule("/hooks/useNow.ts");
  assert.equal(NOW_TICK_MS, 30_000);
  const seen = [];
  function Harness() {
    seen.push(useNow(20).getTime());
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  const initial = seen.length;
  await React.act(async () => new Promise((resolve) => setTimeout(resolve, 75)));
  assert.ok(seen.length >= initial + 2, `ticked ${seen.length - initial} times`);
  assert.ok(seen.at(-1) > seen[0], "time advanced");
  await React.act(async () => root.unmount());
  root = null;
  const afterUnmount = seen.length;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(seen.length, afterUnmount, "the interval is cleared");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/utils/upcomingEventGroups.test.js test/hooks/useNow.test.js`
Expected: FAIL with `Cannot find module` for both new modules.

- [ ] **Step 3: Implement**

Create `src/hooks/useNow.ts`:

```ts
import { useEffect, useState } from "react";

/** 30 s keeps a live label at most half a minute late and rolls "today" over
 * within 30 s of local midnight, at the cost of one cheap re-render. */
export const NOW_TICK_MS = 30_000;

/** A clock for time-relative UI ("Now", "today"). */
export function useNow(intervalMs: number = NOW_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
```

Create `src/utils/upcomingEventGroups.ts`. Move the code verbatim from `UpcomingMeetings.tsx` lines 38–71, export it, and add `isEventLive`:

```ts
import type { CalendarEvent } from "../types/calendar";
import { parseEventDate } from "./dateFormatting";

// Today plus the next days that have events, capped at a working week.
export const MAX_DAY_CARDS = 5;

export interface DayGroup {
  key: string;
  date: Date;
  isToday: boolean;
  items: CalendarEvent[];
}

export function groupEventsByDay(events: CalendarEvent[], now: Date): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const event of events) {
    const date = parseEventDate(event.start_time);
    if (!date) continue;
    const key = date.toDateString();
    let group = byKey.get(key);
    if (!group) {
      group = { key, date, isToday: key === now.toDateString(), items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(event);
  }
  // Surface "today" even when it has nothing scheduled, so the list always
  // answers "what's next today?" at a glance.
  if (groups.length > 0 && !groups.some((g) => g.isToday)) {
    groups.unshift({ key: now.toDateString(), date: now, isToday: true, items: [] });
  }
  return groups.slice(0, MAX_DAY_CARDS);
}

/** Live from start to end, inclusive. Uses parseEventDate like the grouping
 * above, so an all-day "YYYY-MM-DD" event is read in local time, not UTC
 * (the old isNowFn used new Date() and disagreed west of UTC). Unparseable
 * times compare false. */
export function isEventLive(
  event: Pick<CalendarEvent, "start_time" | "end_time">,
  now: Date
): boolean {
  const start = parseEventDate(event.start_time);
  const end = parseEventDate(event.end_time);
  if (!start || !end) return false;
  return start <= now && now <= end;
}
```

In `src/components/UpcomingMeetings.tsx`:
- Delete lines 38–39 (`MAX_DAY_CARDS` and its comment), the `DayGroup` interface and `groupEventsByDay` (lines 43–71). Keep `MAX_STACKED_AVATARS`.
- Remove the `parseEventDate` import (line 15), and add:

  ```ts
  import { useNow } from "../hooks/useNow";
  import { groupEventsByDay, isEventLive, type DayGroup } from "../utils/upcomingEventGroups";
  ```

- Replace lines 290–297 with:

  ```tsx
    const now = useNow();
    const groupedEvents = useMemo(() => groupEventsByDay(events, now), [events, now]);

    const isNowFn = (event: CalendarEvent) => isEventLive(event, now);
  ```

`DayCard` keeps using `DayGroup`, which is now an imported type. `useMemo` is still imported and used.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/utils/upcomingEventGroups.test.js test/hooks/useNow.test.js test/components/directionalContentPolicy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useNow.ts src/utils/upcomingEventGroups.ts src/components/UpcomingMeetings.tsx test/utils/upcomingEventGroups.test.js test/hooks/useNow.test.js
git commit -m "fix(workspace): Coming up keeps \"Now\" and \"today\" current"
```

---

### Task 9: A real chat composer

Covers WS-Q5.

**Files:**
- Create: `src/components/chat/chatInputKeys.ts`
- Modify: `src/components/chat/ChatInput.tsx`:
  - imports (line 1);
  - `inputRef` (line 68);
  - `handleSubmit` and `handleKeyDown` (lines 86–102);
  - the container (lines 118–127);
  - the `<input>` and the button row (lines 200–273);
  - a queued hint after the container.
- Modify: `src/locales/*/translation.json`. Add `agentMode.input.queued` and `agentMode.input.unqueue`.
- Test: `test/components/chatComposer.test.js`

**Interfaces:**
- Produces `src/components/chat/chatInputKeys.ts`:
  - `type ComposerKeyAction = "submit" | "queue" | "unqueue" | "none"`;
  - `resolveComposerKey(input: { key: string; shiftKey: boolean; isComposing: boolean; keyCode?: number; isBusy: boolean; isQueued: boolean; hasText: boolean }): ComposerKeyAction`;
  - `COMPOSER_MAX_HEIGHT_PX = 160`;
  - `composerHeight(scrollHeight: number, maxHeight?: number): { height: number; overflowY: "hidden" | "auto" }`.
- `ChatInputProps` is unchanged. All four call sites keep working:
  - `ChatView.tsx:173`;
  - `EmbeddedChat.tsx:137`;
  - `OverviewAskSection.tsx:60`;
  - `AssistantPanel.tsx:533`.

Behaviour:
- **While the agent is busy (`thinking | streaming | tool-executing`),** the textarea stays editable. Enter marks the draft as queued, and the draft stays visible in the box. The draft is sent on the next idle, and the box clears only when it is sent.
- **Unqueuing:** Esc, the "Don't send when done" button, Stop, or clearing the text all unqueue. Pressing Stop never sends a queued draft.
- **Line breaks and IME:** Shift+Enter inserts a newline. Enter during IME composition does nothing.
- **Tests:** `fieldDirectionPolicy.test.js:78` expects exactly one `dir="auto"` native field in this file. The `<textarea … />` replaces the `<input … />` one for one.

- [ ] **Step 1: Write the failing test**

Create `test/components/chatComposer.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");

const loadKeys = () => import("../../src/components/chat/chatInputKeys.ts");
const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/chat/ChatInput.tsx"),
  "utf8"
);
const base = { shiftKey: false, isComposing: false, isBusy: false, isQueued: false, hasText: true };

test("Enter submits when idle and queues while the agent is busy", async () => {
  const { resolveComposerKey } = await loadKeys();
  assert.equal(resolveComposerKey({ ...base, key: "Enter" }), "submit");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", isBusy: true }), "queue");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", hasText: false }), "none");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", shiftKey: true }), "none");
});

test("Enter during IME composition does nothing", async () => {
  const { resolveComposerKey } = await loadKeys();
  assert.equal(resolveComposerKey({ ...base, key: "Enter", isComposing: true }), "none");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", keyCode: 229 }), "none");
  assert.equal(
    resolveComposerKey({ ...base, key: "Enter", isBusy: true, isComposing: true }),
    "none"
  );
});

test("Escape unqueues only a queued draft", async () => {
  const { resolveComposerKey } = await loadKeys();
  assert.equal(resolveComposerKey({ ...base, key: "Escape", isQueued: true }), "unqueue");
  assert.equal(resolveComposerKey({ ...base, key: "Escape" }), "none");
});

test("the textarea grows to a cap and then scrolls", async () => {
  const { composerHeight, COMPOSER_MAX_HEIGHT_PX } = await loadKeys();
  assert.deepEqual(composerHeight(40), { height: 40, overflowY: "hidden" });
  assert.deepEqual(composerHeight(400), { height: COMPOSER_MAX_HEIGHT_PX, overflowY: "auto" });
  assert.deepEqual(composerHeight(Number.NaN), { height: 0, overflowY: "hidden" });
});

async function renderInput(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-chat-composer-", {
      "/ui/useToast": TOAST_MOCK,
      "/useVoiceDraft": `export const useVoiceDraft = () => ({ status: "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0, streamingOnlyProvider: false });`,
    })
  );
  const { default: ChatInput } = await vite.ssrLoadModule("/components/chat/ChatInput.tsx");
  return renderToStaticMarkup(
    createElement(ChatInput, { partialTranscript: "", onTextSubmit() {}, ...props })
  );
}

test("the composer stays typeable while the agent is busy", async (t) => {
  const html = await renderInput(t, { agentState: "thinking", onCancel() {} });
  const textarea = html.match(/<textarea[^>]*>/);
  assert.ok(textarea, "the composer is a textarea");
  assert.doesNotMatch(textarea[0], /disabled/);
  assert.match(textarea[0], /dir="auto"/);
  assert.match(textarea[0], /rows="1"/);
  assert.match(html, /aria-label="common\.cancel"/, "Stop is still offered");
});

test("Stop never sends a queued draft, and the busy state is not a disabled field", () => {
  assert.doesNotMatch(source, /disabled=\{isBusy\}/);
  assert.doesNotMatch(source, /cursor-not-allowed/);
  assert.match(source, /onClick=\{\(\) => \{\s*setQueued\(false\);\s*onCancel\?\.\(\);/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/chatComposer.test.js`
Expected: FAIL with `Cannot find module '…/chatInputKeys.ts'`.

- [ ] **Step 3: Implement**

Create `src/components/chat/chatInputKeys.ts`:

```ts
export type ComposerKeyAction = "submit" | "queue" | "unqueue" | "none";

export interface ComposerKeyInput {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode?: number;
  isBusy: boolean;
  isQueued: boolean;
  hasText: boolean;
}

/** What a key press in the composer means. IME composition owns Enter
 * (isComposing, or keyCode 229 where Chromium reports the commit key late).
 * Shift+Enter is a newline. */
export function resolveComposerKey(input: ComposerKeyInput): ComposerKeyAction {
  if (input.isComposing || input.keyCode === 229) return "none";
  if (input.key === "Escape") return input.isQueued ? "unqueue" : "none";
  if (input.key !== "Enter" || input.shiftKey || !input.hasText) return "none";
  return input.isBusy ? "queue" : "submit";
}

export const COMPOSER_MAX_HEIGHT_PX = 160;

export function composerHeight(
  scrollHeight: number,
  maxHeight: number = COMPOSER_MAX_HEIGHT_PX
): { height: number; overflowY: "hidden" | "auto" } {
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return { height: 0, overflowY: "hidden" };
  return scrollHeight > maxHeight
    ? { height: maxHeight, overflowY: "auto" }
    : { height: scrollHeight, overflowY: "hidden" };
}
```

In `src/components/chat/ChatInput.tsx`:

1. Line 1 becomes `import { useState, useRef, useCallback, useEffect, useId, useLayoutEffect } from "react";`, and add `import { composerHeight, resolveComposerKey } from "./chatInputKeys";`.
2. Line 68 becomes `const inputRef = useRef<HTMLTextAreaElement>(null);`. Directly after it, add:

   ```tsx
     const [queued, setQueued] = useState(false);
     const queuedHintId = useId();
   ```

3. Replace `handleKeyDown` (lines 94–102) with the code below, and add the resize and auto-send effects after the existing `isIdle` focus effect (line 114):

   ```tsx
     const handleKeyDown = useCallback(
       (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
         const action = resolveComposerKey({
           key: e.key,
           shiftKey: e.shiftKey,
           isComposing: e.nativeEvent.isComposing,
           keyCode: e.nativeEvent.keyCode,
           isBusy,
           isQueued: queued,
           hasText: Boolean(inputText.trim()),
         });
         if (action === "none") return;
         e.preventDefault();
         if (action === "submit") handleSubmit();
         else if (action === "queue") setQueued(true);
         else setQueued(false);
       },
       [handleSubmit, inputText, isBusy, queued]
     );
   ```

   `isBusy` is declared below the current `handleKeyDown`. Move the four `const isIdle / isListening / isTranscribing / isBusy` lines (104–108) above `handleSubmit` so both callbacks can read them.

   ```tsx
     // Grow with the text up to the cap, then scroll inside the box.
     useLayoutEffect(() => {
       const el = inputRef.current;
       if (!el) return;
       el.style.height = "auto";
       const { height, overflowY } = composerHeight(el.scrollHeight);
       el.style.height = `${height}px`;
       el.style.overflowY = overflowY;
     }, [inputText]);

     // A draft queued while the agent was busy goes out on the next idle. It
     // stayed visible in the box the whole time, so nothing is lost if the
     // send itself is refused.
     useEffect(() => {
       if (isIdle && queued) {
         setQueued(false);
         handleSubmit();
       }
     }, [isIdle, queued, handleSubmit]);
   ```

4. Container (lines 120–126): replace `"flex items-center gap-2 min-h-11 ps-4 pe-1.5 rounded-full",` with `"flex items-end gap-2 min-h-11 ps-4 pe-1.5 py-1.5 rounded-[22px]",`. Then change the `isIdle &&` focus-ring condition to `(isIdle || isBusy) &&` so the busy composer still shows focus.

5. Replace the `<input … />` element (lines 202–218) and the row's opening `<div className="flex items-center gap-2 w-full">` with:

   ```tsx
             <div className="flex items-end gap-2 w-full">
               <textarea
                 dir="auto"
                 ref={inputRef}
                 rows={1}
                 value={inputText}
                 onChange={(e) => {
                   setInputText(e.target.value);
                   if (!e.target.value.trim()) setQueued(false);
                 }}
                 onKeyDown={handleKeyDown}
                 autoFocus={autoFocus}
                 aria-describedby={queued ? queuedHintId : undefined}
                 placeholder={placeholder ?? t("agentMode.input.typeMessage")}
                 className={cn(
                   "input-inline flex-1 resize-none outline-none bg-transparent caret-primary",
                   "text-[13px] leading-5 text-foreground placeholder:text-muted-foreground/70",
                   "min-w-0 py-1.5 px-0"
                 )}
               />
   ```

6. Stop button `onClick` (line 222): change `onClick={onCancel}` to:

   ```tsx
                   onClick={() => {
                     setQueued(false);
                     onCancel?.();
                   }}
   ```

7. After the container's closing `</div>` (the one opened at line 119), and before the outer wrapper's closing `</div>`, add:

   ```tsx
         {queued && (
           <p
             id={queuedHintId}
             className="mt-1 flex items-center gap-2 ps-4 text-[11px] text-muted-foreground"
           >
             {t("agentMode.input.queued")}
             <button
               type="button"
               onClick={() => setQueued(false)}
               className="rounded-sm underline-offset-2 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/30"
             >
               {t("agentMode.input.unqueue")}
             </button>
           </p>
         )}
   ```

8. Add the locale keys:

   ```bash
   node - <<'EOF'
   const fs = require("node:fs");
   const path = require("node:path");
   const ADD = {
     "agentMode.input.queued": {
       en: "Sends when the reply finishes", ar: "سيُرسل عند انتهاء الرد",
       de: "Wird gesendet, sobald die Antwort fertig ist", es: "Se enviará cuando termine la respuesta",
       fr: "Sera envoyé à la fin de la réponse", it: "Verrà inviato al termine della risposta",
       ja: "返信が終わると送信されます", pt: "Será enviado quando a resposta terminar",
       ru: "Отправится, когда ответ будет готов", "zh-CN": "回复结束后发送", "zh-TW": "回覆結束後傳送",
     },
     "agentMode.input.unqueue": {
       en: "Don't send when done", ar: "عدم الإرسال عند الانتهاء", de: "Nicht automatisch senden",
       es: "No enviar al terminar", fr: "Ne pas envoyer à la fin", it: "Non inviare al termine",
       ja: "完了時に送信しない", pt: "Não enviar ao terminar", ru: "Не отправлять автоматически",
       "zh-CN": "完成后不发送", "zh-TW": "完成後不傳送",
     },
   };
   for (const lang of fs.readdirSync("src/locales")) {
     const file = path.join("src/locales", lang, "translation.json");
     if (!fs.existsSync(file)) continue;
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     for (const [key, values] of Object.entries(ADD)) {
       if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
       const parts = key.split(".");
       let node = json;
       for (const part of parts.slice(0, -1)) node = node[part] ??= {};
       node[parts.at(-1)] = values[lang];
     }
     fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
   }
   EOF
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/chatComposer.test.js test/components/fieldDirectionPolicy.test.js test/helpers/assistantPanel.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/chatInputKeys.ts src/components/chat/ChatInput.tsx src/locales test/components/chatComposer.test.js
git commit -m "feat(chat): auto-growing composer that stays typeable while the agent works"
```

---

### Task 10: Notes open without the Actions gate

Covers WS-Q7.

**Files:**
- Modify: `src/components/notes/shared.ts`. Append `NOTES_ACTIONS_MODEL_HINT_KEY` and `shouldShowActionsModelHint`.
- Modify: `src/components/notes/PersonalNotesView.tsx`:
  - imports (lines 5 and 78);
  - state (near line 138);
  - remove the early return (lines 679–685);
  - the sidebar Actions button (line 696);
  - add a hint row after it;
  - `ActionPicker.onManageActions` (line 762);
  - move `<ActionManagerDialog>` out of the editor branch (line 772);
  - add the intro dialog before the final `</div>` (line 935).
- Modify: `src/locales/*/translation.json`. Add `notes.actionsModelHint.title` and `notes.actionsModelHint.choose`.
- Test: `test/components/notesActionsGate.test.js`

**Interfaces:**
- Produces `NOTES_ACTIONS_MODEL_HINT_KEY = "notesActionsModelHintDismissed"` and `shouldShowActionsModelHint(modelId: string | null | undefined, dismissed: boolean): boolean`.
- Consumes:
  - `useNotesOnboarding()` (`src/hooks/useNotesOnboarding.ts`);
  - `NotesOnboarding` (`{ onComplete }`);
  - `ActionManagerDialog` (`{ open, onOpenChange }`);
  - `Dialog`, `DialogContent` and `DialogTitle` from `src/components/ui/dialog.tsx`;
  - the existing `onOpenSettings?: (section: string) => void` prop. `HistoryView.tsx:123` uses section `"intelligence"` for the same purpose.

Facts from the code:
- **The audit's description is stale.** The gate is not an AI-model check. It is the `notesOnboardingComplete` localStorage flag, so a first-time user never sees their notes.
- **The model signal for the hint.** `isLLMConfigured` is almost always true, because `cleanupModel` defaults to `qwen3.5-2b-q4_k_m`. The hint therefore uses the note-formatting model the view already resolves, `effectiveModelId` (line 249).
- **A second bug.** `ActionManagerDialog` is rendered only inside the `editorNote` branch, so the sidebar "Actions" button did nothing with no note open. Hoisting the dialog fixes that.

- [ ] **Step 1: Write the failing test**

Create `test/components/notesActionsGate.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const view = fs.readFileSync(
  path.join(__dirname, "../../src/components/notes/PersonalNotesView.tsx"),
  "utf8"
);
const load = () => import("../../src/components/notes/shared.ts");

test("the actions hint shows only without a model and until dismissed", async () => {
  const { shouldShowActionsModelHint, NOTES_ACTIONS_MODEL_HINT_KEY } = await load();
  assert.equal(NOTES_ACTIONS_MODEL_HINT_KEY, "notesActionsModelHintDismissed");
  assert.equal(shouldShowActionsModelHint("", false), true);
  assert.equal(shouldShowActionsModelHint(null, false), true);
  assert.equal(shouldShowActionsModelHint(undefined, false), true);
  assert.equal(shouldShowActionsModelHint("qwen3.5-2b-q4_k_m", false), false);
  assert.equal(shouldShowActionsModelHint("", true), false);
});

test("notes render without passing through the Actions first run", () => {
  assert.doesNotMatch(view, /if \(!isOnboardingComplete\) \{\s*return/);
});

test("Actions opens the first run once, then the manager, from any view", () => {
  assert.equal(view.match(/<ActionManagerDialog\b/g)?.length, 1, "one manager dialog");
  assert.ok(
    view.indexOf("<ActionManagerDialog") > view.indexOf("<ContainerOverview"),
    "the manager is outside the editor-only branch"
  );
  assert.match(view, /<DialogContent[\s\S]*?<NotesOnboarding onComplete=\{finishActionsIntro\} \/>/);
  assert.equal(view.match(/setShowActionManager\(true\)/g)?.length, 2, "openActions and finishActionsIntro");
  assert.match(view, /onManageActions=\{openActions\}/);
});

test("the hint links to model settings and can be dismissed", () => {
  assert.match(view, /shouldShowActionsModelHint\(effectiveModelId, modelHintDismissed\)/);
  assert.match(view, /onOpenSettings\("intelligence"\)/);
  assert.match(view, /localStorage\.setItem\(NOTES_ACTIONS_MODEL_HINT_KEY, "true"\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/notesActionsGate.test.js`
Expected: FAIL. `shouldShowActionsModelHint` is not a function, and the early return is still present.

- [ ] **Step 3: Implement**

1. Append to `src/components/notes/shared.ts`:

   ```ts
   export const NOTES_ACTIONS_MODEL_HINT_KEY = "notesActionsModelHintDismissed";

   /** Notes always render; this row only explains why Actions cannot run yet. */
   export function shouldShowActionsModelHint(
     modelId: string | null | undefined,
     dismissed: boolean
   ): boolean {
     return !dismissed && !modelId;
   }
   ```

2. In `PersonalNotesView.tsx`, update the imports:
   - line 5 becomes `import { Plus, Sparkles, X } from "../icons";`;
   - line 78 becomes `import { defaultFolderDisplayName, notesEmptyTitleKey, NOTES_ACTIONS_MODEL_HINT_KEY, shouldShowActionsModelHint } from "./shared";`;
   - add `import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";` with the other `../ui/*` imports.

   If `X` is not exported from `../icons`, use the name `ChatInput.tsx` imports it under. It imports `{ Mic, Square, X }` from `"../icons"`, so `X` exists.

3. Next to `const [showActionManager, setShowActionManager] = useState(false);` (line 138), add:

   ```tsx
     const [showActionsIntro, setShowActionsIntro] = useState(false);
     const [modelHintDismissed, setModelHintDismissed] = useState(
       () => localStorage.getItem(NOTES_ACTIONS_MODEL_HINT_KEY) === "true"
     );
   ```

4. After the `useNotesOnboarding()` line (line 250), add:

   ```tsx
     // The old first-run screen is now the Actions manager's first run: notes
     // are never hidden behind it.
     const openActions = useCallback(() => {
       if (isOnboardingComplete) setShowActionManager(true);
       else setShowActionsIntro(true);
     }, [isOnboardingComplete]);

     const finishActionsIntro = useCallback(() => {
       completeOnboarding();
       setShowActionsIntro(false);
       setShowActionManager(true);
     }, [completeOnboarding]);

     const dismissModelHint = useCallback(() => {
       localStorage.setItem(NOTES_ACTIONS_MODEL_HINT_KEY, "true");
       setModelHintDismissed(true);
     }, []);
   ```

   `useCallback` is already imported in this file (it is used at line 236).

5. Delete the early return (lines 679–685):

   ```tsx
     if (!isOnboardingComplete) {
       return (
         <>
           <NotesOnboarding onComplete={completeOnboarding} />
         </>
       );
     }
   ```

6. Sidebar Actions button (line 696): change `onClick={() => setShowActionManager(true)}` to `onClick={openActions}`. Directly after that `</button>` (line 706), and still inside the `px-2 pt-2 pb-1` div, add:

   ```tsx
               {shouldShowActionsModelHint(effectiveModelId, modelHintDismissed) && (
                 <div
                   role="note"
                   className="mt-1 rounded-md border border-border/70 bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground"
                 >
                   <div className="flex items-start gap-1.5">
                     <span className="flex-1">{t("notes.actionsModelHint.title")}</span>
                     <button
                       type="button"
                       onClick={dismissModelHint}
                       aria-label={t("common.close")}
                       className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/30"
                     >
                       <X size={12} aria-hidden="true" />
                     </button>
                   </div>
                   {onOpenSettings && (
                     <button
                       type="button"
                       onClick={() => onOpenSettings("intelligence")}
                       className="mt-0.5 text-link hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/30 rounded-sm"
                     >
                       {t("notes.actionsModelHint.choose")}
                     </button>
                   )}
                 </div>
               )}
   ```

   `--color-link` (#c43e13 light, #ff9a7a dark) already exists in `src/index.css` (lines 31 and 154), so `text-link` resolves today.

7. `ActionPicker` (`onManageActions` at line 762): change `onManageActions={() => setShowActionManager(true)}` to `onManageActions={openActions}`.
8. Delete `<ActionManagerDialog open={showActionManager} onOpenChange={setShowActionManager} />` from the editor branch (line 772).
9. Before the component's final `</div>` (line 935, directly after the `{activeFolderId && (<AddNotesToFolderDialog … />)}` block), add:

   ```tsx
         <ActionManagerDialog open={showActionManager} onOpenChange={setShowActionManager} />
         <Dialog open={showActionsIntro} onOpenChange={setShowActionsIntro}>
           <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto p-0">
             <DialogTitle className="sr-only">{t("notes.onboarding.actions.title")}</DialogTitle>
             <NotesOnboarding onComplete={finishActionsIntro} />
           </DialogContent>
         </Dialog>
   ```

10. Add the locale keys:

    ```bash
    node - <<'EOF'
    const fs = require("node:fs");
    const path = require("node:path");
    const ADD = {
      "notes.actionsModelHint.title": {
        en: "Actions need an AI model", ar: "تحتاج الإجراءات إلى نموذج ذكاء اصطناعي",
        de: "Aktionen benötigen ein KI-Modell", es: "Las acciones necesitan un modelo de IA",
        fr: "Les actions nécessitent un modèle d'IA", it: "Le azioni richiedono un modello di IA",
        ja: "アクションには AI モデルが必要です", pt: "As ações precisam de um modelo de IA",
        ru: "Для действий нужна модель ИИ", "zh-CN": "操作需要 AI 模型", "zh-TW": "動作需要 AI 模型",
      },
      "notes.actionsModelHint.choose": {
        en: "Choose a model", ar: "اختر نموذجًا", de: "Modell wählen", es: "Elegir un modelo",
        fr: "Choisir un modèle", it: "Scegli un modello", ja: "モデルを選択", pt: "Escolher um modelo",
        ru: "Выбрать модель", "zh-CN": "选择模型", "zh-TW": "選擇模型",
      },
    };
    for (const lang of fs.readdirSync("src/locales")) {
      const file = path.join("src/locales", lang, "translation.json");
      if (!fs.existsSync(file)) continue;
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const [key, values] of Object.entries(ADD)) {
        if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
        const parts = key.split(".");
        let node = json;
        for (const part of parts.slice(0, -1)) node = node[part] ??= {};
        node[parts.at(-1)] = values[lang];
      }
      fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
    }
    EOF
    ```

11. The comment at line 288 (block 286–292) says the dialog "also renders in the onboarding branch below". Step 5 removed that branch, so delete that clause from the comment.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/notesActionsGate.test.js test/components/notesShared.test.js test/components/fieldDirectionPolicy.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/notes/shared.ts src/components/notes/PersonalNotesView.tsx src/locales test/components/notesActionsGate.test.js
git commit -m "fix(notes): render notes without the Actions gate; first run moves to Actions"
```

---

### Task 11: Settings navigation semantics and real provider tabs

Covers SET-Q1 and SET-Q20.

**Files:**
- Create: `src/components/ui/providerTabsKeys.ts`
- Modify: `src/components/ui/SidebarModal.tsx`. Change the `<nav>` (line 151) and the nav item `<button>` (lines 171–183).
- Modify: `src/components/ui/ProviderTabs.tsx`. Change the imports (line 1), `ProviderTabItem` (lines 7–13) and the render (lines 72–123).
- Test: `test/components/settingsNavigation.test.js`

**Interfaces:**
- Produces:
  - `nextEnabledTabIndex(disabled: readonly boolean[], current: number, key: string, direction: "ltr" | "rtl"): number | null`;
  - `ProviderTabItem.keySaved?: boolean`, which renders a small dot plus screen-reader text from the existing `personal.keyConfigured` ("Key saved securely"). Plan 03 (SET-R5) wires real key status; no caller sets it in this plan.
- Consumes `rendererOptions` (Task 1).

Behaviour:
- **Roving focus.** The selected enabled tab, or else the first enabled tab, is the only tab stop.
- **Arrow keys.**
  - Left and Right move focus in reading order, so they swap under RTL.
  - Home and End jump to the first and last enabled tab.
  - Disabled tabs are skipped. They keep the native `disabled` attribute, so they cannot take focus.
- **Manual activation.** Enter, Space or a click selects. Some callers switch local and remote (`ReasoningModelSelector.tsx:527` mode tabs), so focus alone must never select.
- **The settings sidebar nav** gets `aria-current="page"`, a visible 2px orange focus ring (`--color-ring` is `#ff5a1f` in both themes), an accessible name in compact mode, and an `aria-label` on `<nav>`. The ring is inset, because the nav scrolls (`overflow-y-auto`) and would clip an outset ring.

- [ ] **Step 1: Write the failing test**

Create `test/components/settingsNavigation.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
const loadKeys = () => import("../../src/components/ui/providerTabsKeys.ts");

test("the settings sidebar marks the current section and shows keyboard focus", () => {
  const modal = read("src/components/ui/SidebarModal.tsx");
  assert.match(modal, /<nav\s+aria-label=\{title\}/);
  assert.match(modal, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.match(modal, /aria-label=\{isCompact \? item\.label : undefined\}/);
  assert.match(modal, /outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset/);
});

test("arrow keys move between enabled tabs and wrap", async () => {
  const { nextEnabledTabIndex } = await loadKeys();
  const disabled = [false, true, false, false];
  assert.equal(nextEnabledTabIndex(disabled, 0, "ArrowRight", "ltr"), 2, "skips disabled");
  assert.equal(nextEnabledTabIndex(disabled, 3, "ArrowRight", "ltr"), 0, "wraps");
  assert.equal(nextEnabledTabIndex(disabled, 0, "ArrowLeft", "ltr"), 3);
  assert.equal(nextEnabledTabIndex(disabled, 2, "Home", "ltr"), 0);
  assert.equal(nextEnabledTabIndex(disabled, 0, "End", "ltr"), 3);
  assert.equal(nextEnabledTabIndex(disabled, 0, "Enter", "ltr"), null, "Enter is activation");
  assert.equal(nextEnabledTabIndex([true, true], 0, "ArrowRight", "ltr"), null);
});

test("RTL swaps Left and Right", async () => {
  const { nextEnabledTabIndex } = await loadKeys();
  const disabled = [false, false, false];
  assert.equal(nextEnabledTabIndex(disabled, 0, "ArrowLeft", "rtl"), 1);
  assert.equal(nextEnabledTabIndex(disabled, 0, "ArrowRight", "rtl"), 2);
});

test("arrow keys only move focus; selection stays an explicit activation", () => {
  const tabs = read("src/components/ui/ProviderTabs.tsx");
  const handler = tabs.match(/const handleKeyDown = [\s\S]*?\n {2}\};/)[0];
  assert.match(handler, /\.focus\(\)/);
  assert.doesNotMatch(handler, /onSelect/);
});

test("provider tabs render as a tablist with one tab stop", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-provider-tabs-"));
  const { ProviderTabs } = await vite.ssrLoadModule("/components/ui/ProviderTabs.tsx");
  const html = renderToStaticMarkup(
    createElement(ProviderTabs, {
      providers: [
        { id: "openai", name: "OpenAI", keySaved: true },
        { id: "groq", name: "Groq", disabled: true, disabledLabel: "Soon" },
        { id: "anthropic", name: "Anthropic" },
      ],
      selectedId: "anthropic",
      onSelect() {},
    })
  );
  assert.match(html, /role="tablist"/);
  const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
  assert.equal(tabs.length, 3);
  assert.match(tabs[2], /aria-selected="true"/);
  assert.match(tabs[2], /tabindex="0"/);
  assert.match(tabs[0], /aria-selected="false"/);
  assert.match(tabs[0], /tabindex="-1"/);
  assert.match(tabs[1], /disabled=""/);
  assert.match(html, /<span class="sr-only">personal\.keyConfigured<\/span>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/settingsNavigation.test.js`
Expected: FAIL. There is no `aria-current` in SidebarModal, and `providerTabsKeys.ts` is missing.

- [ ] **Step 3: Implement**

Create `src/components/ui/providerTabsKeys.ts`:

```ts
export type TabDirection = "ltr" | "rtl";

/** Where a key moves focus in a tab row: reading-order arrows (swapped in RTL),
 * Home and End, skipping disabled tabs and wrapping. null means "not a
 * navigation key"; Enter and Space stay with the button as activation. */
export function nextEnabledTabIndex(
  disabled: readonly boolean[],
  current: number,
  key: string,
  direction: TabDirection
): number | null {
  const count = disabled.length;
  if (count === 0) return null;
  const forward = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
  const backward = direction === "rtl" ? "ArrowRight" : "ArrowLeft";
  let start: number;
  let step: number;
  if (key === forward) [start, step] = [current + 1, 1];
  else if (key === backward) [start, step] = [current - 1, -1];
  else if (key === "Home") [start, step] = [0, 1];
  else if (key === "End") [start, step] = [count - 1, -1];
  else return null;
  for (let i = 0; i < count; i++) {
    const index = (((start + i * step) % count) + count) % count;
    if (!disabled[index]) return index;
  }
  return null;
}
```

In `src/components/ui/SidebarModal.tsx`:
- Line 151: `<nav` becomes `<nav aria-label={title}`. `title` is a `string` prop (line 23).
- Nav item button (lines 171–176). Add these attributes, and change the class string's `outline-none` to `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`:

  ```tsx
                              <button
                                key={item.id}
                                type="button"
                                data-section-id={item.id}
                                aria-current={isActive ? "page" : undefined}
                                aria-label={isCompact ? item.label : undefined}
                                onClick={() => onSectionChange(item.id)}
                                title={isCompact ? item.label : undefined}
                                className={`group relative w-full flex items-center text-start text-xs rounded-md transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
  ```

In `src/components/ui/ProviderTabs.tsx`:
1. Line 1 becomes `import { ReactNode, useRef, useEffect, useLayoutEffect, useCallback, type KeyboardEvent } from "react";`, and add `import { nextEnabledTabIndex } from "./providerTabsKeys";`.
2. Add `keySaved?: boolean;` to `ProviderTabItem`.
3. Change `const { t } = useTranslation();` to `const { t, i18n } = useTranslation();`. Then, after `updateIndicator` and its effects, add:

   ```tsx
     const selectedIndex = providers.findIndex((p) => p.id === selectedId && !p.disabled);
     const tabStopIndex =
       selectedIndex !== -1 ? selectedIndex : providers.findIndex((p) => !p.disabled);

     const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
       const buttons = Array.from(
         containerRef.current?.querySelectorAll<HTMLButtonElement>("[data-tab-button]") ?? []
       );
       const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
       if (current === -1) return;
       const next = nextEnabledTabIndex(
         providers.map((p) => !!p.disabled),
         current,
         event.key,
         i18n?.dir?.() === "rtl" ? "rtl" : "ltr"
       );
       if (next === null) return;
       event.preventDefault();
       buttons[next]?.focus();
     };
   ```

4. In the render:
   - Add `role="tablist"` and `onKeyDown={handleKeyDown}` to the container `<div>`.
   - Add `aria-hidden="true"` to the indicator `<div>`.
   - Change the map callback to `providers.map((provider, index) => {`.
   - On each tab `<button>`, add `role="tab"`, `aria-selected={isSelected}` and `tabIndex={index === tabStopIndex ? 0 : -1}`. Keep `disabled` and `aria-disabled`.
   - Add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` to the first class string, after `transition-colors duration-150`.
   - After the `disabledLabel` span, add:

   ```tsx
               {provider.keySaved && (
                 <>
                   <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                   <span className="sr-only">{t("personal.keyConfigured")}</span>
                 </>
               )}
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/settingsNavigation.test.js test/components/directionalContentPolicy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/providerTabsKeys.ts src/components/ui/ProviderTabs.tsx src/components/ui/SidebarModal.tsx test/components/settingsNavigation.test.js
git commit -m "fix(a11y): settings nav semantics and real provider tabs"
```

---

### Task 12: Keyboard-selectable model cards

Covers SET-Q2.

**Files:**
- Modify: `src/components/ui/ModelCardList.tsx`:
  - `ModelCardProps` (line 46) and `ModelCardListProps` (line 228);
  - the `ModelCard` render (lines 105–224);
  - the `ModelCardList` render (lines 258–273).
- Modify: `src/components/ui/SearchableModelList.tsx:244`. Pass `selectionRole="none"`.
- Modify: `src/locales/*/translation.json`. Add `models.deleteNamed` and `models.listLabel`.
- Test: `test/components/modelCardKeyboard.test.js`

**Interfaces:**
- Produces:
  - `ModelCardProps.selectionRole?: "radio" | "none"` (default `"radio"`);
  - `ModelCardListProps.ariaLabel?: string` (default `t("models.listLabel")`).
- Consumes `rendererOptions` (Task 1).

Design:
- **Why the card root cannot be the radio.** A `role="radio"` element's children are presentational. If the root were the radio, the card's delete, download and cancel buttons and its "Learn more" link would lose their roles. So the card keeps its layout and gains a full-bleed overlay `<button role="radio">` as a sibling of those controls.
  - The overlay is the hit area, the tab stop and the focus ring.
  - The real controls sit above it with `pointer-events-auto`.
  - The content row is `pointer-events-none`, so clicks on text reach the overlay.
  - This also fixes a latent bug: clicking "Learn more" used to bubble to the card and select it.
- **Selection is explicit.** Enter, Space (native `<button>`) or a click selects. Arrow keys are not a selection path, because these cards include remote models and moving focus must never switch where audio goes.
- **No nested radio.** `SearchableModelList` already wraps each card in `role="option"`, so it opts out with `selectionRole="none"`. That keeps the old root `onClick` and adds no radio.
- **Unselectable cards stay focusable.** A local model that is not downloaded is `aria-disabled`, not `disabled`. Screen-reader users can still find it next to its Download button.

- [ ] **Step 1: Write the failing test**

Create `test/components/modelCardKeyboard.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/ui/ModelCardList.tsx"),
  "utf8"
);

async function load(t) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-model-card-keyboard-"));
  return vite.ssrLoadModule("/components/ui/ModelCardList.tsx");
}

const LOCAL_MODELS = [
  { value: "parakeet", label: "Parakeet", isDownloaded: true },
  { value: "whisper", label: "Whisper", isDownloaded: true },
  { value: "orukeet", label: "Orukeet", isDownloaded: false },
];

test("a model list is a labelled radiogroup of named, selectable radios", async (t) => {
  const { default: ModelCardList } = await load(t);
  const html = renderToStaticMarkup(
    createElement(ModelCardList, {
      models: LOCAL_MODELS,
      selectedModel: "parakeet",
      onModelSelect() {},
      onDownload() {},
      onDelete() {},
    })
  );
  assert.match(html, /role="radiogroup" aria-label="models\.listLabel"/);
  const radios = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);
  assert.equal(radios.length, 3);
  assert.match(radios[0], /aria-checked="true"/);
  assert.match(radios[0], /aria-label="Parakeet"/);
  assert.match(radios[1], /aria-checked="false"/);
  assert.match(radios[2], /aria-disabled="true"/, "not downloaded yet");
  assert.doesNotMatch(radios[2], /\sdisabled=""/, "still focusable");
  assert.match(radios[0], /type="button"/);
});

test("the delete button is named and appears on keyboard focus, not only on hover", async (t) => {
  const { default: ModelCardList } = await load(t);
  const html = renderToStaticMarkup(
    createElement(ModelCardList, {
      models: LOCAL_MODELS,
      selectedModel: "parakeet",
      onModelSelect() {},
      onDownload() {},
      onDelete() {},
    })
  );
  const del = html.match(/<button[^>]*aria-label="models\.deleteNamed\(model=Whisper\)"[^>]*>/);
  assert.ok(del, "delete has an accessible name");
  assert.match(del[0], /group-focus-within:opacity-100/);
  assert.match(del[0], /focus-visible:opacity-100/);
});

test("a card inside a listbox option does not nest a radio", async (t) => {
  const { ModelCard } = await load(t);
  const html = renderToStaticMarkup(
    createElement(ModelCard, {
      model: { value: "gpt", label: "GPT" },
      isSelected: false,
      onSelect() {},
      selectionRole: "none",
    })
  );
  assert.doesNotMatch(html, /role="radio"/);
});

test("arrow keys are not a selection path", () => {
  assert.doesNotMatch(source, /Arrow(Up|Down|Left|Right)/);
  assert.doesNotMatch(source, /onKeyDown/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/modelCardKeyboard.test.js`
Expected: FAIL on the `role="radiogroup"` match.

- [ ] **Step 3: Implement**

1. Add `selectionRole?: "radio" | "none";` to `ModelCardProps` and `ariaLabel?: string;` to `ModelCardListProps`.
2. `ModelCard`: destructure `selectionRole = "radio",`. After `handleCardClick`, add:

   ```tsx
     const isSelectable = isLocalMode ? Boolean(isDownloaded) : true;
     const asRadio = selectionRole === "radio";
   ```

3. Replace the card's opening tags (lines 105–112: `return ( <div onClick={handleCardClick} …> <div className="flex items-center gap-1.5">`) with:

   ```tsx
     return (
       <div
         onClick={asRadio ? undefined : handleCardClick}
         className={`relative w-full p-2 rounded-md border text-start transition-colors duration-200 group overflow-hidden ${
           isSelected ? styles.selected : styles.default
         } ${!isLocalMode || (isDownloaded && !isSelected) ? "cursor-pointer" : ""}`}
       >
         {asRadio && (
           // The whole card is the hit area, but the radio is a sibling of the
           // card's own buttons and link so they keep their roles and names.
           <button
             type="button"
             role="radio"
             aria-checked={isSelected}
             aria-disabled={isSelectable ? undefined : true}
             aria-label={model.label}
             onClick={handleCardClick}
             className={cn(
               "absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
               isSelectable && !isSelected ? "cursor-pointer" : "cursor-default"
             )}
           />
         )}
         <div className={cn("relative flex items-center gap-1.5", asRadio && "pointer-events-none")}>
   ```

4. Add `pointer-events-auto` at the start of the class strings of the spec `<a>` (line 157) and of all three `<Button>`s (Delete, Cancel, Download).
5. Delete button (lines 181–191). Add an accessible name and the focus reveal:

   ```tsx
                   <Button
                     onClick={(e) => {
                       e.stopPropagation();
                       onDelete?.(model.value);
                     }}
                     size="icon"
                     variant="ghost"
                     aria-label={t("models.deleteNamed", { model: model.label })}
                     className="pointer-events-auto size-6 text-muted-foreground/70 hover:text-destructive opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-[color,opacity,transform] active:scale-95"
                   >
                     <Trash2 size={12} aria-hidden="true" />
                   </Button>
   ```

6. `ModelCardList`:
   - destructure `ariaLabel`;
   - add `const { t } = useTranslation();` at the top of the function;
   - change the container to `<div role="radiogroup" aria-label={ariaLabel ?? t("models.listLabel")} className={`space-y-0.5 ${className}`}>`.
7. `src/components/ui/SearchableModelList.tsx:244`: add `selectionRole="none"` to the `<ModelCard … />` inside the `role="option"` wrapper.
8. Add the locale keys:

   ```bash
   node - <<'EOF'
   const fs = require("node:fs");
   const path = require("node:path");
   const ADD = {
     "models.deleteNamed": {
       en: "Delete {{model}}", ar: "حذف {{model}}", de: "{{model}} löschen", es: "Eliminar {{model}}",
       fr: "Supprimer {{model}}", it: "Elimina {{model}}", ja: "{{model}} を削除", pt: "Excluir {{model}}",
       ru: "Удалить {{model}}", "zh-CN": "删除 {{model}}", "zh-TW": "刪除 {{model}}",
     },
     "models.listLabel": {
       en: "Models", ar: "النماذج", de: "Modelle", es: "Modelos", fr: "Modèles", it: "Modelli",
       ja: "モデル", pt: "Modelos", ru: "Модели", "zh-CN": "模型", "zh-TW": "模型",
     },
   };
   for (const lang of fs.readdirSync("src/locales")) {
     const file = path.join("src/locales", lang, "translation.json");
     if (!fs.existsSync(file)) continue;
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     for (const [key, values] of Object.entries(ADD)) {
       if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
       const parts = key.split(".");
       let node = json;
       for (const part of parts.slice(0, -1)) node = node[part] ??= {};
       node[parts.at(-1)] = values[lang];
     }
     fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
   }
   EOF
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/modelCardKeyboard.test.js test/components/directionalContentPolicy.test.js test/components/orukeetOrganization.test.js test/locales/translationCoverage.test.js`
Expected: PASS. If an existing test clicks the card root via `__reactProps$…onClick`, point it at the `role="radio"` child instead. Selecting by clicking the card is still the behaviour; only the element that owns the handler moved.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ModelCardList.tsx src/components/ui/SearchableModelList.tsx src/locales test/components/modelCardKeyboard.test.js
git commit -m "fix(a11y): keyboard-selectable model cards with a named delete"
```

---

### Task 13: Manual update check works with automatic updates off

Covers SET-Q16, plus the `ml-2` RTL leak in the same file (part of SET-Q6).

**Files:**
- Modify: `src/helpers/updateManager.js`. Change `preferences()` (lines 92–111) and `check()` (lines 124–171).
- Modify: `src/types/updates.ts:2`. Add `"available"` to `phase`.
- Modify: `src/components/settings/UpdateSettings.tsx` (lines 69–97)
- Modify: `docs/PRIVACY.md:63`
- Modify: `src/locales/*/translation.json`. Add `updates.available`, inserted after `updates.ready`.
- Test: `test/helpers/updateManager.test.js:63-76`, plus new cases. Also `test/components/updateSettings.test.js`.

**Interfaces:**
- Produces `UpdateStatus.phase === "available"`, carrying `availableVersion`. It means a manual check found a newer version while automatic updates are off. Nothing was downloaded.
- `UpdateManager.check(manual = true)` keeps its signature. A manual check now runs even when `prefs.enabled` is false. It never downloads in that case.

Facts from the code:
- Removing `!status?.enabled` from the button alone does nothing. `UpdateManager.check()` returns early when `!this.prefs.enabled` (`src/helpers/updateManager.js:128`).
- A successful check auto-downloads (lines 147–156).
- The existing test at lines 63–76 pins "disabled never checks" through `check()`, whose default is `manual = true`. It is rewritten below to pin the timer path instead.

- [ ] **Step 1: Write the failing tests**

In `test/helpers/updateManager.test.js`, replace the test at lines 63–76 with the version below, and append the three tests after it:

```js
test("unsupported, unpackaged and not-onboarded installs never check; disabled skips timer checks", async (t) => {
  for (const options of [{ supported: false }, { packaged: false }]) {
    const s = setup(t, options);
    await s.manager.check();
    assert.equal(s.counts().checks, 0);
  }
  const s = setup(t);
  s.manager.prefs.onboarded = false;
  await s.manager.check();
  s.manager.prefs.onboarded = true;
  s.manager.preferences({ enabled: false });
  await s.manager.check(false);
  assert.equal(s.counts().checks, 0);
});

test("a manual check with automatic updates off reports the update and never downloads", async (t) => {
  const s = setup(t);
  s.manager.preferences({ enabled: false });
  await s.manager.check(true);
  assert.equal(s.counts().checks, 1);
  assert.equal(s.counts().downloads, 0);
  assert.equal(s.manager.status().phase, "available");
  assert.equal(s.manager.status().availableVersion, "0.1.0-beta.2");
});

test("turning automatic updates on after a manual find downloads it", async (t) => {
  const s = setup(t);
  s.manager.preferences({ enabled: false });
  await s.manager.check(true);
  s.manager.preferences({ enabled: true });
  for (let i = 0; i < 10 && s.manager.status().phase !== "ready"; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(s.counts().downloads, 1);
  assert.equal(s.manager.status().phase, "ready");
});

test("a failed manual check with automatic updates off still reports the error", async (t) => {
  const s = setup(t);
  s.updater.checkForUpdates = async () => {
    throw new Error("offline");
  };
  s.manager.preferences({ enabled: false });
  await s.manager.check(true);
  assert.equal(s.manager.status().phase, "error");
});
```

Create `test/components/updateSettings.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");

test("Check for Updates is not disabled by turning automatic updates off", () => {
  const ui = read("src/components/settings/UpdateSettings.tsx");
  assert.doesNotMatch(ui, /!status\?\.enabled/);
  assert.match(ui, /disabled=\{!status \|\| \["checking", "downloading"\]\.includes\(status\.phase\)\}/);
});

test("an available update offers the GitHub download and names the version", () => {
  const ui = read("src/components/settings/UpdateSettings.tsx");
  assert.match(ui, /status\?\.phase === "available" && \(\s*<p>\{t\("updates\.available", \{ version: status\.availableVersion \}\)\}<\/p>/);
  assert.match(ui, /status\?\.phase === "manual" \|\| status\?\.phase === "available" \?/);
  assert.match(read("src/types/updates.ts"), /"available"/);
});

test("no physical margin remains in the update controls", () => {
  assert.doesNotMatch(read("src/components/settings/UpdateSettings.tsx"), /\bml-2\b/);
});

test("the privacy doc explains the manual check with automatic updates off", () => {
  assert.match(read("docs/PRIVACY.md"), /With automatic updates off, \*\*Check for Updates\*\* still works/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/updateManager.test.js test/components/updateSettings.test.js`
Expected: FAIL. The manual check makes 0 checks, and the UI still has `!status?.enabled`.

- [ ] **Step 3: Implement**

1. `src/helpers/updateManager.js`, `preferences(patch)`. Record whether this call turns automatic updates on, then re-check if a manual find is waiting. Change the start and the end of the method:

   ```js
     preferences(patch) {
       if (this.restarting) throw Error("An update restart is already being prepared.");
       const enabling = patch?.enabled === true && !this.prefs.enabled;
       if (typeof patch?.enabled === "boolean") this.prefs.enabled = patch.enabled;
   ```

   ```js
       this.configureChannel();
       this.save();
       // A manual check found an update while automatic updates were off; now
       // that they are on, fetch it the same way a scheduled check would.
       if (enabling && this.state.phase === "available") {
         this.publish({ phase: "idle", availableVersion: undefined });
         void this.check(true);
       }
       return this.status();
     }
   ```

2. `check(manual = true)`:
   - In the guard, replace `!this.prefs.enabled ||` with `(!this.prefs.enabled && !manual) ||`, and put this comment above the `if`:

     ```js
         // A manual check is an explicit request, so it runs even with automatic
         // updates off. It then reports what is available and never downloads.
     ```

   - Replace the post-check block from `if (!this.prefs.enabled || channel !== this.prefs.channel) return this.status();` through `} else this.publish({ phase: "idle" });` with:

     ```js
         if (channel !== this.prefs.channel) return this.status();
         const semver = require("semver");
         const next = result?.updateInfo?.version;
         if (
           next &&
           semver.gt(next, this.version) &&
           (channel === "beta" || !semver.prerelease(next))
         ) {
           if (!this.prefs.enabled) {
             this.publish({ phase: "available", availableVersion: next });
           } else {
             this.downloadChannel = channel;
             this.publish({ phase: "downloading", availableVersion: next });
             const { CancellationToken } = require("builder-util-runtime");
             this.cancel = new CancellationToken();
             await this.updater.downloadUpdate(this.cancel);
           }
         } else this.publish({ phase: "idle" });
     ```

   - In `catch`, change `if (this.prefs.enabled && channel === this.prefs.channel)` to `if ((this.prefs.enabled || manual) && channel === this.prefs.channel)`.

3. `src/types/updates.ts:2`: `phase: "idle" | "manual" | "available" | "checking" | "downloading" | "ready" | "error";`.
4. `src/components/settings/UpdateSettings.tsx`. In the `{!setup && (…)}` block:
   - after the `phase === "ready"` paragraph (line 73), add:

     ```tsx
               {status?.phase === "available" && (
                 <p>{t("updates.available", { version: status.availableVersion })}</p>
               )}
     ```

   - change `{status?.phase === "manual" ? (` to `{status?.phase === "manual" || status?.phase === "available" ? (`;
   - change the Check button's `disabled={…}` to `disabled={!status || ["checking", "downloading"].includes(status.phase)}`;
   - change `<Button className="ml-2" onClick={() => void run(() => api.restart())}>` to `className="ms-2"`.
5. `docs/PRIVACY.md:63`: append this sentence to the paragraph: "With automatic updates off, **Check for Updates** still works: it contacts GitHub only when you click it, never downloads, and links to the release instead."
6. Add the locale key directly after `updates.ready`. `updates` is the last top-level object, and Plan 01 appends `locality` after it, so appending at the object's end would conflict:

   ```bash
   node - <<'EOF'
   const fs = require("node:fs");
   const path = require("node:path");
   const VALUES = {
     en: "Loqui {{version}} is available. Turn on automatic updates to install it, or download it from GitHub.",
     ar: "Loqui {{version}} متاح. فعّل التحديثات التلقائية لتثبيته، أو نزّله من GitHub.",
     de: "Loqui {{version}} ist verfügbar. Aktiviere automatische Updates, um es zu installieren, oder lade es von GitHub herunter.",
     es: "Loqui {{version}} está disponible. Activa las actualizaciones automáticas para instalarlo o descárgalo desde GitHub.",
     fr: "Loqui {{version}} est disponible. Activez les mises à jour automatiques pour l'installer, ou téléchargez-le depuis GitHub.",
     it: "Loqui {{version}} è disponibile. Attiva gli aggiornamenti automatici per installarlo oppure scaricalo da GitHub.",
     ja: "Loqui {{version}} が利用可能です。自動アップデートをオンにしてインストールするか、GitHub からダウンロードしてください。",
     pt: "O Loqui {{version}} está disponível. Ative as atualizações automáticas para instalá-lo ou baixe-o do GitHub.",
     ru: "Доступна версия Loqui {{version}}. Включите автоматические обновления, чтобы установить её, или скачайте с GitHub.",
     "zh-CN": "Loqui {{version}} 已可用。开启自动更新即可安装，或从 GitHub 下载。",
     "zh-TW": "Loqui {{version}} 已可使用。開啟自動更新即可安裝，或從 GitHub 下載。",
   };
   for (const lang of fs.readdirSync("src/locales")) {
     const file = path.join("src/locales", lang, "translation.json");
     if (!fs.existsSync(file)) continue;
     if (!(lang in VALUES)) throw new Error(`updates.available has no ${lang} value`);
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     const ordered = {};
     for (const [key, value] of Object.entries(json.updates)) {
       if (key === "available") continue;
       ordered[key] = value;
       if (key === "ready") ordered.available = VALUES[lang];
     }
     json.updates = ordered;
     fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
   }
   EOF
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/updateManager.test.js test/components/updateSettings.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/updateManager.js src/types/updates.ts src/components/settings/UpdateSettings.tsx docs/PRIVACY.md src/locales test/helpers/updateManager.test.js test/components/updateSettings.test.js
git commit -m "fix(updates): manual check works with automatic updates off"
```

---

### Task 14: Honest settings copy

Covers:
- SET-Q6 (the rest): the setup card strings and CodexConnection's `ml-2`;
- SET-Q7 (Bedrock fields);
- SET-Q11 (neutral URL placeholders);
- SET-Q12 (no phantom endpoint).

**Files:**
- Modify: `src/components/SettingsPage.tsx:625-635` (the "Review dictation setup" card)
- Modify: `src/components/CodexConnection.tsx:138`
- Modify: `src/components/ui/ApiKeyInput.tsx`. Add a `masked` prop (props at lines 7–16; the `<Input>` at lines 100–114).
- Modify: `src/components/EnterpriseProviderConfig.tsx:126-130`
- Modify: `src/components/SelfHostedPanel.tsx:21-22`
- Modify: `src/components/settings/InferenceConfigEditor.tsx:175`. The audit missed this second LAN IP.
- Modify: `src/components/OpenAICompatiblePanel.tsx:272` and `:352-358`
- Modify: `src/locales/*/translation.json`:
  - add `settingsPage.reviewSetup.{title,description,action}`;
  - change three `reasoning.enterprise.*` values in `en` only.
- Test: `test/components/settingsCopy.test.js`

**Interfaces:**
- Produces `ApiKeyInput` prop `masked?: boolean` (default `true`). When `false`, the edit field is `type="text"`. The saved state still never echoes the value.
- Consumes `rendererOptions` (Task 1).

Notes:
- The Bedrock access key ID is an identifier, not a secret: AWS shows it in consoles and logs. It still saves through the secure store, unchanged (`saveBedrockAccessKeyId`).
- `AKIA…` is a format example, not language, so it is not translated.
- Other locales keep their existing Bedrock labels, which already translate the same meaning. Only `en` gains the "AWS" prefix and sentence case.

- [ ] **Step 1: Write the failing test**

Create `test/components/settingsCopy.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

test("the setup card is translated", () => {
  const page = read("src/components/SettingsPage.tsx");
  assert.doesNotMatch(page, />Review dictation setup</);
  assert.doesNotMatch(page, /Open setup\s*</);
  assert.match(page, /t\("settingsPage\.reviewSetup\.title"\)/);
  assert.match(page, /t\("settingsPage\.reviewSetup\.description"\)/);
  assert.match(page, /t\("settingsPage\.reviewSetup\.action"\)/);
});

test("CodexConnection uses logical margins", () => {
  assert.doesNotMatch(read("src/components/CodexConnection.tsx"), /\b(ml|mr|pl|pr)-\d/);
});

test("no component ships a private LAN address as a placeholder", () => {
  const lan = /\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/;
  const offenders = walk(path.join(repoRoot, "src/components")).filter((file) =>
    lan.test(fs.readFileSync(file, "utf8"))
  );
  assert.deepEqual(offenders.map((f) => path.relative(repoRoot, f)), []);
  assert.match(read("src/components/SelfHostedPanel.tsx"), /"http:\/\/localhost:8178"/);
  assert.match(read("src/components/SelfHostedPanel.tsx"), /"http:\/\/localhost:11434\/v1"/);
});

test("Bedrock asks for the access key ID in the clear and labels AWS fields honestly", () => {
  const config = read("src/components/EnterpriseProviderConfig.tsx");
  assert.match(
    config,
    /label=\{t\("reasoning\.enterprise\.accessKeyId"\)\}[\s\S]*?masked=\{false\}[\s\S]*?placeholder="AKIA…"/
  );
  assert.match(read("src/components/ui/ApiKeyInput.tsx"), /type=\{masked \? "password" : "text"\}/);
  const en = JSON.parse(read("src/locales/en/translation.json")).reasoning.enterprise;
  assert.equal(en.accessKeyId, "AWS access key ID");
  assert.equal(en.secretAccessKey, "Secret access key");
  assert.equal(en.sessionToken, "Session token (optional)");
});

async function renderPanel(t, baseUrl) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-openai-compatible-copy-"));
  const { default: Panel } = await vite.ssrLoadModule("/components/OpenAICompatiblePanel.tsx");
  return renderToStaticMarkup(
    createElement(Panel, {
      baseUrl,
      setBaseUrl() {},
      apiKey: "",
      setApiKey() {},
      model: "",
      setModel() {},
    })
  );
}

test("no endpoint is announced while the URL is empty", async (t) => {
  const html = await renderPanel(t, "");
  assert.doesNotMatch(html, /reasoning\.custom\.queryPrefix/);
  assert.doesNotMatch(html, /api\.openai\.com\/v1\/models/);
  assert.match(html, /reasoning\.custom\.enterEndpoint/);
});

test("a saved endpoint is named exactly", async (t) => {
  const html = await renderPanel(t, "http://localhost:11434/v1");
  assert.match(html, /reasoning\.custom\.queryPrefix/);
  assert.match(html, /http:\/\/localhost:11434\/v1\/models/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/settingsCopy.test.js`
Expected: FAIL. The setup card is still English, the LAN IPs are found, and the empty panel prints `api.openai.com/v1/models`.

- [ ] **Step 3: Implement**

1. `src/components/SettingsPage.tsx:627-634` becomes:

   ```tsx
             <p className="text-sm font-medium">{t("settingsPage.reviewSetup.title")}</p>
             <p className="text-xs text-muted-foreground">
               {t("settingsPage.reviewSetup.description")}
             </p>
           </div>
           <Button variant="outline" size="sm" onClick={startOnboarding}>
             {t("settingsPage.reviewSetup.action")}
           </Button>
   ```

   Plan 03 (SET-Q24) demotes this card. This task only translates it.

2. `src/components/CodexConnection.tsx:138`: `className="ml-2"` becomes `className="ms-2"`.
3. `src/components/ui/ApiKeyInput.tsx`:
   - add `masked?: boolean;` to `ApiKeyInputProps`, and `masked = true,` to the destructuring;
   - in the edit `<Input>`, change `type="password"` to `type={masked ? "password" : "text"}`.
4. `src/components/EnterpriseProviderConfig.tsx:126-130`, the access key ID input, becomes:

   ```tsx
             <ApiKeyInput
               label={t("reasoning.enterprise.accessKeyId")}
               masked={false}
               placeholder="AKIA…"
               apiKey={settings.bedrockAccessKeyId}
               setApiKey={(value) => void saveSecret("bedrockAccessKeyId", value)}
             />
   ```

5. `src/components/SelfHostedPanel.tsx:21-22`:

   ```tsx
     const placeholderUrl =
       service === "transcription" ? "http://localhost:8178" : "http://localhost:11434/v1";
   ```

6. `src/components/settings/InferenceConfigEditor.tsx:175`: `baseUrlPlaceholder="http://192.168.1.126:11434/v1"` becomes `baseUrlPlaceholder="http://localhost:11434/v1"`.
7. `src/components/OpenAICompatiblePanel.tsx`:
   - line 272 becomes:

     ```tsx
       // Only name an endpoint the panel will actually query; the placeholder is
       // an example, not a destination.
       const queryUrl = hasBase ? buildApiUrl(normalizedBase, "/models") : null;
     ```

   - wrap the "We'll query" paragraph (lines 352–358) in `{queryUrl && ( … )}`:

     ```tsx
           {queryUrl && (
             <p className="text-xs text-muted-foreground">
               {t("reasoning.custom.queryPrefix")}{" "}
               <code dir="ltr" className="break-all">
                 {queryUrl}
               </code>{" "}
               {t("reasoning.custom.querySuffix")}
             </p>
           )}
     ```

8. Locale changes:

   ```bash
   node - <<'EOF'
   const fs = require("node:fs");
   const path = require("node:path");
   const ADD = {
     "settingsPage.reviewSetup.title": {
       en: "Review dictation setup", ar: "مراجعة إعداد الإملاء", de: "Diktier-Einrichtung prüfen",
       es: "Revisar la configuración del dictado", fr: "Revoir la configuration de la dictée",
       it: "Rivedi la configurazione della dettatura", ja: "音声入力の設定を見直す",
       pt: "Revisar configuração de ditado", ru: "Проверить настройку диктовки",
       "zh-CN": "检查听写设置", "zh-TW": "檢查聽寫設定",
     },
     "settingsPage.reviewSetup.description": {
       en: "Return to the focused setup flow without changing your existing notes or credentials.",
       ar: "ارجع إلى خطوات الإعداد دون تغيير ملاحظاتك أو بيانات الاعتماد الحالية.",
       de: "Kehre zur geführten Einrichtung zurück, ohne vorhandene Notizen oder Zugangsdaten zu ändern.",
       es: "Vuelve al asistente de configuración sin cambiar tus notas ni credenciales.",
       fr: "Revenez à l'assistant de configuration sans modifier vos notes ni vos identifiants.",
       it: "Torna alla configurazione guidata senza modificare note o credenziali esistenti.",
       ja: "既存のメモや認証情報を変更せずに、セットアップの流れに戻ります。",
       pt: "Volte ao fluxo de configuração sem alterar suas notas ou credenciais.",
       ru: "Вернитесь к пошаговой настройке, не меняя заметки и учётные данные.",
       "zh-CN": "返回设置流程，不会更改现有笔记或凭据。",
       "zh-TW": "返回設定流程，不會變更現有筆記或憑證。",
     },
     "settingsPage.reviewSetup.action": {
       en: "Open setup", ar: "فتح الإعداد", de: "Einrichtung öffnen", es: "Abrir configuración",
       fr: "Ouvrir la configuration", it: "Apri configurazione", ja: "セットアップを開く",
       pt: "Abrir configuração", ru: "Открыть настройку", "zh-CN": "打开设置向导", "zh-TW": "開啟設定精靈",
     },
   };
   const EN_ONLY = {
     "reasoning.enterprise.accessKeyId": "AWS access key ID",
     "reasoning.enterprise.secretAccessKey": "Secret access key",
     "reasoning.enterprise.sessionToken": "Session token (optional)",
   };
   const set = (json, key, value) => {
     const parts = key.split(".");
     let node = json;
     for (const part of parts.slice(0, -1)) node = node[part] ??= {};
     node[parts.at(-1)] = value;
   };
   for (const lang of fs.readdirSync("src/locales")) {
     const file = path.join("src/locales", lang, "translation.json");
     if (!fs.existsSync(file)) continue;
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     for (const [key, values] of Object.entries(ADD)) {
       if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
       set(json, key, values[lang]);
     }
     if (lang === "en") for (const [key, value] of Object.entries(EN_ONLY)) set(json, key, value);
     fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
   }
   EOF
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/settingsCopy.test.js test/components/fieldDirectionPolicy.test.js test/components/codexConnectionSignIn.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsPage.tsx src/components/CodexConnection.tsx src/components/ui/ApiKeyInput.tsx src/components/EnterpriseProviderConfig.tsx src/components/SelfHostedPanel.tsx src/components/settings/InferenceConfigEditor.tsx src/components/OpenAICompatiblePanel.tsx src/locales test/components/settingsCopy.test.js
git commit -m "fix(settings): translated setup card, honest Bedrock fields, neutral URLs, no phantom endpoint"
```

---

### Task 15: Clear All Audio confirms with counts and reports failures

Covers SET-Q5.

**Files:**
- Create: `src/utils/audioDeletion.ts`
- Modify: `src/components/SettingsPage.tsx`:
  - imports (near line 102);
  - state (near line 1116);
  - the `handleClearAllAudio` handler (lines 1146–1155);
  - the Clear All Audio row (lines 2793–2815).
- Modify: `src/locales/*/translation.json`:
  - add `settingsPage.privacy.clearAllAudioTitle`, `clearAllAudioCounted`, `clearAllAudioAction`, `clearAllAudioDone` and `clearAllAudioFailed`;
  - delete the unused `clearAllAudioConfirm`.
- Test: `test/components/clearAllAudio.test.js`

**Interfaces:**
- Produces `resolveClearAudioOutcome(after: { fileCount: number } | null): "cleared" | "partial"`.
- Consumes:
  - `showConfirmDialog` from `useDialogs` (destructured in `SettingsPage.tsx:970-976`);
  - `formatBytes` (`SettingsPage.tsx:102`);
  - `window.electronAPI.deleteAllAudio()`, which returns `{ deleted }`;
  - `getAudioStorageUsage()`, which returns `{ fileCount, totalBytes }`.

Facts from the code:
- `deleteAllAudio` never rejects. Per-file unlink errors are only logged in main (`src/helpers/audioStorage.js:167-187`), so the old `catch {}` was dead code.
- The only trustworthy signal is to re-read the storage usage afterwards. A failed re-read counts as `partial`, which fails toward honesty.
- `ConfirmDialog` closes without awaiting `onConfirm` (`src/components/ui/dialog.tsx:108-190`), so the async work handles its own errors.

- [ ] **Step 1: Write the failing test**

Create `test/components/clearAllAudio.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = fs.readFileSync(
  path.join(__dirname, "../../src/components/SettingsPage.tsx"),
  "utf8"
);
const load = () => import("../../src/utils/audioDeletion.ts");

test("only an empty store read back after deleting counts as cleared", async () => {
  const { resolveClearAudioOutcome } = await load();
  assert.equal(resolveClearAudioOutcome({ fileCount: 0 }), "cleared");
  assert.equal(resolveClearAudioOutcome({ fileCount: 3 }), "partial");
  assert.equal(resolveClearAudioOutcome(null), "partial", "an unreadable store is not 'cleared'");
});

test("clearing audio asks first, with a fresh count and size", () => {
  const handler = page.match(/const handleClearAllAudio = async \(\) => \{[\s\S]*?\n {2}\};/)[0];
  assert.match(handler, /getAudioStorageUsage/);
  assert.match(handler, /showConfirmDialog\(\{/);
  assert.match(handler, /variant: "destructive"/);
  assert.match(handler, /t\("settingsPage\.privacy\.clearAllAudioCounted"/);
  assert.match(handler, /t\("settingsPage\.privacy\.audioStorageFiles"/);
});

test("a partial delete is reported in an alert, never swallowed", () => {
  assert.doesNotMatch(page, /\/\/ silent fail/);
  assert.match(
    page,
    /\{clearAudioError && \(\s*<p role="alert" className="mt-2 text-xs text-destructive">\s*\{t\("settingsPage\.privacy\.clearAllAudioFailed"\)\}/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/clearAllAudio.test.js`
Expected: FAIL with `Cannot find module '…/audioDeletion.ts'`.

- [ ] **Step 3: Implement**

Create `src/utils/audioDeletion.ts`:

```ts
export type ClearAudioOutcome = "cleared" | "partial";

/** deleteAllAudio never rejects: main only logs per-file failures. The storage
 * count read back afterwards is the one trustworthy signal, and an unreadable
 * store is reported as partial rather than claimed empty. */
export function resolveClearAudioOutcome(after: { fileCount: number } | null): ClearAudioOutcome {
  return after !== null && after.fileCount === 0 ? "cleared" : "partial";
}
```

In `src/components/SettingsPage.tsx`:
1. Add `import { resolveClearAudioOutcome } from "../utils/audioDeletion";` next to the `formatBytes` import.
2. After the `audioStorageUsage` state (line 1119), add `const [clearAudioError, setClearAudioError] = useState(false);`.
3. Replace `handleClearAllAudio` (lines 1146–1155) with:

   ```tsx
     const clearAllAudio = async () => {
       setClearAudioError(false);
       let after: { fileCount: number; totalBytes: number } | null = null;
       try {
         await window.electronAPI.deleteAllAudio();
         after = (await window.electronAPI.getAudioStorageUsage?.()) ?? null;
       } catch {
         after = null;
       }
       if (after) setAudioStorageUsage(after);
       if (resolveClearAudioOutcome(after) === "cleared") {
         toast({ title: t("settingsPage.privacy.clearAllAudioDone"), variant: "default" });
       } else {
         setClearAudioError(true);
       }
     };

     const handleClearAllAudio = async () => {
       if (!window.electronAPI?.deleteAllAudio) return;
       // Count what is on disk now, not when the section opened.
       const usage = await window.electronAPI
         .getAudioStorageUsage?.()
         .catch(() => null);
       const current = usage ?? audioStorageUsage;
       if (usage) setAudioStorageUsage(usage);
       showConfirmDialog({
         title: t("settingsPage.privacy.clearAllAudioTitle"),
         description: t("settingsPage.privacy.clearAllAudioCounted", {
           summary: t("settingsPage.privacy.audioStorageFiles", {
             count: current.fileCount,
             size: formatBytes(current.totalBytes),
           }),
         }),
         confirmText: t("settingsPage.privacy.clearAllAudioAction"),
         cancelText: t("common.cancel"),
         variant: "destructive",
         onConfirm: () => void clearAllAudio(),
       });
     };
   ```

4. In the Clear All Audio row:
   - change `onClick={handleClearAllAudio}` to `onClick={() => void handleClearAllAudio()}`;
   - after its closing `</SettingsRow>` (line 2814), still inside `<SettingsPanelRow>`, add:

   ```tsx
                     {clearAudioError && (
                       <p role="alert" className="mt-2 text-xs text-destructive">
                         {t("settingsPage.privacy.clearAllAudioFailed")}
                       </p>
                     )}
   ```

5. Locale changes:

   ```bash
   node - <<'EOF'
   const fs = require("node:fs");
   const path = require("node:path");
   const P = "settingsPage.privacy.";
   const ADD = {
     [P + "clearAllAudioTitle"]: {
       en: "Clear all audio?", ar: "مسح كل الصوت؟", de: "Alle Audiodateien löschen?",
       es: "¿Borrar todo el audio?", fr: "Effacer tout l'audio ?", it: "Cancellare tutto l'audio?",
       ja: "すべての音声を削除しますか？", pt: "Apagar todo o áudio?", ru: "Удалить все аудио?",
       "zh-CN": "清除所有音频？", "zh-TW": "清除所有音訊？",
     },
     [P + "clearAllAudioCounted"]: {
       en: "Stored audio: {{summary}}. Delete all of it? This cannot be undone.",
       ar: "الصوت المخزّن: {{summary}}. هل تريد حذفه كله؟ لا يمكن التراجع عن ذلك.",
       de: "Gespeichertes Audio: {{summary}}. Alles löschen? Das kann nicht rückgängig gemacht werden.",
       es: "Audio almacenado: {{summary}}. ¿Eliminarlo todo? No se puede deshacer.",
       fr: "Audio stocké : {{summary}}. Tout supprimer ? Cette action est irréversible.",
       it: "Audio salvato: {{summary}}. Eliminare tutto? L'operazione non può essere annullata.",
       ja: "保存済みの音声: {{summary}}。すべて削除しますか？元に戻せません。",
       pt: "Áudio armazenado: {{summary}}. Excluir tudo? Isso não pode ser desfeito.",
       ru: "Сохранённое аудио: {{summary}}. Удалить всё? Это действие нельзя отменить.",
       "zh-CN": "已存储的音频：{{summary}}。全部删除？此操作无法撤销。",
       "zh-TW": "已儲存的音訊：{{summary}}。全部刪除？此動作無法復原。",
     },
     [P + "clearAllAudioAction"]: {
       en: "Delete audio", ar: "حذف الصوت", de: "Audio löschen", es: "Eliminar audio",
       fr: "Supprimer l'audio", it: "Elimina audio", ja: "音声を削除", pt: "Excluir áudio",
       ru: "Удалить аудио", "zh-CN": "删除音频", "zh-TW": "刪除音訊",
     },
     [P + "clearAllAudioDone"]: {
       en: "Stored audio deleted", ar: "تم حذف الصوت المخزّن", de: "Gespeichertes Audio gelöscht",
       es: "Audio almacenado eliminado", fr: "Audio stocké supprimé", it: "Audio salvato eliminato",
       ja: "保存済みの音声を削除しました", pt: "Áudio armazenado excluído", ru: "Сохранённое аудио удалено",
       "zh-CN": "已删除存储的音频", "zh-TW": "已刪除儲存的音訊",
     },
     [P + "clearAllAudioFailed"]: {
       en: "Some audio files could not be deleted. The count above shows what remains. Try again, or check that no other app is using them.",
       ar: "تعذّر حذف بعض الملفات الصوتية. يوضّح العدد أعلاه ما تبقّى. حاول مرة أخرى، أو تأكد من أن أي تطبيق آخر لا يستخدمها.",
       de: "Einige Audiodateien konnten nicht gelöscht werden. Die Anzahl oben zeigt, was übrig ist. Versuche es erneut oder prüfe, ob eine andere App sie verwendet.",
       es: "No se pudieron eliminar algunos archivos de audio. El recuento de arriba muestra lo que queda. Inténtalo de nuevo o comprueba que ninguna otra app los esté usando.",
       fr: "Certains fichiers audio n'ont pas pu être supprimés. Le total ci-dessus indique ce qui reste. Réessayez ou vérifiez qu'aucune autre app ne les utilise.",
       it: "Alcuni file audio non sono stati eliminati. Il conteggio qui sopra indica cosa rimane. Riprova o verifica che nessun'altra app li stia usando.",
       ja: "一部の音声ファイルを削除できませんでした。残りは上の件数で確認できます。もう一度試すか、他のアプリが使用していないか確認してください。",
       pt: "Alguns arquivos de áudio não puderam ser excluídos. A contagem acima mostra o que resta. Tente novamente ou verifique se outro app está usando-os.",
       ru: "Не удалось удалить некоторые аудиофайлы. Счётчик выше показывает, что осталось. Повторите попытку или проверьте, не использует ли их другое приложение.",
       "zh-CN": "部分音频文件无法删除。上方的数量显示剩余文件。请重试，或检查是否有其他应用正在使用它们。",
       "zh-TW": "部分音訊檔案無法刪除。上方的數量顯示剩餘檔案。請再試一次，或確認沒有其他應用程式正在使用它們。",
     },
   };
   for (const lang of fs.readdirSync("src/locales")) {
     const file = path.join("src/locales", lang, "translation.json");
     if (!fs.existsSync(file)) continue;
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     for (const [key, values] of Object.entries(ADD)) {
       if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
       const parts = key.split(".");
       let node = json;
       for (const part of parts.slice(0, -1)) node = node[part] ??= {};
       node[parts.at(-1)] = values[lang];
     }
     delete json.settingsPage.privacy.clearAllAudioConfirm;
     fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
   }
   EOF
   ```

   Before deleting `clearAllAudioConfirm`, confirm nothing reads it: `grep -rn "clearAllAudioConfirm" src --include='*.ts*' --include='*.js*'` must print nothing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/clearAllAudio.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/audioDeletion.ts src/components/SettingsPage.tsx src/locales test/components/clearAllAudio.test.js
git commit -m "fix(privacy): confirm Clear All Audio with counts and report partial deletes"
```

---

### Task 16: Privacy description and dead locale keys

Covers SET-Q13.

**Files:**
- Modify: `src/locales/*/translation.json`:
  - change `settingsModal.sections.privacyData.description` in all 11 locales;
  - delete the dead paths listed below in all 11.
- Modify: `test/locales/translationCoverage.test.js`. Prune six fixture entries that point at deleted keys.
- Test: `test/locales/deadLocaleKeys.test.js`

**Interfaces:** none. These keys are content-only.

Dead keys to delete. Each was verified to have no `t()` reference in `src/` and no dynamic builder that could reach it. `InferenceConfigEditor` builds only `${prefix}.providers|local|selfHosted`, and `ControlPanelSidebar` uses `sidebar.sections.workspace`, a different path that stays.
- `settingsModal.sections.account`, `settingsModal.sections.plansBilling`, `settingsModal.sections.workspace`, `settingsModal.groups.account`
- `settingsPage.account`, `settingsPage.workspace`
- `settingsPage.aiModels.modes.openwhispr`, `settingsPage.aiModels.modes.openwhisprDesc`, `settingsPage.aiModels.openwhisprCloud`, `settingsPage.aiModels.openwhisprCloudDescription`
- `settingsPage.transcription.modes.openwhispr`, `settingsPage.transcription.modes.openwhisprDesc`, `settingsPage.transcription.openwhisprCloud`, `settingsPage.transcription.openwhisprCloudDescription`
- `dictationAgent.modes.openwhispr`, `dictationAgent.modes.openwhisprDesc`
- `agentMode.settings.modes.openwhispr`, `agentMode.settings.modes.openwhisprDesc`
- `promptStudio.test.openwhisprCloud`, `notes.upload.openwhisprCloud`
- `settingsPage.privacy.usageAnalytics`, `settingsPage.privacy.usageAnalyticsDescription`. These are unused, and they contradict `PRODUCT.md` ("no … analytics upload").

These are out of scope; they are listed as an open question:
- `settingsPage.unifiedBilling`
- `settingsPage.enterpriseCheckout`
- `workspaces.*`

- [ ] **Step 1: Write the failing test**

Create `test/locales/deadLocaleKeys.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LOCALES = path.join(__dirname, "../../src/locales");
const languages = fs
  .readdirSync(LOCALES)
  .filter((entry) => fs.existsSync(path.join(LOCALES, entry, "translation.json")));
const load = (lang) =>
  JSON.parse(fs.readFileSync(path.join(LOCALES, lang, "translation.json"), "utf8"));
const get = (json, key) => key.split(".").reduce((node, part) => node?.[part], json);

const DEAD = [
  "settingsModal.sections.account",
  "settingsModal.sections.plansBilling",
  "settingsModal.sections.workspace",
  "settingsModal.groups.account",
  "settingsPage.account",
  "settingsPage.workspace",
  "settingsPage.aiModels.modes.openwhispr",
  "settingsPage.aiModels.modes.openwhisprDesc",
  "settingsPage.aiModels.openwhisprCloud",
  "settingsPage.aiModels.openwhisprCloudDescription",
  "settingsPage.transcription.modes.openwhispr",
  "settingsPage.transcription.modes.openwhisprDesc",
  "settingsPage.transcription.openwhisprCloud",
  "settingsPage.transcription.openwhisprCloudDescription",
  "dictationAgent.modes.openwhispr",
  "dictationAgent.modes.openwhisprDesc",
  "agentMode.settings.modes.openwhispr",
  "agentMode.settings.modes.openwhisprDesc",
  "promptStudio.test.openwhisprCloud",
  "notes.upload.openwhisprCloud",
  "settingsPage.privacy.usageAnalytics",
  "settingsPage.privacy.usageAnalyticsDescription",
];

test("dead account, billing, workspace and hosted-cloud keys are gone from every locale", () => {
  for (const lang of languages) {
    const json = load(lang);
    for (const key of DEAD) assert.equal(get(json, key), undefined, `${lang}: ${key}`);
  }
});

test("the privacy section no longer promises analytics in any language", () => {
  const analytics = /analytic|Analyse|análisis|análise|analisi|аналитик|التحليلات|分析/i;
  for (const lang of languages) {
    const description = get(load(lang), "settingsModal.sections.privacyData.description");
    assert.ok(description, `${lang} keeps the description`);
    assert.doesNotMatch(description, analytics, `${lang}: ${description}`);
  }
  assert.equal(
    get(load("en"), "settingsModal.sections.privacyData.description"),
    "Privacy, permissions & stored data"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/locales/deadLocaleKeys.test.js`
Expected: FAIL on `ar: settingsModal.sections.account`, and on the en description "Privacy, permissions & analytics".

- [ ] **Step 3: Implement**

1. Confirm there are still no code references. This must print nothing (`sidebar.sections.workspace` does not match):

   ```bash
   grep -rnE 'plansBilling|openwhisprCloud|usageAnalytics|settingsPage\.(account|workspace)\b|settingsModal\.(sections\.(account|workspace|plansBilling)|groups\.account)|modes\.openwhispr' src --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx'
   ```

2. Rewrite the locales:

   ```bash
   node - <<'EOF'
   const fs = require("node:fs");
   const path = require("node:path");
   const DEAD = [
     "settingsModal.sections.account", "settingsModal.sections.plansBilling",
     "settingsModal.sections.workspace", "settingsModal.groups.account",
     "settingsPage.account", "settingsPage.workspace",
     "settingsPage.aiModels.modes.openwhispr", "settingsPage.aiModels.modes.openwhisprDesc",
     "settingsPage.aiModels.openwhisprCloud", "settingsPage.aiModels.openwhisprCloudDescription",
     "settingsPage.transcription.modes.openwhispr", "settingsPage.transcription.modes.openwhisprDesc",
     "settingsPage.transcription.openwhisprCloud", "settingsPage.transcription.openwhisprCloudDescription",
     "dictationAgent.modes.openwhispr", "dictationAgent.modes.openwhisprDesc",
     "agentMode.settings.modes.openwhispr", "agentMode.settings.modes.openwhisprDesc",
     "promptStudio.test.openwhisprCloud", "notes.upload.openwhisprCloud",
     "settingsPage.privacy.usageAnalytics", "settingsPage.privacy.usageAnalyticsDescription",
   ];
   const PRIVACY = {
     en: "Privacy, permissions & stored data", ar: "الخصوصية والأذونات والبيانات المخزّنة",
     de: "Datenschutz, Berechtigungen & gespeicherte Daten", es: "Privacidad, permisos y datos guardados",
     fr: "Confidentialité, autorisations et données stockées", it: "Privacy, autorizzazioni e dati salvati",
     ja: "プライバシー、権限、保存データ", pt: "Privacidade, permissões e dados armazenados",
     ru: "Конфиденциальность, разрешения и сохранённые данные", "zh-CN": "隐私、权限与存储的数据",
     "zh-TW": "隱私權、權限與儲存的資料",
   };
   for (const lang of fs.readdirSync("src/locales")) {
     const file = path.join("src/locales", lang, "translation.json");
     if (!fs.existsSync(file)) continue;
     if (!(lang in PRIVACY)) throw new Error(`no privacy description for ${lang}`);
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     for (const key of DEAD) {
       const parts = key.split(".");
       const parent = parts.slice(0, -1).reduce((node, part) => node?.[part], json);
       // Plural variants (key_one, key_other, ...) of a leaf go with it.
       for (const name of Object.keys(parent ?? {})) {
         if (name === parts.at(-1) || name.startsWith(parts.at(-1) + "_")) delete parent[name];
       }
     }
     json.settingsModal.sections.privacyData.description = PRIVACY[lang];
     fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
   }
   EOF
   ```

   The `startsWith(leaf + "_")` sweep only touches siblings that start with a deleted leaf's exact name plus `_`. Before committing, check `git diff --stat src/locales` and skim one locale's diff to confirm only the listed families changed.

3. In `test/locales/translationCoverage.test.js`, remove these fixture entries, because the keys they name no longer exist:
   - from `ARABIC_PLURAL_BASES` (lines 19–23): `settingsPage.workspace.members.description`, `settingsPage.workspace.teams.memberCount`, `settingsPage.workspace.teams.grantsAccessToSpaces`, `settingsPage.workspace.teams.deleteConfirmSpaceAccess` and `settingsPage.workspace.invites.expiresIn`;
   - from `ARABIC_NUMBER_NEUTRAL_TEMPLATES` (line 49): `"settingsPage.account.planDescriptions.trial": …`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/locales/` and `npm run i18n:check`
Expected: PASS, and `i18n:check` reports no missing keys or placeholder mismatches.

- [ ] **Step 5: Commit**

```bash
git add src/locales test/locales/translationCoverage.test.js test/locales/deadLocaleKeys.test.js
git commit -m "chore(i18n): honest privacy description; delete dead account, billing and hosted-cloud keys"
```

---

### Task 17: Whole-plan verification

**Files:** none new. This task runs every check and fixes what they surface.

- [ ] **Step 1: Run the full suite and static checks**

```bash
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run format:check
```

Expected: everything passes.
- **Allowed test edits.** Edit a pre-existing test only when its assertion pins exactly the behaviour this plan changes on purpose:
  - 3/4/5 s error timers;
  - "disabled never checks" through a manual `check()`;
  - a card root `onClick`;
  - the `installTree` location;
  - deleted locale fixtures.
- Name every such edit in the PR description.
- Any other failure is a regression; fix the code.

- [ ] **Step 2: Verify in the desktop app (light and Plum Night if Plan 01 has merged, otherwise light and the current dark)**

```bash
npm run native:electron
npm run dev
```

Check each of these, and screenshot the starred ones for the PR:
- ★ **Onboarding, macOS at 900×640.**
  - The footer stays pinned while the middle scrolls.
  - The brand tile clears the traffic lights.
  - In Arabic, the clearance is still on the left.
- ★ **Onboarding → Speech → Download.**
  - The bar shows a real percentage.
  - Cancel returns to "Download the selected model".
  - Download again, Continue, and the footer chip shows the percentage on Cleanup.
- **Dictation errors.**
  - Force a paste failure that offers "View transcript": the card stays until acted on.
  - A plain network error disappears after 6–10 s.
- ★ **Esc during a slow transcription** (a remote provider with throttled network) cancels it. After it finishes, Esc works normally in other apps.
- ★ **Meeting recording with the window hidden.** Stop system audio (switch output device). A native notification appears once, and clicking it focuses Loqui.
- **VoiceOver, macOS.**
  - A success toast is announced politely, and an error toast is announced immediately.
  - In Settings, the sidebar announces "current page".
  - The provider tabs announce "tab, selected, 1 of N".
  - Model cards announce "radio button, checked".
- **Chat.**
  - Send a message, then type and press Enter while it streams. "Sends when the reply finishes" appears, and the draft sends once the reply ends.
  - Press Stop with a queued draft: the draft stays in the box, unsent.
- **Coming up.** With a meeting starting within a minute, "Now" appears within 30 s of the start, without reloading.
- **Notes.** On a fresh profile, notes render immediately. "Actions" opens the first-run dialog once, then the manager, even with no note open.
- ★ **Settings.**
  - Privacy → Clear All Audio shows the count and size and asks first.
  - System → updates: with automatic off, Check for Updates works and shows "available" plus the GitHub link.
  - Custom endpoint: with an empty URL, there is no "We'll query" line.

- [ ] **Step 3: Commit any fixes, then prepare the PR (owner approval first)**

`pr-body.md`:
- lists one line per Task 1–16 commit;
- links the spec and this plan;
- carries the Contract change requests section verbatim;
- embeds the Step 2 screenshots;
- names every intentionally updated pre-existing test assertion (Step 1).

Get the owner's explicit OK before `git push` or `gh pr create`; publishing is outward-facing.

```bash
git push -u origin HEAD
gh pr create --title "fix(ui): Plan 02 bug & a11y sweep" --body-file pr-body.md
```
