# Brief for Plan 03 v2 task writers

You are rewriting tasks of an implementation plan (planning only — do NOT edit app code; do NOT edit the plan file in the repo). Write ONLY the files you are assigned under /Users/snow/.t3/worktrees/loqui/snowopsdev-plan-uiux-03-routes-settings/docs/superpowers/plans/plan-03-v2-wip/new/.

## Inputs (read them)
- /Users/snow/.t3/worktrees/loqui/snowopsdev-plan-uiux-03-routes-settings/docs/superpowers/plans/plan-03-v2-wip/INTERFACES.md — authoritative module/contract/interface decisions. Code against these names and shapes exactly. If you truly need an interface that is not there, do not invent silently: add it to your notes file (see Output) with exact signature and rationale, and use it consistently.
- /Users/snow/.t3/worktrees/loqui/snowopsdev-plan-uiux-03-routes-settings/docs/superpowers/plans/plan-03-v2-wip/PAYLOADS.md — payload disclosure parts (I15).
- The independent review: /Users/snow/.t3/worktrees/loqui/t3-5038e8e6/.omc/research/ui-review/reviews/plan-03-codex.md. Your tasks must close the findings assigned to you (listed in your prompt) with concrete code and tests.
- Old v1 task text: /Users/snow/.t3/worktrees/loqui/snowopsdev-plan-uiux-03-routes-settings/docs/superpowers/plans/plan-03-v2-wip/old/taskNN.md (reuse whatever is still right; fix what the review flagged). Old header incl. Global Constraints: /Users/snow/.t3/worktrees/loqui/snowopsdev-plan-uiux-03-routes-settings/docs/superpowers/plans/plan-03-v2-wip/old/header.md.
- Format/quality bar: /Users/snow/.t3/worktrees/loqui/snowopsdev-plan-uiux-03-routes-settings/docs/superpowers/plans/2026-10-15-loqui-uiux-01-foundations.md (task structure: Files / Interfaces (Consumes, Produces) / Steps with checkboxes: write failing test (real code) → run & expected failure → implement (real code) → run & expected pass → commit).
- App code: /Users/snow/.t3/worktrees/loqui/snowopsdev-plan-uiux-03-routes-settings (current main + Plan 03 not yet implemented). Plan 01 (shipped, will be merged before execution): /Users/snow/.t3/worktrees/loqui/t3-5038e8e6 at HEAD (src/lib/locality.ts has providerDisplayLabel; tokens in src/index.css; test/components/plumNight.test.js; test/helpers/harness/cssTokens.js; src/utils/contrast.ts).

## Rules
- Verify every file path, line number, function and store-field name you cite against the real code (open the files). Cite as `path:line`.
- No placeholders: no TBD/TODO, no "similar to Task N", no "/* the same expression */". Every code step has the actual code. If you must refer to existing code to move, quote it or give an exact anchor.
- Tests: node:test; `npm test -- <files>`; renderer modules that import the store load via `createRendererServer` from test/lib/rendererTestHarness.js; react-i18next mocks ONLY via `withI18nMock` from test/lib/i18nTestMock.js (created in Task 3; exported `withI18nMock(serverOptions, { withOptions?: boolean; t?: string })`). Mounted behaviour tests use the personalWorkspace pattern (test/components/personalWorkspace.test.js:18-41: installBrowserGlobals + installHookDom + createRoot, call the component as a function inside a probe returning null, invoke handler props under React.act; never commit host elements). Pure modules are imported directly.
- Label each test as **change-driving** (fails before the change, state why) or **baseline guard** (passes already).
- Each task: i18n strings → give the `en` JSON block verbatim; other 10 locales via `node scripts/merge-locale-keys.js /tmp/loqui-i18n-task-N.json` (script created in Task 3). Plurals need CLDR categories. Use logical CSS properties (ms/me/start/end, padding-inline-*), shared `--motion-*` tokens only (no literal durations like `duration-150`/`1.4s`; Tailwind arbitrary `duration-[var(--motion-fast)]` is fine), provider names in UI via `providerDisplayLabel(providerId, t)`.
- `src/tsconfig.json` is not strict: narrow discriminated unions with explicit comparisons (`x.ok === false`).
- Commits: conventional `type(scope): Subject` (capitalised, imperative). Do not include Co-Authored-By lines in task commit snippets.
- Keep each task self-contained and right-sized; if one assigned task becomes huge, split it into "Na"/"Nb"? NO — keep the assigned numbering; instead keep code tight.
- Header of each task: `### Task N: Title` then a short paragraph naming which review findings it closes (e.g. "Closes C1, I1 (pickers)").

## Task numbering (v2, fixed — use these numbers/titles; reference other tasks by these numbers)
1 Route graph core: pure resolver with executor validation (§5.1)
2 Credential authority in main: acknowledged saves, presence, change events, undoable removal
3 Route facts, sealed store, hooks and route copy (§5.1)
4 Settings paths, in-modal navigation and the support-models tab (SET-Q17)
5 Route chips, an honest mode selector and contrast (SET-Q4)
6 Route planner: one patch for preview, commit and Undo
7 Route drafts: instant on-device, staged off-device, Undo (SET-R3 B core, SET-Q10)
8 Stage, review, apply in the editors (SET-R3 B UI, SET-Q10)
9 Pickers and endpoints through the planner; explicit authenticated discovery
10 Routing page and the Patchbay switchboard (SET-R1 B)
11 Keyring health in main: generation-bound Verify and reminders (SET-R5 C)
12 Keyring panel and undoable key removal (SET-R5 C UI)
13 Cartridge model cards (SET-R4 B, SET-Q8, SET-Q9)
14 Storage list with main-owned counts and typed outcomes (SET-R7 A)
15 Re-home sections, nav descriptions, sticky title and close (SET-R2 A part 1, SET-Q3, SET-Q18, SET-Q21)
16 Settings search with live controls (SET-R2 A part 2)
17 Honest copy and labels (SET-Q15, SET-Q19, SET-Q22, SET-Q23, SET-Q24)
18 DESIGN.md, guards and whole-plan verification

## Output
- /Users/snow/.t3/worktrees/loqui/snowopsdev-plan-uiux-03-routes-settings/docs/superpowers/plans/plan-03-v2-wip/new/TNN.md (two-digit, e.g. T01.md) — the complete task in markdown, starting with `### Task N: …` and ending with `---`.
- /Users/snow/.t3/worktrees/loqui/snowopsdev-plan-uiux-03-routes-settings/docs/superpowers/plans/plan-03-v2-wip/new/TNN.notes.md — (1) findings closed with one line each on how; (2) any interface you added beyond INTERFACES.md (exact signature); (3) anything you could not verify; (4) any finding you believe should be disputed, with evidence.
- Reply with a ≤150-word summary (file names written, interface additions, open issues).
