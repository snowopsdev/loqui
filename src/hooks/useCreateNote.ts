import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { startRecording, useMeetingRecordingStore } from "../stores/meetingRecordingStore";
import {
  revealContainer,
  setActiveContext,
  setActiveNoteId,
  useActiveContext,
} from "../stores/noteStore";
import { requestNoteTitleFocus } from "../stores/noteFocusRequest";
import type { NoteItem } from "../types/electron";

import { isMeetingAutoEndEligible } from "../helpers/meetingRecordingSession";
import { parseTranscriptSegments } from "../utils/parseTranscriptSegments";
import { isExplicitSpeakerCount, resolveExpectedSpeakerCount } from "../utils/participants";

/** Start a meeting recording seeded with the note's transcript and speaker setup. */
export function startRecordingForNote(note: NoteItem | null): Promise<boolean> {
  return startRecording({
    noteId: note?.id ?? null,
    noteTitle: note?.title ?? null,
    folderId: note?.folder_id ?? null,
    seedSegments: note?.transcript ? parseTranscriptSegments(note.transcript) : [],
    diarizationEnabled: note?.diarization_enabled == null ? null : note.diarization_enabled === 1,
    expectedCount: resolveExpectedSpeakerCount(note),
    expectedCountIsExplicit: isExplicitSpeakerCount(note?.expected_speaker_count),
    autoEndEligible: isMeetingAutoEndEligible(note),
  });
}

export interface CreateNoteOptions {
  record?: boolean;
  /** Saving still completes; only the caller's optional UI/automatic-start activation expires. */
  canActivate?: () => boolean;
  /** Hand keyboard focus to the opened note's title (the after-setup hand-off). */
  focusTitle?: boolean;
}

/**
 * Creates a note, opens it, and starts recording into it. A null space resolves
 * to the private space in the database, so this works before the Notes tree loads.
 */
export function useCreateNote() {
  const { t } = useTranslation();
  const activeContext = useActiveContext();
  // One recording intent owns note creation through async recording activation.
  // Plain notes deliberately bypass this admission lock.
  const recordingCreationRef = useRef<Promise<void> | null>(null);

  const createNoteIn = useCallback(
    async (spaceId: number | null, folderId: number | null, options: CreateNoteOptions = {}) => {
      const record = options.record ?? true;
      if (record && recordingCreationRef.current) return recordingCreationRef.current;
      let activation: Promise<boolean> | undefined;
      const operation = (async () => {
        const result = await window.electronAPI.saveNote(
          t("notes.list.untitledNote"),
          "",
          "personal",
          null,
          null,
          folderId,
          spaceId
        );
        if (!result.success || !result.note) return;
        if (options.canActivate && !options.canActivate()) return;
        setActiveContext(result.note.space_id, result.note.folder_id);
        revealContainer(result.note.space_id, result.note.folder_id);
        setActiveNoteId(result.note.id);
        if (options.focusTitle) requestNoteTitleFocus(result.note.id);
        // Read live state after saving; another capture may have started during the await.
        if (record && !useMeetingRecordingStore.getState().isRecording)
          activation = startRecordingForNote(result.note);
      })();
      if (record) recordingCreationRef.current = operation;
      try {
        await operation;
      } finally {
        if (record) {
          const release = () => {
            if (recordingCreationRef.current === operation) recordingCreationRef.current = null;
          };
          // Keep the admission held through activation, but preserve creation's existing
          // navigation timing. The recording store owns startup errors and cleanup.
          if (activation) void activation.then(release, release);
          else release();
        }
      }
    },
    [t]
  );

  const createNote = useCallback(
    (options?: CreateNoteOptions) =>
      createNoteIn(activeContext?.spaceId ?? null, activeContext?.folderId ?? null, options),
    [activeContext, createNoteIn]
  );

  return { createNote, createNoteIn };
}
