const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const debugLogger = require("./debugLogger");
const { buildNoteSearchQuery } = require("./noteSearch");
const { normalizeStoredSpeakerCount } = require("./speakerCount");
const { parseEventTime } = require("./calendarAvailability");
// Prefer recorded occurrence times when dating local history.
const { hasExplicitTimeZone, parseDbTimestamp, toDbTimestamp } = require("./dbTimestamp");
const { BUILTIN_ACTIONS } = require("./builtinActions");
const {
  ANALYTICS_COUNTER_VERSION,
  ANALYTICS_HISTORY_BACKFILL_VERSION,
  ANALYTICS_HISTORICAL_COUNTER_VERSION,
  countSpokenWords,
  inferHistoricalAnalyticsMode,
  localDateKey,
  summarizeAnalyticsDays,
} = require("./analytics");
const { app } = require("electron");

// Keep snippet triggers bounded for predictable local matching.
const MAX_SNIPPET_TRIGGER_LENGTH = 100;

const FOLDER_NAME_TAKEN_FILTER = "deleted_at IS NULL";

// A meeting synced by both a REST provider (Google/Microsoft) and Apple
// (Calendar.app mirrors the same accounts) would double-fire reminders and
// duplicate UI rows; suppress the Apple copy when a REST row occupies the same
// time slot + title (REST rows have richer conference data). datetime()
// normalizes the providers' timestamp formats (Google stores offset-form
// RFC3339, Apple/Microsoft store UTC "Z" form). REST rows are never collapsed
// — Google and Microsoft are never mirrors of each other.
function dedupedEventsQuery(where) {
  return `SELECT * FROM (
    SELECT *, MAX(provider != 'apple') OVER (
      PARTITION BY datetime(start_time), datetime(end_time), COALESCE(summary, '')
    ) AS has_synced
    FROM calendar_events
    WHERE ${where}
  ) WHERE provider != 'apple' OR has_synced = 0 ORDER BY datetime(start_time) ASC`;
}

function stripDedupeColumn({ has_synced: _hasSynced, ...event }) {
  return event;
}

// Whitelist for provider-scoped SQL against the per-provider calendars tables.
const CALENDARS_TABLE_BY_PROVIDER = {
  google: "google_calendars",
  microsoft: "microsoft_calendars",
};

const AVAILABILITY_PROVIDERS = new Set(["google", "microsoft", "apple"]);
const SELECTED_CALENDAR_EVENT_FILTER = `(
  (provider = 'google' AND EXISTS (
    SELECT 1 FROM google_calendars WHERE google_calendars.id = calendar_events.calendar_id
      AND google_calendars.is_selected = 1
  )) OR
  (provider = 'microsoft' AND EXISTS (
    SELECT 1 FROM microsoft_calendars WHERE microsoft_calendars.id = calendar_events.calendar_id
      AND microsoft_calendars.is_selected = 1
  )) OR
  (provider = 'apple' AND EXISTS (
    SELECT 1 FROM apple_calendars WHERE apple_calendars.id = calendar_events.calendar_id
  ))
)`;

class DatabaseManager {
  constructor() {
    this.db = null;
    this.initDatabase();
  }

  _personalScopeCondition(tableName) {
    return {
      sql: `EXISTS (SELECT 1 FROM spaces personal_space
        WHERE personal_space.id = ${tableName}.space_id AND personal_space.kind = 'private')`,
      params: [],
    };
  }

  _getPersonalFolder(id) {
    const personalScope = this._personalScopeCondition("folders");
    return (
      this.db
        .prepare(`SELECT * FROM folders WHERE id = ? AND ${personalScope.sql}`)
        .get(id, ...personalScope.params) || null
    );
  }

  initDatabase() {
    const dbFileName =
      process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db";
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    this.db = new Database(path.join(app.getPath("userData"), dbFileName));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(require("./localDatabaseSchema"));
    this.db.transaction(() => {
      if (!this.db.prepare("SELECT id FROM spaces WHERE kind = 'private'").get()) {
        this.db
          .prepare(
            "INSERT INTO spaces (client_space_id,kind,name,sort_order) VALUES (?, 'private', 'Personal', 0)"
          )
          .run(randomUUID());
      }
      const spaceId = this.getPrivateSpaceId();
      for (const [sortOrder, name] of ["Personal", "Meetings", "Videos"].entries()) {
        if (
          !this.db
            .prepare("SELECT id FROM folders WHERE name = ? AND space_id = ?")
            .get(name, spaceId)
        ) {
          this.db
            .prepare(
              "INSERT INTO folders (name,is_default,sort_order,client_folder_id,space_id) VALUES (?,1,?,?,?)"
            )
            .run(name, sortOrder, randomUUID(), spaceId);
        }
      }
      for (const action of BUILTIN_ACTIONS) {
        const existing = this.db
          .prepare("SELECT id,prompt FROM actions WHERE is_builtin = 1 AND translation_key = ?")
          .get(action.translationKey);
        if (!existing)
          this.db
            .prepare(
              "INSERT INTO actions (name,description,prompt,icon,is_builtin,sort_order,translation_key) VALUES (?,?,?,?,1,?,?)"
            )
            .run(
              action.name,
              action.description,
              action.prompt,
              action.icon,
              action.sortOrder,
              action.translationKey
            );
        else if (action.previousPrompts.includes(existing.prompt))
          this.db
            .prepare("UPDATE actions SET name = ?, description = ?, prompt = ? WHERE id = ?")
            .run(action.name, action.description, action.prompt, existing.id);
      }
    })();
    return true;
  }

  saveTranscription(
    text,
    rawText = null,
    {
      status = "completed",
      errorMessage = null,
      errorCode = null,
      routeKind = null,
      clientTranscriptionId = randomUUID(),
      analyticsOccurredAt = null,
    } = {}
  ) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      // With an occurrence time this column carries when the dictation was
      // spoken rather than when the row was written -- earlier by the length
      // of the recording plus transcription. History reads it through
      // normalizeDbDate, which already branches on a trailing zone.
      // Keep the existing SQLite-friendly separator so mixed old/new rows
      // continue to sort chronologically, while the trailing Z marks this as
      // an exact client-captured instant for clear-state reconciliation.
      const occurredAt = toDbTimestamp(analyticsOccurredAt);
      const stmt = this.db.prepare(
        `INSERT INTO transcriptions (
           text, raw_text, status, error_message, error_code, route_kind,
           client_transcription_id, timestamp
         ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`
      );
      const result = stmt.run(
        text,
        rawText,
        status,
        errorMessage,
        errorCode,
        routeKind,
        clientTranscriptionId,
        occurredAt
      );

      const fetchStmt = this.db.prepare("SELECT * FROM transcriptions WHERE id = ?");
      const transcription = fetchStmt.get(result.lastInsertRowid);

      return { id: result.lastInsertRowid, success: true, transcription };
    } catch (error) {
      debugLogger.error("Error saving transcription", { error: error.message }, "database");
      throw error;
    }
  }

  _ensureAnalyticsHistoryBackfillState(version) {
    this.db
      .prepare(
        `INSERT INTO analytics_history_backfill_state (
           id, version, scanned_through_transcription_id
         ) VALUES (1, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           scanned_through_transcription_id = 0
         WHERE analytics_history_backfill_state.version <> excluded.version`
      )
      .run(version);
    return this.db
      .prepare(
        `SELECT version, scanned_through_transcription_id
         FROM analytics_history_backfill_state WHERE id = 1`
      )
      .get();
  }

  getAnalyticsHistoryBackfillState(version = ANALYTICS_HISTORY_BACKFILL_VERSION) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const safeVersion = Math.max(1, Math.trunc(Number(version)) || 1);
      return this.db.transaction(() => {
        const state = this._ensureAnalyticsHistoryBackfillState(safeVersion);
        const target = this.db
          .prepare("SELECT COALESCE(MAX(id), 0) AS id FROM transcriptions")
          .get();
        return {
          version: safeVersion,
          scannedThroughId: Number(state.scanned_through_transcription_id),
          targetId: Number(target.id),
        };
      })();
    } catch (error) {
      debugLogger.error(
        "Error reading analytics history backfill state",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  _invalidateAnalyticsHistoryFromTranscription(id) {
    const resumeBeforeId = Math.max(0, Math.trunc(Number(id)) - 1);
    this.db
      .prepare(
        `INSERT INTO analytics_history_backfill_state (
           id, version, scanned_through_transcription_id
         ) VALUES (1, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           scanned_through_transcription_id = CASE
             WHEN analytics_history_backfill_state.version = excluded.version
             THEN MIN(
               analytics_history_backfill_state.scanned_through_transcription_id,
               ?
             )
             ELSE 0
           END`
      )
      .run(ANALYTICS_HISTORY_BACKFILL_VERSION, resumeBeforeId);
  }

  backfillAnalyticsHistoryBatch({
    afterId = 0,
    throughId = null,
    checkpointVersion = null,
    limit = 250,
  } = {}) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const safeLimit = Math.max(1, Math.min(Math.trunc(Number(limit)) || 250, 1_000));
      const safeAfterId = Math.max(0, Math.trunc(Number(afterId)) || 0);
      const safeThroughId =
        throughId === null || throughId === undefined
          ? null
          : Math.max(0, Math.trunc(Number(throughId)) || 0);
      const safeCheckpointVersion =
        checkpointVersion === null || checkpointVersion === undefined
          ? null
          : Math.max(1, Math.trunc(Number(checkpointVersion)) || 1);

      return this.db.transaction(() => {
        const checkpoint =
          safeCheckpointVersion === null
            ? null
            : this._ensureAnalyticsHistoryBackfillState(safeCheckpointVersion);
        const effectiveAfterId = checkpoint
          ? Number(checkpoint.scanned_through_transcription_id)
          : safeAfterId;
        if (safeThroughId !== null && effectiveAfterId >= safeThroughId) {
          return {
            complete: true,
            nextCursor: effectiveAfterId,
            scanned: 0,
            inserted: 0,
            skipped: 0,
          };
        }

        const clearState = this.db
          .prepare("SELECT cleared_through FROM analytics_device_clear_state WHERE id = 1")
          .get();
        // Legacy SQLite timestamps are completion times without an offset. Once
        // the user has cleared Insights, only a client-captured occurrence time
        // can prove that a historical row happened afterward, so an ambiguous
        // legacy row stays out rather than reviving a cleared counter. That is
        // the eligibility rule below; the boundary on the instant actually
        // written is enforced in the loop, where the chosen value is known.
        const rows = this.db
          .prepare(
            `SELECT transcription.id, transcription.client_transcription_id,
                    transcription.text, transcription.raw_text, transcription.timestamp,
                    transcription.created_at,
                    audio_duration_ms, provider, model
             FROM transcriptions transcription
             WHERE transcription.id > ?
               AND (? IS NULL OR transcription.id <= ?)
               AND transcription.deleted_at IS NULL
               AND transcription.status = 'completed'
               AND TRIM(COALESCE(NULLIF(TRIM(transcription.raw_text), ''), transcription.text, '')) != ''
               AND NOT EXISTS (
                 SELECT 1 FROM analytics_events event
                 WHERE event.event_id = TRIM(transcription.client_transcription_id)
               )
               AND (
                 ? IS NULL
                 OR (
                   (TRIM(transcription.timestamp) LIKE '%Z'
                    OR SUBSTR(TRIM(transcription.timestamp), -6, 1) IN ('+', '-'))
                   AND JULIANDAY(transcription.timestamp) > JULIANDAY(?)
                 )
               )
             ORDER BY transcription.id ASC
             LIMIT ?`
          )
          .all(
            effectiveAfterId,
            safeThroughId,
            safeThroughId,
            clearState?.cleared_through ?? null,
            clearState?.cleared_through ?? null,
            safeLimit
          );

        let inserted = 0;
        let skipped = 0;
        const clearedThrough = clearState ? Date.parse(clearState.cleared_through) : null;
        const insert = this.db.prepare(
          `INSERT INTO analytics_events (
             event_id, occurred_at, local_date, word_count,
             spoken_duration_ms, mode, provider, model, counter_version, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATETIME(?))
           ON CONFLICT(event_id) DO NOTHING`
        );
        const assignClientId = this.db.prepare(
          `UPDATE transcriptions SET client_transcription_id = ?
           WHERE id = ? AND (client_transcription_id IS NULL OR TRIM(client_transcription_id) = '')`
        );

        for (const row of rows) {
          const sourceText = row.raw_text?.trim() ? row.raw_text : row.text;
          const wordCount = countSpokenWords(sourceText);
          if (wordCount === 0) {
            skipped += 1;
            continue;
          }

          const createdAt = parseDbTimestamp(row.created_at);
          // Prefer an explicit occurrence timestamp over the row creation time.
          const occurredAt =
            (hasExplicitTimeZone(row.timestamp) ? parseDbTimestamp(row.timestamp) : null) ??
            createdAt;
          // Guessing a date would put an old dictation on today, inflating
          // today's counters and manufacturing a current streak out of a row
          // whose age we could not read. It stays out instead.
          if (!occurredAt) {
            skipped += 1;
            continue;
          }
          // Not a restatement of the query's clear filter: that one decides
          // eligibility from transcription.timestamp, while this guards the
          // instant actually chosen, which may be created_at. It also catches
          // what the SQL shape test cannot -- a bare YYYY-MM-DD reads as zoned
          // there, its day hyphen sitting six characters from the end.
          if (clearedThrough !== null && occurredAt.getTime() <= clearedThrough) {
            skipped += 1;
            continue;
          }

          const eventId = row.client_transcription_id?.trim() || randomUUID();
          if (!row.client_transcription_id?.trim()) assignClientId.run(eventId, row.id);
          const result = insert.run(
            eventId,
            occurredAt.toISOString(),
            localDateKey(occurredAt),
            wordCount,
            Number(row.audio_duration_ms) > 0 ? Number(row.audio_duration_ms) : null,
            inferHistoricalAnalyticsMode(row.provider),
            row.provider || null,
            row.model || null,
            ANALYTICS_HISTORICAL_COUNTER_VERSION,
            (createdAt ?? occurredAt).toISOString()
          );
          if (result.changes > 0) inserted += 1;
          else skipped += 1;
        }

        const complete = rows.length < safeLimit;
        const lastCandidateId =
          rows.length > 0 ? Number(rows[rows.length - 1].id) : effectiveAfterId;
        const nextCursor = complete && safeThroughId !== null ? safeThroughId : lastCandidateId;
        if (checkpoint) {
          this.db
            .prepare(
              `UPDATE analytics_history_backfill_state
               SET scanned_through_transcription_id = ?
               WHERE id = 1 AND version = ?`
            )
            .run(nextCursor, safeCheckpointVersion);
        }

        return {
          complete,
          nextCursor,
          scanned: rows.length,
          inserted,
          skipped,
        };
      })();
    } catch (error) {
      debugLogger.error(
        "Error backfilling analytics history",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  recordAnalyticsEvent({
    eventId,
    wordCount,
    occurredAt,
    localDate,
    spokenDurationMs = null,
    mode = "unknown",
    provider = null,
    model = null,
  }) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (wordCount === 0) return { success: true, ignored: true };
      // Clear History also covers recordings whose delayed write arrives afterward.
      const cleared = this.db
        .prepare(
          `SELECT 1 FROM analytics_device_clear_state
           WHERE id = 1 AND ? <= cleared_through`
        )
        .get(occurredAt);
      if (cleared) return { success: true, ignored: true };
      this.db
        .prepare(
          `INSERT INTO analytics_events (
             event_id, occurred_at, local_date, word_count,
             spoken_duration_ms, mode, provider, model, counter_version
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(event_id) DO UPDATE SET
             occurred_at = excluded.occurred_at,
             local_date = excluded.local_date,
             word_count = excluded.word_count,
             spoken_duration_ms = COALESCE(
               excluded.spoken_duration_ms,
               analytics_events.spoken_duration_ms
             ),
             mode = excluded.mode,
             provider = COALESCE(excluded.provider, analytics_events.provider),
             model = COALESCE(excluded.model, analytics_events.model),
             counter_version = excluded.counter_version WHERE analytics_events.deleted_at IS NULL`
        )
        .run(
          eventId,
          occurredAt,
          localDate,
          wordCount,
          Number(spokenDurationMs) > 0 ? Number(spokenDurationMs) : null,
          mode,
          provider,
          model,
          ANALYTICS_COUNTER_VERSION
        );
      return { success: true, eventId };
    } catch (error) {
      debugLogger.error("Error recording analytics event", { error: error.message }, "database");
      throw error;
    }
  }

  getAnalyticsSummary() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      // Grouped in SQL so the row count is bounded by distinct days rather than
      // by dictations; summarizeAnalyticsDays still owns every derived figure.
      const days = this.db
        .prepare(
          `SELECT local_date AS date,
                  SUM(word_count) AS words,
                  COUNT(*) AS dictations,
                  SUM(CASE WHEN spoken_duration_ms > 0 THEN spoken_duration_ms ELSE 0 END)
                    AS spokenDurationMs,
                  SUM(CASE WHEN spoken_duration_ms > 0 THEN word_count ELSE 0 END)
                    AS coveredWords
           FROM analytics_events
           WHERE deleted_at IS NULL
           GROUP BY local_date`
        )
        .all();
      return summarizeAnalyticsDays(days);
    } catch (error) {
      debugLogger.error("Error reading analytics summary", { error: error.message }, "database");
      throw error;
    }
  }

  getTranscriptions(limit = 50, { includeDiscarded = false } = {}) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const statusFilter = includeDiscarded ? "" : " AND status != 'discarded'";
      const stmt = this.db.prepare(
        `SELECT * FROM transcriptions WHERE deleted_at IS NULL${statusFilter} ORDER BY timestamp DESC LIMIT ?`
      );
      const transcriptions = stmt.all(limit);
      return transcriptions;
    } catch (error) {
      debugLogger.error("Error getting transcriptions", { error: error.message }, "database");
      throw error;
    }
  }

  clearTranscriptions() {
    return this.db.transaction(() => {
      const cleared = this.db.prepare("DELETE FROM transcriptions").run().changes;
      this.db.prepare("DELETE FROM analytics_events").run();
      this.db
        .prepare(
          "INSERT INTO analytics_device_clear_state (id, cleared_through) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET cleared_through = excluded.cleared_through"
        )
        .run(new Date().toISOString());
      return { success: true, cleared };
    })();
  }

  /** Purges transcriptions and their Insights counters older than the retention window.
   *  Returns the affected transcription ids so callers can drop the matching audio files.
   *  Runs even with no expired transcriptions: counters outlive tombstoned rows. */
  deleteTranscriptionsExpiredBefore(retentionDays) {
    if (!Number.isFinite(retentionDays) || retentionDays < 0)
      throw new Error("Invalid retention period");
    const cutoff = this.db
      .prepare("SELECT datetime('now', ?) AS cutoff")
      .get(`-${retentionDays} days`).cutoff;
    return this.db.transaction(() => {
      const ids = this.db
        .prepare("SELECT id FROM transcriptions WHERE created_at < ?")
        .all(cutoff)
        .map((row) => row.id);
      this.db.prepare("DELETE FROM transcriptions WHERE created_at < ?").run(cutoff);
      const analyticsPurged = this.db
        .prepare("DELETE FROM analytics_events WHERE created_at < ?")
        .run(cutoff).changes;
      return { ids, analyticsPurged };
    })();
  }

  deleteTranscription(id) {
    const result = this.db.prepare("DELETE FROM transcriptions WHERE id = ?").run(id);
    return { success: result.changes > 0, id };
  }

  updateTranscriptionAudio(id, { hasAudio, audioDurationMs, provider, model }) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare(
        "UPDATE transcriptions SET has_audio = ?, audio_duration_ms = ?, provider = ?, model = ? WHERE id = ?"
      );
      stmt.run(hasAudio, audioDurationMs, provider, model, id);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error updating transcription audio", { error: error.message }, "database");
      throw error;
    }
  }

  updateTranscriptionText(id, text, rawText) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare("UPDATE transcriptions SET text = ?, raw_text = ? WHERE id = ?");
      this.db.transaction(() => {
        const existing = this.db
          .prepare("SELECT text, raw_text FROM transcriptions WHERE id = ?")
          .get(id);
        if (existing && (existing.text !== text || existing.raw_text !== rawText)) {
          this._invalidateAnalyticsHistoryFromTranscription(id);
        }
        stmt.run(text, rawText, id);
      })();
      return { success: true };
    } catch (error) {
      debugLogger.error("Error updating transcription text", { error: error.message }, "database");
      throw error;
    }
  }

  updateTranscriptionStatus(id, status, errorMessage = null, errorCode = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare(
        "UPDATE transcriptions SET status = ?, error_message = ?, error_code = ? WHERE id = ?"
      );
      this.db.transaction(() => {
        const existing = this.db.prepare("SELECT status FROM transcriptions WHERE id = ?").get(id);
        if (existing && existing.status !== status && status === "completed") {
          this._invalidateAnalyticsHistoryFromTranscription(id);
        }
        stmt.run(status, errorMessage, errorCode, id);
      })();
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Error updating transcription status",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  getTranscriptionById(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare("SELECT * FROM transcriptions WHERE id = ?");
      return stmt.get(id) || null;
    } catch (error) {
      debugLogger.error("Error getting transcription by id", { error: error.message }, "database");
      throw error;
    }
  }

  clearAudioFlags(ids) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (!ids || ids.length === 0) return { success: true };
      const transaction = this.db.transaction((idList) => {
        const stmt = this.db.prepare("UPDATE transcriptions SET has_audio = 0 WHERE id = ?");
        for (const id of idList) {
          stmt.run(id);
        }
      });
      transaction(ids);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error clearing audio flags", { error: error.message }, "database");
      throw error;
    }
  }

  getDictionary() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const rows = this.db
        .prepare("SELECT word FROM custom_dictionary WHERE deleted_at IS NULL ORDER BY id ASC")
        .all();
      return rows.map((row) => row.word);
    } catch (error) {
      debugLogger.error("Error getting dictionary", { error: error.message }, "database");
      throw error;
    }
  }

  // Every dictionary mutation rule lives here once, so the whole-list and
  // delta write paths cannot drift apart.
  _dictionaryWriteStatements() {
    return {
      hardDelete: this.db.prepare("DELETE FROM custom_dictionary WHERE id = ?"),
      restore: this.db.prepare(
        "UPDATE custom_dictionary SET deleted_at = NULL, source = CASE WHEN source = 'learned' AND ? = 'manual' THEN 'manual' ELSE source END, word = ?, updated_at = datetime('now') WHERE id = ?"
      ),
      promoteSource: this.db.prepare(
        "UPDATE custom_dictionary SET word = ?, source = 'manual', updated_at = datetime('now') WHERE id = ? AND source = 'learned'"
      ),
      updateWord: this.db.prepare(
        "UPDATE custom_dictionary SET word = ?, updated_at = datetime('now') WHERE id = ? AND word != ?"
      ),
      // INSERT OR IGNORE in case a legacy case-variant row collides on the
      // case-sensitive UNIQUE(word) that the lowercase index didn't catch.
      insert: this.db.prepare(
        "INSERT OR IGNORE INTO custom_dictionary (word, source, client_dict_id, updated_at) VALUES (?, ?, ?, datetime('now'))"
      ),
    };
  }

  // Dedupe by lower(word), keeping the first occurrence's casing, so no caller
  // can present two spellings of the same word to a write loop.
  _normalizeDictionaryWords(words) {
    const byLower = new Map();
    for (const raw of Array.isArray(words) ? words : []) {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (!byLower.has(lower)) byLower.set(lower, trimmed);
    }
    return byLower;
  }

  _dictionaryRows() {
    const rows = this.db
      .prepare("SELECT id, word, source, deleted_at FROM custom_dictionary")
      .all();
    return { rows, byLower: new Map(rows.map((r) => [r.word.toLowerCase(), r])) };
  }

  // Returns true when the word became present, so callers can report how many
  // words they actually added rather than how many they asked for.
  _upsertDictionaryWord(stmts, word, existing, source) {
    if (!existing) {
      return stmts.insert.run(word, source, randomUUID()).changes > 0;
    }
    if (existing.deleted_at) {
      stmts.restore.run(source, word, existing.id);
      return true;
    }
    if (source === "manual" && existing.source === "learned") {
      stmts.promoteSource.run(word, existing.id);
    } else {
      stmts.updateWord.run(word, existing.id, word);
    }
    return false;
  }
  _deleteDictionaryRow(stmts, existing) {
    return !!existing && stmts.hardDelete.run(existing.id).changes > 0;
  }

  // Add and/or remove specific words, leaving every other row untouched.
  // Prefer this over setDictionary, which deletes whatever the caller omitted
  // and so lets a stale snapshot destroy the rest (#1295).
  // `source` tags additions ('manual' for user-typed, 'learned' for auto-learn).
  applyDictionaryChanges({ add = [], remove = [] } = {}, source = "manual") {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const additions = this._normalizeDictionaryWords(add);
      const removals = this._normalizeDictionaryWords(remove);
      // A word on both sides is a rename to itself; adding wins.
      for (const lower of additions.keys()) removals.delete(lower);
      if (additions.size === 0 && removals.size === 0) {
        return { success: true, added: 0, removed: 0 };
      }

      const { byLower } = this._dictionaryRows();
      const stmts = this._dictionaryWriteStatements();
      let added = 0;
      let removed = 0;

      this.db.transaction(() => {
        for (const lower of removals.keys()) {
          if (this._deleteDictionaryRow(stmts, byLower.get(lower))) removed += 1;
        }
        for (const [lower, word] of additions) {
          if (this._upsertDictionaryWord(stmts, word, byLower.get(lower), source)) added += 1;
        }
      })();

      return { success: true, added, removed };
    } catch (error) {
      debugLogger.error("Error applying dictionary changes", { error: error.message }, "database");
      throw error;
    }
  }

  // Replace the entire dictionary: anything absent from `words` is deleted.
  // Only for deliberate replace-everything callers (settings restore, clear
  // all, first write into an empty database). Everything else wants
  // applyDictionaryChanges.
  //
  setDictionary(words, sourceForNewWords = "manual") {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const incomingByLower = this._normalizeDictionaryWords(words);
      const { rows, byLower } = this._dictionaryRows();
      const stmts = this._dictionaryWriteStatements();

      this.db.transaction(() => {
        for (const existing of rows) {
          if (incomingByLower.has(existing.word.toLowerCase())) continue;
          this._deleteDictionaryRow(stmts, existing);
        }
        for (const [lower, word] of incomingByLower) {
          this._upsertDictionaryWord(stmts, word, byLower.get(lower), sourceForNewWords);
        }
      })();

      return { success: true };
    } catch (error) {
      debugLogger.error("Error setting dictionary", { error: error.message }, "database");
      throw error;
    }
  }

  getDictionaryEntryByClientId(clientDictId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return (
        this.db
          .prepare("SELECT * FROM custom_dictionary WHERE client_dict_id = ?")
          .get(clientDictId) || null
      );
    } catch (error) {
      debugLogger.error(
        "Error getting dictionary entry by client id",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  getSnippets() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      return this.db
        .prepare(
          "SELECT trigger, replacement FROM snippets WHERE deleted_at IS NULL ORDER BY id ASC"
        )
        .all();
    } catch (error) {
      debugLogger.error("Error getting snippets", { error: error.message }, "database");
      throw error;
    }
  }

  setSnippets(snippets) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }

      const incomingByLower = new Map();
      for (const raw of Array.isArray(snippets) ? snippets : []) {
        if (!raw || typeof raw !== "object") continue;
        const trigger = typeof raw.trigger === "string" ? raw.trigger.trim() : "";
        const replacement = typeof raw.replacement === "string" ? raw.replacement.trim() : "";
        if (!trigger || !replacement) continue;
        if (trigger.length > MAX_SNIPPET_TRIGGER_LENGTH) continue;
        const lower = trigger.toLowerCase();
        if (!incomingByLower.has(lower)) incomingByLower.set(lower, { trigger, replacement });
      }
      const cleaned = Array.from(incomingByLower.values());
      const incomingLower = new Set(incomingByLower.keys());

      const existingRows = this.db.prepare("SELECT * FROM snippets").all();
      const existingByLower = new Map();
      for (const row of existingRows) {
        const lower = row.trigger.toLowerCase();
        const current = existingByLower.get(lower);
        if (!current || (current.deleted_at && !row.deleted_at)) existingByLower.set(lower, row);
      }

      const hardDelete = this.db.prepare("DELETE FROM snippets WHERE id = ?");
      const restore = this.db.prepare(
        "UPDATE snippets SET deleted_at = NULL, trigger = ?, replacement = ?, updated_at = datetime('now') WHERE id = ?"
      );
      const updateActive = this.db.prepare(
        "UPDATE snippets SET trigger = ?, replacement = ?, updated_at = datetime('now') WHERE id = ? AND (trigger != ? OR replacement != ?)"
      );
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO snippets (trigger, replacement, client_snippet_id, updated_at) VALUES (?, ?, ?, datetime('now'))"
      );

      this.db.transaction(() => {
        for (const existing of existingRows) {
          if (incomingLower.has(existing.trigger.toLowerCase())) continue;
          if (existing.deleted_at) continue;
          hardDelete.run(existing.id);
        }

        for (const snippet of cleaned) {
          const existing = existingByLower.get(snippet.trigger.toLowerCase());
          if (existing) {
            if (existing.deleted_at) {
              restore.run(snippet.trigger, snippet.replacement, existing.id);
            } else {
              updateActive.run(
                snippet.trigger,
                snippet.replacement,
                existing.id,
                snippet.trigger,
                snippet.replacement
              );
            }
            continue;
          }
          insert.run(snippet.trigger, snippet.replacement, randomUUID());
        }
      })();

      return { success: true };
    } catch (error) {
      debugLogger.error("Error setting snippets", { error: error.message }, "database");
      throw error;
    }
  }

  saveNote(
    title,
    content,
    noteType = "personal",
    sourceFile = null,
    audioDuration = null,
    folderId = null,
    spaceId = null
  ) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      if (folderId) {
        // D2: a note's space always follows its folder's space.
        const folder = this._getPersonalFolder(folderId);
        if (!folder) throw new Error("Folder not found in the personal workspace");
        spaceId = folder.space_id;
      } else {
        if (spaceId == null) spaceId = this.getPrivateSpaceId();
        if (!this.getSpace(spaceId)) throw new Error("Space not found in the personal workspace");
        const defaultFolderName = noteType === "meeting" ? "Meetings" : "Personal";
        const folderScope = this._personalScopeCondition("folders");
        const defaultFolder = this.db
          .prepare(
            `SELECT id FROM folders
             WHERE name = ? AND is_default = 1 AND space_id = ? AND ${folderScope.sql}`
          )
          .get(defaultFolderName, spaceId, ...folderScope.params);
        folderId = defaultFolder?.id || null;
      }
      const clientNoteId = randomUUID();
      const stmt = this.db.prepare(
        "INSERT INTO notes (title, content, note_type, source_file, audio_duration_seconds, folder_id, space_id, client_note_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      const result = stmt.run(
        title,
        content,
        noteType,
        sourceFile,
        audioDuration,
        folderId,
        spaceId,
        clientNoteId
      );

      const fetchStmt = this.db.prepare("SELECT * FROM notes WHERE id = ?");
      const note = fetchStmt.get(result.lastInsertRowid);

      return { success: true, note };
    } catch (error) {
      debugLogger.error("Error saving note", { error: error.message }, "notes");
      throw error;
    }
  }

  /**
   * Bulk-insert externally imported notes (e.g. a Granola CSV export).
   * Unlike saveNote, rows carry their own client_note_id and original
   * created_at/updated_at; the UNIQUE client_note_id index makes re-imports
   * idempotent (duplicates are skipped, never overwritten).
   */
  importNotes(rows, { noteType = "meeting", folderName = "Imported" } = {}) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const spaceId = this.getPrivateSpaceId();

      let folderId = null;
      try {
        const folderScope = this._personalScopeCondition("folders");
        const existing = this.db
          .prepare(
            `SELECT id FROM folders
             WHERE name = ? AND space_id = ? AND deleted_at IS NULL AND ${folderScope.sql}`
          )
          .get(folderName, spaceId, ...folderScope.params);
        folderId = existing?.id ?? this.createFolder(folderName, spaceId)?.folder?.id ?? null;
      } catch (folderError) {
        debugLogger.error(
          "Import folder resolution failed; importing without a folder",
          { error: folderError.message },
          "notes"
        );
      }

      const insert = this.db.prepare(`
        INSERT INTO notes (client_note_id, title, content, note_type, source_file,
          folder_id, space_id, transcript, participants, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
          COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
        ON CONFLICT(client_note_id) DO NOTHING
      `);

      let imported = 0;
      let skipped = 0;
      const noteIds = [];
      const errors = [];
      this.db.transaction(() => {
        for (const row of rows) {
          try {
            const result = insert.run(
              row.clientNoteId,
              row.title,
              row.content,
              noteType,
              row.sourceFile,
              folderId,
              spaceId,
              row.transcript,
              row.participants,
              row.createdAt,
              row.createdAt
            );
            if (result.changes === 1) {
              imported++;
              noteIds.push(Number(result.lastInsertRowid));
            } else {
              skipped++;
            }
          } catch (rowError) {
            errors.push({ clientNoteId: row.clientNoteId, error: rowError.message });
          }
        }
      })();

      return { success: true, imported, skipped, folderId, noteIds, errors };
    } catch (error) {
      debugLogger.error("Error importing notes", { error: error.message }, "notes");
      throw error;
    }
  }

  getExistingClientNoteIds(clientNoteIds) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const existing = [];
      for (let i = 0; i < clientNoteIds.length; i += 500) {
        const chunk = clientNoteIds.slice(i, i + 500);
        const placeholders = chunk.map(() => "?").join(",");
        const found = this.db
          .prepare(`SELECT client_note_id FROM notes WHERE client_note_id IN (${placeholders})`)
          .all(...chunk);
        existing.push(...found.map((row) => row.client_note_id));
      }
      return existing;
    } catch (error) {
      debugLogger.error("Error checking client note ids", { error: error.message }, "notes");
      throw error;
    }
  }

  getNote(id) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const personalScope = this._personalScopeCondition("notes");
      const stmt = this.db.prepare(`SELECT * FROM notes WHERE id = ? AND ${personalScope.sql}`);
      return stmt.get(id, ...personalScope.params) || null;
    } catch (error) {
      debugLogger.error("Error getting note", { error: error.message }, "notes");
      throw error;
    }
  }

  getNotes(noteType = null, limit = 100, folderId = null, spaceId = null) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const conditions = ["deleted_at IS NULL"];
      const params = [];
      const personalScope = this._personalScopeCondition("notes");
      conditions.push(personalScope.sql);
      params.push(...personalScope.params);
      if (noteType) {
        conditions.push("note_type = ?");
        params.push(noteType);
      }
      if (folderId != null) {
        conditions.push("folder_id = ?");
        params.push(folderId);
      } else if (spaceId != null) {
        // spaceId without folderId lists a space's root: folderless notes only.
        conditions.push("folder_id IS NULL");
      }
      if (spaceId != null) {
        conditions.push("space_id = ?");
        params.push(spaceId);
      }
      const where = `WHERE ${conditions.join(" AND ")}`;
      const stmt = this.db.prepare(`SELECT * FROM notes ${where} ORDER BY updated_at DESC LIMIT ?`);
      params.push(limit);
      return stmt.all(...params);
    } catch (error) {
      debugLogger.error("Error getting notes", { error: error.message }, "notes");
      throw error;
    }
  }

  // Unlike getNotes(null, limit, null, spaceId) — which is root-only — this
  // lists every note in the space, foldered or not (space overview list).
  getNotesForSpace(spaceId, limit = 50) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const personalScope = this._personalScopeCondition("notes");
      return this.db
        .prepare(
          `SELECT * FROM notes
           WHERE space_id = ? AND deleted_at IS NULL AND ${personalScope.sql}
           ORDER BY updated_at DESC LIMIT ?`
        )
        .all(spaceId, ...personalScope.params, limit);
    } catch (error) {
      debugLogger.error("Error getting notes for space", { error: error.message }, "notes");
      throw error;
    }
  }

  getNoteIdsInFolder(folderId) {
    return this.getNoteIdsInScope(null, folderId);
  }

  // Authoritative scope membership for semantic-search candidates. Qdrant
  // payload writes are asynchronous/best-effort, so its filters are only an
  // optimization and must not decide which space or folder a hit belongs to.
  getNoteIdsInScope(spaceId = null, folderId = null, candidateIds = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (candidateIds && candidateIds.length === 0) return [];
      const conditions = ["deleted_at IS NULL"];
      const params = [];
      const personalScope = this._personalScopeCondition("notes");
      conditions.push(personalScope.sql);
      params.push(...personalScope.params);
      if (candidateIds) {
        conditions.push(`id IN (${candidateIds.map(() => "?").join(", ")})`);
        params.push(...candidateIds);
      }
      if (spaceId != null) {
        conditions.push("space_id = ?");
        params.push(spaceId);
      }
      if (folderId != null) {
        conditions.push("folder_id = ?");
        params.push(folderId);
      }
      return this.db
        .prepare(`SELECT id FROM notes WHERE ${conditions.join(" AND ")}`)
        .all(...params)
        .map((row) => row.id);
    } catch (error) {
      debugLogger.error("Error getting scoped note ids", { error: error.message }, "notes");
      throw error;
    }
  }

  updateNote(id, updates) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (!this.getNote(id)) return { success: false, error: "Note not found" };
      updates = { ...updates };
      if (updates.folder_id != null) {
        // D2: a note's space always follows its folder's space.
        const folder = this._getPersonalFolder(updates.folder_id);
        if (folder) updates = { ...updates, space_id: folder.space_id };
        else return { success: false, error: "Folder not found" };
      }
      if (updates.space_id !== undefined) {
        if (!this.getSpace(updates.space_id)) {
          return { success: false, error: "Space not found" };
        }
      }
      const allowedFields = [
        "title",
        "content",
        "enhanced_content",
        "enhancement_prompt",
        "enhanced_at_content_hash",
        "folder_id",
        "space_id",
        "transcript",
        "calendar_event_id",
        "participants",
        "diarization_enabled",
        "expected_speaker_count",
        "deleted_at",
        "client_note_id",
      ];
      const fields = [];
      const values = [];
      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key) && value !== undefined) {
          fields.push(`${key} = ?`);
          values.push(value);
        }
      }
      if (fields.length === 0) return { success: false };
      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      const personalScope = this._personalScopeCondition("notes");
      const stmt = this.db.prepare(
        `UPDATE notes SET ${fields.join(", ")} WHERE id = ? AND ${personalScope.sql}`
      );
      const result = stmt.run(...values, ...personalScope.params);
      if (result.changes === 0) return { success: false, error: "Note not found" };
      const fetchStmt = this.db.prepare("SELECT * FROM notes WHERE id = ?");
      const note = fetchStmt.get(id);
      return { success: true, note };
    } catch (error) {
      debugLogger.error("Error updating note", { error: error.message }, "notes");
      throw error;
    }
  }

  getFolders(spaceId = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const conditions = ["deleted_at IS NULL"];
      const params = [];
      const personalScope = this._personalScopeCondition("folders");
      conditions.push(personalScope.sql);
      params.push(...personalScope.params);
      if (spaceId != null) {
        conditions.push("space_id = ?");
        params.push(spaceId);
      }
      return this.db
        .prepare(
          `SELECT * FROM folders WHERE ${conditions.join(" AND ")} ORDER BY sort_order ASC, created_at ASC`
        )
        .all(...params);
    } catch (error) {
      debugLogger.error("Error getting folders", { error: error.message }, "notes");
      throw error;
    }
  }

  createFolder(name, spaceId = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const trimmed = (name || "").trim();
      if (!trimmed) return { success: false, error: "Folder name is required" };
      if (spaceId == null) spaceId = this.getPrivateSpaceId();
      if (!this.getSpace(spaceId)) {
        return { success: false, error: "Space not found" };
      }
      const personalScope = this._personalScopeCondition("folders");
      const existing = this.db
        .prepare(
          `SELECT id FROM folders
           WHERE name = ? AND space_id = ? AND ${FOLDER_NAME_TAKEN_FILTER}
             AND ${personalScope.sql}`
        )
        .get(trimmed, spaceId, ...personalScope.params);
      if (existing) return { success: false, error: "A folder with that name already exists" };
      const maxOrder = this.db
        .prepare("SELECT MAX(sort_order) as max_order FROM folders WHERE space_id = ?")
        .get(spaceId);
      const sortOrder = (maxOrder?.max_order ?? 0) + 1;
      const clientFolderId = randomUUID();
      const result = this.db
        .prepare(
          "INSERT INTO folders (name, sort_order, space_id, client_folder_id) VALUES (?, ?, ?, ?)"
        )
        .run(trimmed, sortOrder, spaceId, clientFolderId);
      const folder = this.db
        .prepare("SELECT * FROM folders WHERE id = ?")
        .get(result.lastInsertRowid);
      return { success: true, folder };
    } catch (error) {
      debugLogger.error("Error creating folder", { error: error.message }, "notes");
      throw error;
    }
  }

  deleteFolder(id) {
    const folder = this._getPersonalFolder(id);
    if (!folder) return { success: false, error: "Folder not found" };
    if (folder.is_default) return { success: false, error: "Cannot delete default folders" };
    return this.db.transaction(() => {
      const noteIds = this.db
        .prepare("SELECT id FROM notes WHERE folder_id = ?")
        .all(id)
        .map((row) => row.id);
      this._hardDeleteConversationsWhere(
        "folder_id = ? OR note_id IN (SELECT id FROM notes WHERE folder_id = ?)",
        [id, id]
      );
      this._deleteSpeakerRowsForNotes("SELECT id FROM notes WHERE folder_id = ?", id);
      this.db.prepare("DELETE FROM notes WHERE folder_id = ?").run(id);
      this.db.prepare("DELETE FROM folders WHERE id = ?").run(id);
      return { success: true, id, name: folder.name, noteIds, relocatedNotes: [] };
    })();
  }

  renameFolder(id, name) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const folder = this._getPersonalFolder(id);
      if (folder?.deleted_at) return { success: false, error: "Folder not found" };
      if (!folder) return { success: false, error: "Folder not found" };
      if (folder.is_default) return { success: false, error: "Cannot rename default folders" };
      const trimmed = (name || "").trim();
      if (!trimmed) return { success: false, error: "Folder name is required" };
      const folderScope = this._personalScopeCondition("folders");
      const existing = this.db
        .prepare(
          `SELECT id FROM folders
           WHERE name = ? AND space_id = ? AND id != ? AND ${FOLDER_NAME_TAKEN_FILTER}
             AND ${folderScope.sql}`
        )
        .get(trimmed, folder.space_id, id, ...folderScope.params);
      if (existing) return { success: false, error: "A folder with that name already exists" };
      this.db
        .prepare("UPDATE folders SET name = ?, updated_at = datetime('now') WHERE id = ?")
        .run(trimmed, id);
      const updated = this.db.prepare("SELECT * FROM folders WHERE id = ?").get(id);
      return { success: true, folder: updated };
    } catch (error) {
      debugLogger.error("Error renaming folder", { error: error.message }, "notes");
      throw error;
    }
  }

  moveFolderToSpace(id, spaceId) {
    const folder = this._getPersonalFolder(id);
    if (!folder || spaceId !== this.getPrivateSpaceId())
      return { success: false, error: "Personal workspace not found" };
    return { success: true, folder, notes: [] };
  }

  getFolderNoteCounts() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      // folder_id NULL rows are space-root notes; grouping by space_id too
      // attributes them per space so the tree shows true space totals.
      const personalScope = this._personalScopeCondition("notes");
      return this.db
        .prepare(
          `SELECT space_id, folder_id, COUNT(*) as count
           FROM notes
           WHERE deleted_at IS NULL AND ${personalScope.sql}
           GROUP BY space_id, folder_id`
        )
        .all(...personalScope.params);
    } catch (error) {
      debugLogger.error("Error getting folder note counts", { error: error.message }, "notes");
      throw error;
    }
  }

  getPrivateSpaceId() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT id FROM spaces WHERE kind = 'private'").get()?.id ?? null;
    } catch (error) {
      debugLogger.error("Error getting private space id", { error: error.message }, "spaces");
      throw error;
    }
  }

  getSpaces() {
    return this.db
      .prepare(
        "SELECT * FROM spaces WHERE kind = 'private' AND deleted_at IS NULL ORDER BY sort_order, id"
      )
      .all();
  }

  getSpace(id) {
    return (
      this.db
        .prepare("SELECT * FROM spaces WHERE id = ? AND kind = 'private' AND deleted_at IS NULL")
        .get(id) || null
    );
  }

  updateSpace(id, { name, emoji } = {}) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const space = this.getSpace(id);
      if (!space) return { success: false, error: "Space not found" };
      const fields = [];
      const values = [];
      if (name !== undefined) {
        if (space.kind === "private") {
          return { success: false, error: "Cannot rename the private space" };
        }
        const trimmed = (name || "").trim();
        if (!trimmed) return { success: false, error: "Space name is required" };
        fields.push("name = ?");
        values.push(trimmed);
      }
      if (emoji !== undefined) {
        fields.push("emoji = ?");
        values.push(emoji);
      }
      if (fields.length === 0) return { success: false };
      fields.push("", "updated_at = datetime('now')");
      values.push(id);
      this.db.prepare(`UPDATE spaces SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      const updated = this.db.prepare("SELECT * FROM spaces WHERE id = ?").get(id);
      return { success: true, space: updated };
    } catch (error) {
      debugLogger.error("Error updating space", { error: error.message }, "spaces");
      throw error;
    }
  }

  // Remove speaker rows explicitly for bulk note deletion.
  _deleteSpeakerRowsForNotes(noteIdSubquery, param) {
    this.db.prepare(`DELETE FROM speaker_mappings WHERE note_id IN (${noteIdSubquery})`).run(param);
    this.db
      .prepare(`DELETE FROM note_speaker_embeddings WHERE note_id IN (${noteIdSubquery})`)
      .run(param);
  }
  _hardDeleteConversationsWhere(filter, params) {
    this.db
      .prepare(
        `DELETE FROM agent_messages WHERE conversation_id IN (SELECT id FROM agent_conversations WHERE ${filter})`
      )
      .run(...params);
    this.db.prepare(`DELETE FROM agent_conversations WHERE ${filter}`).run(...params);
  }

  addPendingVectorPurge(spaceId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare("INSERT OR IGNORE INTO pending_vector_purges (space_id) VALUES (?)")
        .run(spaceId);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error adding pending vector purge", { error: error.message }, "spaces");
      throw error;
    }
  }

  getPendingVectorPurges() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT space_id FROM pending_vector_purges").all();
    } catch (error) {
      debugLogger.error("Error getting pending vector purges", { error: error.message }, "spaces");
      throw error;
    }
  }

  clearPendingVectorPurge(spaceId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db.prepare("DELETE FROM pending_vector_purges WHERE space_id = ?").run(spaceId);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error clearing pending vector purge", { error: error.message }, "spaces");
      throw error;
    }
  }

  getActions() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT * FROM actions ORDER BY sort_order ASC, created_at ASC").all();
    } catch (error) {
      debugLogger.error("Error getting actions", { error: error.message }, "notes");
      throw error;
    }
  }

  getAction(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT * FROM actions WHERE id = ?").get(id) || null;
    } catch (error) {
      debugLogger.error("Error getting action", { error: error.message }, "notes");
      throw error;
    }
  }

  createAction(name, description, prompt, icon = "sparkles") {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const trimmedName = (name || "").trim();
      const trimmedPrompt = (prompt || "").trim();
      if (!trimmedName) return { success: false, error: "Action name is required" };
      if (!trimmedPrompt) return { success: false, error: "Action prompt is required" };
      const maxOrder = this.db.prepare("SELECT MAX(sort_order) as max_order FROM actions").get();
      const sortOrder = (maxOrder?.max_order ?? 0) + 1;
      const result = this.db
        .prepare(
          "INSERT INTO actions (name, description, prompt, icon, sort_order) VALUES (?, ?, ?, ?, ?)"
        )
        .run(trimmedName, (description || "").trim(), trimmedPrompt, icon || "sparkles", sortOrder);
      const action = this.db
        .prepare("SELECT * FROM actions WHERE id = ?")
        .get(result.lastInsertRowid);
      return { success: true, action };
    } catch (error) {
      debugLogger.error("Error creating action", { error: error.message }, "notes");
      throw error;
    }
  }

  updateAction(id, updates) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const allowedFields = ["name", "description", "prompt", "icon", "sort_order"];
      const fields = [];
      const values = [];
      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key) && value !== undefined) {
          fields.push(`${key} = ?`);
          values.push(value);
        }
      }
      if (fields.length === 0) return { success: false };
      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      this.db.prepare(`UPDATE actions SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      const action = this.db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
      return { success: true, action };
    } catch (error) {
      debugLogger.error("Error updating action", { error: error.message }, "notes");
      throw error;
    }
  }

  deleteAction(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const action = this.db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
      if (!action) return { success: false, error: "Action not found" };
      if (action.is_builtin) return { success: false, error: "Cannot delete built-in actions" };
      this.db.prepare("DELETE FROM actions WHERE id = ?").run(id);
      return { success: true, id };
    } catch (error) {
      debugLogger.error("Error deleting action", { error: error.message }, "notes");
      throw error;
    }
  }

  deleteNote(id) {
    return this.db.transaction(() => {
      if (!this.getNote(id)) return { success: false, id };
      this._hardDeleteConversationsWhere("note_id = ?", [id]);
      this._deleteSpeakerRowsForNotes("SELECT id FROM notes WHERE id = ?", id);
      const result = this.db.prepare("DELETE FROM notes WHERE id = ?").run(id);
      return { success: result.changes > 0, id };
    })();
  }

  createAgentConversation(title = "Untitled", noteId = null, spaceId = null, folderId = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.transaction(() => {
        let note = null;
        let space = null;
        let folder = null;

        if (noteId != null) {
          note = this.getNote(noteId);
          if (!note || note.deleted_at) return null;
          if (note.folder_id != null) {
            const noteFolder = this._getPersonalFolder(note.folder_id);
            if (!noteFolder || noteFolder.deleted_at || noteFolder.space_id !== note.space_id) {
              return null;
            }
          }
        }
        if (spaceId != null) {
          space = this.getSpace(spaceId);
          if (!space) return null;
        }
        if (folderId != null) {
          folder = this._getPersonalFolder(folderId);
          if (!folder || folder.deleted_at || !this.getSpace(folder.space_id)) return null;
        }
        if (folder && spaceId != null && folder.space_id !== spaceId) return null;
        if (note && spaceId != null && note.space_id !== spaceId) return null;
        if (note && folderId != null && note.folder_id !== folderId) return null;

        const clientConversationId = randomUUID();
        const result = this.db
          .prepare(
            "INSERT INTO agent_conversations (title, note_id, space_id, folder_id, client_conversation_id) VALUES (?, ?, ?, ?, ?)"
          )
          .run(title, noteId, spaceId, folderId, clientConversationId);
        return this.db
          .prepare("SELECT * FROM agent_conversations WHERE id = ?")
          .get(result.lastInsertRowid);
      })();
    } catch (error) {
      debugLogger.error("Error creating agent conversation", { error: error.message }, "database");
      throw error;
    }
  }

  getConversationsForNote(noteId, limit = 20) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (!this.getNote(noteId)) return [];
      return this.db
        .prepare(
          `SELECT c.id, c.title, c.created_at, c.updated_at,
            COUNT(m.id) AS message_count
          FROM agent_conversations c
          LEFT JOIN agent_messages m ON m.conversation_id = c.id
          WHERE c.note_id = ? AND c.deleted_at IS NULL
          GROUP BY c.id
          ORDER BY c.updated_at DESC
          LIMIT ?`
        )
        .all(noteId, limit);
    } catch (error) {
      debugLogger.error(
        "Error getting conversations for note",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  // Space-root scope (folderId null) intentionally excludes folder-scoped
  // conversations — each container surfaces only its own chats.
  getConversationsForContainer(spaceId, folderId = null, limit = 20) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (folderId != null) {
        const folder = this._getPersonalFolder(folderId);
        if (!folder || folder.deleted_at) return [];
      } else if (!this.getSpace(spaceId)) {
        return [];
      }
      const scopeFilter =
        folderId != null ? "c.folder_id = ?" : "c.space_id = ? AND c.folder_id IS NULL";
      const params = folderId != null ? [folderId, limit] : [spaceId, limit];
      return this.db
        .prepare(
          `SELECT c.id, c.title, c.created_at, c.updated_at,
            COUNT(m.id) AS message_count
          FROM agent_conversations c
          LEFT JOIN agent_messages m ON m.conversation_id = c.id
          WHERE ${scopeFilter} AND c.deleted_at IS NULL
          GROUP BY c.id
          ORDER BY c.updated_at DESC
          LIMIT ?`
        )
        .all(...params);
    } catch (error) {
      debugLogger.error(
        "Error getting conversations for container",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  getAgentConversations(limit = 50) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          "SELECT * FROM agent_conversations WHERE deleted_at IS NULL AND space_id IS NULL AND folder_id IS NULL ORDER BY updated_at DESC LIMIT ?"
        )
        .all(limit);
    } catch (error) {
      debugLogger.error("Error getting agent conversations", { error: error.message }, "database");
      throw error;
    }
  }

  getAgentConversation(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const conversation = this.db
        .prepare("SELECT * FROM agent_conversations WHERE id = ? AND deleted_at IS NULL")
        .get(id);
      if (!conversation) return null;
      const messages = this.db
        .prepare("SELECT * FROM agent_messages WHERE conversation_id = ? ORDER BY created_at ASC")
        .all(id);
      return { ...conversation, messages };
    } catch (error) {
      debugLogger.error("Error getting agent conversation", { error: error.message }, "database");
      throw error;
    }
  }

  deleteAgentConversation(id) {
    const exists = this.getAgentConversation(id);
    if (!exists) return { success: false };
    this._hardDeleteConversationsWhere("id = ?", [id]);
    return { success: true };
  }

  updateAgentConversationTitle(id, title) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const result = this.db
        .prepare(
          "UPDATE agent_conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL"
        )
        .run(title, id);
      return { success: result.changes > 0 };
    } catch (error) {
      debugLogger.error(
        "Error updating agent conversation title",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  saveGoogleTokens(tokens) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare(
        `INSERT INTO google_calendar_tokens (google_email, access_token, refresh_token, expires_at, scope)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(google_email) DO UPDATE SET
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at,
           scope = excluded.scope,
           updated_at = CURRENT_TIMESTAMP`
      );
      stmt.run(
        tokens.google_email,
        tokens.access_token,
        tokens.refresh_token,
        tokens.expires_at,
        tokens.scope
      );
      return { success: true };
    } catch (error) {
      debugLogger.error("Error saving Google tokens", { error: error.message }, "gcal");
      throw error;
    }
  }

  getGoogleTokens() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT * FROM google_calendar_tokens LIMIT 1").get() || null;
    } catch (error) {
      debugLogger.error("Error getting Google tokens", { error: error.message }, "gcal");
      throw error;
    }
  }

  getGoogleTokensByEmail(email) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return (
        this.db.prepare("SELECT * FROM google_calendar_tokens WHERE google_email = ?").get(email) ||
        null
      );
    } catch (error) {
      debugLogger.error("Error getting Google tokens by email", { error: error.message }, "gcal");
      throw error;
    }
  }

  addAgentMessage(conversationId, role, content, metadata) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.transaction(() => {
        const conversation = this.db
          .prepare("SELECT id FROM agent_conversations WHERE id = ? AND deleted_at IS NULL")
          .get(conversationId);
        if (!conversation) return null;

        const metadataStr = metadata ? JSON.stringify(metadata) : null;
        const result = this.db
          .prepare(
            "INSERT INTO agent_messages (conversation_id, role, content, metadata) VALUES (?, ?, ?, ?)"
          )
          .run(conversationId, role, content, metadataStr);
        this.db
          .prepare(
            "UPDATE agent_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL"
          )
          .run(conversationId);
        return this.db
          .prepare("SELECT * FROM agent_messages WHERE id = ?")
          .get(result.lastInsertRowid);
      })();
    } catch (error) {
      debugLogger.error("Error adding agent message", { error: error.message }, "database");
      throw error;
    }
  }

  getAllGoogleTokens() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT * FROM google_calendar_tokens").all();
    } catch (error) {
      debugLogger.error("Error getting all Google tokens", { error: error.message }, "gcal");
      throw error;
    }
  }

  getGoogleAccounts() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare("SELECT google_email AS email FROM google_calendar_tokens ORDER BY created_at ASC")
        .all();
    } catch (error) {
      debugLogger.error("Error getting Google accounts", { error: error.message }, "gcal");
      throw error;
    }
  }

  removeGoogleAccount(email) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const transaction = this.db.transaction(() => {
        const calendarIds = this.db
          .prepare("SELECT id FROM google_calendars WHERE account_email = ?")
          .all(email)
          .map((c) => c.id);
        if (calendarIds.length > 0) {
          const placeholders = calendarIds.map(() => "?").join(", ");
          this.db
            .prepare(
              `DELETE FROM calendar_events WHERE provider = 'google' AND calendar_id IN (${placeholders})`
            )
            .run(...calendarIds);
        }
        this.db.prepare("DELETE FROM google_calendars WHERE account_email = ?").run(email);
        this.db.prepare("DELETE FROM google_calendar_tokens WHERE google_email = ?").run(email);
      });
      transaction();
      return { success: true };
    } catch (error) {
      debugLogger.error("Error removing Google account", { error: error.message }, "gcal");
      throw error;
    }
  }

  deleteGoogleTokens() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db.prepare("DELETE FROM google_calendar_tokens").run();
      return { success: true };
    } catch (error) {
      debugLogger.error("Error deleting Google tokens", { error: error.message }, "gcal");
      throw error;
    }
  }

  saveGoogleCalendars(calendars, accountEmail = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare(
        `INSERT INTO google_calendars (id, summary, description, background_color, account_email, is_primary)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           summary = excluded.summary,
           description = excluded.description,
           background_color = excluded.background_color,
           account_email = excluded.account_email,
           is_primary = excluded.is_primary`
      );
      for (const cal of calendars) {
        stmt.run(
          cal.id,
          cal.summary,
          cal.description || null,
          cal.background_color || null,
          accountEmail,
          cal.is_primary ? 1 : 0
        );
      }
      return { success: true };
    } catch (error) {
      debugLogger.error("Error saving Google calendars", { error: error.message }, "gcal");
      throw error;
    }
  }

  applyPrimaryOnlyToSelection(primaryOnly) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare(
          "UPDATE google_calendars SET is_selected = CASE WHEN ? = 1 THEN is_primary ELSE 1 END"
        )
        .run(primaryOnly ? 1 : 0);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error applying primary-only selection", { error: error.message }, "gcal");
      throw error;
    }
  }

  getGoogleCalendars(accountEmail = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (accountEmail) {
        return this.db
          .prepare("SELECT * FROM google_calendars WHERE account_email = ?")
          .all(accountEmail);
      }
      return this.db.prepare("SELECT * FROM google_calendars").all();
    } catch (error) {
      debugLogger.error("Error getting Google calendars", { error: error.message }, "gcal");
      throw error;
    }
  }

  updateCalendarSelection(calendarId, isSelected) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare("UPDATE google_calendars SET is_selected = ? WHERE id = ?")
        .run(isSelected ? 1 : 0, calendarId);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error updating calendar selection", { error: error.message }, "gcal");
      throw error;
    }
  }

  getAgentMessages(conversationId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare("SELECT * FROM agent_messages WHERE conversation_id = ? ORDER BY created_at ASC")
        .all(conversationId);
    } catch (error) {
      debugLogger.error("Error getting agent messages", { error: error.message }, "database");
      throw error;
    }
  }

  getSelectedCalendars(accountEmail = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (accountEmail) {
        return this.db
          .prepare("SELECT * FROM google_calendars WHERE is_selected = 1 AND account_email = ?")
          .all(accountEmail);
      }
      return this.db.prepare("SELECT * FROM google_calendars WHERE is_selected = 1").all();
    } catch (error) {
      debugLogger.error("Error getting selected calendars", { error: error.message }, "gcal");
      throw error;
    }
  }

  upsertCalendarEvents(events) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const transaction = this.db.transaction((eventList) => {
        const stmt = this.db.prepare(
          "INSERT OR REPLACE INTO calendar_events (id, calendar_id, provider, summary, start_time, end_time, is_all_day, status, availability_status, self_response_status, hangout_link, conference_data, organizer_email, attendees_count, attendees, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
        );
        for (const e of eventList) {
          stmt.run(
            e.id,
            e.calendar_id,
            e.provider || "google",
            e.summary || null,
            e.start_time,
            e.end_time,
            e.is_all_day ? 1 : 0,
            e.status || "confirmed",
            e.availability_status || "unknown",
            e.self_response_status || "unknown",
            e.hangout_link || null,
            e.conference_data || null,
            e.organizer_email || null,
            e.attendees_count || 0,
            e.attendees || null
          );
        }
      });
      transaction(events);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error upserting calendar events", { error: error.message }, "gcal");
      throw error;
    }
  }

  getActiveEvents() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          dedupedEventsQuery(
            "datetime(start_time) <= datetime('now') AND datetime(end_time) > datetime('now') AND is_all_day = 0 AND status IN ('confirmed', 'tentative')"
          )
        )
        .all()
        .map(stripDedupeColumn);
    } catch (error) {
      debugLogger.error("Error getting active events", { error: error.message }, "gcal");
      throw error;
    }
  }

  searchNotes(query, limit = 50, spaceId = null, folderId = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const ftsQuery = buildNoteSearchQuery(query);
      if (!ftsQuery) return [];
      const personalScope = this._personalScopeCondition("n");
      const params = [ftsQuery, ...personalScope.params];
      let scopeFilter = "";
      if (spaceId != null) {
        scopeFilter += " AND n.space_id = ?";
        params.push(spaceId);
      }
      if (folderId != null) {
        scopeFilter += " AND n.folder_id = ?";
        params.push(folderId);
      }
      params.push(limit);
      return this.db
        .prepare(
          `
        SELECT n.*
        FROM notes n
        JOIN notes_fts ON notes_fts.rowid = n.id
        WHERE notes_fts MATCH ? AND n.deleted_at IS NULL AND ${personalScope.sql}${scopeFilter}
        ORDER BY notes_fts.rank
        LIMIT ?
      `
        )
        .all(...params);
    } catch (error) {
      debugLogger.error("Error searching notes", { error: error.message }, "database");
      throw error;
    }
  }

  getUpcomingEvents(windowMinutes = 1440) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          dedupedEventsQuery(
            "((datetime(start_time) > datetime('now') AND datetime(start_time) <= datetime('now', '+' || ? || ' minutes')) OR (datetime(start_time) <= datetime('now') AND datetime(end_time) > datetime('now'))) AND is_all_day = 0 AND status IN ('confirmed', 'tentative')"
          )
        )
        .all(windowMinutes)
        .map(stripDedupeColumn);
    } catch (error) {
      debugLogger.error("Error getting upcoming events", { error: error.message }, "gcal");
      throw error;
    }
  }

  getCalendarEventsInRange(start, end, providers) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const rangeStart = Date.parse(start);
      const rangeEnd = Date.parse(end);
      if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
        throw new RangeError("Invalid calendar event range");
      }

      const selectedProviders = [...new Set(providers)].filter((provider) =>
        AVAILABILITY_PROVIDERS.has(provider)
      );
      if (selectedProviders.length === 0) return [];
      const placeholders = selectedProviders.map(() => "?").join(", ");
      const events = this.db
        .prepare(
          dedupedEventsQuery(
            `provider IN (${placeholders}) AND status IN ('confirmed', 'tentative') AND ${SELECTED_CALENDAR_EVENT_FILTER}`
          )
        )
        .all(...selectedProviders)
        .map(stripDedupeColumn);

      return events.filter((event) => {
        const isAllDay = event.is_all_day === true || event.is_all_day === 1;
        const eventStart = parseEventTime(event.start_time, isAllDay);
        const eventEnd = parseEventTime(event.end_time, isAllDay);
        return (
          Number.isFinite(eventStart) &&
          Number.isFinite(eventEnd) &&
          eventStart < rangeEnd &&
          eventEnd > rangeStart
        );
      });
    } catch (error) {
      debugLogger.error(
        "Error getting calendar events in range",
        { error: error.message },
        "calendar"
      );
      throw error;
    }
  }

  getCalendarEventById(eventId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT * FROM calendar_events WHERE id = ?").get(eventId) || null;
    } catch (error) {
      debugLogger.error("Error getting calendar event by id", { error: error.message }, "gcal");
      return null;
    }
  }

  getNoteByCalendarEventId(eventId, excludeNoteId = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const personalScope = this._personalScopeCondition("notes");
      const base = `SELECT * FROM notes
                    WHERE calendar_event_id = ? AND deleted_at IS NULL
                      AND ${personalScope.sql}`;
      if (excludeNoteId) {
        return (
          this.db
            .prepare(`${base} AND id != ? LIMIT 1`)
            .get(eventId, ...personalScope.params, excludeNoteId) || null
        );
      }
      return this.db.prepare(`${base} LIMIT 1`).get(eventId, ...personalScope.params) || null;
    } catch (error) {
      debugLogger.error(
        "Error getting note by calendar event id",
        { error: error.message },
        "notes"
      );
      return null;
    }
  }

  upsertContacts(contacts) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const transaction = this.db.transaction((list) => {
        const stmt = this.db.prepare(
          "INSERT INTO contacts (email, display_name, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(email) DO UPDATE SET display_name = COALESCE(excluded.display_name, contacts.display_name), updated_at = CURRENT_TIMESTAMP"
        );
        for (const c of list) {
          if (c.email) stmt.run(c.email.toLowerCase().trim(), c.displayName || null);
        }
      });
      transaction(contacts);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error upserting contacts", { error: error.message }, "database");
      throw error;
    }
  }

  searchContacts(query) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const pattern = `%${query || ""}%`;
      return this.db
        .prepare(
          "SELECT * FROM contacts WHERE email LIKE ? OR display_name LIKE ? ORDER BY display_name ASC, email ASC LIMIT 20"
        )
        .all(pattern, pattern);
    } catch (error) {
      debugLogger.error("Error searching contacts", { error: error.message }, "database");
      throw error;
    }
  }

  clearGoogleCalendarData() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const transaction = this.db.transaction(() => {
        this.db.prepare("DELETE FROM calendar_events WHERE provider = 'google'").run();
        this.db.prepare("DELETE FROM google_calendars").run();
        this.db.prepare("DELETE FROM google_calendar_tokens").run();
      });
      transaction();
      return { success: true };
    } catch (error) {
      debugLogger.error("Error clearing calendar data", { error: error.message }, "gcal");
      throw error;
    }
  }

  updateCalendarSyncToken(calendarId, syncToken, expiresAt) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare(
          "UPDATE google_calendars SET sync_token = ?, sync_token_expires_at = ? WHERE id = ?"
        )
        .run(syncToken, expiresAt, calendarId);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error updating sync token", { error: error.message }, "gcal");
      throw error;
    }
  }

  removeCalendarEvents(eventIds) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const placeholders = eventIds.map(() => "?").join(", ");
      this.db.prepare(`DELETE FROM calendar_events WHERE id IN (${placeholders})`).run(...eventIds);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error removing calendar events", { error: error.message }, "gcal");
      throw error;
    }
  }

  // A full (non-incremental) REST sync is authoritative for its calendar's
  // window: rows the provider no longer returns were deleted while no valid
  // sync token existed (e.g. the app was offline past the token TTL), so they
  // would otherwise linger and fire reminders for cancelled meetings. Rows
  // referenced by meeting notes are kept so notes retain calendar metadata.
  removeStaleCalendarEvents(provider, calendarId, freshEventIds) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const placeholders = freshEventIds.map(() => "?").join(", ");
      const freshFilter = freshEventIds.length > 0 ? `AND id NOT IN (${placeholders})` : "";
      this.db
        .prepare(
          `DELETE FROM calendar_events
           WHERE provider = ? AND calendar_id = ? ${freshFilter}
             AND id NOT IN (
               SELECT calendar_event_id
               FROM notes
               WHERE calendar_event_id IS NOT NULL AND deleted_at IS NULL
             )`
        )
        .run(provider, calendarId, ...freshEventIds);
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Error removing stale calendar events",
        { error: error.message },
        provider === "microsoft" ? "mcal" : "gcal"
      );
      throw error;
    }
  }

  removeEventsFromDeselectedCalendars(provider) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const calendarsTable = CALENDARS_TABLE_BY_PROVIDER[provider];
      if (!calendarsTable) throw new Error(`Unknown calendar provider: ${provider}`);
      this.db
        .prepare(
          `DELETE FROM calendar_events WHERE provider = ? AND calendar_id NOT IN (SELECT id FROM ${calendarsTable} WHERE is_selected = 1)`
        )
        .run(provider);
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Error removing events from deselected calendars",
        { error: error.message },
        provider === "microsoft" ? "mcal" : "gcal"
      );
      throw error;
    }
  }

  saveMicrosoftTokens(tokens) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare(
        `INSERT INTO microsoft_calendar_tokens (microsoft_email, access_token, refresh_token, expires_at, scope)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(microsoft_email) DO UPDATE SET
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at,
           scope = excluded.scope,
           updated_at = CURRENT_TIMESTAMP`
      );
      stmt.run(
        tokens.microsoft_email,
        tokens.access_token,
        tokens.refresh_token,
        tokens.expires_at,
        tokens.scope
      );
      return { success: true };
    } catch (error) {
      debugLogger.error("Error saving Microsoft tokens", { error: error.message }, "mcal");
      throw error;
    }
  }

  getMicrosoftTokensByEmail(email) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return (
        this.db
          .prepare("SELECT * FROM microsoft_calendar_tokens WHERE microsoft_email = ?")
          .get(email) || null
      );
    } catch (error) {
      debugLogger.error(
        "Error getting Microsoft tokens by email",
        { error: error.message },
        "mcal"
      );
      throw error;
    }
  }

  getMicrosoftAccounts() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          "SELECT microsoft_email AS email FROM microsoft_calendar_tokens ORDER BY created_at ASC"
        )
        .all();
    } catch (error) {
      debugLogger.error("Error getting Microsoft accounts", { error: error.message }, "mcal");
      throw error;
    }
  }

  removeMicrosoftAccount(email) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const transaction = this.db.transaction(() => {
        const calendarIds = this.db
          .prepare("SELECT id FROM microsoft_calendars WHERE account_email = ?")
          .all(email)
          .map((c) => c.id);
        if (calendarIds.length > 0) {
          const placeholders = calendarIds.map(() => "?").join(", ");
          this.db
            .prepare(
              `DELETE FROM calendar_events WHERE provider = 'microsoft' AND calendar_id IN (${placeholders})`
            )
            .run(...calendarIds);
        }
        this.db.prepare("DELETE FROM microsoft_calendars WHERE account_email = ?").run(email);
        this.db
          .prepare("DELETE FROM microsoft_calendar_tokens WHERE microsoft_email = ?")
          .run(email);
      });
      transaction();
      return { success: true };
    } catch (error) {
      debugLogger.error("Error removing Microsoft account", { error: error.message }, "mcal");
      throw error;
    }
  }

  saveMicrosoftCalendars(calendars, accountEmail) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare(
        `INSERT INTO microsoft_calendars (id, summary, background_color, account_email, is_primary)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           summary = excluded.summary,
           background_color = excluded.background_color,
           account_email = excluded.account_email,
           is_primary = excluded.is_primary`
      );
      for (const cal of calendars) {
        stmt.run(
          cal.id,
          cal.summary,
          cal.background_color || null,
          accountEmail,
          cal.is_primary ? 1 : 0
        );
      }
      return { success: true };
    } catch (error) {
      debugLogger.error("Error saving Microsoft calendars", { error: error.message }, "mcal");
      throw error;
    }
  }

  applyMicrosoftPrimaryOnlyToSelection(primaryOnly) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare(
          "UPDATE microsoft_calendars SET is_selected = CASE WHEN ? = 1 THEN is_primary ELSE 1 END"
        )
        .run(primaryOnly ? 1 : 0);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error applying primary-only selection", { error: error.message }, "mcal");
      throw error;
    }
  }

  getSelectedMicrosoftCalendars() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT * FROM microsoft_calendars WHERE is_selected = 1").all();
    } catch (error) {
      debugLogger.error(
        "Error getting selected Microsoft calendars",
        { error: error.message },
        "mcal"
      );
      throw error;
    }
  }

  updateMicrosoftCalendarSyncToken(calendarId, syncToken, expiresAt) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare(
          "UPDATE microsoft_calendars SET sync_token = ?, sync_token_expires_at = ? WHERE id = ?"
        )
        .run(syncToken, expiresAt, calendarId);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error updating sync token", { error: error.message }, "mcal");
      throw error;
    }
  }

  clearMicrosoftCalendarData() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const transaction = this.db.transaction(() => {
        this.db.prepare("DELETE FROM calendar_events WHERE provider = 'microsoft'").run();
        this.db.prepare("DELETE FROM microsoft_calendars").run();
        this.db.prepare("DELETE FROM microsoft_calendar_tokens").run();
      });
      transaction();
      return { success: true };
    } catch (error) {
      debugLogger.error("Error clearing calendar data", { error: error.message }, "mcal");
      throw error;
    }
  }

  saveAppleCalendars(calendars) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const transaction = this.db.transaction((list) => {
        // Snapshots are complete: prune calendars removed from Calendar.app,
        // upsert the rest so created_at survives.
        if (list.length === 0) {
          this.db.prepare("DELETE FROM apple_calendars").run();
          return;
        }
        const placeholders = list.map(() => "?").join(", ");
        this.db
          .prepare(`DELETE FROM apple_calendars WHERE id NOT IN (${placeholders})`)
          .run(...list.map((cal) => cal.id));

        const stmt = this.db.prepare(
          `INSERT INTO apple_calendars (id, title, color, source_name)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             color = excluded.color,
             source_name = excluded.source_name`
        );
        for (const cal of list) {
          stmt.run(cal.id, cal.title, cal.color || null, cal.source_name || null);
        }
      });
      transaction(calendars);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error saving Apple calendars", { error: error.message }, "acal");
      throw error;
    }
  }

  getAppleCalendars() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT * FROM apple_calendars").all();
    } catch (error) {
      debugLogger.error("Error getting Apple calendars", { error: error.message }, "acal");
      throw error;
    }
  }

  // Snapshots cover the full current/future window, so missing unreferenced
  // events can be removed while note-linked history is retained.
  replaceAppleCalendarEvents(events) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const transaction = this.db.transaction((list) => {
        // The helper snapshot only contains current/future events. Keep past or
        // rescheduled rows that are still referenced by meeting notes so those
        // notes retain their calendar metadata.
        this.db
          .prepare(
            `DELETE FROM calendar_events
             WHERE provider = 'apple'
               AND id NOT IN (
                 SELECT calendar_event_id
                 FROM notes
                 WHERE calendar_event_id IS NOT NULL AND deleted_at IS NULL
               )`
          )
          .run();
        if (list.length > 0) this.upsertCalendarEvents(list);
      });
      transaction(events);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error replacing Apple calendar events", { error: error.message }, "acal");
      throw error;
    }
  }

  clearAppleCalendarData() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const transaction = this.db.transaction(() => {
        this.db.prepare("DELETE FROM calendar_events WHERE provider = 'apple'").run();
        this.db.prepare("DELETE FROM apple_calendars").run();
      });
      transaction();
      return { success: true };
    } catch (error) {
      debugLogger.error("Error clearing Apple calendar data", { error: error.message }, "acal");
      throw error;
    }
  }

  getMeetingsFolder(spaceId = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const personalScope = this._personalScopeCondition("folders");
      return (
        this.db
          .prepare(
            `SELECT id FROM folders
             WHERE name = 'Meetings' AND is_default = 1 AND space_id = ?
               AND ${personalScope.sql}`
          )
          .get(spaceId ?? this.getPrivateSpaceId(), ...personalScope.params) || null
      );
    } catch (error) {
      debugLogger.error("Error getting meetings folder", { error: error.message }, "gcal");
      throw error;
    }
  }

  cleanup() {
    try {
      if (this.db) {
        try {
          this.db.close();
        } catch (closeError) {
          debugLogger.error("Error closing database", { error: closeError.message }, "database");
        }
        this.db = null;
      }
      const dbPath = path.join(
        app.getPath("userData"),
        process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db"
      );
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    } catch (error) {
      debugLogger.error("Error deleting database file", { error: error.message }, "database");
    }
  }
  getAgentConversationsWithPreview(limit = 50, offset = 0, includeArchived = false) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const archiveFilter = includeArchived
        ? "WHERE c.archived_at IS NOT NULL AND c.deleted_at IS NULL AND c.space_id IS NULL AND c.folder_id IS NULL"
        : "WHERE c.archived_at IS NULL AND c.deleted_at IS NULL AND c.space_id IS NULL AND c.folder_id IS NULL";
      return this.db
        .prepare(
          `SELECT c.id, c.title, c.created_at, c.updated_at, c.archived_at,
            COUNT(m.id) AS message_count,
            (SELECT content FROM agent_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
            (SELECT role FROM agent_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_role
          FROM agent_conversations c
          LEFT JOIN agent_messages m ON m.conversation_id = c.id
          ${archiveFilter}
          GROUP BY c.id
          ORDER BY c.updated_at DESC
          LIMIT ? OFFSET ?`
        )
        .all(limit, offset);
    } catch (error) {
      debugLogger.error(
        "Error getting agent conversations with preview",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  searchAgentConversations(query, limit = 20) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const pattern = `%${query}%`;
      return this.db
        .prepare(
          `SELECT DISTINCT c.id, c.title, c.created_at, c.updated_at, c.archived_at,
            COUNT(m.id) AS message_count,
            (SELECT content FROM agent_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
            (SELECT role FROM agent_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_role
          FROM agent_conversations c
          LEFT JOIN agent_messages m ON m.conversation_id = c.id
          LEFT JOIN agent_messages ms ON ms.conversation_id = c.id
          WHERE c.archived_at IS NULL AND c.deleted_at IS NULL
            AND c.space_id IS NULL AND c.folder_id IS NULL
            AND (c.title LIKE ? OR ms.content LIKE ?)
          GROUP BY c.id
          ORDER BY c.updated_at DESC
          LIMIT ?`
        )
        .all(pattern, pattern, limit);
    } catch (error) {
      debugLogger.error(
        "Error searching agent conversations",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  archiveAgentConversation(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const result = this.db
        .prepare(
          "UPDATE agent_conversations SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL"
        )
        .run(id);
      return { success: result.changes > 0 };
    } catch (error) {
      debugLogger.error("Error archiving agent conversation", { error: error.message }, "database");
      throw error;
    }
  }

  unarchiveAgentConversation(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const result = this.db
        .prepare(
          "UPDATE agent_conversations SET archived_at = NULL WHERE id = ? AND deleted_at IS NULL"
        )
        .run(id);
      return { success: result.changes > 0 };
    } catch (error) {
      debugLogger.error(
        "Error unarchiving agent conversation",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  _normalizeEmail(email) {
    const trimmed = (email || "").trim().toLowerCase();
    return trimmed || null;
  }

  _findProfileByEmail(email) {
    const normalized = this._normalizeEmail(email);
    if (!normalized) return null;
    return this.db.prepare("SELECT * FROM speaker_profiles WHERE lower(email) = ?").get(normalized);
  }

  upsertSpeakerProfile(name, email, embeddingBuffer, profileId = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const normalizedEmail = this._normalizeEmail(email);
      let existing = profileId
        ? this.db.prepare("SELECT * FROM speaker_profiles WHERE id = ?").get(profileId)
        : null;
      if (!existing && normalizedEmail) {
        existing = this._findProfileByEmail(normalizedEmail);
      }
      if (!existing) {
        existing = this.db
          .prepare("SELECT * FROM speaker_profiles WHERE display_name = ?")
          .get(name);
      }
      if (existing) {
        const stored = new Float32Array(
          existing.embedding.buffer,
          existing.embedding.byteOffset,
          existing.embedding.byteLength / 4
        );
        const incoming = new Float32Array(
          embeddingBuffer.buffer,
          embeddingBuffer.byteOffset,
          embeddingBuffer.byteLength / 4
        );
        const updated = new Float32Array(stored.length);
        for (let i = 0; i < stored.length; i++) {
          updated[i] = 0.3 * incoming[i] + 0.7 * stored[i];
        }
        const updatedBuf = Buffer.from(updated.buffer);
        const finalEmail = normalizedEmail || existing.email || null;
        this.db
          .prepare(
            "UPDATE speaker_profiles SET display_name = ?, email = ?, embedding = ?, sample_count = sample_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          )
          .run(name, finalEmail, updatedBuf, existing.id);
        const resolved = this.db
          .prepare("SELECT * FROM speaker_profiles WHERE id = ?")
          .get(existing.id);
        if (normalizedEmail) {
          const collision = this.db
            .prepare("SELECT * FROM speaker_profiles WHERE lower(email) = ? AND id != ?")
            .get(normalizedEmail, existing.id);
          if (collision) {
            return this.mergeSpeakerProfiles(resolved, collision);
          }
        }
        return resolved;
      }
      const result = this.db
        .prepare("INSERT INTO speaker_profiles (display_name, email, embedding) VALUES (?, ?, ?)")
        .run(name, normalizedEmail, embeddingBuffer);
      return this.db
        .prepare("SELECT * FROM speaker_profiles WHERE id = ?")
        .get(result.lastInsertRowid);
    } catch (error) {
      debugLogger.error("Error upserting speaker profile", { error: error.message }, "database");
      throw error;
    }
  }

  attachEmailToProfile(profileId, email) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const normalizedEmail = this._normalizeEmail(email);
      const profile = this.db.prepare("SELECT * FROM speaker_profiles WHERE id = ?").get(profileId);
      if (!profile) throw new Error(`Speaker profile ${profileId} not found`);

      if (!normalizedEmail) {
        this.db
          .prepare(
            "UPDATE speaker_profiles SET email = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          )
          .run(profileId);
        return this.db.prepare("SELECT * FROM speaker_profiles WHERE id = ?").get(profileId);
      }

      const collision = this._findProfileByEmail(normalizedEmail);
      if (collision && collision.id !== profileId) {
        return this.mergeSpeakerProfiles(collision, profile);
      }

      this.db
        .prepare(
          "UPDATE speaker_profiles SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .run(normalizedEmail, profileId);
      return this.db.prepare("SELECT * FROM speaker_profiles WHERE id = ?").get(profileId);
    } catch (error) {
      debugLogger.error(
        "Error attaching email to speaker profile",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  mergeSpeakerProfiles(a, b) {
    const winner = (a.sample_count || 0) >= (b.sample_count || 0) ? a : b;
    const loser = winner === a ? b : a;

    const winnerEmb = new Float32Array(
      winner.embedding.buffer,
      winner.embedding.byteOffset,
      winner.embedding.byteLength / 4
    );
    const loserEmb = new Float32Array(
      loser.embedding.buffer,
      loser.embedding.byteOffset,
      loser.embedding.byteLength / 4
    );
    const wSamples = winner.sample_count || 1;
    const lSamples = loser.sample_count || 1;
    const total = wSamples + lSamples;
    const blended = new Float32Array(winnerEmb.length);
    for (let i = 0; i < winnerEmb.length; i++) {
      blended[i] = (winnerEmb[i] * wSamples + loserEmb[i] * lSamples) / total;
    }

    const finalEmail = winner.email || loser.email || null;
    const finalName = winner.display_name || loser.display_name;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE speaker_profiles SET display_name = ?, email = ?, embedding = ?, sample_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .run(finalName, finalEmail, Buffer.from(blended.buffer), total, winner.id);
      this.db
        .prepare(
          "UPDATE speaker_mappings SET profile_id = ?, display_name = ? WHERE profile_id = ?"
        )
        .run(winner.id, finalName, loser.id);
      this.db.prepare("DELETE FROM speaker_profiles WHERE id = ?").run(loser.id);
    });
    tx();

    return this.db.prepare("SELECT * FROM speaker_profiles WHERE id = ?").get(winner.id);
  }

  getSpeakerProfiles(includeEmbedding = false) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const query = includeEmbedding
        ? "SELECT * FROM speaker_profiles"
        : `SELECT id, display_name, email, sample_count, created_at, updated_at
           FROM speaker_profiles`;
      return this.db.prepare(query).all();
    } catch (error) {
      debugLogger.error("Error getting speaker profiles", { error: error.message }, "database");
      throw error;
    }
  }

  setSpeakerMapping(noteId, speakerId, profileId, displayName) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (!this.getNote(noteId)) return { success: false, error: "Note not found" };
      this.db
        .prepare(
          "INSERT OR REPLACE INTO speaker_mappings (note_id, speaker_id, profile_id, display_name) VALUES (?, ?, ?, ?)"
        )
        .run(noteId, speakerId, profileId, displayName);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error setting speaker mapping", { error: error.message }, "database");
      throw error;
    }
  }

  getSpeakerMappings(noteId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (!this.getNote(noteId)) return [];
      return this.db.prepare("SELECT * FROM speaker_mappings WHERE note_id = ?").all(noteId);
    } catch (error) {
      debugLogger.error("Error getting speaker mappings", { error: error.message }, "database");
      throw error;
    }
  }

  saveNoteSpeakerEmbeddings(noteId, embeddings) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (!this.getNote(noteId)) return { success: false, error: "Note not found" };
      const transaction = this.db.transaction((entries) => {
        const stmt = this.db.prepare(
          "INSERT OR REPLACE INTO note_speaker_embeddings (note_id, speaker_id, embedding) VALUES (?, ?, ?)"
        );
        for (const [speakerId, buffer] of entries) {
          stmt.run(noteId, speakerId, buffer);
        }
      });
      transaction(Object.entries(embeddings));
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Error saving note speaker embeddings",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  getNoteSpeakerEmbeddings(noteId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (!this.getNote(noteId)) return [];
      return this.db.prepare("SELECT * FROM note_speaker_embeddings WHERE note_id = ?").all(noteId);
    } catch (error) {
      debugLogger.error(
        "Error getting note speaker embeddings",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  getNoteByClientId(clientNoteId) {
    return (
      this.db
        .prepare("SELECT * FROM notes WHERE client_note_id = ? AND deleted_at IS NULL")
        .get(clientNoteId) || null
    );
  }

  getFolderByClientId(clientFolderId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const personalScope = this._personalScopeCondition("folders");
      return (
        this.db
          .prepare(`SELECT * FROM folders WHERE client_folder_id = ? AND ${personalScope.sql}`)
          .get(clientFolderId, ...personalScope.params) || null
      );
    } catch (error) {
      debugLogger.error("Error getting folder by client id", { error: error.message }, "database");
      throw error;
    }
  }

  getFolderIdMap() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const personalScope = this._personalScopeCondition("folders");
      return this.db
        .prepare(`SELECT * FROM folders WHERE deleted_at IS NULL AND ${personalScope.sql}`)
        .all(...personalScope.params);
    } catch (error) {
      debugLogger.error("Error getting folder id map", { error: error.message }, "database");
      throw error;
    }
  }

  getConversationByClientId(clientId) {
    return (
      this.db
        .prepare(
          "SELECT * FROM agent_conversations WHERE client_conversation_id = ? AND deleted_at IS NULL"
        )
        .get(clientId) || null
    );
  }

  getTranscriptionByClientId(clientId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return (
        this.db
          .prepare("SELECT * FROM transcriptions WHERE client_transcription_id = ?")
          .get(clientId) || null
      );
    } catch (error) {
      debugLogger.error(
        "Error getting transcription by client id",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  getNotesWithUnmappedSpeakers() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const personalScope = this._personalScopeCondition("notes");
      return this.db
        .prepare(
          `SELECT DISTINCT nse.note_id
          FROM note_speaker_embeddings nse
          JOIN notes ON notes.id = nse.note_id
          LEFT JOIN speaker_mappings sm ON nse.note_id = sm.note_id AND nse.speaker_id = sm.speaker_id
          WHERE sm.note_id IS NULL AND ${personalScope.sql}`
        )
        .all(...personalScope.params)
        .map((row) => row.note_id);
    } catch (error) {
      debugLogger.error(
        "Error getting notes with unmapped speakers",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  removeSpeakerMapping(noteId, speakerId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (!this.getNote(noteId)) return { success: false };
      this.db
        .prepare("DELETE FROM speaker_mappings WHERE note_id = ? AND speaker_id = ?")
        .run(noteId, speakerId);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error removing speaker mapping", { error: error.message }, "database");
      throw error;
    }
  }
}

module.exports = DatabaseManager;
