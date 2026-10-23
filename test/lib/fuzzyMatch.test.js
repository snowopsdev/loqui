const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

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

test("contextual casing keeps original ranges across runtime locales", () => {
  const cases = [
    { locale: "lt_LT.UTF-8", query: "z", text: "I\u0301z", range: [2, 3] },
    { locale: "tr_TR.UTF-8", query: "stan", text: "I\u0307stan", range: [2, 6] },
  ];
  for (const { locale, query, text, range } of cases) {
    const script = `
      const { fuzzyMatch, substringMatch, highlightSegments } = await import(${JSON.stringify(require("node:path").resolve(__dirname, "../../src/lib/fuzzyMatch.ts"))});
      const query = ${JSON.stringify(query)};
      const text = ${JSON.stringify(text)};
      const expectedRange = ${JSON.stringify(range)};
      const results = [substringMatch(query, text), fuzzyMatch(query, text)];
      for (const result of results) {
        if (!result || !Number.isFinite(result.score) || result.score < 500 || JSON.stringify(result.ranges) !== JSON.stringify([expectedRange])) throw new Error(JSON.stringify(result));
        const segments = highlightSegments(text, result.ranges);
        if (segments.map((segment) => segment.text).join("") !== text) throw new Error("segments do not roundtrip");
        if (segments.filter((segment) => segment.match).map((segment) => segment.text).join("") !== text.slice(...expectedRange)) throw new Error("segments mark the wrong original text");
      }
      console.log(JSON.stringify({ locale: process.env.LC_ALL, results }));
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, LANG: locale, LC_ALL: locale },
    });
    assert.equal(
      child.status,
      0,
      `${locale} child failed\nstdout: ${child.stdout}\nstderr: ${child.stderr}`
    );
    const output = JSON.parse(child.stdout.trim().split("\n").at(-1));
    assert.equal(output.locale, locale);
    assert.equal(output.results.length, 2);
  }
});

test("whole-string lowercase preserves contextual Greek sigma matching", async () => {
  const { substringMatch, fuzzyMatch } = await load();
  for (const matcher of [substringMatch, fuzzyMatch]) {
    const hit = matcher("ος", "ΟΣ");
    assert.deepEqual(hit.ranges, [[0, 2]]);
    assert.ok(Number.isFinite(hit.score));
  }
});
