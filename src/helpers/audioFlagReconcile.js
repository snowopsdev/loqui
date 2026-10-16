// After "delete all audio", unflag only the recordings whose file is really
// gone. A file that survived a failed delete keeps its history playback; an
// unreadable folder unflags nothing, because nothing can be confirmed gone.
function clearFlagsForDeletedAudio({ audioStorage, database }) {
  const remaining = audioStorage.remainingAudioIds();
  if (remaining === null) return [];
  const rows = database.db.prepare("SELECT id FROM transcriptions WHERE has_audio = 1").all();
  const gone = rows.map((row) => row.id).filter((id) => !remaining.has(String(id)));
  if (gone.length > 0) database.clearAudioFlags(gone);
  return gone;
}

module.exports = { clearFlagsForDeletedAudio };
