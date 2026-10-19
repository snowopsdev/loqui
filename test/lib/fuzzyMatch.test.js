const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/fuzzyMatch.ts");

test("a contiguous match ranks above a scattered one and reports its range", async () => {
  const { fuzzyMatch } = await load();
  const contiguous = fuzzyMatch("meet", "Record meeting");
  const scattered = fuzzyMatch("meet", "Move every entry today");
  assert.deepEqual(contiguous.ranges, [[7, 11]]);
  assert.ok(scattered && contiguous.score > scattered.score);
});

test("word starts beat mid-word hits", async () => {
  const { fuzzyMatch } = await load();
  assert.ok(fuzzyMatch("no", "New note").score > fuzzyMatch("no", "Piano").score);
});

test("subsequence ranges merge consecutive characters", async () => {
  const { fuzzyMatch } = await load();
  assert.deepEqual(fuzzyMatch("gnot", "Go to Notes").ranges, [
    [0, 1],
    [6, 9],
  ]);
});

test("case and missing characters", async () => {
  const { fuzzyMatch } = await load();
  assert.ok(fuzzyMatch("PRICING", "pricing review"));
  assert.equal(fuzzyMatch("xyz", "pricing"), null);
  assert.deepEqual(fuzzyMatch("", "anything"), { score: 0, ranges: [] });
});

test("transcripts use substring matching only", async () => {
  const { substringMatch } = await load();
  assert.deepEqual(substringMatch("thurs", "goes out Thursday").ranges, [[9, 14]]);
  assert.equal(substringMatch("gout", "goes out Thursday"), null);
});

test("highlight segments cover the whole string in order", async () => {
  const { highlightSegments } = await load();
  assert.deepEqual(highlightSegments("Record meeting", [[7, 11]]), [
    { text: "Record ", match: false },
    { text: "meet", match: true },
    { text: "ing", match: false },
  ]);
  assert.deepEqual(highlightSegments("abc", []), [{ text: "abc", match: false }]);
});

test("expanding lowercase and non-ASCII matches use ORIGINAL UTF-16 offsets", async () => {
  const { fuzzyMatch, substringMatch, highlightSegments } = await load();
  for (const matcher of [fuzzyMatch, substringMatch]) {
    for (const [query, text, range] of [
      ["stan", "İstanbul", [1, 5]],
      ["İ", "İstanbul", [0, 1]],
      ["É", "café", [3, 4]],
      ["京", "東京都", [1, 2]],
    ]) {
      const hit = matcher(query, text);
      assert.deepEqual(hit.ranges, [range]);
      assert.equal(
        highlightSegments(text, hit.ranges)
          .map((s) => s.text)
          .join(""),
        text
      );
      assert.equal(
        highlightSegments(text, hit.ranges)
          .filter((s) => s.match)
          .map((s) => s.text)
          .join(""),
        text.slice(...range)
      );
    }
  }
});

test("supplementary-character subsequences never split surrogate highlights", async () => {
  const { fuzzyMatch, highlightSegments } = await load();
  const text = "😀x😀yz";
  const hit = fuzzyMatch("😀😀z", text);
  assert.deepEqual(hit.ranges, [
    [0, 2],
    [3, 5],
    [6, 7],
  ]);
  const segments = highlightSegments(text, hit.ranges);
  assert.equal(segments.map((s) => s.text).join(""), text);
  assert.deepEqual(
    segments.filter((s) => s.match).map((s) => s.text),
    ["😀", "😀", "z"]
  );
});

test("even a long late substring outranks a scattered match", async () => {
  const { fuzzyMatch } = await load();
  const hit = fuzzyMatch("meet", "x".repeat(600) + "meet");
  assert.deepEqual(hit.ranges, [[600, 604]]);
  assert.ok(hit.score >= 500);
  assert.ok(hit.score > fuzzyMatch("meet", "Move every entry today").score);
});
