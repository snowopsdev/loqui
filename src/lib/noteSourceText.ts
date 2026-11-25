type TranscriptSegment = { text?: unknown; speakerName?: unknown; speakerIsPlaceholder?: unknown };

// The notes table stores a transcript as a JSON array of segments. Speaker
// labels are kept only when a person was actually named.
export function formatTranscript(transcript: string | null | undefined): string {
  if (!transcript) return "";
  let segments: unknown;
  try {
    segments = JSON.parse(transcript);
  } catch {
    return transcript.trim();
  }
  if (!Array.isArray(segments)) return "";
  return (segments as TranscriptSegment[])
    .map((segment) => {
      const text = typeof segment?.text === "string" ? segment.text.trim() : "";
      if (!text) return "";
      const name = typeof segment.speakerName === "string" ? segment.speakerName.trim() : "";
      return name && !segment.speakerIsPlaceholder ? `${name}: ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

// The text Chat reads for a note: the AI summary, then typed notes, then the
// transcript. Recorded meetings and uploaded audio usually have no typed notes,
// and a blank (whitespace-only) field falls through rather than hiding the rest.
// Shared by RAG context, get_note and search_notes so all three agree.
export function noteSourceText(note: {
  content?: string | null;
  enhanced_content?: string | null;
  transcript?: string | null;
}): string {
  for (const candidate of [note.enhanced_content, note.content])
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  return formatTranscript(note.transcript);
}
