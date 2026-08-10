// Routing rules for meeting-diarization-complete events (issue #1495):
// results must be persisted to the note that owns the recording session,
// never to whichever note happens to be rendered when the event arrives.
// Persistence runs at store level (meetingRecordingStore), so results
// survive the notes view unmounting; `isCurrentSession` gates only whether
// the result is published to the UI.

export interface DiarizationCompletionPlan {
  targetNoteId: number | null;
  isCurrentSession: boolean;
}

export function resolveDiarizationTarget(params: {
  payloadNoteId?: number | null;
  payloadSessionId?: string | null;
  currentSessionId: string | null;
  recordingNoteId: number | null;
}): DiarizationCompletionPlan {
  const { payloadNoteId, payloadSessionId, currentSessionId, recordingNoteId } = params;

  // A null current session means nothing newer is pending, so publishing is
  // safe and clearing a waiting spinner prevents it from getting stuck.
  const isCurrentSession = currentSessionId == null || payloadSessionId === currentSessionId;

  if (payloadNoteId != null) {
    return { targetNoteId: payloadNoteId, isCurrentSession };
  }

  // Legacy payloads without a noteId can only be attributed via the session
  // check; recordingNoteId still names the owner (it is not cleared on stop).
  if (currentSessionId != null && payloadSessionId === currentSessionId) {
    return { targetNoteId: recordingNoteId, isCurrentSession };
  }

  return { targetNoteId: null, isCurrentSession };
}

export function selectBaseSegments<Segment>(params: {
  persistedSegments: Segment[] | null;
  liveSegments: Segment[];
  recordingNoteId: number | null;
  targetNoteId: number;
}): Segment[] {
  const { persistedSegments, liveSegments, recordingNoteId, targetNoteId } = params;

  if (persistedSegments) {
    return persistedSegments;
  }
  // Live segments belong to the recording note; merging them into any other
  // note would cross-contaminate transcripts.
  if (recordingNoteId === targetNoteId && liveSegments.length > 0) {
    return liveSegments;
  }
  return [];
}
