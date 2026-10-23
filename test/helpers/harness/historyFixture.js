// Synthetic IPC records use the full public TranscriptionItem shape.
const row = (id, over = {}) => ({
  id,
  text: `Synthetic dictation ${id}`,
  raw_text: null,
  timestamp: "2026-10-14 19:51:00",
  created_at: "2026-10-14 19:51:00",
  has_audio: 1,
  audio_duration_ms: 7000,
  provider: "local-parakeet",
  model: "parakeet",
  status: "completed",
  error_message: null,
  error_code: null,
  client_transcription_id: `synthetic-${id}`,
  cloud_id: null,
  sync_status: "synced",
  deleted_at: null,
  ...over,
});
module.exports = { row };
