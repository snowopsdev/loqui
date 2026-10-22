const { EventEmitter } = require("node:events");
const { EGRESS_TASKS } = require("./egressPolicy");

const MAX_ROWS = 100000;
const MEMORY_LIMIT = 500;
const CAP_CHECK_EVERY = 500;
const MAX_TRAIL = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const OUTCOMES = new Set(["ok", "error", "blocked", "cancelled"]);
const KINDS = ["request", "stream", "connection", "session", "operation"];
const ERROR_CLASSES = [
  "SEALED_MODE",
  "ABORTED",
  "TIMEOUT",
  "DNS",
  "CONNECTION",
  "TLS",
  "HTTP_4XX",
  "HTTP_5XX",
  "PROTOCOL",
  "BODY_CANCELLED",
  "DOWNLOAD_CANCELLED",
  "UPDATE_FAILED",
  "CHILD_EXIT",
  "OTHER",
];
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/;
const BARE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?))*$/;

function modelId(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!MODEL_ID.test(v) || v.includes("//") || /:[^/@]*@/.test(v) || /[A-Za-z0-9_]{32,}/.test(v))
    return null;
  return v;
}

function errorClass(value) {
  return value == null ? null : ERROR_CLASSES.includes(value) ? value : "OTHER";
}

const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : null);

function bareHost(value) {
  const host = typeof value === "string" ? value.trim().toLowerCase() : "";
  const ipv4 = (candidate) => {
    const parts = candidate.split(".");
    return (
      parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    );
  };
  const ipv6 = (candidate) => {
    if (!candidate.includes(":") || candidate.includes(":::")) return false;
    const halves = candidate.split("::");
    if (halves.length > 2) return false;
    const parts = candidate.split(":").filter(Boolean);
    let units = 0;
    for (const part of parts) {
      if (part.includes(".")) {
        if (!ipv4(part)) return false;
        units += 2;
      } else if (/^[a-f0-9]{1,4}$/.test(part)) units += 1;
      else return false;
    }
    return halves.length === 2 ? units < 8 : units === 8;
  };
  const isNumericDotted = /^\d+(?:\.\d+){3}$/.test(host);
  const valid =
    host === "unknown" ||
    (host.length <= 253 &&
      ((isNumericDotted && ipv4(host)) ||
        ipv6(host) ||
        (!isNumericDotted && BARE_HOST.test(host))));
  if (!valid) throw new TypeError("Egress host must be a bare hostname");
  return host;
}

function safePersistError(error) {
  const code =
    error && typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code)
      ? error.code
      : null;
  return code || "PERSISTENCE_ERROR";
}

function toPublic(row) {
  return {
    id: row.id,
    ts: row.ts,
    endedAt: row.ended_at,
    task: row.task,
    host: row.host,
    hosts: row.hosts.split(","),
    bytesOut: row.bytes_out,
    bytesIn: row.bytes_in,
    outcome: row.outcome,
    status: row.status,
    errorClass: row.error_class,
    model: row.model,
    attributed: row.attributed === 1,
    opaque: row.opaque === 1,
    kind: row.kind,
    operationId: row.operation_id,
  };
}

class FlightRecorder extends EventEmitter {
  constructor({ db = null, now = Date.now } = {}) {
    super();
    this.now = now;
    this.db = null;
    this.insert = null;
    this.mode = "pending";
    this.memory = [];
    this.nextMemoryId = -1;
    this.writesSinceCap = 0;
    this._persistError = null;
    if (db) this.attachDatabase(db);
  }

  get persistError() {
    return this._persistError;
  }

  set persistError(value) {
    this._persistError = value;
  }

  attachDatabase(db) {
    if (!db || typeof db.prepare !== "function")
      throw new TypeError("A database handle is required");
    const insert = db.prepare(
      `INSERT INTO egress_events (ts, ended_at, task, host, hosts, bytes_out, bytes_in, outcome, status, error_class, model, attributed, opaque, kind, operation_id)
       VALUES (@ts, @ended_at, @task, @host, @hosts, @bytes_out, @bytes_in, @outcome, @status, @error_class, @model, @attributed, @opaque, @kind, @operation_id)`
    );
    this.db = db;
    this.insert = insert;
    return this;
  }

  get persisting() {
    return this.mode === "persist";
  }

  setPersistence(enabled) {
    if (enabled !== true) {
      if (this.mode === "pending") for (const row of this.memory) row.scope = "memory";
      this.mode = "memory";
      return;
    }
    this.mode = "persist";
    this.flushPending();
  }

  flushPending() {
    if (!this.db || this.mode !== "persist") return false;
    const pending = this.memory.filter((row) => row.scope === "pending");
    if (pending.length === 0) return true;
    try {
      const insert = this.insert;
      this.db.transaction(() => {
        for (const { id: _id, scope: _scope, ...row } of pending) insert.run(row);
      })();
      const flushed = new Set(pending);
      this.memory = this.memory.filter((row) => !flushed.has(row));
      this.persistError = null;
      return true;
    } catch (error) {
      this.persistError = safePersistError(error);
      return false;
    }
  }

  normalize(event) {
    if (!EGRESS_TASKS.includes(event?.task)) throw new TypeError("Unknown egress task");
    if (!OUTCOMES.has(event.outcome)) throw new TypeError("Unknown egress outcome");
    const host = bareHost(event.host);
    const trail = [host, ...(Array.isArray(event.hosts) ? event.hosts.map(bareHost) : [])];
    const hosts = [...new Set(trail)].slice(0, MAX_TRAIL);
    const kind = event.kind ?? (event.opaque === true ? "session" : "request");
    if (!KINDS.includes(kind)) throw new TypeError("Unknown egress kind");
    const opaque = kind === "session";
    const ts = count(event.ts) ?? this.now();
    return {
      ts,
      ended_at: count(event.endedAt) ?? ts,
      task: event.task,
      host,
      hosts: hosts.join(","),
      bytes_out: opaque ? null : count(event.bytesOut),
      bytes_in: opaque ? null : count(event.bytesIn),
      outcome: event.outcome,
      status: Number.isInteger(event.status) ? event.status : null,
      error_class: errorClass(event.errorClass),
      model: modelId(event.model),
      attributed: event.attributed === false ? 0 : 1,
      opaque: opaque ? 1 : 0,
      kind,
      operation_id: Number.isInteger(event.operationId) ? event.operationId : null,
    };
  }

  remember(row, scope) {
    const id = this.nextMemoryId--;
    this.memory.push({ id, scope, ...row });
    if (this.memory.length > MEMORY_LIMIT) this.memory.splice(0, this.memory.length - MEMORY_LIMIT);
    return id;
  }

  record(event) {
    const row = this.normalize(event);
    let id;
    if (this.mode === "persist" && this.db) {
      try {
        id = Number(this.insert.run(row).lastInsertRowid);
        if (++this.writesSinceCap >= CAP_CHECK_EVERY) this.capRows();
      } catch (error) {
        // The insert itself failed; a cap-sweep failure after insert is handled separately.
        this.persistError = safePersistError(error);
        id = this.remember(row, "pending");
      }
    } else {
      id = this.remember(row, this.mode === "memory" ? "memory" : "pending");
    }
    const published = toPublic({ id, ...row });
    this.emit("event", published);
    return published;
  }

  list({ since = 0, limit = 500 } = {}) {
    const lim = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_ROWS);
    let fromDb = [];
    if (this.db) {
      try {
        fromDb = this.db
          .prepare("SELECT * FROM egress_events WHERE ts >= ? ORDER BY ts DESC, id DESC LIMIT ?")
          .all(since, lim);
        if (this.persistError === "READ_ERROR") this.persistError = null;
      } catch {
        this.persistError = "READ_ERROR";
      }
    }
    const fromMemory = this.memory.filter((row) => row.ts >= since);
    const order = (row) => (row.id > 0 ? row.id : Number.MAX_SAFE_INTEGER / 2 - row.id);
    return [...fromDb, ...fromMemory]
      .sort((a, b) => b.ts - a.ts || order(b) - order(a))
      .slice(0, lim)
      .map(toPublic);
  }

  summary({ since = 0 } = {}) {
    const rows = this.list({ since, limit: MAX_ROWS });
    const sent = rows.filter((row) => row.outcome !== "blocked" && row.kind !== "operation");
    const observed = sent.filter((row) => row.kind === "request" || row.kind === "stream");
    const connections = sent.filter((row) => row.kind === "connection");
    const unexplained = rows.filter((row) => !row.attributed);
    const sum = (key) => observed.reduce((total, row) => total + (row[key] ?? 0), 0);
    return {
      left:
        observed.length + connections.length + sent.filter((row) => row.kind === "session").length,
      observed: observed.length,
      connections: connections.length,
      blocked: rows.filter((row) => row.outcome === "blocked").length,
      unattributed: unexplained.length,
      unattributedHosts: [...new Set(unexplained.map((row) => row.host))],
      bytesOut: sum("bytesOut"),
      bytesIn: sum("bytesIn"),
      unknownBytes: observed.filter((row) => row.bytesOut == null).length,
      opaqueSessions: sent.filter((row) => row.kind === "session").length,
    };
  }

  clear() {
    try {
      if (this.db) this.db.prepare("DELETE FROM egress_events").run();
      this.memory = [];
      this.persistError = null;
      this.emit("cleared");
    } catch (error) {
      this.persistError = safePersistError(error);
    }
  }

  capRows(maxRows = MAX_ROWS) {
    if (!this.db) return 0;
    const cap = Math.min(MAX_ROWS, Math.max(1, Math.trunc(maxRows) || 1));
    this.writesSinceCap = 0;
    try {
      const deleted = this.db
        .prepare(
          "DELETE FROM egress_events WHERE id NOT IN (SELECT id FROM egress_events ORDER BY ts DESC, id DESC LIMIT ?)"
        )
        .run(cap).changes;
      if (!this.memory.some((row) => row.scope === "pending")) this.persistError = null;
      return deleted;
    } catch (error) {
      this.persistError = safePersistError(error);
      return 0;
    }
  }

  prune({ retentionDays, maxRows = MAX_ROWS } = {}) {
    const cutoff =
      Number.isFinite(retentionDays) && retentionDays > 0
        ? this.now() - retentionDays * DAY_MS
        : null;
    const cap = Math.min(MAX_ROWS, Math.max(1, Math.trunc(maxRows) || 1));
    if (cutoff !== null) this.memory = this.memory.filter((row) => row.ts >= cutoff);
    if (!this.db) return { deleted: 0 };
    this.flushPending();
    try {
      const deleted = this.db.transaction(() => {
        let removed = 0;
        if (cutoff !== null)
          removed += this.db.prepare("DELETE FROM egress_events WHERE ts < ?").run(cutoff).changes;
        removed += this.db
          .prepare(
            "DELETE FROM egress_events WHERE id NOT IN (SELECT id FROM egress_events ORDER BY ts DESC, id DESC LIMIT ?)"
          )
          .run(cap).changes;
        return removed;
      })();
      this.writesSinceCap = 0;
      if (!this.memory.some((row) => row.scope === "pending")) this.persistError = null;
      return { deleted };
    } catch (error) {
      this.persistError = safePersistError(error);
      return { deleted: 0 };
    }
  }
}

const CSV_HEADER = [
  "started_utc",
  "ended_utc",
  "task",
  "kind",
  "hosts",
  "bytes_sent",
  "bytes_received",
  "outcome",
  "status",
  "error_class",
  "model",
  "attributed",
  "opaque_session",
];

function csvCell(value) {
  if (value == null) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(events) {
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
  const lines = events.map((event) =>
    [
      iso(event.ts),
      iso(event.endedAt),
      event.task,
      event.kind,
      event.hosts.join(" "),
      event.bytesOut,
      event.bytesIn,
      event.outcome,
      event.status,
      event.errorClass,
      event.model,
      event.attributed ? "yes" : "no",
      event.opaque ? "yes" : "no",
    ]
      .map(csvCell)
      .join(",")
  );
  return [CSV_HEADER.join(","), ...lines].join("\n") + "\n";
}

module.exports = {
  FlightRecorder,
  toCsv,
  ERROR_CLASSES,
  KINDS,
  MAX_ROWS,
  MEMORY_LIMIT,
  CAP_CHECK_EVERY,
};
