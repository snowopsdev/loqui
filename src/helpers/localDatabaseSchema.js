// Fresh local-only schema for the isolated Loqui profile.
// Stable client UUIDs support idempotent imports and local conversation links.
module.exports = `
CREATE TABLE IF NOT EXISTS transcriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  raw_text TEXT,
  has_audio INTEGER NOT NULL DEFAULT 0,
  audio_duration_ms INTEGER,
  provider TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  error_message TEXT,
  error_code TEXT,
  route_kind TEXT,
  client_transcription_id TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS custom_dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  client_dict_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  deleted_at TEXT,
  updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS snippets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL,
  replacement TEXT NOT NULL,
  client_snippet_id TEXT,
  deleted_at TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT 'Untitled Note',
  content TEXT NOT NULL DEFAULT '',
  note_type TEXT NOT NULL DEFAULT 'personal',
  source_file TEXT,
  audio_duration_seconds REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  enhanced_content TEXT,
  enhancement_prompt TEXT,
  enhanced_at_content_hash TEXT,
  folder_id INTEGER REFERENCES folders(id),
  transcript TEXT,
  calendar_event_id TEXT,
  participants TEXT,
  diarization_enabled INTEGER,
  expected_speaker_count INTEGER,
  client_note_id TEXT,
  deleted_at TEXT,
  space_id INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
          title,
          content,
          enhanced_content,
          content='notes',
          content_rowid='id'
        );

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'sparkles',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  translation_key TEXT
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT 'Untitled',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  archived_at DATETIME,
  note_id INTEGER,
  space_id INTEGER,
  folder_id INTEGER,
  client_conversation_id TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON agent_messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_note ON agent_conversations(note_id);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_container ON agent_conversations(space_id, folder_id);

CREATE TABLE IF NOT EXISTS google_calendar_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_email TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  scope TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS google_calendars (
  id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  description TEXT,
  background_color TEXT,
  is_selected INTEGER NOT NULL DEFAULT 1,
  sync_token TEXT,
  sync_token_expires_at INTEGER,
  account_email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS microsoft_calendar_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  microsoft_email TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  scope TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS microsoft_calendars (
  id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  background_color TEXT,
  is_selected INTEGER NOT NULL DEFAULT 1,
  is_primary INTEGER NOT NULL DEFAULT 0,
  sync_token TEXT,
  sync_token_expires_at INTEGER,
  account_email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL,
  summary TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_all_day INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed',
  availability_status TEXT NOT NULL DEFAULT 'unknown',
  self_response_status TEXT NOT NULL DEFAULT 'unknown',
  hangout_link TEXT,
  conference_data TEXT,
  organizer_email TEXT,
  attendees_count INTEGER DEFAULT 0,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  provider TEXT NOT NULL DEFAULT 'google',
  attendees TEXT
);

CREATE TABLE IF NOT EXISTS apple_calendars (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  color TEXT,
  source_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contacts (
  email TEXT PRIMARY KEY,
  display_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS speaker_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  email TEXT,
  embedding BLOB NOT NULL,
  sample_count INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS speaker_mappings (
  note_id INTEGER NOT NULL,
  speaker_id TEXT NOT NULL,
  profile_id INTEGER,
  display_name TEXT NOT NULL,
  PRIMARY KEY (note_id, speaker_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES speaker_profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS note_speaker_embeddings (
  note_id INTEGER NOT NULL,
  speaker_id TEXT NOT NULL,
  embedding BLOB NOT NULL,
  PRIMARY KEY (note_id, speaker_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_client_note_id ON notes(client_note_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_client_id ON agent_conversations(client_conversation_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transcriptions_client_id ON transcriptions(client_transcription_id);

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  word_count INTEGER NOT NULL CHECK (word_count > 0),
  spoken_duration_ms INTEGER,
  mode TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  counter_version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analytics_device_clear_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cleared_through TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_history_backfill_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  scanned_through_transcription_id INTEGER NOT NULL DEFAULT 0
            CHECK (scanned_through_transcription_id >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_dictionary_client_id ON custom_dictionary(client_dict_id);

CREATE TRIGGER IF NOT EXISTS custom_dictionary_client_id_default
        AFTER INSERT ON custom_dictionary
        WHEN new.client_dict_id IS NULL
        BEGIN
          UPDATE custom_dictionary SET client_dict_id =
            lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
            substr(lower(hex(randomblob(2))), 2) || '-' ||
            substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) ||
            '-' || lower(hex(randomblob(6)))
          WHERE id = new.id;
        END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_snippets_client_id ON snippets(client_snippet_id) WHERE client_snippet_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_snippets_trigger_lower_active ON snippets(lower(trigger)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS spaces (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_space_id TEXT,
  kind TEXT NOT NULL DEFAULT 'private' CHECK (kind = 'private'),
  name            TEXT NOT NULL,
  emoji           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  deleted_at      TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_client_space_id ON spaces(client_space_id);

CREATE TABLE IF NOT EXISTS "folders" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  client_folder_id TEXT,
  deleted_at TEXT,
  space_id INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_client_folder_id ON folders(client_folder_id);

CREATE INDEX IF NOT EXISTS idx_notes_folder_id ON notes(folder_id);

CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);

CREATE INDEX IF NOT EXISTS idx_notes_space_updated ON notes(space_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_folders_space_sort ON folders(space_id, sort_order);

CREATE TABLE IF NOT EXISTS pending_vector_purges (
  space_id   INTEGER PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_private ON spaces(kind);

CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_personal_name ON folders(space_id, name) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_events(local_date);
CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content, enhanced_content) VALUES (new.id, new.title, new.content, new.enhanced_content);
END;
CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content, enhanced_content) VALUES ('delete', old.id, old.title, old.content, old.enhanced_content);
  INSERT INTO notes_fts(rowid, title, content, enhanced_content) VALUES (new.id, new.title, new.content, new.enhanced_content);
END;
CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content, enhanced_content) VALUES ('delete', old.id, old.title, old.content, old.enhanced_content);
END;
`;
