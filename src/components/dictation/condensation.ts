export interface CondensedWord {
  key: string;
  text: string;
  committed: boolean;
  changed: boolean;
}

export const CONDENSATION_MAX_WORDS = 6;
// Visual alignment only: at most 128KiB of cells and 65,536 comparisons.
// The character budget also bounds token interning before alignment. Splitting
// the displayed cleaned tail remains linear in the supplied text, never quadratic.
const ALIGNMENT_MAX_CELLS = 65_536;
const ALIGNMENT_MAX_CHARACTERS = 65_536;

export function splitWords(text: string): string[] {
  return (text ?? "").trim().split(/\s+/u).filter(Boolean);
}

/** Positional keys survive a partial word becoming committed. */
export function condenseWords(committed: string, partial: string): CondensedWord[] {
  const done = splitWords(committed);
  const tail = splitWords(partial);
  const total = done.length + tail.length;
  const words: CondensedWord[] = [];
  for (let i = Math.max(0, total - CONDENSATION_MAX_WORDS); i < total; i += 1) {
    words.push({
      key: String(i),
      text: i < done.length ? done[i] : tail[i - done.length],
      committed: i < done.length,
      changed: false,
    });
  }
  return words;
}

const bare = (word: string) => word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");

/**
 * Exact case-sensitive LCS (ignoring edge punctuation) within a fixed budget.
 * The tie rule matches the ordinary global alignment. Outside that budget,
 * unproven displayed matches are conservatively marked changed. Transcript
 * strings are never modified or truncated; only the visible row is bounded.
 */
export function diffWords(raw: string, cleaned: string): CondensedWord[] {
  const bWords = splitWords(cleaned);
  const start = Math.max(0, bWords.length - CONDENSATION_MAX_WORDS);
  const visible = (kept: (j: number) => boolean) =>
    bWords.slice(start).map((text, i) => ({
      key: String(start + i),
      text,
      committed: true,
      changed: !kept(start + i),
    }));
  if (!bWords.length) return [];
  if (raw === cleaned) return visible(() => true);
  if (raw.length + cleaned.length > ALIGNMENT_MAX_CHARACTERS) return visible(() => false);
  const aWords = splitWords(raw);
  const columns = bWords.length + 1;
  const cells = (aWords.length + 1) * columns;
  if (cells > ALIGNMENT_MAX_CELLS) return visible(() => false);

  // Intern once so each bounded DP comparison is constant-time even for long
  // tokens with common prefixes. IDs preserve exact punctuation/case semantics.
  const ids = new Map<string, number>();
  const intern = (word: string) => {
    const value = bare(word);
    if (!ids.has(value)) ids.set(value, ids.size);
    return ids.get(value)!;
  };
  const a = aWords.map(intern);
  const b = bWords.map(intern);
  const lcs = new Uint16Array(cells);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * columns + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * columns + j + 1] + 1
          : Math.max(lcs[(i + 1) * columns + j], lcs[i * columns + j + 1]);
    }
  }
  const kept = new Set<number>();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      kept.add(j);
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * columns + j] >= lcs[i * columns + j + 1]) i += 1;
    else j += 1;
  }
  return visible((j) => kept.has(j));
}
