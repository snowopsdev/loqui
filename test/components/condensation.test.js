const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const load = () => import("../../src/components/dictation/condensation.ts");
const css = () =>
  fs.readFileSync(path.join(__dirname, "../../src/styles/dictation-panel.css"), "utf8");

test("committed words are stable; the partial tail is marked uncommitted", async () => {
  const { condenseWords } = await load();
  const words = condenseWords("hey maya can you", "move the");
  assert.deepEqual(
    words.map((w) => [w.text, w.committed]),
    [
      ["hey", true],
      ["maya", true],
      ["can", true],
      ["you", true],
      ["move", false],
      ["the", false],
    ]
  );
  const later = condenseWords("hey maya can you move the", "design");
  // Keys are positions in the whole utterance, so a word keeps its key when it commits.
  assert.equal(later.find((w) => w.text === "move").key, words.find((w) => w.text === "move").key);
});

test("only the last six words stay on the row", async () => {
  const { condenseWords, CONDENSATION_MAX_WORDS } = await load();
  const words = condenseWords("one two three four five six seven", "eight");
  assert.equal(words.length, CONDENSATION_MAX_WORDS);
  assert.equal(words[0].text, "three");
  assert.equal(words.at(-1).text, "eight");
});

test("cleanup diff marks rewritten words and leaves the rest", async () => {
  const { diffWords } = await load();
  const diff = diffWords("move the review to thursday at two", "move the review to Thursday at 2.");
  assert.deepEqual(
    diff.filter((w) => w.changed).map((w) => w.text),
    ["Thursday", "2."]
  );
  assert.deepEqual(
    diffWords("same words", "same words").filter((w) => w.changed),
    []
  );
  assert.deepEqual(diffWords("", "").length, 0);
});

test("the row renders partial and changed words with their classes", async () => {
  const { CondensationWords } =
    await import("../../src/components/dictation/CondensationWords.tsx");
  const html = renderStatic(CondensationWords, {
    words: [
      { key: "0", text: "hey", committed: true, changed: false },
      { key: "1", text: "Thursday", committed: true, changed: true },
      { key: "2", text: "at", committed: false, changed: false },
    ],
  });
  assert.match(html, /class="condense-word is-changed"[^>]*>Thursday</);
  assert.match(html, /class="condense-word is-partial"[^>]*>at</);
  // One spark, for the newest committed unchanged word ("hey"), outside the track.
  assert.equal((html.match(/class="condense-spark"/g) || []).length, 1);
  assert.match(html, /<\/span><span class="condense-spark"/);
  assert.equal(renderStatic(CondensationWords, { words: [] }), "");
});

test("words land on the beat tokens; reduced motion keeps the fades and drops the flight", () => {
  const styles = css().replace(/\s+/g, " ");
  // Spark flies --motion-condense-fly (140ms); the word lands over
  // --motion-condense-land (220ms), one --motion-instant after it leaves (R2-M1).
  assert.match(
    styles,
    /\.condense-word \{[^}]*animation: condense-in var\(--motion-condense-land\) var\(--motion-ease-enter\) var\(--motion-instant\) both/
  );
  assert.match(
    styles,
    /\.condense-word\.is-partial \{[^}]*transition: opacity var\(--motion-fast\) var\(--motion-ease-std\)/
  );
  assert.match(styles, /@keyframes condense-in \{ from \{[^}]*filter: blur\(6px\)/);
  assert.match(
    styles,
    /\.condense-word\.is-changed::after \{[^}]*animation: condense-underline var\(--motion-rewrite-underline\) var\(--motion-ease-std\) both/
  );
  assert.match(
    styles,
    /\.condense-spark \{[^}]*condense-spark-rise var\(--motion-condense-fly\) var\(--motion-ease-std\) both, condense-spark-fade var\(--motion-fast\) var\(--motion-ease-exit\) var\(--motion-condense-fly\) both/
  );
  // Reduced motion: no flight; the words still fade in, and the rewrite
  // underline (colour, not movement) keeps its full length.
  assert.match(
    styles,
    /prefers-reduced-motion: reduce[\s\S]*\.condense-spark \{ display: none; \}/
  );
  assert.match(
    styles,
    /prefers-reduced-motion: reduce[\s\S]*\.condense-word \{ animation: notice-fade var\(--motion-fast\) linear both !important; \}/
  );
  assert.match(
    styles,
    /prefers-reduced-motion: reduce[\s\S]*\.condense-word\.is-changed::after \{ animation-duration: var\(--motion-rewrite-underline\) !important; \}/
  );
});

test("words never render inside the pill box (D9)", () => {
  const pill = fs.readFileSync(
    path.join(__dirname, "../../src/components/dictation/VoicePill.tsx"),
    "utf8"
  );
  assert.doesNotMatch(pill, /CondensationWords|condense-word/);
});

test("ordinary repeated words keep the sample LCS tie rule, punctuation and whole-utterance keys", async () => {
  const { splitWords, diffWords } = await load();
  assert.deepEqual(splitWords("  ألف\n two\tthree  "), ["ألف", "two", "three"]);
  assert.deepEqual(
    diffWords("a b a", "a a b").map((w) => [w.text, w.changed]),
    [
      ["a", false],
      ["a", false],
      ["b", true],
    ]
  );
  assert.deepEqual(
    diffWords("hey, maya!", "hey maya.").map((w) => w.changed),
    [false, false]
  );
  assert.deepEqual(
    diffWords("1 2 3 4 5 6 7", "1 2 3 4 5 6 7").map((w) => w.key),
    ["1", "2", "3", "4", "5", "6"]
  );
});

test("bounded alignment agrees with the exact ordinary LCS for insertions, deletions and repeated tokens", async () => {
  const { diffWords } = await load();
  const reference = (raw, cleaned) => {
    const bare = (word) => word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
    const a = raw.split(" ").filter(Boolean).map(bare);
    const words = cleaned.split(" ").filter(Boolean);
    const b = words.map(bare);
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const kept = new Set();
    for (let i = 0, j = 0; i < a.length && j < b.length;) {
      if (a[i] === b[j]) {
        kept.add(j++);
        i++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return words
      .map((text, j) => ({ text, key: String(j), committed: true, changed: !kept.has(j) }))
      .slice(-6);
  };
  let seed = 12;
  const rand = (n) => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n;
  const vocabulary = ["a", "A", "a,", "b", "c.", "!", "ألف"];
  for (let k = 0; k < 250; k++) {
    const words = () =>
      Array.from({ length: rand(22) }, () => vocabulary[rand(vocabulary.length)]).join(" ");
    const raw = words(),
      cleaned = words();
    assert.deepEqual(diffWords(raw, cleaned), reference(raw, cleaned));
  }
});

test("long takes and adversarial rewrites use a conservative bounded visual fallback without mutating text", async () => {
  const { diffWords } = await load();
  for (const length of [256, 10_000, 100_000]) {
    const raw = Array.from({ length }, (_, i) => `raw${i}`).join(" ");
    const cleaned = Array.from({ length }, (_, i) => `clean${i}`).join(" ");
    const before = [raw, cleaned];
    const words = diffWords(raw, cleaned);
    assert.equal(words.length, 6);
    assert.ok(words.every((w) => w.changed));
    assert.equal(words[0].key, String(length - 6));
    assert.equal(words.at(-1).text, `clean${length - 1}`);
    assert.deepEqual([raw, cleaned], before);
    assert.ok(
      diffWords(raw, raw).every((w) => !w.changed),
      "identical long text is a proven match"
    );
  }
  const hugeToken = "a".repeat(70_000);
  assert.equal(
    diffWords(hugeToken, hugeToken + "!")[0].changed,
    true,
    "character-budget fallback is conservative"
  );
  assert.equal(
    diffWords("a ".repeat(254) + "b", "a ".repeat(254) + "B").at(-1).changed,
    true,
    "exact budget boundary still detects case"
  );
});

test("alignment allocation reaches the documented boundary but never exceeds it", async (t) => {
  const { diffWords } = await load();
  const Original = globalThis.Uint16Array;
  const allocations = [];
  globalThis.Uint16Array = class extends Original {
    constructor(length) {
      super(length);
      allocations.push(this.byteLength);
    }
  };
  t.after(() => {
    globalThis.Uint16Array = Original;
  });
  diffWords("a ".repeat(254) + "b", "a ".repeat(254) + "B");
  assert.deepEqual(allocations, [131072], "256 × 256 Uint16 cells at the exact boundary");
  diffWords("a ".repeat(255) + "b", "a ".repeat(255) + "B");
  diffWords("a".repeat(70_000), "b");
  assert.equal(allocations.length, 1, "over-budget inputs allocate no alignment cells");
});
