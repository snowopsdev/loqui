export type MatchRange = readonly [start: number, end: number];
export interface FuzzyMatch {
  score: number;
  ranges: MatchRange[];
}

const isWordStart = (text: string, index: number) =>
  index === 0 || /[\s\-_/.(]/.test(text[index - 1]);

// Keep the whole-string locale casing (including contextual forms), while
// mapping each folded UTF-16 unit back to its original code point. This is a
// small offset map, not accent stripping or a general Unicode search engine.
function foldedText(text: string) {
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const char of text) {
    const end = offset + char.length;
    const foldedLength = char.toLocaleLowerCase().length;
    for (let i = 0; i < foldedLength; i++) {
      starts.push(offset);
      ends.push(end);
    }
    offset = end;
  }
  return { text: text.toLocaleLowerCase(), starts, ends };
}

export function substringMatch(query: string, text: string): FuzzyMatch | null {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { score: 0, ranges: [] };
  const folded = foldedText(text);
  const index = folded.text.indexOf(needle);
  if (index < 0) return null;
  const start = folded.starts[index];
  const end = folded.ends[index + needle.length - 1];
  const penalty =
    start * 2 + (text.length - (end - start)) * 0.1 + (isWordStart(text, start) ? 0 : 100);
  // A monotonic bounded category retains position/word-start ranking even
  // for long strings: every nonempty substring is >500, subsequences <500.
  const score = 500 + 500 / (1 + penalty / 500);
  return { score, ranges: [[start, end]] };
}

// Contiguous matches first; otherwise an in-order subsequence (cmdk-style),
// rewarded for word starts and runs. Nonempty subsequences always score below 500.
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const direct = substringMatch(query, text);
  if (direct) return direct;
  const needle = query.trim().toLocaleLowerCase().replace(/\s+/g, "");
  const folded = foldedText(text);
  const haystack = folded.text;
  const ranges: Array<[number, number]> = [];
  let score = 0;
  let from = 0;
  for (const char of needle) {
    const index = haystack.indexOf(char, from);
    if (index < 0) return null;
    const start = folded.starts[index];
    const end = folded.ends[index + char.length - 1];
    const last = ranges.at(-1);
    if (last && last[1] >= start) {
      last[1] = end;
      score += 8;
    } else {
      ranges.push([start, end]);
    }
    score += isWordStart(text, start) ? 12 : 2;
    from = index + char.length;
  }
  return { score: Math.min(score, 499) - from * 0.05, ranges };
}

export function highlightSegments(
  text: string,
  ranges: readonly MatchRange[]
): Array<{ text: string; match: boolean }> {
  const segments: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length || segments.length === 0)
    segments.push({ text: text.slice(cursor), match: false });
  return segments;
}
