import type { CondensedWord } from "./condensation";

/**
 * The word row above the pill. A spark rises through the gap toward the
 * newest committed unchanged word on the shared fly/land beats. A wide row
 * can extend beside a compact pill; this is a decorative cue, never a bar
 * moving through the text. The bars remain uncovered (D9).
 */
export function CondensationWords({ words }: { words: CondensedWord[] }) {
  if (words.length === 0) return null;
  // The spark lives outside the clipped, masked track. It is keyed by the
  // newest committed word, so it replays once per commit, rising from the
  // height of the pill's top edge into the row, above the bars (D9).
  const newest = [...words].reverse().find((w) => w.committed && !w.changed);
  return (
    <>
      <span className="condense-track" aria-hidden="true">
        {words.map((word) => (
          <span
            key={word.key}
            className={[
              "condense-word",
              word.changed && "is-changed",
              !word.committed && "is-partial",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {word.text}
          </span>
        ))}
      </span>
      {newest ? (
        <span key={`spark-${newest.key}`} className="condense-spark" aria-hidden="true" />
      ) : null}
    </>
  );
}
