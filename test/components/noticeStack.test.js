const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const repoRoot = path.join(__dirname, "../..");
const notices = () => import("../../src/components/ui/notices.ts");

test.before(async () => {
  const i18n = require("i18next");
  const { initReactI18next } = require("react-i18next");
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: require("../../src/locales/en/translation.json") } },
    initImmediate: false,
  });
});

const base = { createdAt: 0, expiresAt: null, remainingMs: null, revision: 1, busy: false };

test("receipts and notices are polite status chips; alerts are role=alert", async () => {
  const { NoticeChip } = await import("../../src/components/ui/NoticeChip.tsx");
  const receipt = renderStatic(NoticeChip, {
    notice: { ...base, id: "a", kind: "receipt", title: "Pasted", body: "into Slack" },
    stagger: 0,
  });
  const alert = renderStatic(NoticeChip, {
    notice: {
      ...base,
      id: "b",
      kind: "alert",
      title: "Couldn't paste into Slack",
      actions: [{ label: "Retry", primary: true, onClick() {} }],
    },
    stagger: 1,
  });
  assert.match(receipt, /role="status"/);
  assert.match(receipt, /data-kind="receipt"/);
  assert.match(alert, /role="alert"/);
  assert.match(alert, />Retry</);
  assert.match(alert, /--notice-stagger:1/);
});

test("every chip has a visible, labelled close button (VO-Q9)", async () => {
  const { NoticeChip } = await import("../../src/components/ui/NoticeChip.tsx");
  const html = renderStatic(NoticeChip, {
    notice: { ...base, id: "c", kind: "notice", title: "Model changed", persistent: true },
    stagger: 0,
  });
  assert.match(html, /<button[^>]*class="notice-chip__close"[^>]*aria-label="[^"]+"/);
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/notices.css"), "utf8");
  assert.doesNotMatch(css, /\.notice-chip__close\s*\{[^}]*opacity:\s*0[;\s]/);
});

test("every action stays reachable: secondary actions sit behind an accessible More (I11)", async () => {
  const { NoticeChip } = await import("../../src/components/ui/NoticeChip.tsx");
  const notice = {
    ...base,
    id: "cleanup-failed",
    kind: "notice",
    title: "Pasted without cleanup",
    actions: [
      { label: "Retry cleanup", primary: true, onClick() {} },
      { label: "Settings", onClick() {} },
    ],
  };
  const collapsed = renderStatic(NoticeChip, { notice, stagger: 0 });
  assert.match(collapsed, />Retry cleanup</);
  assert.match(collapsed, /<button[^>]*class="notice-chip__more"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(collapsed, />Settings</);
  const expanded = renderStatic(NoticeChip, { notice, stagger: 0, defaultExpanded: true });
  assert.match(expanded, /aria-expanded="true"/);
  assert.match(expanded, /role="group"[^>]*>.*>Settings</s);
  const single = renderStatic(NoticeChip, {
    notice: { ...notice, actions: [notice.actions[0]] },
    stagger: 0,
  });
  assert.match(single, /notice-chip__more/, "a title-only chip also reveals its complete message");
});

test("buttons are disabled while the notice's action is running", async () => {
  const { NoticeChip } = await import("../../src/components/ui/NoticeChip.tsx");
  const html = renderStatic(NoticeChip, {
    notice: {
      ...base,
      id: "x",
      kind: "alert",
      title: "Couldn't paste",
      busy: true,
      actions: [{ label: "Retry", primary: true, onClick() {} }],
    },
    stagger: 0,
  });
  assert.match(html, /<button[^>]*class="notice-chip__action"[^>]*disabled=""/);
});

test("the words-first card shows the words as the headline, selectable and draggable", async () => {
  const { WordsFirstCard } = await import("../../src/components/ui/WordsFirstCard.tsx");
  const html = renderStatic(WordsFirstCard, {
    notice: {
      ...base,
      id: "dictation-recovery:rec-1",
      kind: "alert",
      title: "Couldn't paste into Slack",
      words: "Hey Maya, can you move the design review to Thursday at 2?",
      actions: [{ label: "Paste again", primary: true, onClick() {} }],
    },
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /class="words-card__words"[^>]*draggable="true"/);
  assert.match(html, /Hey Maya, can you move the design review/);
  assert.match(html, />Paste again</);
  assert.match(html, /data-copy=""/);
});

test("the stack shows at most three chips; a words card owns the pill slot", async (t) => {
  const m = await notices();
  m.__setNoticeClockForTests();
  t.after(() => m.__setNoticeClockForTests());
  for (const title of ["one", "two", "three", "four"])
    m.notify({ kind: "notice", title, persistent: true });
  const { NoticeStack } = await import("../../src/components/ui/NoticeStack.tsx");
  const chipsOnly = renderStatic(NoticeStack, { placement: "pill", horizontalDirection: "right" });
  assert.equal((chipsOnly.match(/class="notice-chip"/g) || []).length, 3);
  assert.match(chipsOnly, /data-placement="pill"/);

  m.notify({
    id: "dictation-recovery:rec-1",
    kind: "alert",
    title: "Couldn't paste",
    words: "keep me",
  });
  const pill = renderStatic(NoticeStack, { placement: "pill", horizontalDirection: "right" });
  assert.match(pill, /class="words-card"/);
  // In the 168px pill slot the card owns the space; chips wait until it is dismissed.
  assert.equal((pill.match(/class="notice-chip"/g) || []).length, 0);
  const panel = renderStatic(NoticeStack, { placement: "panel" });
  assert.match(panel, /class="words-card"/);
  // §5.3: at most three visible. The card counts as one.
  assert.equal((panel.match(/class="notice-chip"/g) || []).length, 2);
  assert.doesNotMatch(panel, /class="words-card__more"/, "one held transcript needs no 'N more'");
});

test("chip CSS uses the motion tokens and no ease-in", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/notices.css"), "utf8");
  assert.doesNotMatch(css, /ease-in(?:[;,\s]|\))/);
  assert.match(
    fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8"),
    /--motion-stagger:\s*40ms/
  );
  assert.match(css, /animation:\s*notice-in var\(--motion-base\) var\(--motion-ease-enter\)/);
  assert.match(
    css,
    /animation-delay:\s*calc\(var\(--notice-stagger\) \* var\(--motion-stagger\)\)/
  );
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.notice-chip[\s\S]*transform:\s*none/);
  assert.match(
    css,
    /prefers-reduced-motion: reduce[\s\S]*\.words-card \{\s*\/\*[^*]*\*\/\s*animation: notice-fade var\(--motion-fast\) linear both !important;/,
    "the fade survives index.css's global cut"
  );
});

for (const diagnostic of [false, true]) {
  test(`full title is reachable in a ${diagnostic ? "diagnostic" : "title-only primary-action"} chip`, async () => {
    const { NoticeChip } = await import("../../src/components/ui/NoticeChip.tsx");
    const title = "The meeting could not be saved. Open notes to check what was kept.";
    const notice = {
      ...base,
      id: "long-title",
      kind: "alert",
      title,
      ...(diagnostic
        ? { body: "Preserved in memory", details: { underlyingError: "Synthetic diagnostic" } }
        : {}),
      actions: [{ label: "Open notes", primary: true, onClick() {} }],
    };
    const collapsed = renderStatic(NoticeChip, { notice, stagger: 0 });
    assert.match(collapsed, /class="notice-chip__more"[^>]*aria-expanded="false"/);
    const expanded = renderStatic(NoticeChip, { notice, stagger: 0, defaultExpanded: true });
    assert.match(expanded, /class="notice-chip__expanded-title"[^>]*dir="auto"/);
    assert.equal(expanded.includes(title), true);
    assert.match(expanded, /aria-expanded="true"/);
    assert.match(expanded, />Open notes</);
  });
}

test("satellites use half their active phase period", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/dictation-panel.css"), "utf8");
  assert.match(
    css,
    /\.agent-orbit\s*\{[^}]*--agent-orbit-period:\s*var\(--motion-agent-thinking\)/
  );
  assert.match(
    css,
    /data-phase="answering"[^}]*--agent-orbit-period:\s*var\(--motion-agent-answering\)/
  );
  assert.match(css, /animation-delay:\s*calc\(-0\.5 \* var\(--agent-orbit-period\)\)/);
});
